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
// v2: estimated rows now carry the input/cached/output split instead of 0.
const QODER_CN_MIRROR_VERSION = 2;
// Fields the panel reads alongside total_tokens. An estimated row that zeros
// these leaves the card showing the local 13 rows of real data (17M tokens)
// next to a 735M total, so the "86% cache hit" line and the input figure end
// up two orders of magnitude below the headline.
const SHAPE_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

function qoderCnLimitsCacheFile({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", "qoder-cn-usage-limits-cache.json");
}

// A mirror of the rows this module last derived from a healthy limits cache.
// It lives beside the cache but is owned here: the cache is the upstream's
// payload (and can be empty after a failed fetch), the mirror is what the usage
// endpoints are allowed to keep showing.
function qoderCnEstimateMirrorFile({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", "qoder-cn-estimate-rows.json");
}

function readQoderCnEstimateMirror({ home = os.homedir() } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(qoderCnEstimateMirrorFile({ home }), "utf8"));
    return Array.isArray(parsed?.rows) ? parsed.rows : null;
  } catch (_error) {
    return null;
  }
}

// A mirror written before rows carried the component split still holds the only
// numbers there are when the limits cache is cold (spend === null), so the rows
// are upgraded in place instead of discarded. Idempotent: rows that already
// carry a non-zero input or cache figure are passed through.
function upgradeMirroredRows(rows, shape) {
  if (!Array.isArray(rows) || rows.length === 0 || !shape) return rows || [];
  return rows.map((row) => {
    const total = Number(row?.total_tokens) || 0;
    if (!(total > 0)) return row;
    if (Number(row?.input_tokens) > 0 || Number(row?.cached_input_tokens) > 0) return row;
    const upgraded = { ...row };
    const shaped = splitByShape(total, shape);
    for (const field of SHAPE_FIELDS) upgraded[field] = shaped[field];
    if (!(upgraded.input_tokens > 0) && !(upgraded.cached_input_tokens > 0)) {
      upgraded.input_tokens = total;
    }
    return upgraded;
  });
}

// Only ever written from a non-empty derivation, so a failed upstream fetch
// cannot erase the last good numbers. Compare-then-write keeps the per-request
// cost at a stat when nothing changed.
function writeQoderCnEstimateMirror(rows, { home = os.homedir() } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) return false;
  const file = qoderCnEstimateMirrorFile({ home });
  try {
    const previous = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(previous.rows) && JSON.stringify(previous.rows) === JSON.stringify(rows)) return false;
  } catch (_error) { /* first write */ }
  const payload = JSON.stringify({ version: QODER_CN_MIRROR_VERSION, synced_at: new Date().toISOString(), rows });
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, file);
    return true;
  } catch (_error) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* nothing to clean */ }
    return false;
  }
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

// Fallback shape: every component at zero except input, which takes the whole
// total. Used when the local rows carry no split to learn from.
function zeroShape(tokens) {
  const out = {};
  for (const field of SHAPE_FIELDS) out[field] = 0;
  out.input_tokens = Number(tokens) || 0;
  return out;
}

// Split `tokens` across the component fields by `shape`, keeping the invariant// that the components sum to exactly `tokens`. Rounding each field on its own
// drifts by a token or two per row, which is what made the panel's
// "input + cache" add up to one less than the headline.
function splitByShape(tokens, shape) {
  const out = {};
  let assigned = 0;
  for (const field of SHAPE_FIELDS) {
    out[field] = Math.round(tokens * shape[field]);
    assigned += out[field];
  }
  out.output_tokens += tokens - assigned;
  return out;
}

// Token shape of the rows this source actually recorded, as fractions of
// total_tokens. Qoder CN froze its local stores in 2026-07, but the rows that
// survived do carry a real input/cached/output split, and reusing it keeps the
// estimated rows shaped like the real ones instead of leaving every component
// field at zero. Returns null when there is nothing to learn from.
function qoderCnTokenShape(allRows) {
  const sums = { total_tokens: 0 };
  for (const field of SHAPE_FIELDS) sums[field] = 0;
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (String(row?.source || "").toLowerCase() !== QODER_CN_SOURCE) continue;
    sums.total_tokens += Number(row?.total_tokens) || 0;
    for (const field of SHAPE_FIELDS) sums[field] += Number(row?.[field]) || 0;
  }
  if (!(sums.total_tokens > 0)) return null;
  const shares = {};
  for (const field of SHAPE_FIELDS) shares[field] = sums[field] / sums.total_tokens;
  return shares;
}

// Days inside the anchor window keep their locally recorded totals; every
// other day is estimated at the anchor ratio minus any local tokens already
// recorded for that day, so no day is ever double-counted.
function qoderCnEstimatedRows(allRows, { home = os.homedir() } = {}) {
  const spend = readQoderCnSpend({ home });
  const daily = Array.isArray(spend?.daily) ? spend.daily : null;
  const anchorTokens = Number(spend?.est_anchor?.tokens);
  const anchorMessages = Number(spend?.est_anchor?.messages);
  if (!daily || daily.length === 0 || !(anchorTokens > 0) || !(anchorMessages > 0)) {
    // The limits cache is cold, absent, or was written by a failed fetch. Show
    // the last numbers we derived rather than collapsing the card to the raw
    // local rows (which for Qoder CN are effectively zero). Older mirrors have
    // no component split, so they are upgraded from the local rows' shape.
    const mirrored = readQoderCnEstimateMirror({ home }) || [];
    return upgradeMirroredRows(mirrored, qoderCnTokenShape(allRows));
  }
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
  const shape = qoderCnTokenShape(allRows);
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
      // Only split when the local rows taught us a non-degenerate shape; a
      // shape of all zeroes would leave every component field at zero while the
      // headline carries the whole total, which is the bug this split fixes.
      // The cold mirror path has to make the same choice or the two disagree.
      const usable = shape && Object.values(shape).some((share) => share > 0);
      // Without a usable local shape everything lands in input_tokens, so the
      // component fields still match the headline instead of reading as zero.
      const shaped = usable ? splitByShape(tokens, shape) : zeroShape(tokens);
      const row = {
        source: QODER_CN_SOURCE,
        model,
        hour_start: day + "T04:00:00.000Z",
        input_tokens: usable ? shaped.input_tokens : tokens,
        cached_input_tokens: usable ? shaped.cached_input_tokens : 0,
        cache_creation_input_tokens: usable ? shaped.cache_creation_input_tokens : 0,
        output_tokens: usable ? shaped.output_tokens : 0,
        reasoning_output_tokens: usable ? shaped.reasoning_output_tokens : 0,
        total_tokens: tokens,
        billable_total_tokens: tokens,
        total_cost_usd: 0,
        conversation_count: 0,
      };
      rows.push(row);
    }
  }
  writeQoderCnEstimateMirror(rows, { home });
  return rows;
}

module.exports = {
  qoderCnEstimatedRows,
  qoderCnLimitsCacheFile,
  qoderCnEstimateMirrorFile,
  readQoderCnEstimateMirror,
  readQoderCnSpend,
  qoderCnTokenShape,
  SHAPE_FIELDS,
  QODER_CN_MIRROR_VERSION,
};