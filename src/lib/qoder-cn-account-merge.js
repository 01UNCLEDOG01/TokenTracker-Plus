'use strict';

// The signed-in dashboard asks for `?account=1`, and the local server answers
// with the cloud cross-device aggregate (see cloud-account.js). That aggregate
// is built from synced queue rows, so it carries qoder-cn = 0: Qoder CN stopped
// writing token counts to disk in 2026-07 and nothing about it is synced.
// qoder-cn-estimate.js already turns the official cloud spend into queue-shaped
// rows for the *local* read path. This module folds the same rows into the
// cloud payload so the hero total, the daily table and the per-model rows agree.
//
// Nothing is uploaded: this only rewrites the response on its way out.

const { qoderCnEstimatedRows } = require("./qoder-cn-estimate");

const QODER_SOURCE = "qoder-cn";
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

function zeroShaped() {
  const out = {};
  for (const field of TOKEN_FIELDS) out[field] = 0;
  return out;
}

// Row-shaped accumulator: keeps every token field, not just the two totals.
function addShaped(target, row) {
  const shaped = target || zeroShaped();
  for (const field of TOKEN_FIELDS) shaped[field] = num(shaped[field]) + num(row?.[field]);
  return shaped;
}

function shapedTotals(shaped) {
  const out = zeroShaped();
  for (const field of TOKEN_FIELDS) out[field] = num(shaped?.[field]);
  return out;
}

