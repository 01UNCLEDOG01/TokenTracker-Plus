"use strict";

// The signed-in dashboard asks for `?account=1` and the local server answers
// with the cloud cross-device aggregate (cloud-account.js). That aggregate is
// built from synced queue rows, and the scanner writes `total_cost_usd: 0` for
// every Qoder row it produces (rollout.js's parseQoderNewIncremental totals), so
// the cloud can never carry this edition's money: Qoder international bills
// credits, records no tokens, and marks every request `billable: false` - which
// upstream skips entirely. qoder-intl-credits.js already turns those transcripts
// into money-only rows for the local read path; this folds the same rows into
// the cloud payload so the hero total, the daily table and the per-source
// breakdown agree with the local view.
//
// Nothing is uploaded: this only rewrites the response on its way out.
//
// Shapes are taken from the live payloads, not invented: summary totals and
// model-breakdown totals carry cost as a 6-decimal string, daily rows carry it
// as a number, and daily `models` is a model->tokens map with no per-model cost.
// Monthly, hourly and heatmap carry no cost field at all, so they are left
// untouched rather than given a field nothing reads.

const { qoderIntlCreditRows, qoderIntlDisplayModel } = require("./qoder-intl-credits");
const { getModelPricingInfo } = require("./pricing");

const QODER_INTL_SOURCE = "qoder";
const TOKEN_FIELDS = [
  "total_tokens",
  "billable_total_tokens",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
];

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money6(value) {
  return (Math.round(num(value) * 1e6) / 1e6).toFixed(6);
}

