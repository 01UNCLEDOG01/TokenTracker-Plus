"use strict";

// The account view is the cross-device aggregate: the cloud priced each row with
// whatever price table it held when the row was uploaded, and those figures are
// returned as-is. A model added to the curated table after a device uploaded its
// rows therefore comes back priced at zero, even though this machine can price it
// fine - the tokens are identical on both sides, only the money is missing.
//
// So fill the gaps on the way out, with this machine's own table - but only the
// gaps. A row the cloud DID price is left exactly as it came back: the cloud
// priced the underlying rows at upload time, so it saw each row's own hour_start
// and applied DeepSeek's time-of-day rates (off-peak is half price; whole Beijing
// weekends are off-peak). Chinese public holidays are a known gap: neither the
// local table nor the cloud edge consults a holiday calendar (see the deliberate
// gap documented in src/lib/pricing/index.js). This aggregate carries no
// hour_start, so recomputing a positive row here would bill every off-peak token
// at the peak rate - measured on real data that inflated codex/deepseek-v4-flash
// from 163.51 to 263.24. Only a zero (the model was missing from the cloud's
// table when the row was uploaded) is filled in.
//
// Provider-reported spend is left alone too: those sources bill in credits, not
// tokens, and their reported cost is the authority (see
// SOURCES_WITH_AUTHORITATIVE_COST).

const { computeRowCost, hasAuthoritativeRowCost, getModelPricingInfo } = require("./pricing");

const MODEL_BREAKDOWN_SLUG = "tokentracker-usage-model-breakdown";

function sourcesOf(data) {
  if (Array.isArray(data?.sources)) return data.sources;
  if (Array.isArray(data?.data?.sources)) return data.data.sources;
  return null;
}

// Returns a count for logging/tests: how many zero rows this machine filled in.
// Only model-breakdown carries per-model rows with token splits; every other
// aggregate is a sum with no way to re-derive a blended rate, so those are left
// exactly as the cloud computed them.
function repriceAccountModelCosts(usageSlug, data) {
  if (usageSlug !== MODEL_BREAKDOWN_SLUG) return 0;
  const sources = sourcesOf(data);
  if (!sources) return 0;

  let repriced = 0;
  for (const source of sources) {
    if (!source || hasAuthoritativeRowCost(source.source)) continue;
    if (!Array.isArray(source.models)) continue;

    let sourceTotal = 0;
    let filledAny = false;
    for (const model of source.models) {
      const totals = model?.totals;
      if (!totals || !Number.isFinite(Number(totals.total_tokens))) continue;
      const existing = Number(totals.total_cost_usd);
      // A positive figure means the cloud already priced this row, with the row's
      // own hour_start in hand. Keep it: recomputing from the aggregate would
      // lose the time-of-day rates (see the header). Only a zero is filled in.
      if (Number.isFinite(existing) && existing > 0) {
        sourceTotal += existing;
        continue;
      }
      const cost = computeRowCost({ source: source.source, model: model.model, ...totals });
      if (!Number.isFinite(cost)) {
        sourceTotal += Number.isFinite(existing) ? existing : 0;
        continue;
      }
      totals.total_cost_usd = Number(cost).toFixed(6);
      if (cost > 0) {
        model.cost_source = "model_pricing";
        filledAny = true;
        // The cloud sent its own `pricing` verdict with the row, and it still
        // says "unpriced" for a model this machine just priced. Left alone, an
        // "unpriced models" report would list a row that now carries money.
        model.pricing = getModelPricingInfo(model.model, { source: source.source });
      }
      sourceTotal += cost;
      repriced += 1;
    }
    // Only restate the source total when a zero was actually filled in, so an
    // untouched source keeps reporting the cloud's own figure rather than having
    // a number it never had overwritten.
    if (filledAny && source.totals) {
      source.totals.total_cost_usd = Number(sourceTotal).toFixed(6);
    }
  }
  return repriced;
}

module.exports = {
  MODEL_BREAKDOWN_SLUG,
  repriceAccountModelCosts,
};