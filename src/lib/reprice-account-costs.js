"use strict";

// The account view is the cross-device aggregate: the cloud priced each row with
// whatever price table it held when the row was uploaded, and those figures are
// returned as-is. A model added to the curated table after a device uploaded its
// rows therefore comes back priced at zero, even though this machine can price it
// fine - the tokens are identical on both sides, only the money is missing.
//
// So reprice on the way out, with this machine's own table. Provider-reported
// spend is left alone: those sources bill in credits, not tokens, and their
// reported cost is the authority (see SOURCES_WITH_AUTHORITATIVE_COST).

const { computeRowCost, hasAuthoritativeRowCost } = require("./pricing");

const MODEL_BREAKDOWN_SLUG = "tokentracker-usage-model-breakdown";

function sourcesOf(data) {
  if (Array.isArray(data?.sources)) return data.sources;
  if (Array.isArray(data?.data?.sources)) return data.data.sources;
  return null;
}

// Returns a count for logging/tests. Only model-breakdown carries per-model rows
// with token splits; every other aggregate is a sum with no way to re-derive a
// blended rate, so those are left exactly as the cloud computed them.
function repriceAccountModelCosts(usageSlug, data) {
  if (usageSlug !== MODEL_BREAKDOWN_SLUG) return 0;
  const sources = sourcesOf(data);
  if (!sources) return 0;

  let repriced = 0;
  for (const source of sources) {
    if (!source || hasAuthoritativeRowCost(source.source)) continue;
    if (!Array.isArray(source.models)) continue;

    let sourceTotal = 0;
    let pricedAny = false;
    for (const model of source.models) {
      const totals = model?.totals;
      if (!totals || !Number.isFinite(Number(totals.total_tokens))) continue;
      const cost = computeRowCost({ source: source.source, model: model.model, ...totals });
      if (!Number.isFinite(cost)) continue;
      totals.total_cost_usd = Number(cost).toFixed(6);
      if (cost > 0) {
        model.cost_source = "model_pricing";
        pricedAny = true;
      }
      sourceTotal += cost;
      repriced += 1;
    }
    // Only restate the source total when this machine actually priced something,
    // so an entirely unpriced source keeps reporting the cloud's own figure
    // rather than having a number it never had overwritten with zero.
    if (pricedAny && source.totals) {
      source.totals.total_cost_usd = Number(sourceTotal).toFixed(6);
    }
  }
  return repriced;
}

module.exports = {
  MODEL_BREAKDOWN_SLUG,
  repriceAccountModelCosts,
};