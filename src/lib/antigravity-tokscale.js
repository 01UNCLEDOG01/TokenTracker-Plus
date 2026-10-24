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

const { tokenMonitorDisabled } = require("./token-monitor-speed");

const ANTIGRAVITY_SOURCE = "antigravity";

// Antigravity reports one Claude SKU as `-thinking`, dotted and hyphenated
// variants. Canonicalize before keying, or a single model splits into three
// rows in the sessions view and the model breakdown.
function canonicalAntigravityModelId(raw) {
  let id = String(raw || "").trim();
  if (!id) return "antigravity-unknown";
  if (!/^claude-/i.test(id)) return id;
  id = id.toLowerCase().replace(/-thinking$/, "");
  id = id.replace(/^(claude-(?:sonnet|opus|haiku))-(\d+)\.(\d+)$/, "$1-$2-$3");
  return id;
}

function resolveTokenMonitorDbPath({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  const override = typeof env.TOKENTRACKER_TOKEN_MONITOR_DB === "string"
    ? env.TOKENTRACKER_TOKEN_MONITOR_DB.trim()
    : "";
  if (override) return path.resolve(override);
  if (typeof env.TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR === "string" && env.TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR.trim()) {
    return null;
  }
  const isCustomHome = Boolean(home && home !== os.homedir());
  if (platform === "win32") {
    const appData = isCustomHome ? path.join(home, "AppData", "Roaming") : (env.APPDATA || path.join(home, "AppData", "Roaming"));
    return path.join(appData, "Token Monitor", "session-usage-archive.sqlite");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Token Monitor", "session-usage-archive.sqlite");
  }
  const configHome = isCustomHome ? path.join(home, ".config") : (env.XDG_CONFIG_HOME || path.join(home, ".config"));
  return path.join(configHome, "Token Monitor", "session-usage-archive.sqlite");
}

function readTokenMonitorAntigravitySessions(dbPath) {
  const sessions = new Map();
  if (!dbPath || !fs.existsSync(dbPath)) return sessions;
  let DatabaseSync;
  try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
  } catch {
    return sessions;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const rows = db.prepare("SELECT session_key, entry_json FROM sessions WHERE session_key LIKE 'antigravity:%'").all();
    for (const row of rows) {
      try {
        const data = JSON.parse(row.entry_json);
        const p = data?.periods?.allTime || data?.periods?.month;
        if (!p) continue;
        const sessionId = String(data.sessionId || row.session_key.replace(/^antigravity:/, "")).trim();
        if (!sessionId) continue;
        const input = num(p.inputTokens);
        const cached = num(p.cacheReadTokens);
        const cacheWrite = num(p.cacheWriteTokens);
        const output = num(p.outputTokens);
        const reasoning = num(p.reasoningTokens);
        const total = num(p.totalTokens) || (input + cached + cacheWrite + output + reasoning);
        if (total <= 0) continue;
        const startedAt = p.startedAt ? Date.parse(p.startedAt) : null;
        const endedAt = p.lastUsedAt ? Date.parse(p.lastUsedAt) : null;
        const models = new Map();
        if (p.models && typeof p.models === "object") {
          for (const [rawName, mTokens] of Object.entries(p.models)) {
            const mName = canonicalAntigravityModelId(rawName);
            const mTot = num(mTokens);
            const mRatio = total > 0 ? (mTot / total) : 1;
            const entry = models.get(mName) || {
              model: mName,
              input_tokens: 0,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 0,
              usage_events: 0,
            };
            entry.input_tokens += Math.round(input * mRatio);
            entry.cached_input_tokens += Math.round(cached * mRatio);
            entry.cache_creation_input_tokens += Math.round(cacheWrite * mRatio);
            entry.output_tokens += Math.round(output * mRatio);
            entry.reasoning_output_tokens += Math.round(reasoning * mRatio);
            entry.total_tokens += mTot;
            entry.usage_events += num(p.messageCount) || 1;
            models.set(mName, entry);
          }
        }
        if (models.size === 0) {
          const defaultModel = "gemini-3.8-flash-n";
          models.set(defaultModel, {
            model: defaultModel,
            input_tokens: input,
            cached_input_tokens: cached,
            cache_creation_input_tokens: cacheWrite,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
            total_tokens: total,
            usage_events: num(p.messageCount) || 1,
          });
        }
        const timedOutput = num(p.timedOutputTokens);
        const timedDuration = num(p.timedDurationMs);
        const requestCount = num(p.messageCount) || 1;
        let performance = null;
        if (timedOutput > 0 && timedDuration > 0) {
          performance = {
            estimated_output_tokens: timedOutput,
            estimated_duration_ms: timedDuration,
            estimated_request_count: requestCount,
            estimated_tokens_per_second: timedOutput * 1000 / timedDuration,
            first_response_total_ms: 0,
            first_response_sample_count: 0,
            first_response_ms: null,
          };
        }
        sessions.set(sessionId, {
          sessionId,
          usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            cache_creation_input_tokens: cacheWrite,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
            total_tokens: total,
          },
          costUsd: typeof p.costUsd === "number" && p.costUsd >= 0 ? p.costUsd : null,
          models,
          startedAt: Number.isFinite(startedAt) ? startedAt : null,
          endedAt: Number.isFinite(endedAt) ? endedAt : null,
          requests: requestCount,
          performance,
          provenance: "token-monitor-archive",
        });
      } catch { /* skip malformed */ }
    }
  } catch {
    /* open or query failure */
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }
  return sessions;
}

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

