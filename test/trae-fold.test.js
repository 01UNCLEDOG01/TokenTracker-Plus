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
  // Reset BOTH edition pools — tests that inject the trae (intl) pool must
  // not leak module state into later tests in the same process.
  __setTraeFoldStateForTest({ byModel: {}, recognizedRate: 0, edition: "trae-cn" });
  __setTraeFoldStateForTest({ byModel: {}, recognizedRate: 0, edition: "trae" });
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

test("an off-peak row folds at its own effective input price (no negative folds)", () => {
  // DeepSeek bills off-peak hours at half price via the row's hour_start. The
  // naive synthetic reprice used the full list rate, so the unmeasured cost
  // exceeded the row's real cost and the fold went NEGATIVE on off-peak rows.
  // The fold now scales the row's own input-leg cost proportionally.
  // Off-peak: 12:00 UTC on a weekday (peak = 01:00-04:00 / 06:00-10:00 UTC).
  const r = row({ hour_start: "2026-11-04T12:00:00.000Z" });
  const base = computeRowCost(r);
  const foldFactor = (1 - 0.952) + 0.952 * (0.006 / 0.3);
  const folded = foldTraeRowCost(r, base);
  // Off-peak input leg = 1M * (0.3/2) / 1e6 = 0.15; folded = base - 0.15 + 0.15*f.
  const expected = base - 0.15 + 0.15 * foldFactor;
  assert.ok(Math.abs(folded - expected) < 1e-9, `folded ${folded} vs expected ${expected}`);
  assert.ok(folded > 0, "the fold must stay positive on discounted rows");
  // The output leg still survives proportionally.
  const r2 = row({ hour_start: "2026-11-04T12:00:00.000Z", output_tokens: 300_000 });
  const base2 = computeRowCost(r2);
  const expected2 = base2 - 0.15 + 0.15 * foldFactor;
  assert.ok(Math.abs(foldTraeRowCost(r2, base2) - expected2) < 1e-9);
  assert.ok(Math.abs((foldTraeRowCost(r2, base2) - folded) - (base2 - base)) < 1e-9,
    "the output cost delta must survive the fold unchanged off-peak");
});

test("a bucket with cache-creation volume never folds negative", () => {
  // Legacy-shaped bucket: cache_creation rides the input side but not the
  // fresh column; unclamped, the unmeasured share exceeded fresh and the
  // proportional fold over-drew the input leg (deepseek-v4-flash -43.22).
  const cc = 600_000;
  const r = row({
    input_tokens: 200_000,
    cached_input_tokens: 0,
    cache_creation_input_tokens: cc,
    cache_observed_input_tokens: 0,
  });
  const base = computeRowCost(r);
  const folded = foldTraeRowCost(r, base);
  assert.ok(folded > 0, `folded must stay positive, got ${folded}`);
  // Clamped to fresh: only the 200k fresh input folds, at the effective
  // input price; the creation leg keeps its computeRowCost pricing.
  const foldFactor = (1 - 0.952) + 0.952 * (0.006 / 0.3);
  const inputLeg = base - computeRowCost({ ...r, input_tokens: 0 });
  const expected = base - inputLeg + inputLeg * foldFactor;
  assert.ok(Math.abs(folded - expected) < 1e-9, `folded ${folded} vs expected ${expected}`);
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

test("edition isolation: trae (intl) rows never fold on trae-cn evidence", () => {
  // The intl edition has no fielded history of its own. The trae-cn pool is
  // full of evidence (beforeEach), yet the intl row must stay at the uncached
  // rate — the editions run different model fleets, and borrowing measured
  // rates across them silently mispriced the intl dry spell (owner ruling
  // 2026-11-10: split the pools).
  const r = row({ source: "trae" });
  const base = computeRowCost(r);
  assert.equal(foldTraeRowCost(r, base), base,
    "an intl row must not fold while only trae-cn has evidence");
});

test("edition isolation: trae (intl) rows fold on their own edition's pool", () => {
  __setTraeFoldStateForTest({
    byModel: { "deepseek-v4.1-flash": { hits: 40, volume: 100 } },
    recognizedRate: 0.4,
    edition: "trae",
  });
  const r = row({ source: "trae" });
  const base = computeRowCost(r);
  const folded = foldTraeRowCost(r, base);
  assert.ok(folded < base, "intl evidence must fold intl rows");
  const foldFactor = (1 - 0.4) + 0.4 * (0.006 / 0.3);
  const inputLeg = base - computeRowCost({ ...r, input_tokens: 0 });
  const expected = base - inputLeg + inputLeg * foldFactor;
  assert.ok(Math.abs(folded - expected) < 1e-9, `folded ${folded} vs expected ${expected}`);
});

test("edition isolation: trae-cn rows ignore the trae (intl) pool", () => {
  // Mirrored direction: a weak intl pool must not drag the CN evidence down.
  __setTraeFoldStateForTest({
    byModel: { "deepseek-v4.1-flash": { hits: 10, volume: 100 } },
    recognizedRate: 0.1,
    edition: "trae",
  });
  const r = row({ source: "trae-cn" });
  const base = computeRowCost(r);
  const folded = foldTraeRowCost(r, base);
  // CN evidence is still the 952/1000 pool from beforeEach.
  const cnFoldFactor = (1 - 0.952) + 0.952 * (0.006 / 0.3);
  const intlFoldFactor = (1 - 0.1) + 0.1 * (0.006 / 0.3);
  const inputLeg = base - computeRowCost({ ...r, input_tokens: 0 });
  const cnExpected = base - inputLeg + inputLeg * cnFoldFactor;
  const intlExpected = base - inputLeg + inputLeg * intlFoldFactor;
  assert.ok(Math.abs(folded - cnExpected) < 1e-9, `folded ${folded} vs cn-expected ${cnExpected}`);
  assert.ok(Math.abs(cnExpected - intlExpected) > 1e-6,
    "the two editions' rates must be far enough apart to tell the pools apart");
});
