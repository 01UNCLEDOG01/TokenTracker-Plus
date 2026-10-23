"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let cachedDbPath = null;
let cachedMtimeMs = 0;
let cachedSize = 0;
let cachedSpeedIndex = null;

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
  const dbPath = resolveTokenMonitorDbPath({ home, env, platform });
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { byKey: new Map(), bySessionId: new Map() };
  }
  let stat;
  try {
    stat = fs.statSync(dbPath);
  } catch {
    return { byKey: new Map(), bySessionId: new Map() };
  }
  if (cachedSpeedIndex && cachedDbPath === dbPath && cachedMtimeMs === stat.mtimeMs && cachedSize === stat.size) {
    return cachedSpeedIndex;
  }

  let DatabaseSync;
  try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
  } catch {
    return { byKey: new Map(), bySessionId: new Map() };
  }

  const byKey = new Map();
  const bySessionId = new Map();
  let db;
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
  } catch {
    // Open/read failure
  } finally {
    if (db) {
      try { db.close(); } catch { /* ignore */ }
    }
  }

  cachedDbPath = dbPath;
  cachedMtimeMs = stat.mtimeMs;
  cachedSize = stat.size;
  cachedSpeedIndex = { byKey, bySessionId };
  return cachedSpeedIndex;
}

function lookupTokenMonitorPerformance(source, sessionId, options = {}) {
  if (!sessionId) return null;
  const { byKey, bySessionId } = loadTokenMonitorSpeedMap(options);
  if (source) {
    const prefixed = `${source}:${sessionId}`;
    if (byKey.has(prefixed)) return byKey.get(prefixed);
  }
  if (bySessionId.has(sessionId)) return bySessionId.get(sessionId);
  return null;
}

function resetTokenMonitorSpeedCacheForTests() {
  cachedDbPath = null;
  cachedMtimeMs = 0;
  cachedSize = 0;
  cachedSpeedIndex = null;
}

module.exports = {
  resolveTokenMonitorDbPath,
  normalizeSpeedPerformance,
  loadTokenMonitorSpeedMap,
  lookupTokenMonitorPerformance,
  resetTokenMonitorSpeedCacheForTests,
};
