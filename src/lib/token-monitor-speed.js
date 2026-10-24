"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let cachedDbPath = null;
let cachedMtimeMs = 0;
let cachedSize = 0;
let cachedWalMtimeMs = 0;
let cachedWalSize = 0;
let cachedSpeedIndex = null;

// Fork users who never install Token Monitor must get exactly the shape the
// code returns when the archive is absent, so that mode is testable rather
// than an implicit "the file happened not to exist".
function tokenMonitorDisabled(env = process.env) {
  const raw = String(env?.TOKENTRACKER_DISABLE_TOKEN_MONITOR ?? "").trim().toLowerCase();
  return raw !== "" && raw !== "0" && raw !== "false";
}

function emptySpeedIndex() {
  return { byKey: new Map(), bySessionId: new Map(), byKeyTotals: new Map() };
}

function resolveTokenMonitorDbPath({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (tokenMonitorDisabled(env)) return null;
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

function num(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function normalizeSpeedPerformance(outputTokens, durationMs, requestCount) {
  const output = num(outputTokens);
  const duration = num(durationMs);
  const count = Math.max(1, Math.floor(num(requestCount)));
  if (output <= 0 || duration <= 0) return null;
  return {
    estimated_output_tokens: Math.round(output),
    estimated_duration_ms: Math.round(duration),
    estimated_request_count: count,
    estimated_tokens_per_second: output / (duration / 1000),
    first_response_total_ms: 0,
    first_response_sample_count: 0,
    first_response_ms: null,
  };
}

function loadTokenMonitorSpeedMap({ home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (tokenMonitorDisabled(env)) return emptySpeedIndex();
  const dbPath = resolveTokenMonitorDbPath({ home, env, platform });
  if (!dbPath || !fs.existsSync(dbPath)) {
    return emptySpeedIndex();
  }
  let stat;
  try {
    stat = fs.statSync(dbPath);
  } catch {
    return emptySpeedIndex();
  }

  let walMtimeMs = 0;
  let walSize = 0;
  try {
    const walStat = fs.statSync(`${dbPath}-wal`);
    walMtimeMs = walStat.mtimeMs;
    walSize = walStat.size;
  } catch {}

  if (
    cachedSpeedIndex &&
    cachedDbPath === dbPath &&
    cachedMtimeMs === stat.mtimeMs &&
    cachedSize === stat.size &&
    cachedWalMtimeMs === walMtimeMs &&
    cachedWalSize === walSize
  ) {
    return cachedSpeedIndex;
  }

  let DatabaseSync;
  try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
  } catch {
    return emptySpeedIndex();
  }

  const byKey = new Map();
  const bySessionId = new Map();
  let db;
  let readSuccess = false;
  const byKeyTotals = new Map();
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const rows = db.prepare("SELECT session_key, entry_json FROM sessions").all();
    for (const row of rows) {
      const key = String(row?.session_key || "").trim();
      if (!key) continue;
      try {
        const data = JSON.parse(row.entry_json);
        const p = data?.periods?.allTime || data?.periods?.month || data?.periods?.today;
        if (!p) continue;
        const totals = {
          input_tokens: num(p.inputTokens),
          cached_input_tokens: num(p.cacheReadTokens),
          cache_creation_input_tokens: num(p.cacheWriteTokens),
          output_tokens: num(p.outputTokens),
          reasoning_output_tokens: num(p.reasoningTokens),
          total_tokens: num(p.totalTokens)
            || num(p.inputTokens) + num(p.cacheReadTokens) + num(p.cacheWriteTokens)
              + num(p.outputTokens) + num(p.reasoningTokens),
        };
        if (totals.total_tokens > 0) {
          byKeyTotals.set(key, totals);
          const bare = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
          if (bare) byKeyTotals.set(`*:${bare}`, totals);
        }
        const timedTokens = num(p.timedOutputTokens);
        const timedMs = num(p.timedDurationMs);
        if (timedTokens <= 0 || timedMs <= 0) continue;
        const count = num(p.messageCount) || 1;
        const perf = normalizeSpeedPerformance(timedTokens, timedMs, count);
        if (!perf) continue;
        byKey.set(key, perf);
        const bareId = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
        if (bareId) bySessionId.set(bareId, perf);
      } catch {
        // Skip malformed entries
      }
    }
    readSuccess = true;
  } catch {
    // Open/read failure - do not poison cache
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }

  if (readSuccess) {
    cachedDbPath = dbPath;
    cachedMtimeMs = stat.mtimeMs;
    cachedSize = stat.size;
    cachedWalMtimeMs = walMtimeMs;
    cachedWalSize = walSize;
    cachedSpeedIndex = { byKey, bySessionId, byKeyTotals };
    return cachedSpeedIndex;
  }

  return { byKey, bySessionId, byKeyTotals };
}

// TM's session archive is the measured source for these clients; return its
// all-time totals so a transcript estimate can be replaced by the real number.
const TM_SOURCE_PREFIX = { "qoder-cn": "qodercn", minimax: "mcode" };

function lookupTokenMonitorSessionTotals(source, sessionId, options = {}) {
  if (!sessionId) return null;
  const index = loadTokenMonitorSpeedMap(options);
  const totals = index?.byKeyTotals;
  if (!totals) return null;
  const key = String(source || "").toLowerCase();
  const prefix = TM_SOURCE_PREFIX[key] || key;
  return totals.get(`${prefix}:${sessionId}`) || totals.get(`*:${sessionId}`) || null;
}

function lookupTokenMonitorPerformance(source, sessionId, options = {}) {
  if (!sessionId) return null;
  const { byKey, bySessionId } = loadTokenMonitorSpeedMap(options);
  if (source) {
    const prefixed = `${source}:${sessionId}`;
    return byKey.get(prefixed) || null;
  }
  return bySessionId.get(sessionId) || null;
}

function resetTokenMonitorSpeedCacheForTests() {
  cachedDbPath = null;
  cachedMtimeMs = 0;
  cachedSize = 0;
  cachedWalMtimeMs = 0;
  cachedWalSize = 0;
  cachedSpeedIndex = null;
}

module.exports = {
  tokenMonitorDisabled,
  resolveTokenMonitorDbPath,
  normalizeSpeedPerformance,
  loadTokenMonitorSpeedMap,
  lookupTokenMonitorPerformance,
  lookupTokenMonitorSessionTotals,
  resetTokenMonitorSpeedCacheForTests,
};
