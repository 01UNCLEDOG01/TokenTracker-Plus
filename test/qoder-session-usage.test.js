const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  applyWallClockSpeed,
  applyQoderSessionUsageEstimates,
  scanQoderSession,
} = require("../src/lib/session-analytics");

// A Qoder profile whose client texts name the router ids, plus a transcript
// whose assistant rows carry a model and zeroed usage — the exact shape Qoder
// CN writes.
function qoderFixtureHome({ models, slug = "qfmodel" }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-qoder-scan-"));
  const authDir = path.join(home, ".qoder-cn", ".auth");
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, "dynamic-texts.json"), JSON.stringify({
    en: {
      "modelSelector.item.qfmodel": "Qwen3.8-Flash",
      "modelSelector.item.dfmodel": "DeepSeek-Flash",
      "modelSelector.item.auto": "Auto",
    },
  }));
  const sessionDir = path.join(home, "projects", "F--demo");
  fs.mkdirSync(sessionDir, { recursive: true });
  const file = path.join(sessionDir, "s1.jsonl");
  const lines = models.map((model, i) => JSON.stringify({
    type: "assistant",
    sessionId: "s1",
    timestamp: new Date(1764000000000 + i * 60000).toISOString(),
    message: {
      model,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }));
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return { home, file };
}

test("zero-usage Qoder CN rows still attribute their router model", async () => {
  const { home, file } = qoderFixtureHome({ models: ["qfmodel", "qfmodel", "qfmodel"] });
  const record = await scanQoderSession(file, "qoder-cn", { home });
  assert.equal(record.model, "Qwen3.8-Flash");
  assert.equal(record.total_tokens, 0);
  // No usage was ever reported, so the row must not claim precision it lacks.
  assert.equal(record.usage_precision, "unavailable");
  fs.rmSync(home, { recursive: true, force: true });
});

test("Auto is a selector bucket and is never attributed as a model", async () => {
  const { home, file } = qoderFixtureHome({ models: ["auto", "auto"] });
  const record = await scanQoderSession(file, "qoder-cn", { home });
  assert.notEqual(record.model, "Auto");
  assert.ok(!record.model || record.model === "unknown");
  fs.rmSync(home, { recursive: true, force: true });
});

test("a session that mixed two routers keeps both models with measured counts", async () => {
  const { home, file } = qoderFixtureHome({ models: ["qfmodel", "qfmodel", "qfmodel", "dfmodel"] });
  const record = await scanQoderSession(file, "qoder-cn", { home });
  assert.equal(record.model, "mixed");
  assert.deepEqual(record.model_message_counts, { "Qwen3.8-Flash": 3, "DeepSeek-Flash": 1 });
  assert.equal(record.model_usage.length, 2);
  assert.equal(record.total_tokens, 0);
  fs.rmSync(home, { recursive: true, force: true });
});

test("mixed sessions split allocated tokens by measured message counts", () => {
  const sessions = [{
    source: "qoder-cn",
    turns: 4,
    active_ms: 60000,
    total_tokens: 0,
    performance: {},
    model: "mixed",
    model_message_counts: { "Qwen3.8-Flash": 3, "DeepSeek-Flash": 1 },
  }];
  applyQoderSessionUsageEstimates(sessions, [
    { source: "qoder-cn", total_tokens: 1000, input_tokens: 800, cached_input_tokens: 100, output_tokens: 100 },
  ]);

  const [row] = sessions;
  assert.equal(row.model_usage.length, 2);
  // 3:1 measured message ratio, and the split must consume the whole pool.
  assert.equal(row.model_usage[0].total_tokens, 750);
  assert.equal(row.model_usage[1].total_tokens, 250);
  assert.equal(row.model_usage.reduce((sum, r) => sum + r.total_tokens, 0), 1000);
  assert.equal(row.model_usage.reduce((sum, r) => sum + r.input_tokens, 0), 800);
  assert.ok(row.cost_usd > 0);
});

test("credit-derived rows are priced by model instead of collapsing to zero", () => {
  const sessions = [
    { source: "qoder-cn", turns: 1, active_ms: 60000, total_tokens: 0, performance: {}, model: "Qwen3.8-Flash" },
    { source: "qoder-cn", turns: 1, active_ms: 60000, total_tokens: 0, performance: {} },
  ];
  applyQoderSessionUsageEstimates(sessions, [
    { source: "qoder-cn", total_tokens: 2000000, input_tokens: 1600000, cached_input_tokens: 200000, output_tokens: 200000 },
  ]);

  const [named, unknown] = sessions;
  assert.ok(named.cost_usd > 0, "a known model must cost something once tokens are allocated");
  assert.equal(named.cost_usd, named.model_usage[0].cost_usd);
  assert.equal(unknown.cost_usd, 0);
  assert.equal(unknown.cost_is_partial, true, "an unattributed row stays a lower bound, not a real figure");
});

test("wall-clock speed fills sources without per-request timing", () => {
  const record = {
    source: "workbuddy",
    output_tokens: 100000,
    active_ms: 1000000,
    turns: 10,
    performance: {},
  };
  applyWallClockSpeed(record);
  assert.equal(record.performance.estimated_tokens_per_second, 100);
  assert.equal(record.performance_source, "wall-clock");

  const precise = {
    source: "workbuddy",
    output_tokens: 100000,
    active_ms: 1000000,
    performance: {
      estimated_output_tokens: 50000,
      estimated_duration_ms: 1000,
      estimated_request_count: 1,
      estimated_tokens_per_second: 50000,
    },
  };
  applyWallClockSpeed(precise);
  assert.equal(precise.performance.estimated_tokens_per_second, 50000);
});

test("Qoder credit estimates are allocated across zero-usage sessions by turns", () => {
  const sessions = [
    { source: "qoder-cn", turns: 1, active_ms: 60000, total_tokens: 0, performance: {} },
    { source: "qoder-cn", turns: 3, active_ms: 120000, total_tokens: 0, performance: {} },
    { source: "qoder-cn", turns: 2, active_ms: 60000, total_tokens: 100, performance: {} },
    { source: "qoder", turns: 2, active_ms: 60000, total_tokens: 0, performance: {} },
  ];
  applyQoderSessionUsageEstimates(sessions, [
    { source: "qoder-cn", total_tokens: 500, input_tokens: 400, cached_input_tokens: 50, output_tokens: 50 },
    { source: "qoder", total_tokens: 100, input_tokens: 90, output_tokens: 10 },
  ]);

  const cn = sessions.filter((session) => session.source === "qoder-cn");
  assert.equal(cn.reduce((sum, session) => sum + session.total_tokens, 0), 500);
  assert.equal(cn[0].total_tokens, 100); // 1 of 4 allocated turns
  assert.equal(cn[1].total_tokens, 300);
  assert.equal(cn[2].total_tokens, 100); // pre-existing real value, untouched
  assert.equal(cn[0].usage_precision, "estimated");
  assert.equal(cn[0].usage_source, "qoder-credit-estimate");
  assert.equal(cn[0].model_usage.length, 1);
  assert.ok(cn[0].performance.estimated_tokens_per_second > 0);

  const intl = sessions.find((session) => session.source === "qoder");
  assert.equal(intl.total_tokens, 100);
  assert.equal(intl.output_tokens, 10);
  assert.equal(intl.usage_precision, "estimated");
});