function dayKeyOfHourStart(hourStart, offsetMinutes) {
  const ms = Date.parse(String(hourStart || ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10);
}

// tokens per Beijing day, and per model within that day, clipped to the window.
function buildBuckets(queueRows, { from, to, offsetMinutes }) {
  const rows = qoderCnEstimatedRows(Array.isArray(queueRows) ? queueRows : []);
  const byDay = new Map();
  let grand = 0;
  for (const row of rows || []) {
    const day = dayKeyOfHourStart(row.hour_start, offsetMinutes);
    if (!day) continue;
    if (from && day < from) continue;
    if (to && day > String(to)) continue;
    const tokens = num(row.total_tokens);
    if (tokens <= 0) continue;
    const entry = byDay.get(day) || { tokens: 0, models: new Map() };
    entry.tokens += tokens;
    const model = String(row.model || "unknown");
    entry.models.set(model, addShaped(entry.models.get(model), row));
    byDay.set(day, entry);
    grand += tokens;
  }
  return { byDay, grand };
}

// `models` shows up as a {name: tokens} map in the daily/heatmap payloads and
// as an array of {model, totals} in the model breakdown. Handle both.
function mergeModels(container, models) {
  if (!container) return;
  const list = container.models;
  if (Array.isArray(list)) {
    for (const [name, shaped] of models) {
      const hit = list.find((m) => (m?.model_id || m?.model) === name);
      if (hit) {
        hit.totals = hit.totals || {};
        for (const field of TOKEN_FIELDS) hit.totals[field] = num(hit.totals[field]) + num(shaped[field]);
      } else {
        list.push({
          model: name,
          model_id: name,
          pricing: { status: "unpriced", source: null, input: 0, output: 0, cache_read: 0, cache_write: 0 },
          cost_source: "model_pricing",
          totals: { ...zeroShaped(), ...shapedTotals(shaped), total_cost_usd: "0" },
        });
      }
    }
    return;
  }
  if (list && typeof list === "object") {
    for (const [name, shaped] of models) list[name] = num(list[name]) + num(shaped.total_tokens);
  }
}

function sortedInsert(list, entry, key) {
  let i = 0;
  while (i < list.length && String(list[i]?.[key]) < String(entry[key])) i += 1;
  list.splice(i, 0, entry);
}

function emptyDayEntry(day, shaped) {
  const entry = { day, total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, conversation_count: 0, models: {} };
  const shapedTotals_ = shapedTotals(shaped);
  for (const field of TOKEN_FIELDS) entry[field] = (entry[field] || 0) + num(shapedTotals_[field]);
  return entry;
}

function applyShapedToContainer(container, shaped) {
  if (!container || typeof container !== "object") return;
  const shapedTotals_ = shapedTotals(shaped);
  for (const field of TOKEN_FIELDS) container[field] = num(container[field]) + num(shapedTotals_[field]);
}

// Sum every per-model shape in a bucket into one row shape.
function sumShapes(bucket) {
  const out = zeroShaped();
  for (const [, shaped] of bucket) {
    for (const field of TOKEN_FIELDS) out[field] += num(shaped[field]);
  }
  return out;
}

function mergeDaily(payload, buckets) {
  const list = Array.isArray(payload?.data) ? payload.data : null;
  if (!list) return;
  for (const [day, entry] of buckets.byDay) {
    const dayShaped = sumShapes(entry.models);
    const hit = list.find((d) => String(d?.day) === day);
    if (hit) {
      applyShapedToContainer(hit, dayShaped);
      mergeModels(hit, entry.models);
    } else {
      sortedInsert(list, emptyDayEntry(day, dayShaped), "day");
    }
  }
}

function mergeMonthly(payload, buckets) {
  const list = Array.isArray(payload?.data) ? payload.data : null;
  if (!list) return;
  const byMonth = new Map();
  for (const [day, entry] of buckets.byDay) {
    const month = day.slice(0, 7);
    const agg = byMonth.get(month) || new Map();
    for (const [model, shaped] of entry.models) {
      agg.set(model, addShaped(agg.get(model), shaped));
    }
    byMonth.set(month, agg);
  }
  for (const [month, models] of byMonth) {
    const monthShaped = sumShapes(models);
    const hit = list.find((m) => String(m?.month) === month);
    if (hit) {
      applyShapedToContainer(hit, monthShaped);
      mergeModels(hit, models);
    } else {
      const shapedTotals_ = shapedTotals(monthShaped);
      const entry = { month, total_tokens: 0, models: {} };
      for (const field of TOKEN_FIELDS) entry[field] = shapedTotals_[field];
      sortedInsert(list, entry, "month");
    }
  }
}

function mergeHourly(payload, buckets) {
  const list = Array.isArray(payload?.data) ? payload.data : null;
  const day = String(payload?.day || "");
  const entry = buckets.byDay.get(day);
  if (!list || !entry) return;
  // Hour keys are strings like "2026-10-10T12:00:00". The synthetic rows sit at
  // 04:00Z so they land at local midday; credit the whole day to that hour
  // rather than spreading it across hours we cannot know.
  const key = day + "T12:00:00";
  let hour = list.find((h) => String(h?.hour) === key);
  if (!hour) {
    hour = { hour: key, total_tokens: 0, billable_total_tokens: 0, conversation_count: 0, models: {} };
    for (const field of TOKEN_FIELDS) hour[field] = 0;
    sortedInsert(list, hour, "hour");
  }
  const hourShaped = sumShapes(entry.models);
  applyShapedToContainer(hour, hourShaped);
  mergeModels(hour, entry.models);
}

function mergeTotalsBlock(block, shaped) {
  if (!block || typeof block !== "object" || !shaped) return;
  const target = block.totals || block;
  const shapedTotals_ = shapedTotals(shaped);
  for (const field of TOKEN_FIELDS) target[field] = num(target[field]) + num(shapedTotals_[field]);
}

function mergeSummary(payload, buckets) {
  // mergeTotalsBlock already targets payload.totals when present; doing both
  // would credit the estimate twice.
  const grandShaped = zeroShaped();
  for (const entry of buckets.byDay.values()) {
    for (const shaped of entry.models.values()) {
      for (const field of TOKEN_FIELDS) grandShaped[field] += num(shaped[field]);
    }
  }
  mergeTotalsBlock(payload, grandShaped);
  const rolling = payload?.rolling;
  if (!rolling) return;
  for (const key of Object.keys(rolling)) {
    const block = rolling[key];
    if (!block || typeof block !== "object") continue;
    const windowShaped = zeroShaped();
    for (const [day, entry] of buckets.byDay) {
      if (block.from && day < String(block.from)) continue;
      if (block.to && day > String(block.to)) continue;
      for (const shaped of entry.models.values()) {
        for (const field of TOKEN_FIELDS) windowShaped[field] += num(shaped[field]);
      }
    }
    if (windowShaped.total_tokens > 0) mergeTotalsBlock(block, windowShaped);
  }
}

function mergeHeatmap(payload, buckets) {
  const weeks = Array.isArray(payload?.weeks) ? payload.weeks : null;
  if (!weeks) return;
  for (const week of weeks) {
    if (!Array.isArray(week)) continue;
    for (const cell of week) {
      const entry = cell && buckets.byDay.get(String(cell.day));
      if (!entry) continue;
      const cellShaped = sumShapes(entry.models);
      applyShapedToContainer(cell, cellShaped);
      mergeModels(cell, entry.models);
    }
  }
}

function mergeModelBreakdown(payload, buckets) {
  const sources = Array.isArray(payload?.sources) ? payload.sources : null;
  if (!sources) return;
  let entry = sources.find((s) => String(s?.source) === QODER_SOURCE);
  if (!entry) {
    entry = { source: QODER_SOURCE, source_scope: "local", totals: {}, models: [] };
    for (const field of TOKEN_FIELDS) entry.totals[field] = 0;
    entry.totals.total_cost_usd = "0";
    sources.push(entry);
  }
  entry.totals = entry.totals || {};
  entry.models = Array.isArray(entry.models) ? entry.models : [];
  const perModel = new Map();
  for (const dayEntry of buckets.byDay.values()) {
    for (const [name, shaped] of dayEntry.models) {
      perModel.set(name, addShaped(perModel.get(name), shaped));
    }
  }
  for (const shaped of perModel.values()) {
    for (const field of TOKEN_FIELDS) entry.totals[field] = num(entry.totals[field]) + num(shaped[field]);
  }
  mergeModels(entry, perModel);
  entry.models.sort((a, b) => num(b?.totals?.total_tokens) - num(a?.totals?.total_tokens));
}

/**
 * The signed-in dashboard does not keep asking for `tokentracker-usage-*`: with
 * cloud sync on, api.ts's USAGE_TO_ACCOUNT_SLUG rewrites the path to
 * `tokentracker-account-*` before the request leaves the browser, and
 * local-api.js derives usageSlug from the path it actually received. So every
 * slug that reaches a merge here is the account form. Matching only the
 * `usage-` form made the switch fall through to `default: break` and the merge
 * silently did nothing - which is why the cross-device view lost the Qoder CN
 * estimate entirely and the card sat at the bare local value.
 */
function normalizeUsageSlug(usageSlug) {
  return String(usageSlug || "").replace(/^tokentracker-account-/, "tokentracker-usage-");
}

/**
 * Mutate a cloud account-view payload in place, adding the local Qoder CN
 * estimate. Never throws: a shape we do not recognise is returned untouched.
 */
function applyAccountViewQoderMerge(usageSlug, payload, { queueRows, searchParams, offsetMinutes = 480 } = {}) {
  try {
    if (!payload || typeof payload !== "object") return payload;
    const from = String(searchParams?.get("from") || payload.from || "");
    const to = String(searchParams?.get("to") || payload.to || "");
    const buckets = buildBuckets(queueRows, { from, to, offsetMinutes });
    if (!buckets.byDay.size) return payload;
    switch (normalizeUsageSlug(usageSlug)) {
      case "tokentracker-usage-model-breakdown": mergeModelBreakdown(payload, buckets); break;
      case "tokentracker-usage-daily": mergeDaily(payload, buckets); break;
      case "tokentracker-usage-monthly": mergeMonthly(payload, buckets); break;
      case "tokentracker-usage-hourly": mergeHourly(payload, buckets); break;
      case "tokentracker-usage-summary": mergeSummary(payload, buckets); break;
      case "tokentracker-usage-heatmap": mergeHeatmap(payload, buckets); break;
      default: break;
    }
    return payload;
  } catch (_error) {
    return payload;
  }
}

module.exports = { applyAccountViewQoderMerge, buildBuckets, normalizeUsageSlug };
