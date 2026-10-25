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

// KI-030 standards (captured 2026-10-25). The CN client's credit multiplier
// table lives only in its UI, so these are a manual snapshot with the capture
// date attached. They are used for exactly two things: deciding which SKUs are
// free (0x multiplier, judged per SKU - a 0.1x tier is NOT free) and sizing the
// freeloading interval. Billed rows keep using the official cost figures; the
// multipliers never reprice anything.
const QODER_CN_CREDIT_TIERS_CAPTURED_AT = "2026-10-25";
const QODER_CN_CREDIT_MULTIPLIERS = {
  "Auto": 0.5,
  "快速": 0.8,
  "Qwen3.8-Max": 0.5,
  "Qwen3.8-Flash": 0,
  "DeepSeek-V4-Pro": 0.5,
  "DeepSeek-Flash": 0,
  "GLM-5.3": 0.8,
  "GLM-5.3-Flash": 0.1,
  "Kimi-K3.1-Pro": 1,
  "Kimi-K2.8-Preview": 0.8,
  "MiniMax-M3.1-Flash": 0.1,
};
// July 2026 anchor: 17,235,393 tokens / 467 messages measured locally while CN
// still recorded tokens (queue rows). Per the 2026-10-25 spike verdict this is
// the only same-tier measured ratio; transcript rebuild failed the +-25% gate,
// so freeloading publishes as an interval, never a point value.
const QODER_CN_TOKENS_PER_MSG_ANCHOR = 36907;
// Two independent rate sources cross-check within 6.1% (KI-030): the official
// July billing (¥0.2820/MTok) and a third-party flash-card blend (¥0.2657/MTok).
const QODER_CN_CNY_PER_MTOK_BAND = [0.2657, 0.2820];
// Cash actually paid for the credits, at the plan's fold rate (KI-030 standard
// 3: cash paid / official pricing / freeloading are reported side by side and
// never merged into one number).
const QODER_CN_CNY_PER_CREDIT_PLAN = 0.0295;

