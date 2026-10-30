"use strict";

// MiniMax Code session metadata for the Sessions sidecar.
//
// Two MiniMax stores say different things and both are needed:
//   - v2/sessions/YYYY/MM/DD/<dir>/messages.jsonl: the per-reply usage rows.
//     Assistant messages carry {input, output, cacheRead, cacheWrite,
//     totalTokens}; replay/fork copies repeat the same message_id.
//   - v2/sqlite/runtime-state.sqlite: local_runtime_sessions carries the
//     agent-authored title, workspace_dir, archived/status/error. This is the
//     same table Token Monitor reads for its session list.
//
// Token Monitor counts usage-bearing replies (messageCount) from the JSONL,
// not local_runtime_token_usage: the runtime table contains extra retry rows.
// We follow that contract so a session's calls/tokens match TM.
// Prompts and message bodies are never persisted.

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { readSqliteJsonRows } = require("./sqlite-reader");


const MINIMAX_SESSION_SOURCE = "minimax-code";
const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);
const MAX_ACTIVE_GAP_MS = 30 * 60 * 1000;

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function modelName(value, fallback) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw) return raw.replace(/^minimax\//i, "");
  return fallback || "MiniMax-M3.1";
}

function timestampMs(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= MIN_TIMESTAMP_MS ? n : null;
}

function resolveMinimaxRuntimeDbPath(env = process.env, home = osHome(env)) {
  const explicit = [env.MINIMAX_DATA_DIR, env.MAVIS_DATA_DIR, env.TOKENTRACKER_MINIMAX_HOME]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .find(Boolean);
  const roots = explicit
    ? [path.resolve(explicit)]
    : [path.join(home, ".minimax"), path.join(home, ".mavis")];
  for (const root of roots) {
    const dbPath = path.join(root, "v2", "sqlite", "runtime-state.sqlite");
    if (fs.existsSync(dbPath)) return dbPath;
  }
  return roots[0] ? path.join(roots[0], "v2", "sqlite", "runtime-state.sqlite") : null;
}

function osHome(env = process.env) {
  return env.HOME || env.USERPROFILE || require("node:os").homedir();
}

function discoverMinimaxSessionFiles(env = process.env) {
  const roots = [env.MINIMAX_DATA_DIR, env.MAVIS_DATA_DIR, env.TOKENTRACKER_MINIMAX_HOME]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .map((v) => path.resolve(v));
  if (!roots.length) roots.push(path.join(osHome(env), ".minimax"), path.join(osHome(env), ".mavis"));
  const files = [];
  const seen = new Set();
  const seenRoots = new Set();
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === "messages.jsonl") {
        let resolved = path.resolve(full);
        try { resolved = fs.realpathSync.native(full); } catch { /* keep the lexical path */ }
        if (!seen.has(resolved)) {
          seen.add(resolved);
          files.push(resolved);
        }
      }
    }
  };
  for (const root of roots) {
    let resolvedRoot = path.resolve(root);
    try { resolvedRoot = fs.realpathSync.native(root); } catch { /* keep the lexical path */ }
    if (seenRoots.has(resolvedRoot)) continue;
    seenRoots.add(resolvedRoot);
    walk(path.join(resolvedRoot, "v2", "sessions"), 0);
  }
  files.sort((a, b) => a.localeCompare(b));
  return files;
}

function readRuntimeSessions(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return new Map();
  let rows;
  try {
    rows = readSqliteJsonRows(
      dbPath,
      "SELECT session_id, title, workspace_dir, project_id, created_at_ms, updated_at_ms, " +
        "archived, status, error_message, error_code, session_type, parent_session_id, extra_data_json " +
        "FROM local_runtime_sessions",
      { readOnly: true, throwOnReadFailure: true },
    );
  } catch {
    try {
      rows = readSqliteJsonRows(
        dbPath,
        "SELECT session_id, title, workspace_dir, created_at_ms, updated_at_ms FROM local_runtime_sessions",
        { readOnly: true, throwOnReadFailure: true },
      );
    } catch {
      return new Map();
    }
  }
  const map = new Map();
  for (const row of rows) {
    if (row && typeof row.session_id === "string") map.set(row.session_id, row);
  }
  return map;
}

