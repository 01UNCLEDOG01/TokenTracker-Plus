"use strict";

// Qoder international (qoder.com) records no token counts anywhere: every
// `message.usage` entry under ~/.qoder/projects carries five zero token fields
// and a real `credits` value. Credits are still convertible to money, because
// Qoder publishes the plan price - unlike the CN estimate, no token rate has to
// be invented here. This module turns those transcripts into money-only usage
// rows so the edition stops being invisible, and mirrors the result so a
// partially readable transcript tree cannot collapse the card to zero.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { qoderCnTokenShape } = require("./qoder-cn-estimate");
const { getModelPricing } = require("./pricing");

const QODER_INTL_SOURCE = "qoder";
// Pro is $20 for 2,000 credits. This is the published rate, not a fitted one.
const QODER_INTL_USD_PER_CREDIT = 0.01;
const QODER_INTL_FALLBACK_MODEL = "官方云端（积分）";
// The user only runs qwen3.8-flash on this edition, so the derived tokens are
// attributed to that model instead of the opaque router string Qoder writes.
// Its four rates are read from lib/pricing/curated-overrides.json rather than
// repeated here, so one price edit moves this card and the estimate together.
const QODER_INTL_REFERENCE_MODEL = "qwen3.8-flash";
const QODER_INTL_TOKEN_MODEL = `${QODER_INTL_REFERENCE_MODEL}（按积分反推）`;
// Which of the reference model's four rates bills which measured shape field.
// Reasoning bills at the output rate, the same rule computeRowCost applies:
// qoder-cn is not in its reasoningIncludedInOutput allowlist, so there reasoning
// is a second line item rather than a subset marker.
const QODER_INTL_SHAPE_FIELD_RATE = {
  input_tokens: "input",
  cached_input_tokens: "cache_read",
  cache_creation_input_tokens: "cache_write",
  output_tokens: "output",
  reasoning_output_tokens: "output",
};
// Qoder's transcripts name their router, not a model: all 1,398 credit records
// on this machine read `qfmodel`, which carries no identity and no rate. The CN
// estimate labels the same undisclosed-router case after the cloud plan, so
// this does too instead of printing an opaque internal string as a model.
const QODER_INTL_UNDISCLOSED_MODELS = new Set(["qfmodel"]);
// Bumped whenever the rows this module derives change shape or meaning, so an
// existing mirror is rebuilt instead of replayed. The version is the only thing
// that can distinguish two derivations of one unchanged transcript tree.
//   2 = the router-name mapping, 3 = derived token figures,
//   4 = those figures priced at the blended token mix.
const QODER_INTL_MIRROR_VERSION = 4;
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const TOKEN_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
  "billable_total_tokens",
];

// What one derived token actually costs, USD per MTok: the CN edition's measured
// token mix weighted by the reference model's four rates.
//
// This used to be the input rate alone ($0.15), which contradicts the split the
// row then performs - 85.8% of the measured tokens are cache reads at $0.016,
// about a ninth of the input rate - so the same money was credited with roughly a
// quarter of the tokens it really bought. Billing the mix makes the total and the
// components that compose it agree.
//
// Normalised by the covered share, so a shape that does not sum to 1 cannot
// understate the rate. A field whose rate is genuinely free (zero) is skipped
// rather than counted as covered, which keeps free cache reads from dragging the
// blend toward a price that is never charged. With no measured shape at all there
// is nothing to weight, so the flat input rate stands and the row puts every
// derived token in input_tokens to match.
function qoderIntlBlendedRateUsdPerMtok(shape) {
  const card = getModelPricing(QODER_INTL_REFERENCE_MODEL) || {};
  const inputRate = Number(card.input) || 0;
  if (!shape) return inputRate;
  let weighted = 0;
  let covered = 0;
  for (const [field, rate] of Object.entries(QODER_INTL_SHAPE_FIELD_RATE)) {
    const share = Number(shape[field]) || 0;
    const per = Number(card[rate]) || 0;
    if (!(share > 0) || !(per > 0)) continue;
    weighted += share * per;
    covered += share;
  }
  return covered > 0 && weighted > 0 ? weighted / covered : inputRate;
}

function qoderIntlCreditMirrorFile({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", "qoder-intl-credit-rows.json");
}

function listJsonl(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
    }
  }
  return out.sort();
}

// Path + mtime + size, so an appended transcript changes the signature and an
// untouched tree costs one stat pass instead of re-reading megabytes per request.
function treeSignature(files) {
  return files.map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${file}:${Math.round(stat.mtimeMs)}:${stat.size}`;
    } catch {
      return `${file}:missing`;
    }
  }).join("|");
}

function beijingDayKey(isoOrMs) {
  const ms = typeof isoOrMs === "number" ? isoOrMs : Date.parse(String(isoOrMs || ""));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

function readMirror({ home }) {
  try {
    const parsed = JSON.parse(fs.readFileSync(qoderIntlCreditMirrorFile({ home }), "utf8"));
    // A mirror is a snapshot of one version of the derivation, so a shipped
    // change to the rows has to invalidate it; the transcript signature cannot,
    // because the tree did not change. v1 predates the router-name mapping.
    if (Number(parsed?.version) !== QODER_INTL_MIRROR_VERSION) return null;
    return Array.isArray(parsed?.rows) ? parsed : null;
  } catch {
    return null;
  }
}

function writeMirror(payload, { home }) {
  const file = qoderIntlCreditMirrorFile({ home });
  const tmp = `${file}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean */ }
    return false;
  }
}