function snapshotSignature(cacheDir, files, tmDbPath = null) {
  const parts = files.map((file) => {
    try {
      const stat = fs.statSync(file);
      return `${file}:${stat.size}:${stat.mtimeMs}`;
    } catch {
      return `${file}:missing`;
    }
  });
  if (tmDbPath) {
    try {
      const stat = fs.statSync(tmDbPath);
      parts.push(`${tmDbPath}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      parts.push(`${tmDbPath}:missing`);
    }
  }
  return `${cacheDir}|${parts.join("|")}`;
}

function emptyTokscaleResult({ cacheDir = null, tokenMonitorDbPath = null } = {}) {
  return { rows: [], coveredDays: new Set(), bySession: new Map(), files: 0, cacheDir, tokenMonitorDbPath };
}

function readAntigravityTokscaleUsageCached(options = {}) {
  if (tokenMonitorDisabled(options.env || process.env)) {
    return emptyTokscaleResult({ tokenMonitorDbPath: null });
  }
  const cacheDir = options.dir || resolveAntigravityTokscaleDir(options);
  const tmDbPath = options.tokenMonitorDbPath !== undefined
    ? options.tokenMonitorDbPath
    : (options.dir ? null : resolveTokenMonitorDbPath(options));
  const files = listCacheFiles(cacheDir);
  const key = snapshotSignature(cacheDir, files, tmDbPath);
  if (lastSnapshot.key === key && lastSnapshot.value) return lastSnapshot.value;
  const value = readAntigravityTokscaleUsage({ ...options, dir: cacheDir, tokenMonitorDbPath: tmDbPath });
  lastSnapshot = { key, value };
  return value;
}

function readAntigravityTokscaleUsage({ home = os.homedir(), env = process.env, platform = process.platform, dir = null, tokenMonitorDbPath = undefined } = {}) {
  const cacheDir = dir || resolveAntigravityTokscaleDir({ home, env, platform });
  const tmDbPath = tokenMonitorDbPath !== undefined
    ? tokenMonitorDbPath
    : (dir ? null : resolveTokenMonitorDbPath({ home, env, platform }));
  if (tokenMonitorDisabled(env)) return emptyTokscaleResult({ cacheDir });
  const files = listCacheFiles(cacheDir);
  const tmSessions = readTokenMonitorAntigravitySessions(tmDbPath);
  if (files.length === 0 && tmSessions.size === 0) return emptyTokscaleResult({ cacheDir, tokenMonitorDbPath: tmDbPath });

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
      const model = canonicalAntigravityModelId(record.modelId || record.model);
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

  for (const [sessionId, tmSession] of tmSessions.entries()) {
    const existing = bySession.get(sessionId);
    if (!existing || tmSession.usage.total_tokens > existing.usage.total_tokens) {
      bySession.set(sessionId, tmSession);
      const ts = tmSession.endedAt || tmSession.startedAt;
      const hour = hourStart(ts);
      if (hour) {
        for (const [mName, mUsage] of tmSession.models.entries()) {
          const key = `${hour}\0${mName}`;
          if (!byHourModel.has(key)) {
            byHourModel.set(key, {
              hour_start: hour,
              model: mName,
              input_tokens: mUsage.input_tokens,
              cached_input_tokens: mUsage.cached_input_tokens,
              cache_creation_input_tokens: mUsage.cache_creation_input_tokens,
              output_tokens: mUsage.output_tokens,
              reasoning_output_tokens: mUsage.reasoning_output_tokens,
              total_tokens: mUsage.total_tokens,
              usage_events: mUsage.usage_events || 1,
            });
          }
        }
      }
    } else if (existing) {
      if (tmSession.costUsd !== null && existing.costUsd === undefined) {
        existing.costUsd = tmSession.costUsd;
      }
      if (tmSession.performance && !existing.performance) {
        existing.performance = tmSession.performance;
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
  resolveTokenMonitorDbPath,
  readTokenMonitorAntigravitySessions,
  readAntigravityTokscaleUsage,
  readAntigravityTokscaleUsageCached,
  mergeAntigravityTokscaleRows,
  dayKeyOfRow,
};