function manifestFor(filePath) {
  const manifestPath = path.join(path.dirname(filePath), "manifest.json");
  try {
    const value = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function sessionIdFromDir(filePath) {
  const name = path.basename(path.dirname(filePath));
  const match = /^.*?session_([A-Za-z0-9]+)$/.exec(name);
  if (match) {
    try {
      return Buffer.from(match[1], "base64").toString("utf8").replace(/^mvs_/, "mvs_") || null;
    } catch {
      return null;
    }
  }
  return null;
}

function usageOf(message) {
  const usage = message && typeof message.usage === "object" ? message.usage : null;
  if (!usage) return null;
  const input = count(usage.input);
  const output = count(usage.output);
  const cacheRead = count(usage.cacheRead);
  const cacheWrite = count(usage.cacheWrite);
  const reported = count(usage.totalTokens);
  const total = reported || input + output + cacheRead + cacheWrite;
  if (!total && !input && !output && !cacheRead && !cacheWrite) return null;
  return {
    input_tokens: input,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: total,
  };
}

function addUsage(target, delta) {
  for (const key of ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"]) {
    target[key] = count(target[key]) + count(delta?.[key]);
  }
}

function runtimeDbForSessionFile(filePath) {
  const normalized = path.resolve(filePath);
  const marker = `${path.sep}v2${path.sep}sessions${path.sep}`;
  const index = normalized.indexOf(marker);
  if (index > 0) {
    const root = normalized.slice(0, index);
    return path.join(root, "v2", "sqlite", "runtime-state.sqlite");
  }
  return null;
}

async function readMinimaxCodeSession(filePath, { runtimeDbPath } = {}) {
  const manifest = manifestFor(filePath);
  const metadataMap = readRuntimeSessions(runtimeDbPath || runtimeDbForSessionFile(filePath) || resolveMinimaxRuntimeDbPath());
  const manifestId = typeof manifest?.sessionId === "string" ? manifest.sessionId : null;
  const metadata = manifestId ? metadataMap.get(manifestId) : null;
  const sessionId = manifestId || (metadata?.session_id ?? sessionIdFromDir(filePath));
  const metadataModel = (() => {
    try {
      const extra = JSON.parse(metadata?.extra_data_json || "{}");
      return typeof extra?.effectiveModel === "string" ? extra.effectiveModel : null;
    } catch {
      return null;
    }
  })();

  const seen = new Set();
  const models = new Map();
  const buckets = new Map();
  const times = [];
  let calls = 0;
  let turns = 0;
  let toolCalls = 0;
  let toolFailures = 0;
  const tokens = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };

  const reader = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of reader) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const message = entry?.message;
    if (!message || typeof message !== "object") continue;
    const messageId = typeof entry.message_id === "string" ? entry.message_id : null;
    if (messageId) {
      if (seen.has(messageId)) continue;
      seen.add(messageId);
    }
    const ts = timestampMs(message.timestamp);
    if (ts) times.push(ts);
    const role = message.role;
    if (role === "user") {
      turns += 1;
      continue;
    }
    if (role === "toolResult") {
      toolCalls += 1;
      if (message.isError === true) toolFailures += 1;
      continue;
    }
    if (role !== "assistant") continue;
    const delta = usageOf(message);
    if (!delta) continue;
    calls += 1;
    const model = modelName(message.model, metadataModel);
    let row = models.get(model);
    if (!row) {
      row = {
        model,
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        usage_events: 0,
      };
      models.set(model, row);
    }
    addUsage(tokens, delta);
    addUsage(row, delta);
    row.usage_events += 1;
    if (ts) {
      const bucketTime = new Date(Math.floor(ts / 60000) * 60000).toISOString();
      const key = `${model}\0${bucketTime}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { model, timestamp: bucketTime, ...delta, usage_events: 0 };
        buckets.set(key, bucket);
      } else {
        addUsage(bucket, delta);
      }
      bucket.usage_events += 1;
    }
  }

  if (!tokens.total_tokens && !turns && !calls) return null;
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const gap = ordered[i] - ordered[i - 1];
    if (gap > 0 && gap <= MAX_ACTIVE_GAP_MS) activeMs += gap;
  }
  const startedAt = ordered.length
    ? new Date(ordered[0]).toISOString()
    : (Number.isFinite(Number(metadata?.created_at_ms)) ? new Date(Number(metadata.created_at_ms)).toISOString() : null);
  const endedAt = ordered.length
    ? new Date(ordered[ordered.length - 1]).toISOString()
    : (Number.isFinite(Number(metadata?.updated_at_ms)) ? new Date(Number(metadata.updated_at_ms)).toISOString() : null);
  const modelRows = [...models.values()].sort((a, b) => b.total_tokens - a.total_tokens);
  const workspace = typeof metadata?.workspace_dir === "string" && metadata.workspace_dir.trim()
    ? metadata.workspace_dir.trim()
    : null;
  const title = typeof metadata?.title === "string" && metadata.title.trim() ? metadata.title.trim() : null;

  return {
    session_id: sessionId || path.basename(path.dirname(filePath)),
    title,
    project_ref: workspace,
    model: modelRows.length === 1 ? modelRows[0].model : modelRows.length > 1 ? "mixed" : "MiniMax-M3.1",
    model_usage: modelRows,
    usage_buckets: [...buckets.values()],
    tokens,
    turns,
    model_calls: calls,
    tool_calls: toolCalls,
    tool_failures: toolFailures,
    started_at: startedAt,
    ended_at: endedAt,
    active_ms: activeMs,
    archived: metadata?.archived === 1 || metadata?.archived === true,
    error: typeof metadata?.error_message === "string" && metadata.error_message ? metadata.error_message : null,
    error_code: metadata?.error_code ?? null,
    parent_session_id: typeof metadata?.parent_session_id === "string" ? metadata.parent_session_id : null,
    provenance: {
      source: "local-session-log",
      confidence: "observed",
      content_retained: false,
      usage: "minimax-messages-jsonl",
    },
  };
}

module.exports = {
  MINIMAX_SESSION_SOURCE,
  resolveMinimaxRuntimeDbPath,
  discoverMinimaxSessionFiles,
  readMinimaxCodeSession,
};