function scanCredits(projectsDir, allRows) {
  const byDayModel = new Map();
  let requests = 0;
  for (const file of listJsonl(projectsDir)) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      const usage = record?.message?.usage || record?.usage;
      if (!usage || typeof usage !== "object") continue;
      const credits = Number(usage.credits ?? usage.original_credits);
      if (!Number.isFinite(credits) || credits <= 0) continue;
      const day = beijingDayKey(record?.timestamp ?? usage.timestamp ?? record?.message?.timestamp);
      if (!day) continue;
      const rawModel = String(record?.message?.model || usage.model || "").trim();
      const model = !rawModel || QODER_INTL_UNDISCLOSED_MODELS.has(rawModel.toLowerCase())
        ? QODER_INTL_FALLBACK_MODEL
        : rawModel;
      const key = `${day}|${model}`;
      const entry = byDayModel.get(key) || { day, model, credits: 0, requests: 0 };
      entry.credits += credits;
      entry.requests += 1;
      byDayModel.set(key, entry);
      requests += 1;
    }
  }
  // The CN edition's token shape, reused so the derived international tokens
  // are shaped like the ones the CN edition really recorded instead of being
  // dumped into input_tokens alone (which would read as 0% cache hit).
  const shape = qoderCnTokenShape(Array.isArray(allRows) ? allRows : []);
  const usable = shape && Object.values(shape).some((share) => share > 0);
  const rows = [...byDayModel.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.model.localeCompare(b.model))
    .map((entry) => {
      const usd = Math.round(entry.credits * QODER_INTL_USD_PER_CREDIT * 1e6) / 1e6;
      // Derived, not measured: money divided by the rate this token mix really
      // bills at, so the total and the split below describe one and the same
      // usage. The panel labels these rows as estimates so they never read as
      // counts that came off the wire.
      const total = Math.round((usd / qoderIntlBlendedRateUsdPerMtok(usable ? shape : null)) * 1e6);
      const tokens = { total_tokens: total, billable_total_tokens: total };
      if (usable) {
        let assigned = 0;
        for (const field of TOKEN_FIELDS) {
          if (field === "total_tokens" || field === "billable_total_tokens") continue;
          tokens[field] = Math.round(total * shape[field]);
          assigned += tokens[field];
        }
        // Absorb the per-field rounding drift so the components always sum to
        // the derived total.
        tokens.output_tokens += total - assigned;
      } else {
        for (const field of TOKEN_FIELDS) {
          if (field === "total_tokens" || field === "billable_total_tokens") continue;
          tokens[field] = 0;
        }
        tokens.input_tokens = total;
      }
      return {
        source: QODER_INTL_SOURCE,
        model: entry.model,
        // 04:00Z is Beijing midday, the same convention the CN estimate uses so
        // a derived day lands in neither the early-morning nor the late-night bin.
        hour_start: `${entry.day}T04:00:00.000Z`,
        input_tokens: tokens.input_tokens,
        cached_input_tokens: tokens.cached_input_tokens,
        cache_creation_input_tokens: tokens.cache_creation_input_tokens,
        output_tokens: tokens.output_tokens,
        reasoning_output_tokens: tokens.reasoning_output_tokens,
        total_tokens: total,
        billable_total_tokens: total,
        tokens_derived: true,
        // Authoritative for this source (see SOURCES_WITH_AUTHORITATIVE_COST):
        // the money is what Qoder charged. The token figures are the derived
        // half and are marked as such rather than presented as measured.
        total_cost_usd: usd,
        credits: Math.round(entry.credits * 1e6) / 1e6,
        requests: entry.requests,
        // Requests are not conversations; leaving this at 0 keeps the session
        // counters honest about an edition that records no conversation tokens.
        conversation_count: 0,
      };
    });
  return { rows, requests };
}

function qoderIntlCreditRows(allRows, { projectsDir, home = os.homedir() } = {}) {
  if (!projectsDir) return [];
  // A queue that already carries Qoder spend is authoritative; adding the
  // transcript scan on top would bill the same credits twice. Rows that record
  // neither money nor tokens are placeholders, so they must not suppress the
  // card - that is the case this module exists for.
  const reportedSpend = (Array.isArray(allRows) ? allRows : []).some(
    (row) =>
      row?.source === QODER_INTL_SOURCE &&
      (Number(row.total_cost_usd) > 0 || Number(row.total_tokens) > 0),
  );
  if (reportedSpend) return [];
  let files;
  try { files = listJsonl(projectsDir); } catch { files = []; }
  if (files.length === 0) return readMirror({ home })?.rows || [];
  const signature = treeSignature(files);
  const mirror = readMirror({ home });
  if (mirror && mirror.signature === signature) return mirror.rows;
  const scanned = scanCredits(projectsDir, allRows);
  if (scanned.rows.length === 0) return mirror?.rows || [];
  writeMirror({ version: QODER_INTL_MIRROR_VERSION, synced_at: new Date().toISOString(), signature, rows: scanned.rows }, { home });
  return scanned.rows;
}

module.exports = {
  QODER_INTL_SOURCE,
  QODER_INTL_USD_PER_CREDIT,
  QODER_INTL_REFERENCE_MODEL,
  QODER_INTL_MIRROR_VERSION,
  qoderIntlBlendedRateUsdPerMtok,
  qoderIntlCreditRows,
  qoderIntlCreditMirrorFile,
};