function beijingDayOfHourStart(hourStart, offsetMinutes) {
  const ms = Date.parse(String(hourStart || ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10);
}

// credits-derived rows, bucketed by Beijing day and clipped to the window the
// caller asked for. `byDay` holds the day's money and derived tokens;
// `byModel` the whole window's.
function buildCostBuckets(rows, { from, to, offsetMinutes }) {
  const byDay = new Map();
  const byModel = new Map();
  let grand = 0;
  let grandTokens = 0;
  for (const row of rows || []) {
    if (row?.source !== QODER_INTL_SOURCE) continue;
    const cost = num(row.total_cost_usd);
    if (!(cost > 0)) continue;
    const day = beijingDayOfHourStart(row.hour_start, offsetMinutes);
    if (!day) continue;
    if (from && day < String(from)) continue;
    if (to && day > String(to)) continue;
    const model = String(row.model || "unknown");
    const entry = byDay.get(day) || { day, cost: 0, tokens: 0, models: new Set() };
    entry.cost += cost;
    // Credits are what Qoder charged; the tokens are derived from them and are
    // labelled as an estimate everywhere they surface.
    const tokens = num(row.total_tokens);
    entry.tokens += tokens;
    entry.models.add(model);
    byDay.set(day, entry);
    const modelEntry = byModel.get(model) || { cost: 0, tokens: 0 };
    modelEntry.cost += cost;
    modelEntry.tokens += tokens;
    byModel.set(model, modelEntry);
    grand += cost;
    grandTokens += tokens;
  }
  return { byDay, byModel, grand, grandTokens };
}

function sortedInsert(list, entry, key) {
  let i = 0;
  while (i < list.length && String(list[i]?.[key]) < String(entry[key])) i += 1;
  list.splice(i, 0, entry);
}

function emptyDayEntry(day, cost, tokens) {
  const entry = {
    day,
    total_tokens: tokens,
    billable_total_tokens: tokens,
    total_cost_usd: cost,
    conversation_count: 0,
    models: {},
  };
  for (const field of TOKEN_FIELDS) if (!(field in entry)) entry[field] = 0;
  return entry;
}

function mergeDaily(payload, buckets) {
  const list = Array.isArray(payload?.data) ? payload.data : null;
  if (!list) return;
  for (const [day, entry] of buckets.byDay) {
    const hit = list.find((d) => String(d?.day) === day);
    if (hit) {
      // Daily cost is a number in this payload; keep it a number.
      hit.total_cost_usd = num(hit.total_cost_usd) + entry.cost;
      // The derived tokens land on the same per-device total so the row stops
      // reading as "money, but nobody ran anything".
      hit.total_tokens = num(hit.total_tokens) + entry.tokens;
      hit.billable_total_tokens = num(hit.billable_total_tokens) + entry.tokens;
      // The model map is model -> tokens, so the edition joins it at zero: the
      // same shape the local read path produces for these days.
      if (hit.models && typeof hit.models === "object") {
        for (const model of entry.models.keys()) if (!(model in hit.models)) hit.models[model] = 0;
      }
    } else {
      const fresh = emptyDayEntry(day, entry.cost, entry.tokens);
      for (const model of entry.models.keys()) fresh.models[model] = 0;
      sortedInsert(list, fresh, "day");
    }
  }
}

function mergeSummaryCost(block, amount) {
  if (!block || typeof block !== "object" || !(amount > 0)) return;
  const target = block.totals || block;
  // Summary totals carry cost as a fixed-precision string in this payload.
  target.total_cost_usd = money6(num(target.total_cost_usd) + amount);
}

function mergeSummaryTokens(block, tokens) {
  if (!block || typeof block !== "object" || !(tokens > 0)) return;
  const target = block.totals || block;
  target.total_tokens = num(target.total_tokens) + tokens;
  target.billable_total_tokens = num(target.billable_total_tokens) + tokens;
}

function mergeSummary(payload, buckets) {
  mergeSummaryCost(payload, buckets.grand);
  mergeSummaryTokens(payload, buckets.grandTokens);
}

function mergeModelBreakdown(payload, buckets) {
  const sources = Array.isArray(payload?.sources) ? payload.sources : null;
  if (!sources || !(buckets.grand > 0)) return;
  let entry = sources.find((s) => String(s?.source) === QODER_INTL_SOURCE);
  if (!entry) {
    entry = { source: QODER_INTL_SOURCE, source_scope: "local", totals: {}, models: [] };
    for (const field of TOKEN_FIELDS) entry.totals[field] = 0;
    entry.totals.total_cost_usd = "0.000000";
    sources.push(entry);
  }
  entry.totals = entry.totals || {};
  entry.models = Array.isArray(entry.models) ? entry.models : [];
  entry.totals.total_cost_usd = money6(num(entry.totals.total_cost_usd) + buckets.grand);
  entry.totals.total_tokens = num(entry.totals.total_tokens) + buckets.grandTokens;
  entry.totals.billable_total_tokens = num(entry.totals.billable_total_tokens) + buckets.grandTokens;
  for (const [model, agg] of buckets.byModel) {
    // The display name is the model Qoder itself names (its client texts know
    // every router id); the row keeps the id it was stored under.
    const display = qoderIntlDisplayModel(model);
    let row = entry.models.find((m) => String(m?.model_id) === model || String(m?.model) === model);
    if (!row) {
      row = {
        model: display,
        model_id: model,
        // A credits row's tokens are money divided by the reference model's
        // blended rate, so the reference rate is the price behind the figure.
        pricing: getModelPricingInfo(model, { source: QODER_INTL_SOURCE }),
        // Credits are what Qoder charged, priced at the published plan rate -
        // the cost is the provider's money, not an estimate.
        cost_source: "provider_reported",
        totals: Object.fromEntries([...TOKEN_FIELDS, "total_cost_usd"].map((field) => [field, 0])),
      };
      entry.models.push(row);
    }
    row.totals.total_cost_usd = money6(num(row.totals.total_cost_usd) + agg.cost);
    row.totals.total_tokens = num(row.totals.total_tokens) + agg.tokens;
    row.totals.billable_total_tokens = num(row.totals.billable_total_tokens) + agg.tokens;
  }
}

/**
 * See qoder-cn-account-merge.js for why this is needed: the signed-in dashboard
 * rewrites every usage path to its `tokentracker-account-*` form before the
 * request leaves the browser, so the slug that reaches a merge is never the
 * `usage-` form these switches are written against. Matching only `usage-`
 * meant the international credit spend was never folded into the cross-device
 * payload, and the card - which has zero tokens - was filtered out entirely.
 */
function normalizeUsageSlug(usageSlug) {
  return String(usageSlug || "").replace(/^tokentracker-account-/, "tokentracker-usage-");
}

/**
 * Mutate a cloud account-view payload in place, adding the local Qoder
 * international credit spend. Never throws: a shape we do not recognise is
 * returned untouched.
 */
function applyAccountViewQoderIntlMerge(usageSlug, payload, { queueRows, projectsDir, home, searchParams, offsetMinutes = 480 } = {}) {
  try {
    if (!payload || typeof payload !== "object") return payload;
    const rows = qoderIntlCreditRows(queueRows || [], { projectsDir, home });
    if (!rows.length) return payload;
    const from = String(searchParams?.get("from") || payload.from || "");
    const to = String(searchParams?.get("to") || payload.to || "");
    const buckets = buildCostBuckets(rows, { from, to, offsetMinutes });
    if (!buckets.byDay.size) return payload;
    switch (normalizeUsageSlug(usageSlug)) {
      case "tokentracker-usage-model-breakdown": mergeModelBreakdown(payload, buckets); break;
      case "tokentracker-usage-daily": mergeDaily(payload, buckets); break;
      case "tokentracker-usage-summary": mergeSummary(payload, buckets); break;
      default: break;
    }
    return payload;
  } catch (_error) {
    return payload;
  }
}

module.exports = { applyAccountViewQoderIntlMerge, buildCostBuckets, normalizeUsageSlug };
