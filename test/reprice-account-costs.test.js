"use strict";

// The account view returned per-model cost exactly as the cloud computed it at
// upload time, so any model this machine could price arrived as zero money. These
// pin the gap-fill pass, and the three things it must NOT touch: a source with
// provider-reported spend, a source nothing can price, and a row the cloud
// already priced (recomputing it would lose the time-of-day rates).

const test = require("node:test");
const assert = require("node:assert");
const { ensurePricingLoaded } = require("../src/lib/pricing");
const { repriceAccountModelCosts } = require("../src/lib/reprice-account-costs");

function breakdown(sources) {
  return {
    from: "2026-01-01",
    to: "2026-10-13",
    sources: sources.map((s) => ({
      source: s.source,
      totals: { total_tokens: s.totals.total_tokens, total_cost_usd: s.totals.total_cost_usd },
      models: s.models.map((m) => ({ model: m.model, cost_source: m.cost_source || null, totals: { ...m.totals } })),
    })),
  };
}

function find(data, source, model) {
  const s = data.sources.find((x) => x.source === source);
  return s?.models.find((x) => x.model === model);
}

test("a model the cloud priced at zero is repriced with the local table", async () => {
  await ensurePricingLoaded();
  // The real shape of the report: every token column present, cost zero, and the
  // pricing metadata the cloud attached saying "unpriced".
  const data = breakdown([
    {
      source: "workbuddy-ai",
      totals: { total_tokens: 78_799_532, total_cost_usd: "0.000000" },
      models: [
        { model: "gpt-6-luna", cost_source: "model_pricing", totals: {
          total_tokens: 78_799_532, billable_total_tokens: 78_799_532,
          input_tokens: 894, output_tokens: 52_337, cached_input_tokens: 77_201_175,
          cache_creation_input_tokens: 1_428_977, reasoning_output_tokens: 116_149,
          total_cost_usd: "0.000000" } },
      ],
    },
  ]);

  assert.equal(repriceAccountModelCosts("tokentracker-usage-model-breakdown", data), 1);
  const row = find(data, "workbuddy-ai", "gpt-6-luna");
  assert.equal(Number(row.totals.total_cost_usd), 1.034966, "the same figure the local view reports");
  assert.equal(row.cost_source, "model_pricing");
  assert.equal(Number(data.sources[0].totals.total_cost_usd), 1.034966, "the source total is restated from its models");
});

test("provider-reported spend is never recomputed from tokens", async () => {
  await ensurePricingLoaded();
  const data = breakdown([
    {
      source: "qoder",
      totals: { total_tokens: 96_679_264, total_cost_usd: "3.566868" },
      models: [{ model: "官方云端（积分）", cost_source: "provider_reported", totals: {
        total_tokens: 96_679_264, billable_total_tokens: 96_679_264,
        input_tokens: 13_176_152, output_tokens: 560_337, cached_input_tokens: 82_942_775,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
        total_cost_usd: "3.566868" } }],
    },
  ]);

  assert.equal(repriceAccountModelCosts("tokentracker-usage-model-breakdown", data), 0, "nothing was repriced");
  assert.equal(
    Number(find(data, "qoder", "官方云端（积分）").totals.total_cost_usd),
    3.566868,
    "Qoder's credit spend is the authority; pricing its derived tokens would replace it",
  );
  assert.equal(find(data, "qoder", "官方云端（积分）").cost_source, "provider_reported");
});

test("a source nothing can price keeps the figure the cloud sent", async () => {
  await ensurePricingLoaded();
  const data = breakdown([
    {
      source: "trae-cn",
      totals: { total_tokens: 351_104, total_cost_usd: "1.234567" },
      models: [{ model: "trae-cn-unknown", totals: {
        total_tokens: 351_104, billable_total_tokens: 351_104,
        input_tokens: 351_104, output_tokens: 0, cached_input_tokens: 0,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
        total_cost_usd: "1.234567" } }],
    },
  ]);

  assert.equal(repriceAccountModelCosts("tokentracker-usage-model-breakdown", data), 0, "nothing was filled in - the cloud already sent a figure");
  assert.equal(
    Number(find(data, "trae-cn", "trae-cn-unknown").totals.total_cost_usd),
    1.234567,
    "the model row keeps the cloud's figure instead of being overwritten with a zero",
  );
  assert.equal(
    Number(data.sources[0].totals.total_cost_usd),
    1.234567,
    "an entirely unpriced source is not overwritten with a zero the cloud never sent",
  );
});

test("a row the cloud already priced keeps its figure (DeepSeek time-of-day rates survive)", async () => {
  await ensurePricingLoaded();
  // codex/deepseek-v4-flash is a time-priced model: off-peak is half price and
  // whole Beijing weekends are off-peak. The cloud priced the rows at upload time
  // with each row's hour_start, so its 163.51 is already correct. This aggregate
  // carries no hour_start, so computeRowCost on it lands on the peak-only 263.24 -
  // recomputing would inflate the account view by ~61%. It must be left alone.
  const data = breakdown([
    {
      source: "codex",
      totals: { total_tokens: 10_938_417_142, total_cost_usd: "163.509652" },
      models: [{ model: "deepseek-v4-flash", cost_source: "model_pricing", totals: {
        total_tokens: 10_938_417_142, billable_total_tokens: 10_938_417_142,
        input_tokens: 187_950_692, output_tokens: 22_995_858, cached_input_tokens: 10_727_470_592,
        cache_creation_input_tokens: 0, reasoning_output_tokens: 12_080_490,
        total_cost_usd: "163.509652" } }],
    },
  ]);

  assert.equal(repriceAccountModelCosts("tokentracker-usage-model-breakdown", data), 0, "a priced row is not revisited");
  assert.equal(
    Number(find(data, "codex", "deepseek-v4-flash").totals.total_cost_usd),
    163.509652,
    "the cloud's time-priced figure is preserved, not replaced by the peak-only aggregate",
  );
  assert.equal(Number(data.sources[0].totals.total_cost_usd), 163.509652);
});

test("aggregates with no per-model rows are left untouched", async () => {
  await ensurePricingLoaded();
  const summary = { totals: { total_tokens: 10423058577, total_cost_usd: "319.292145" } };
  assert.equal(repriceAccountModelCosts("tokentracker-usage-summary", summary), 0);
  assert.equal(summary.totals.total_cost_usd, "319.292145", "a blended total cannot be re-derived from aggregate tokens");
});

test("only the model-breakdown payload is ever rewritten", async () => {
  await ensurePricingLoaded();
  // Today no other endpoint emits a top-level `sources` array, so the slug guard
  // is not yet load-bearing. It still encodes the intent - if some future
  // aggregate grows one, this must not silently start rewriting it.
  const data = breakdown([
    {
      source: "workbuddy-ai",
      totals: { total_tokens: 78_799_532, total_cost_usd: "0.000000" },
      models: [{ model: "gpt-6-luna", totals: {
        total_tokens: 78_799_532, billable_total_tokens: 78_799_532,
        input_tokens: 894, output_tokens: 52_337, cached_input_tokens: 77_201_175,
        cache_creation_input_tokens: 1_428_977, reasoning_output_tokens: 116_149,
        total_cost_usd: "0.000000" } }],
    },
  ]);

  for (const slug of ["tokentracker-usage-daily", "tokentracker-usage-summary", "tokentracker-usage-heatmap"]) {
    assert.equal(repriceAccountModelCosts(slug, data), 0, `${slug} is not the model-breakdown payload`);
  }
  assert.equal(find(data, "workbuddy-ai", "gpt-6-luna").totals.total_cost_usd, "0.000000", "nothing was rewritten");
});