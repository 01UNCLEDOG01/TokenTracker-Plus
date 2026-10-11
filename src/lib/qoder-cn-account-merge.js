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
    if (to && day > to) continue;
    const tokens = num(row.total_tokens);
    if (tokens <= 0) continue;
    const entry = byDay.get(day) || { tokens: 0, models: new Map() };
    entry.tokens += tokens;
    const model = String(row.model || "unknown");
    entry.models.set(model, (entry.models.get(model) || 0) + tokens);
    byDay.set(day, entry);
    grand += tokens;
  }
  return { byDay, grand };
}

function addTokenFields(target, tokens) {
  if (!target || typeof target !== "object") return;
  target.total_tokens = num(target.total_tokens) + tokens;
  target.billable_total_tokens = num(target.billable_total_tokens) + tokens;
}

// `models` shows up as a {name: tokens} map in the daily/heatmap payloads and
// as an array of {model, totals} in the model breakdown. Handle both.
function mergeModels(container, models) {
  if (!container) return;
  const list = container.models;
  if (Array.isArray(list)) {
    for (const [name, tokens] of models) {
      const hit = list.find((m) => (m?.model_id || m?.model) === name);
      if (hit) {
        hit.totals = hit.totals || {};
        addTokenFields(hit.totals, tokens);
      } else {
        list.push({
          model: name,
          model_id: name,
          pricing: { status: "unpriced", source: null, input: 0, output: 0, cache_read: 0, cache_write: 0 },
          cost_source: "model_pricing",
          totals: {
            total_tokens: tokens,
            billable_total_tokens: tokens,
            input_tokens: 0,
            output_tokens: 0,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            reasoning_output_tokens: 0,
            total_cost_usd: "0",
          },
        });
      }
    }
    return;
  }
  if (list && typeof list === "object") {
    for (const [name, tokens] of models) list[name] = num(list[name]) + tokens;
  }
}

function sortedInsert(list, entry, key) {
  let i = 0;
  while (i < list.length && String(list[i]?.[key]) < String(entry[key])) i += 1;
  list.splice(i, 0, entry);
}

function emptyDayEntry(day, tokens, models) {
  const entry = { day, total_tokens: tokens, billable_total_tokens: tokens, total_cost_usd: 0, conversation_count: 0, models: {} };
  for (const field of TOKEN_FIELDS) if (!(field in entry)) entry[field] = 0;
  for (const [name, n] of models) entry.models[name] = n;
  return entry;
}

function mergeDaily(payload, buckets) {
  const list = Array.isArray(payload?.data) ? payload.data : null;
  if (!list) return;
  for (const [day, entry] of buckets.byDay) {
    const hit = list.find((d) => String(d?.day) === day);
    if (hit) {
      addTokenFields(hit, entry.tokens);
      mergeModels(hit, entry.models);
    } else {
      sortedInsert(list, emptyDayEntry(day, entry.tokens, entry.models), "day");
    }
  }
}

function mergeMonthly(payload, buckets) {
  const list = Array.isArray(payload?.data) ? payload.data : null;
  if (!list) return;
  const byMonth = new Map();
  for (const [day, entry] of buckets.byDay) {
    const month = day.slice(0, 7);
    const agg = byMonth.get(month) || { tokens: 0, models: new Map() };
    agg.tokens += entry.tokens;
    for (const [name, n] of entry.models) agg.models.set(name, (agg.models.get(name) || 0) + n);
    byMonth.set(month, agg);
  }
  for (const [month, agg] of byMonth) {
    const hit = list.find((m) => String(m?.month) === month);
    if (hit) {
      addTokenFields(hit, agg.tokens);
      mergeModels(hit, agg.models);
    } else {
      const entry = { month, total_tokens: agg.tokens, billable_total_tokens: agg.tokens, models: {} };
      for (const field of TOKEN_FIELDS) if (!(field in entry)) entry[field] = 0;
      for (const [name, n] of agg.models) entry.models[name] = n;
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
    for (const field of TOKEN_FIELDS) if (!(field in hour)) hour[field] = 0;
    sortedInsert(list, hour, "hour");
  }
  addTokenFields(hour, entry.tokens);
  mergeModels(hour, entry.models);
}

function mergeTotalsBlock(block, tokens) {
  if (!block || typeof block !== "object") return;
  const target = block.totals || block;
  addTokenFields(target, tokens);
}

function mergeSummary(payload, buckets) {
  // mergeTotalsBlock already targets payload.totals when present; doing both
  // would credit the estimate twice.
  mergeTotalsBlock(payload, buckets.grand);
  const rolling = payload?.rolling;
  if (!rolling) return;
  for (const key of Object.keys(rolling)) {
    const block = rolling[key];
    if (!block || typeof block !== "object") continue;
    let sum = 0;
    for (const [day, entry] of buckets.byDay) {
      if (block.from && day < String(block.from)) continue;
      if (block.to && day > String(block.to)) continue;
      sum += entry.tokens;
    }
    if (sum > 0) addTokenFields(block.totals || block, sum);
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
      addTokenFields(cell, entry.tokens);
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
    addTokenFields(entry.totals, dayEntry.tokens);
    for (const [name, n] of dayEntry.models) perModel.set(name, (perModel.get(name) || 0) + n);
  }
  mergeModels(entry, perModel);
  entry.models.sort((a, b) => num(b?.totals?.total_tokens) - num(a?.totals?.total_tokens));
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
    switch (usageSlug) {
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

module.exports = { applyAccountViewQoderMerge, buildBuckets };
