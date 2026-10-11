"use strict";

// Qoder CN (qoder.com.cn) stopped recording token counts anywhere: the local
// stores froze in 2026-07 and the official APIs expose credits / reference
// cost / messageCount only. usage-limits' fetchQoderCnSpend therefore carries
// an estimate anchored on the last window with local ground truth and stores
// a per-day official breakdown (spend.daily) in the limits cache. This module
// turns that breakdown into queue-shaped rows so the usage endpoints count
// CN spend like any other source, instead of only showing the July archive.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const QODER_CN_SOURCE = "qoder-cn";
const QODER_CN_EST_MODEL = "官方云端（估算）";
const QODER_CN_EST_SUFFIX = "（估算）";
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

function qoderCnLimitsCacheFile({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", "qoder-cn-usage-limits-cache.json");
}

function readQoderCnSpend({ home = os.homedir() } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(qoderCnLimitsCacheFile({ home }), "utf8"))?.qoder;
    return raw?.spend && typeof raw.spend === "object" ? raw.spend : null;
  } catch (_error) {
    return null;
  }
}

function beijingDayKey(hourStart) {
  const ms = Date.parse(String(hourStart || ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

// Days inside the anchor window keep their locally recorded totals; every
// other day is estimated at the anchor ratio minus any local tokens already
// recorded for that day, so no day is ever double-counted.
function qoderCnEstimatedRows(allRows, { home = os.homedir() } = {}) {
  const spend = readQoderCnSpend({ home });
  const daily = Array.isArray(spend?.daily) ? spend.daily : null;
  const anchorTokens = Number(spend?.est_anchor?.tokens);
  const anchorMessages = Number(spend?.est_anchor?.messages);
  if (!daily || daily.length === 0 || !(anchorTokens > 0) || !(anchorMessages > 0)) return [];
  const ratio = anchorTokens / anchorMessages;
  const anchorFrom = typeof spend?.est_anchor?.from === "string" ? spend.est_anchor.from : null;
  const anchorTo = typeof spend?.est_anchor?.to === "string" ? spend.est_anchor.to : null;
  const localByDay = new Map();
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (String(row?.source || "").toLowerCase() !== QODER_CN_SOURCE) continue;
    const day = beijingDayKey(row?.hour_start);
    if (!day) continue;
    localByDay.set(day, (localByDay.get(day) || 0) + (Number(row?.total_tokens) || 0));
  }
  const rows = [];
  for (const entry of daily) {
    const day = typeof entry?.date === "string" ? entry.date : "";
    const messages = Number(entry?.messages) || 0;
    if (!day || messages <= 0) continue;
    // Inside the anchor window the locally recorded totals are ground truth;
    // the estimate only covers days the local stores never captured.
    if (anchorFrom && anchorTo && day >= anchorFrom && day <= anchorTo) continue;
    const estimated = Math.round(messages * ratio);
    const shortfall = estimated - (localByDay.get(day) || 0);
    if (shortfall <= 0) continue;
    // The official trend already splits every day by model tier, so attribute
    // the estimate to those real names instead of one lumped pseudo-model.
    const byModel = entry?.by_model && typeof entry.by_model === "object" ? entry.by_model : null;
    const parts = byModel
      ? Object.entries(byModel).filter(([, n]) => Number(n) > 0).sort((a, b) => Number(b[1]) - Number(a[1]))
      : [];
    const partTotal = parts.reduce((sum, [, n]) => sum + Number(n), 0);
    const buckets = [];
    if (partTotal > 0) {
      let left = shortfall;
      for (let index = 0; index < parts.length; index += 1) {
        const [model, counted] = parts[index];
        const tokens = index === parts.length - 1
          ? left
          : Math.round((shortfall * Number(counted)) / partTotal);
        left -= tokens;
        if (tokens > 0) buckets.push([String(model) + QODER_CN_EST_SUFFIX, tokens]);
      }
    } else {
      buckets.push([QODER_CN_EST_MODEL, shortfall]);
    }
    for (const [model, tokens] of buckets) {
      rows.push({
        source: QODER_CN_SOURCE,
        model,
        hour_start: day + "T04:00:00.000Z",
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: tokens,
        billable_total_tokens: tokens,
        total_cost_usd: 0,
        conversation_count: 0,
      });
    }
  }
  return rows;
}

module.exports = { qoderCnEstimatedRows, qoderCnLimitsCacheFile, readQoderCnSpend };