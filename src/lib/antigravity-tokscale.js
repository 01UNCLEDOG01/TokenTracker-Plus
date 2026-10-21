"use strict";

// Token Monitor's tokscale bridge records the real usage it sees from the
// running Antigravity IDE. Antigravity's own transcripts carry no token
// counters, so the TT parser has to estimate them from text. Where the
// tokscale cache exists, prefer its measured records and keep the estimate
// only for days/sessions the cache never covered.
//
// Cache layout (Windows):
//   %APPDATA%\tokscale\antigravity-cache\sessions\*.jsonl
// Each usage row is:
//   { type:"usage", sessionId, modelId, input, output, reasoning,
//     cacheRead, cacheWrite, timestamp, messageId, responseId }
// `timestamp` is epoch milliseconds. The cache only advances while the IDE is
// open and Token Monitor has run `tokscale antigravity sync`, so absence is a
// normal fallback case, never "zero usage".

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ANTIGRAVITY_SOURCE = "antigravity";

function resolveAntigravityTokscaleDir({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const override = typeof env.TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR === "string"
    ? env.TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR.trim()
    : "";
  if (override) return path.resolve(override);
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), "tokscale", "antigravity-cache", "sessions");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "tokscale", "antigravity-cache", "sessions");
  }
  return path.join(env.XDG_CACHE_HOME || path.join(home, ".cache"), "tokscale", "antigravity-cache", "sessions");
}

function listCacheFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch {
    return [];
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function hourStart(timestamp) {
  const ms = Number(timestamp);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return `${new Date(ms).toISOString().slice(0, 13)}:00:00.000Z`;
}

function emptyTotals() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

const TOKEN_KEYS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
];

function addUsage(totals, usage) {
  for (const key of TOKEN_KEYS) totals[key] += usage[key] || 0;
}

function usageFromCacheRecord(record) {
  const input = num(record?.input);
  const cached = num(record?.cacheRead);
  const cacheWrite = num(record?.cacheWrite);
  const output = num(record?.output);
  const reasoning = num(record?.reasoning);
  const total = input + cached + cacheWrite + output + reasoning;
  if (total <= 0) return null;
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_creation_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: total,
  };
}

function dayOfHourStart(hour) {
  return typeof hour === "string" && hour.length >= 10 ? hour.slice(0, 10) : "";
}

let lastSnapshot = { key: "", value: null };

function snapshotSignature(cacheDir, files) {
  const parts = files.map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${file}:missing`;
    }
  });
  return `${cacheDir}|${parts.join("|")}`;
}

function readAntigravityTokscaleUsageCached(options = {}) {
  const cacheDir = options.dir || resolveAntigravityTokscaleDir(options);
  const files = listCacheFiles(cacheDir);
  const key = snapshotSignature(cacheDir, files);
  if (lastSnapshot.key === key && lastSnapshot.value) return lastSnapshot.value;
  const value = readAntigravityTokscaleUsage({ ...options, dir: cacheDir });
  lastSnapshot = { key, value };
  return value;
}

function readAntigravityTokscaleUsage({ home = os.homedir(), env = process.env, platform = process.platform, dir = null } = {}) {
  const cacheDir = dir || resolveAntigravityTokscaleDir({ home, env, platform });
  const files = listCacheFiles(cacheDir);
  if (files.length === 0) return { rows: [], coveredDays: new Set(), bySession: new Map(), files: 0 };

  const byHourModel = new Map();
  const bySession = new Map();
  let syncedAt = null;
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      if (record?.type === "session_meta") {
        if (typeof record.timestamp === "number" && (!syncedAt || record.timestamp > syncedAt)) syncedAt = record.timestamp;
        continue;
      }
      if (record?.type !== "usage") continue;
      const hour = hourStart(record.timestamp);
      if (!hour) continue;
      const usage = usageFromCacheRecord(record);
      if (!usage) continue;
      const model = String(record.modelId || record.model || "antigravity-unknown").trim() || "antigravity-unknown";
      const key = `${hour}\0${model}`;
      const row = byHourModel.get(key) || { hour_start: hour, model, ...emptyTotals(), usage_events: 0 };
      addUsage(row, usage);
      row.usage_events += 1;
      byHourModel.set(key, row);

      const sessionId = String(record.sessionId || "").trim();
      if (sessionId) {
        const session = bySession.get(sessionId) || {
          sessionId,
          usage: emptyTotals(),
          models: new Map(),
          startedAt: null,
          endedAt: null,
          requests: 0,
        };
        addUsage(session.usage, usage);
        const modelEntry = session.models.get(model) || { model, ...emptyTotals(), usage_events: 0 };
        addUsage(modelEntry, usage);
        modelEntry.usage_events += 1;
        session.models.set(model, modelEntry);
        const ms = Number(record.timestamp);
        if (Number.isFinite(ms)) {
          if (session.startedAt === null || ms < session.startedAt) session.startedAt = ms;
          if (session.endedAt === null || ms > session.endedAt) session.endedAt = ms;
        }
        session.requests += 1;
        bySession.set(sessionId, session);
      }
    }
  }

  const rows = [...byHourModel.values()]
    .sort((a, b) => a.hour_start.localeCompare(b.hour_start) || a.model.localeCompare(b.model))
    .map((row) => ({
      source: ANTIGRAVITY_SOURCE,
      model: row.model,
      hour_start: row.hour_start,
      input_tokens: row.input_tokens,
      cached_input_tokens: row.cached_input_tokens,
      cache_creation_input_tokens: row.cache_creation_input_tokens,
      output_tokens: row.output_tokens,
      reasoning_output_tokens: row.reasoning_output_tokens,
      total_tokens: row.total_tokens,
      billable_total_tokens: row.total_tokens,
      total_cost_usd: 0,
      conversation_count: 0,
      usage_events: row.usage_events,
      usage_precision: "exact",
      provenance: "tokscale-antigravity-cache",
    }));
  const coveredDays = new Set(rows.map((row) => dayOfHourStart(row.hour_start)));
  return {
    rows,
    coveredDays,
    bySession,
    files: files.length,
    syncedAt: syncedAt ? new Date(syncedAt).toISOString() : null,
    cacheDir,
  };
}

function dayKeyOfRow(row) {
  const hour = typeof row?.hour_start === "string" ? row.hour_start : "";
  return hour.length >= 10 ? hour.slice(0, 10) : "";
}

// Remove the estimated antigravity rows for days the cache actually covers,
// then append the measured rows. Days outside the cache keep their estimate.
function mergeAntigravityTokscaleRows(allRows, snapshot) {
  const rows = Array.isArray(allRows) ? allRows : [];
  if (!snapshot || !snapshot.rows.length) return rows;
  return rows
    .filter((row) => !(row?.source === ANTIGRAVITY_SOURCE && snapshot.coveredDays.has(dayKeyOfRow(row))))
    .concat(snapshot.rows);
}

module.exports = {
  ANTIGRAVITY_SOURCE,
  resolveAntigravityTokscaleDir,
  readAntigravityTokscaleUsage,
  readAntigravityTokscaleUsageCached,
  mergeAntigravityTokscaleRows,
  dayKeyOfRow,
};
