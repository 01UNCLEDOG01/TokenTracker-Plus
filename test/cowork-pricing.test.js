"use strict";

// Pricing for the codely-* models Codely itself records.
//
// The regression these pin is the one that produced a 5x overstatement: the
// cached portion of a Codely turn is 95.9% of its tokens, and charging that
// portion at the full input rate instead of the cache-read rate inflates the
// card by ~5x. It is easy to write because computeRowCost reads
// `row.cached_input_tokens`, a different key from the `cache_read_*` names the
// price tables use - pass the wrong one and the cached tokens are silently
// dropped (too low), or fold them into input_tokens and they get billed twice at
// the full rate (too high). All three mistakes were made while building this,
// so each is pinned below.
//
// Every expected number comes from the machine's own queue, not from hand
// arithmetic: 12 deduped buckets, 81,866,295 tokens.

const test = require("node:test");
const assert = require("node:assert");

const { computeRowCost, getModelPricing } = require("../src/lib/pricing");
const overrides = require("../src/lib/pricing/curated-overrides.json");

const SOURCE = "tuanjie-cowork";

// Measured on this machine: deduped per model across all buckets.
const MEASURED = {
  "codely-core": { fresh: 1809762, cached: 38547264, output: 124155, usd: 13.1022 },
  "codely-basic": { fresh: 1106582, cached: 39344896, output: 94476, usd: 0.6814 },
  "codely-air": { fresh: 194421, cached: 614400, output: 30339, usd: 0.0984 },
};
const MEASURED_TOTAL_TOKENS = 81866295;

function cost(model, { fresh, cached, output }) {
  return Number(computeRowCost({
    source: SOURCE,
    model,
    input_tokens: fresh,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: output,
  })) || 0;
}

test("each codely id resolves to its underlying model's card", () => {
  const se = overrides.source_exact[SOURCE];
  assert.ok(se, "source_exact is scoped per source so a codely row cannot inherit a bare model's price");
  assert.deepEqual(Object.keys(se).sort(),
    ["codely-air", "codely-basic", "codely-core", "codely-flash"]);

  // codely-core is GLM-5.3; the other three are DeepSeek-V4.1-Flash.
  assert.deepEqual(
    [se["codely-core"].input, se["codely-core"].output, se["codely-core"].cache_read],
    [1.4, 4.4, 0.26], "same numbers as curated:exact glm-5.3, not fresh ones");
  for (const id of ["codely-air", "codely-basic", "codely-flash"]) {
    assert.deepEqual(
      [se[id].input, se[id].output, se[id].cache_read, se[id].cache_write],
      [0.3, 1.2, 0.006, 0.3], `${id} matches curated:exact deepseek-v4.1-flash`);
  }
});

test("the card is reported as an API-equivalent reference, not a provider charge", () => {
  const note = overrides.source_exact[SOURCE]["codely-core"].note;
  assert.match(note, /API-EQUIVALENT REFERENCE/);
  assert.match(note, /subscription/i);
  assert.match(note, /display_name/);
  // The 0.25x badge has no documented baseline, so it must NOT be silently
  // applied - the note has to say so out loud.
  assert.match(note, /0\.25x/);
});

test("cached tokens are billed at the cache-read rate, not the input rate", () => {
  const m = MEASURED["codely-core"];
  const actual = cost("codely-core", m);
  assert.ok(Math.abs(actual - m.usd) < 0.0002, `got ${actual}, want ~${m.usd}`);

  // The failure mode, made explicit: 95.9% of these tokens are cached. Billing
  // that at the input rate would charge 38.5M x 1.4 instead of x 0.26.
  const ifBilledAtInputRate = (m.fresh * 1.4 + m.cached * 1.4 + m.output * 4.4) / 1e6;
  const ratio = ifBilledAtInputRate / actual;
  assert.ok(ratio > 3.5, `the two口径 must differ enough to be caught; ratio=${ratio.toFixed(2)}`);
});

test("the key name matters: cache_read_input_tokens is silently ignored", () => {
  // computeRowCost reads row.cached_input_tokens. Handing it the cache_read_*
  // spelling used by the price tables drops the cached tokens on the floor.
  const m = MEASURED["codely-core"];
  const right = computeRowCost({
    source: SOURCE, model: "codely-core",
    input_tokens: m.fresh, cached_input_tokens: m.cached,
    cache_creation_input_tokens: 0, output_tokens: m.output,
  });
  const wrong = computeRowCost({
    source: SOURCE, model: "codely-core",
    input_tokens: m.fresh, cache_read_input_tokens: m.cached,
    cache_creation_input_tokens: 0, output_tokens: m.output,
  });
  assert.notEqual(Number(right) || 0, Number(wrong) || 0,
    "if these ever agree, the test can no longer tell the two spellings apart");
  assert.ok((Number(wrong) || 0) < (Number(right) || 0) * 0.5,
    "the wrong key must visibly under-count, not just differ");
});

test("folding cached into input_tokens double-bills it", () => {
  // The other mistake: passing fresh + cached as input_tokens AND cached as
  // cached_input_tokens charges the cached portion twice, once at the full rate.
  const m = MEASURED["codely-core"];
  const correct = cost("codely-core", m);
  const doubled = Number(computeRowCost({
    source: SOURCE, model: "codely-core",
    input_tokens: m.fresh + m.cached, cached_input_tokens: m.cached,
    cache_creation_input_tokens: 0, output_tokens: m.output,
  })) || 0;
  assert.ok(doubled > correct * 2, `doubled=${doubled} correct=${correct}`);
});

test("all three measured models price to the figure the queue implies", () => {
  let total = 0;
  for (const [model, m] of Object.entries(MEASURED)) {
    const c = cost(model, m);
    assert.ok(Math.abs(c - m.usd) < 0.0002, `${model}: got ${c}, want ~${m.usd}`);
    total += c;
  }
  assert.ok(Math.abs(total - 13.8821) < 0.001, `total=${total}`);
});

test("the token total these prices cover is the measured 81,866,295", () => {
  const tokens = Object.values(MEASURED).reduce((s, m) => s + m.fresh + m.cached + m.output, 0);
  assert.equal(tokens, MEASURED_TOTAL_TOKENS);
});

test("an unknown codely id stays unpriced instead of borrowing a bare model card", () => {
  // Source-scoping is the whole point of source_exact: an id we have no mapping
  // for must come back all-zero, not silently pick up a same-named model's rate.
  // (getModelPricing returns the rate object itself - an unpriced model is
  // ZERO_PRICING; there is no `status` field to read.)
  const rates = getModelPricing("codely-vl", { source: SOURCE });
  assert.deepEqual(rates, { input: 0, output: 0, cache_read: 0, cache_write: 0 });
  assert.equal(cost("codely-vl", MEASURED["codely-air"]), 0,
    "and it contributes nothing to a row rather than guessing");
});
