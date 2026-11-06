"use strict";

// Row-level TRAE cache-estimate fold (owner review 2026-11-07).
//
// computeRowCost already bills a row's MEASURED cache at the cache rate, so
// the fold must never re-fold those rows — the previous whole-row factor
// double-discounted exactly the best-covered months and folded output, which
// is not cacheable. The contract under test:
//   - a row whose measured coverage >= 50% keeps its computeRowCost cost;
//   - a dry row (observed 0) folds ONLY its unmeasured input side — output,
//     reasoning and measured cache keep their exact computeRowCost pricing;
//   - a legacy row without the coverage signal behaves like observed = 0.

const test = require("node:test");
const assert = require("node:assert/strict");

const { computeRowCost, foldTraeRowCost, __setTraeFoldStateForTest } = require("../src/lib/local-api");
const { resetPricingCacheForTest } = require("../src/lib/pricing");

test.beforeEach(() => {
  resetPricingCacheForTest?.();
  __setTraeFoldStateForTest({
    // deepseek-v4.1-flash's real self rate (measured 95.2%).
    byModel: { "deepseek-v4.1-flash": { hits: 952, volume: 1000 } },
    recognizedRate: 0.966,
  });
});

test.afterEach(() => {
  __setTraeFoldStateForTest({ byModel: {}, recognizedRate: 0 });
});

function row(overrides = {}) {
  return {
    source: "trae-cn",
    model: "deepseek-v4.1-flash",
    input_tokens: 1_000_000,
    output_tokens: 100_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    ...overrides,
  };
}

test("a well-covered row keeps its computeRowCost cost untouched", () => {
  // September shape: the bucket's measured coverage is 90% — computeRowCost
  // already billed the measured cache at the cache rate; folding again would
  // double-discount (the regression the owner caught: $20.22 -> $2.53).
  const r = row({ cache_observed_input_tokens: 900_000 });
  assert.equal(foldTraeRowCost(r, computeRowCost(r)), computeRowCost(r));
});

test("a dry row folds only its unmeasured input side; output keeps its price", () => {
  // November shape: the client reports no cache fields at all — every input
  // token is unmeasured and rides the estimate; output is priced at the
  // output rate and must come through the fold untouched.
  const r = row();
  const base = computeRowCost(r);
  // Manual expectation: unmeasured cost = 1M input at the uncached rate;
  // fold factor = (1-0.952) + 0.952 * (0.006/0.3).
  const foldFactor = (1 - 0.952) + 0.952 * (0.006 / 0.3);
  const unmeasuredCost = 1_000_000 * 0.3 / 1_000_000;
  const expected = base - unmeasuredCost + unmeasuredCost * foldFactor;
  assert.ok(Math.abs(foldTraeRowCost(r, base) - expected) < 1e-12);

  // The output leg is untouched by the fold: a row with the same input but
  // different output costs exactly base diff, not base diff * foldFactor.
  const r2 = row({ output_tokens: 300_000 });
  const base2 = computeRowCost(r2);
  const expected2 = base2 - unmeasuredCost + unmeasuredCost * foldFactor;
  assert.ok(Math.abs(foldTraeRowCost(r2, base2) - expected2) < 1e-12);
  assert.ok(Math.abs((expected2 - expected) - (base2 - base)) < 1e-12,
    "the output cost delta must survive the fold unchanged");
});

test("a legacy row without the coverage signal folds like observed = 0", () => {
  // Pre-signal queue rows carry no cache_observed_input_tokens: the whole
  // input side is unmeasured and folds, exactly like the dry row.
  const legacy = row();
  delete legacy.cache_observed_input_tokens;
  const dry = row({ cache_observed_input_tokens: 0 });
  assert.equal(
    foldTraeRowCost(legacy, computeRowCost(legacy)),
    foldTraeRowCost(dry, computeRowCost(dry)),
  );

  // Non-TRAE sources are never folded, whatever the row carries.
  const codex = row({ source: "codex" });
  assert.equal(foldTraeRowCost(codex, computeRowCost(codex)), computeRowCost(codex));
});

test("a sprinkled row folds just its unmeasured remainder (partial coverage below the gate)", () => {
  // The 2026-11-07 production shape: 44k measured against a 74.2M input side
  // (0.06% coverage) — the unmeasured remainder folds, the measured 44k keep
  // their computeRowCost pricing.
  const measured = 44_000;
  const r = row({
    input_tokens: 74_176_000 - measured,
    cached_input_tokens: measured,
    cache_observed_input_tokens: measured,
  });
  const base = computeRowCost(r);
  const foldFactor = (1 - 0.952) + 0.952 * (0.006 / 0.3);
  const unmeasuredCost = (74_176_000 - measured) * 0.3 / 1_000_000;
  const expected = base - unmeasuredCost + unmeasuredCost * foldFactor;
  assert.ok(Math.abs(foldTraeRowCost(r, base) - expected) < 1e-9);
});

test("models without evidence or official cache pricing stay at the ceiling", () => {
  // No fielded history and no recognized rate: nothing to fold with.
  __setTraeFoldStateForTest({ byModel: {}, recognizedRate: 0 });
  const r = row();
  assert.equal(foldTraeRowCost(r, computeRowCost(r)), computeRowCost(r));

  // A model with no cache_read pricing cannot be folded either.
  __setTraeFoldStateForTest({ byModel: {}, recognizedRate: 0.9 });
  const noCachePricing = row({ model: "model-without-cache-pricing" });
  assert.equal(
    foldTraeRowCost(noCachePricing, computeRowCost(noCachePricing)),
    computeRowCost(noCachePricing),
  );
});