// The official daily feed returned byte-identical duplicate rows for 10-21 and
// 10-22 (984 phantom messages, KI-030 standard 5). Dedupe whole-object-equal
// rows before anything ingests or sums them.
function dedupeQoderCnDaily(daily) {
  if (!Array.isArray(daily)) return [];
  const seen = new Set();
  const out = [];
  for (const row of daily) {
    if (!row || typeof row !== "object") continue;
    const key = JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function computeQoderCnValueSummary(spend) {
  if (!spend || typeof spend !== "object") return null;
  const daily = dedupeQoderCnDaily(spend.daily);
  const modelMessages = spend.model_messages && typeof spend.model_messages === "object"
    ? spend.model_messages : {};
  // Free consumption = messages on 0x SKUs only (per SKU, not per tier).
  let freeMessages = 0;
  for (const [sku, entry] of Object.entries(modelMessages)) {
    const multiplier = Object.prototype.hasOwnProperty.call(QODER_CN_CREDIT_MULTIPLIERS, sku)
      ? QODER_CN_CREDIT_MULTIPLIERS[sku] : 1;
    if (multiplier === 0) freeMessages += Number(entry?.messages) || 0;
  }
  const freeTokens = freeMessages * QODER_CN_TOKENS_PER_MSG_ANCHOR;
  const cashPaid = (Number(spend.credits_total) || 0) * QODER_CN_CNY_PER_CREDIT_PLAN;
  return {
    credit_tiers_captured_at: QODER_CN_CREDIT_TIERS_CAPTURED_AT,
    daily_deduped: {
      days: daily.length,
      removed: (Array.isArray(spend.daily) ? spend.daily.length : 0) - daily.length,
    },
    official_cost_cny: Math.round((Number(spend.cost_total) || 0) * 100) / 100,
    cash_paid_cny: Math.round(cashPaid * 100) / 100,
    freeloading: {
      messages: freeMessages,
      tokens_est: freeTokens,
      cny_low: Math.round((freeTokens / 1e6) * QODER_CN_CNY_PER_MTOK_BAND[0] * 100) / 100,
      cny_high: Math.round((freeTokens / 1e6) * QODER_CN_CNY_PER_MTOK_BAND[1] * 100) / 100,
      tokens_per_msg: QODER_CN_TOKENS_PER_MSG_ANCHOR,
      cny_per_mtok_band: QODER_CN_CNY_PER_MTOK_BAND,
      // Interval by construction: the per-message ratio is the July anchor
      // (rebuild failed the spike gate), the rate is a two-source band.
      estimate_kind: "interval",
    },
  };
}

// Serve-time enrichment: attach the deduped daily rows and the three-value
// summary without touching the on-disk cache. Consumers that only need the
// period sums automatically stop double counting the duplicated days.
function enrichQoderCnSpend(limits, { home = os.homedir() } = {}) {
  const spend = limits?.spend;
  if (!spend || typeof spend !== "object" || spend.value_summary) return limits;
  // The cached est_anchor may be the fork-default constant; the anchor sidecar
  // written by qoderCnEstimatedRows() is machine-local ground truth and wins.
  // `source` is what lets the UI avoid claiming "locally measured" on machines
  // that never had a measured window.
  const localAnchor = readQoderCnAnchor({ home });
  const estAnchor = localAnchor
    ? { ...spend.est_anchor, ...localAnchor }
    : { ...(spend.est_anchor || {}), source: "fork-default" };
  return {
    ...limits,
    spend: {
      ...spend,
      est_anchor: estAnchor,
      daily: dedupeQoderCnDaily(spend.daily),
      value_summary: computeQoderCnValueSummary(spend),
    },
  };
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
//
// The anchor itself is machine-local ground truth whenever this machine has
// real recorded rows: real tokens come from the queue, the matching message
// counts from the official daily feed for exactly those days. Machines without
// such a window fall back to the fork-default constant (the author's 2026-07
// measurement) and the UI says so instead of claiming a local measurement.
const QODER_CN_FALLBACK_ANCHOR = { tokens: 17235393, messages: 467, from: "2026-07-20", to: "2026-07-22" };

function qoderCnAnchorFile({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", "qoder-cn-anchor.json");
}

function readQoderCnAnchor({ home = os.homedir() } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(qoderCnAnchorFile({ home }), "utf8"));
    return raw && raw.source === "local-queue" && Number(raw.tokens) > 0 && Number(raw.messages) > 0 ? raw : null;
  } catch (_error) {
    return null;
  }
}

function qoderCnEstimatedRows(allRows, { home = os.homedir() } = {}) {
  const spend = readQoderCnSpend({ home });
  // KI-030 standard 5: the official 10-21/10-22 duplicates must never enter
  // the ledger; dedupe before any day is turned into a queue row.
  const daily = Array.isArray(spend?.daily) ? dedupeQoderCnDaily(spend.daily) : null;
  const localByDay = new Map();
  const realByDay = new Map();
  for (const row of Array.isArray(allRows) ? allRows : []) {
    if (String(row?.source || "").toLowerCase() !== QODER_CN_SOURCE) continue;
    const day = beijingDayKey(row?.hour_start);
    if (!day) continue;
    const tokens = Number(row?.total_tokens) || 0;
    localByDay.set(day, (localByDay.get(day) || 0) + tokens);
    // The queue also holds the uploaded estimate rows (model names carry the
    // 估算 suffix); they must never feed the anchor, or the anchor would be
    // the estimate regenerating itself.
    if (String(row?.model || "").includes(QODER_CN_EST_SUFFIX)) continue;
    realByDay.set(day, (realByDay.get(day) || 0) + tokens);
  }
  // Machine-local anchor: days where this queue actually holds REAL tokens,
  // paired with the official message counts for exactly those days.
  let anchor = null;
  if (daily && daily.length > 0) {
    let tokens = 0, messages = 0, from = null, to = null;
    for (const entry of daily) {
      const day = typeof entry?.date === "string" ? entry.date : "";
      const dayMessages = Number(entry?.messages) || 0;
      const dayTokens = realByDay.get(day) || 0;
      if (!day || dayMessages <= 0 || !(dayTokens > 0)) continue;
      tokens += dayTokens;
      messages += dayMessages;
      if (!from || day < from) from = day;
      if (!to || day > to) to = day;
    }
    if (tokens > 0 && messages > 0) {
      anchor = { tokens, messages, from, to, source: "local-queue" };
    }
  }
  if (!anchor) {
    anchor = { ...QODER_CN_FALLBACK_ANCHOR, source: "fork-default" };
  }
  const anchorTokens = Number(anchor.tokens);
  const anchorMessages = Number(anchor.messages);
  if (!daily || daily.length === 0 || !(anchorTokens > 0) || !(anchorMessages > 0)) {
    // The limits cache is cold, absent, or was written by a failed fetch. Show
    // the last numbers we derived rather than collapsing the card to the raw
    // local rows (which for Qoder CN are effectively zero). Older mirrors have
    // no component split, so they are upgraded from the local rows' shape.
    const mirrored = readQoderCnEstimateMirror({ home }) || [];
    return upgradeMirroredRows(mirrored, qoderCnTokenShape(allRows));
  }
  // Persist only a genuinely local anchor; a fork-default result must never
  // clobber a local sidecar written by an earlier run with a warm cache.
  if (anchor.source === "local-queue") {
    try {
      const tmp = qoderCnAnchorFile({ home }) + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(anchor), "utf8");
      fs.renameSync(tmp, qoderCnAnchorFile({ home }));
    } catch (_error) { /* best effort; the cache anchor stays as fallback */ }
  }
  const ratio = anchorTokens / anchorMessages;
  const shape = qoderCnTokenShape(allRows);
  const rows = [];
  for (const entry of daily) {
    const day = typeof entry?.date === "string" ? entry.date : "";
    const messages = Number(entry?.messages) || 0;
    if (!day || messages <= 0) continue;
    // Days where this queue holds real recorded tokens are ground truth; the
    // estimate only covers days the local stores never captured.
    if ((localByDay.get(day) || 0) > 0) continue;
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
  qoderCnAnchorFile,
  readQoderCnEstimateMirror,
  readQoderCnAnchor,
  readQoderCnSpend,
  qoderCnTokenShape,
  dedupeQoderCnDaily,
  computeQoderCnValueSummary,
  enrichQoderCnSpend,
  QODER_CN_CREDIT_MULTIPLIERS,
  QODER_CN_TOKENS_PER_MSG_ANCHOR,
  QODER_CN_CNY_PER_MTOK_BAND,
  QODER_CN_FALLBACK_ANCHOR,
  SHAPE_FIELDS,
  QODER_CN_MIRROR_VERSION,
};