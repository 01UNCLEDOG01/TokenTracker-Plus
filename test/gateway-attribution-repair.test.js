"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planGatewayAttributionRepair,
  applyGatewayAttributionRepair,
} = require("../src/lib/gateway-attribution-repair");

const HOUR = "2026-10-16T09:00:00.000Z";
const TS = Date.UTC(2026, 9, 16, 9, 5, 0);

function bucket({ input = 0, cached = 0, output = 0, conv = 0 } = {}) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + cached + output,
    billable_total_tokens: input + cached + output,
    total_cost_usd: 0,
    conversation_count: conv,
  };
}

function request(overrides = {}) {
  return {
    ts: TS,
    client: "ZCode",
    client_model: "glm-5.3-flash",
    upstream_model: "glm-5.3-flash",
    prompt_tokens: 300_000,
    completion_tokens: 10_000,
    cache_read_tokens: 250_000,
    status: 200,
    ...overrides,
  };
}

test("zcode rows leave the gateway card and credit input-only to zcode", () => {
  const buckets = new Map([
    ["agent2api|glm-5.3-flash|" + HOUR, bucket({ input: 1_100_000, cached: 1_250_000, output: 60_000, conv: 5 })],
    ["zcode|glm-5.3-flash|" + HOUR, bucket({ input: 0, cached: 0, output: 4_000, conv: 1 })],
  ]);
  const plan = planGatewayAttributionRepair({ requests: [request()], buckets });
  const { touched, warnings } = applyGatewayAttributionRepair({ buckets, plan });

  assert.deepEqual(warnings, []);
  assert.ok(touched.has("agent2api|glm-5.3-flash|" + HOUR));
  const gateway = buckets.get("agent2api|glm-5.3-flash|" + HOUR);
  assert.equal(gateway.input_tokens, 1_100_000 - 50_000);
  assert.equal(gateway.cached_input_tokens, 1_250_000 - 250_000);
  assert.equal(gateway.output_tokens, 60_000 - 10_000);
  assert.equal(gateway.total_tokens, 2_410_000 - 310_000);
  assert.equal(gateway.conversation_count, 4);

  const zcode = buckets.get("zcode|glm-5.3-flash|" + HOUR);
  assert.equal(zcode.input_tokens, 50_000, "fresh input credited");
  assert.equal(zcode.cached_input_tokens, 250_000, "cache credited");
  assert.equal(zcode.output_tokens, 4_000, "ZCode's own completion must not be duplicated");
  assert.equal(zcode.total_tokens, 304_000);
  assert.equal(zcode.conversation_count, 1, "no phantom conversation added");
});

test("dsh rows are removed from the gateway card and credited nowhere", () => {
  // The parser canonicalizes `sn-deepseek-v4-1-flash` to `deepseek-v4.1-flash`
  // before building the bucket key; the repair must use the same key.
  const buckets = new Map([
    ["agent2api|deepseek-v4.1-flash|" + HOUR, bucket({ input: 100_000, cached: 900_000, output: 20_000, conv: 2 })],
  ]);
  const plan = planGatewayAttributionRepair({
    requests: [request({ client: "deepseek-harness", client_model: "sn-deepseek-v4-1-flash", upstream_model: "sn-deepseek-v4-1-flash" })],
    buckets,
  });
  assert.equal(plan.credits.size, 0);
  applyGatewayAttributionRepair({ buckets, plan });
  const gateway = buckets.get("agent2api|deepseek-v4.1-flash|" + HOUR);
  assert.equal(gateway.total_tokens, 1_020_000 - 310_000);
  assert.equal(gateway.input_tokens, 50_000);
  assert.equal(gateway.cached_input_tokens, 650_000);
  assert.equal(gateway.output_tokens, 10_000);
  assert.equal(gateway.conversation_count, 1);
});

test("claude rows lose the phantom conversation but keep their tokens", () => {
  const buckets = new Map([
    ["claude|deepseek-v4.1-flash|" + HOUR, bucket({ input: 100_000, cached: 500_000, output: 20_000, conv: 3 })],
  ]);
  const plan = planGatewayAttributionRepair({
    requests: [request({ client: "Claude Code", client_model: "deepseek-flash", upstream_model: "deepseek-v4-1-flash" })],
    buckets,
  });
  assert.equal(plan.removals.size, 1);
  applyGatewayAttributionRepair({ buckets, plan });
  const claude = buckets.get("claude|deepseek-v4.1-flash|" + HOUR);
  assert.equal(claude.total_tokens, 620_000);
  assert.equal(claude.conversation_count, 2);
});

test("unknown clients and non-200 rows are left alone", () => {
  const buckets = new Map([
    ["agent2api|glm-5.3-flash|" + HOUR, bucket({ input: 1_000, output: 100, conv: 1 })],
  ]);
  const plan = planGatewayAttributionRepair({
    requests: [
      request({ client: "other" }),
      request({ client: "" }),
      request({ client: "ZCode", status: 500 }),
    ],
    buckets,
  });
  assert.equal(plan.removals.size, 0);
  assert.equal(plan.credits.size, 0);
});

test("a removal with no matching bucket is skipped, including its credit", () => {
  const buckets = new Map();
  const plan = planGatewayAttributionRepair({ requests: [request()], buckets });
  assert.equal(plan.removals.size, 0);
  assert.equal(plan.credits.size, 0);
  assert.equal(plan.skipped, 1);
});

test("removal clamps at zero and warns instead of going negative", () => {
  const buckets = new Map([
    ["agent2api|glm-5.3-flash|" + HOUR, bucket({ input: 10, cached: 0, output: 1, conv: 0 })],
  ]);
  const plan = planGatewayAttributionRepair({ requests: [request()], buckets });
  const { warnings } = applyGatewayAttributionRepair({ buckets, plan });
  const gateway = buckets.get("agent2api|glm-5.3-flash|" + HOUR);
  assert.equal(gateway.input_tokens, 0);
  assert.equal(gateway.cached_input_tokens, 0);
  assert.equal(gateway.output_tokens, 0);
  assert.ok(warnings.some((w) => w.includes("exceeded bucket")));
});

test("a credit creates the zcode bucket when it never existed", () => {
  const buckets = new Map([
    ["agent2api|glm-5.3-flash|" + HOUR, bucket({ input: 1_000, output: 100, conv: 1 })],
  ]);
  const plan = planGatewayAttributionRepair({ requests: [request()], buckets });
  applyGatewayAttributionRepair({ buckets, plan });
  const zcode = buckets.get("zcode|glm-5.3-flash|" + HOUR);
  assert.ok(zcode);
  assert.equal(zcode.input_tokens, 50_000);
  assert.equal(zcode.cached_input_tokens, 250_000);
  assert.equal(zcode.output_tokens, 0);
});
