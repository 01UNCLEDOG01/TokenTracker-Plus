"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { getModelPricingInfo } = require("../src/lib/pricing");
const { computeRowCost } = require("../src/lib/pricing");

test("MiniMax-M3.1-Flash uses the official launch rates from the curated note", () => {
  for (const model of ["MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash-Preview"]) {
    const pricing = getModelPricingInfo(model, { source: "minimax-code" });
    assert.equal(pricing.status, "priced");
    assert.equal(pricing.input, 0.3);
    assert.equal(pricing.output, 1.2);
    assert.equal(pricing.cache_read, 0.03);
    assert.equal(pricing.cache_write, 0.3);
  }
});

test("MiniMax-M3.1-Flash token mix is priced at the official cache/write rates", () => {
  const cost = computeRowCost({
    source: "minimax-code",
    model: "MiniMax-M3.1-Flash",
    input_tokens: 5_566_426,
    output_tokens: 272_612,
    cached_input_tokens: 140_053_554,
    cache_creation_input_tokens: 0,
    total_tokens: 145_892_592,
  });
  assert.ok(Math.abs(cost - 6.19866882) < 1e-6, String(cost));
});
