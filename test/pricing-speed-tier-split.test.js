"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { computeRowCost, computeRowSpeedTierSplit } = require("../src/lib/pricing/index");

// gpt-6.1-sol carries priority_multiplier 2 and ultrafast_multiplier 6 in the
// curated overrides.
function codexRow(overrides = {}) {
  return {
    source: "codex",
    model: "gpt-6.1-sol",
    input_tokens: 2_000_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 400_000,
    reasoning_output_tokens: 0,
    total_tokens: 2_400_000,
    billable_total_tokens: 2_400_000,
    ...overrides,
  };
}

test("rows without any observed speed-tier subset return null", () => {
  assert.equal(computeRowSpeedTierSplit(codexRow()), null);
  // A non-codex row never carries the fields at all.
  assert.equal(computeRowSpeedTierSplit({ source: "claude", model: "x", input_tokens: 10 }), null);
});

test("a priority subset includes its standard base and multiplier", () => {
  const row = codexRow({
    priority_input_tokens: 1_000_000,
    priority_output_tokens: 100_000,
  });
  const split = computeRowSpeedTierSplit(row);
  assert.ok(split);
  assert.equal(split.priority_cost_usd, 6);
  assert.equal(split.ultrafast_cost_usd, 0);
  const standard = computeRowCost(codexRow({ input_tokens: 1_000_000, output_tokens: 300_000 }));
  assert.ok(Math.abs(computeRowCost(row) - (standard + split.priority_cost_usd)) < 1e-9);
});

test("both tiers present: full tier costs and the Standard remainder sum to the total", () => {
  const row = codexRow({
    priority_input_tokens: 1_000_000,
    priority_output_tokens: 100_000,
    ultrafast_input_tokens: 500_000,
    ultrafast_output_tokens: 50_000,
  });
  const split = computeRowSpeedTierSplit(row);
  assert.ok(split.priority_cost_usd > 0 && split.ultrafast_cost_usd > 0);
  assert.equal(split.priority_cost_usd, 6);
  assert.equal(split.ultrafast_cost_usd, 9);
  const base = computeRowCost(codexRow({ input_tokens: 500_000, output_tokens: 250_000 }));
  const total = computeRowCost(row);
  assert.ok(Math.abs(total - (base + split.priority_cost_usd + split.ultrafast_cost_usd)) < 1e-9);
  // Ultrafast bills at 3x the priority multiplier (6 vs 2) on the same rate
  // base; with different subset sizes just verify both scale above base share.
  assert.ok(split.ultrafast_cost_usd > 0);
});

test("authoritative-cost sources report zero split (total is provider-reported)", () => {
  const row = codexRow({ source: "grok", priority_input_tokens: 1_000_000, total_cost_usd: 5 });
  const split = computeRowSpeedTierSplit(row);
  assert.ok(split);
  assert.equal(split.priority_cost_usd, 0);
  assert.equal(split.ultrafast_cost_usd, 0);
});

test("an entirely Fast row assigns its full cost to Fast rather than to Standard", () => {
  const row = codexRow({ priority_input_tokens: 2_000_000, priority_output_tokens: 400_000 });
  assert.equal(computeRowSpeedTierSplit(row).priority_cost_usd, computeRowCost(row));
});

test("an entirely Ultrafast long-context row includes the tier's base and context cost", () => {
  const row = codexRow({
    long_context_input_tokens: 2_000_000, long_context_output_tokens: 400_000,
    ultrafast_input_tokens: 2_000_000, ultrafast_output_tokens: 400_000,
    ultrafast_long_context_input_tokens: 2_000_000, ultrafast_long_context_output_tokens: 400_000,
  });
  assert.equal(computeRowSpeedTierSplit(row).ultrafast_cost_usd, computeRowCost(row));
});
