"use strict";

// Trae (international) per-request usage reader.
//
// The TRAE SOLO desktop app records every model call in its own
// `server_history_info` table (token_usage = prompt + completion for that
// request), with optional exact_* fields that split prompt into cache/fresh
// and output into reasoning/everything else. The legacy parser
// (parseTraeIncremental) reads `chat_turn`, which only carries the LAST call of
// a turn — turns that lack Trae's whole-turn counters therefore undercount
// every earlier call (measured 2026-11-06: 1.05 亿 booked vs 1.32 亿 in the
// request log).
//
// These stores are small (~30 MB), so this parser re-derives the complete
// `trae` hourly ledger on every change instead of maintaining a row ledger:
//   - all readable stores are read fully and deduplicated by history_id (the
//     same call may be copied into another install);
//   - new buckets REPLACE the booked totals, so the migration from the
//     per-turn ledger never stacks;
//   - a store without the request table is reported as unsupported and the
//     caller falls back to the legacy per-turn parser.
const fs = require("node:fs");
const path = require("node:path");

const { openTraeSnapshot } = require("./trae-snapshot");
const { withTraeSqlite } = require("./trae-sqlite");
const { resolveTraeDbPaths } = require("./trae-db");

const SOURCE = "trae";
const LEDGER_VERSION = 1;

function bucketStartOf(value) {
  const num = typeof value === "number" || /^\d+$/.test(String(value)) ? Number(value) : NaN;
  if (!Number.isFinite(num) || num <= 0) return null;
  const ms = num < 100_000_000_000 ? num * 1000 : num;
  const date = new Date(ms);
  if (!Number.isFinite(date.getTime())) return null;
  const halfHour = date.getUTCMinutes() >= 30 ? 30 : 0;
  date.setUTCMinutes(halfHour, 0, 0);
  return date.toISOString();
}

function safeInt(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function exactSplit(info, total) {
  if (!info || typeof info !== "object") return null;
  const prompt = safeInt(info.exact_prompt_tokens_v1);
  const output = safeInt(info.exact_output_tokens_v1);
  if (prompt === null && output === null) return null;
  if (prompt !== null && output !== null && prompt + output !== total) return null;
  return {
    prompt,
    output,
    cacheRead: safeInt(info.exact_cache_read_input_tokens_v1),
    reasoning: safeInt(info.exact_reasoning_tokens_v1),
  };
}

function requestTotals(row) {
  const total = safeInt(row.total);
  if (total === null || total <= 0) return null;
  const exact = exactSplit(row.extra, total);
  if (exact) {
    const prompt = exact.prompt !== null ? exact.prompt : Math.max(0, total - (exact.output || 0));
    const outputAll = exact.output !== null ? exact.output : Math.max(0, total - prompt);
    const cached = Math.min(prompt, exact.cacheRead || 0);
    const reasoning = Math.min(outputAll, exact.reasoning || 0);
    return {
      input_tokens: prompt - cached,
      cached_input_tokens: cached,
      cache_creation_input_tokens: 0,
      output_tokens: outputAll - reasoning,
      reasoning_output_tokens: reasoning,
      total_tokens: total,
      billable_total_tokens: total,
      total_cost_usd: 0,
      conversation_count: 1,
    };
  }
  const output = Math.min(safeInt(row.item) || 0, total);
  return {
    input_tokens: total - output,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: total,
    billable_total_tokens: total,
    total_cost_usd: 0,
    conversation_count: 1,
  };
}

function requestModel(extra) {
  if (!extra || typeof extra !== "object") return "trae-unknown";
  for (const field of ["auto_router_model_name_v1", "config_name"]) {
    const value = extra[field];
    if (typeof value === "string" && value.trim()) {
      return value.trim().split("__")[0].toLowerCase().replace(/\s+/g, "-");
    }
  }
  return "trae-unknown";
}

function storeFingerprint(dbPath) {
  const main = fs.statSync(dbPath, { bigint: true });
  let wal = null;
  try { wal = fs.statSync(`${dbPath}-wal`, { bigint: true }); }
  catch (err) { if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err; }
  return {
    main: `${main.size}:${main.mtimeNs}:${main.ctimeNs}:${main.ino}`,
    wal: wal ? `${wal.size}:${wal.mtimeNs}:${wal.ctimeNs}` : null,
  };
}

function sameFingerprint(a, b) {
  if (!a || !b) return false;
  return a.main === b.main && a.wal === b.wal;
}

async function readStoreRequests(dbPath) {
  const snap = openTraeSnapshot(dbPath);
  try {
    return await withTraeSqlite(snap, async (q) => {
      const tables = (await q("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
      if (!tables.includes("server_history_info")) return null;
      const columns = new Set((await q("PRAGMA table_info(server_history_info)")).map((r) => r.name));
      if (!columns.has("token_usage")) return null;
      const session = columns.has("conversation_id")
        ? "t.conversation_id"
        : columns.has("session_id") ? "t.session_id" : "NULL";
      const item = columns.has("item_token_usage") ? "t.item_token_usage" : "0";
      const extra = columns.has("extra_info") ? "t.extra_info" : "NULL";
      const history = columns.has("history_id") ? "t.history_id" : "CAST(t.rowid AS TEXT)";
      return await q(`SELECT ${history} AS history_id, ${session} AS session_id,
        COALESCE(t.created_at, t.updated_at) AS created_at, t.updated_at AS updated_at,
        t.token_usage AS total, ${item} AS item, ${extra} AS extra_info
        FROM server_history_info t WHERE t.token_usage > 0
        ORDER BY t.rowid ASC`).then((rows) => rows.map((row) => {
        let parsed = null;
        if (typeof row.extra_info === "string") {
          try { parsed = JSON.parse(row.extra_info); } catch (_error) { parsed = null; }
        } else if (row.extra_info && typeof row.extra_info === "object") {
          parsed = row.extra_info;
        }
        return {
          history_id: row.history_id,
          session_id: row.session_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          total: row.total,
          item: row.item,
          extra: parsed,
        };
      }));
    });
  } finally {
    snap.close();
  }
}

async function parseTraeRequestsIncremental({
  dbPaths,
  cursors,
  queuePath,
  env = process.env,
  onProgress,
  readStoreRows = readStoreRequests,
} = {}) {
  const paths = dbPaths && dbPaths.length ? dbPaths : resolveTraeDbPaths(env);
  if (!paths.length) return { supported: false, recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
  if (!cursors || typeof cursors !== "object") cursors = {};
  const prior = cursors.traeRequests && cursors.traeRequests.version === LEDGER_VERSION
    ? cursors.traeRequests
    : null;

  const stores = {};
  const merged = new Map();
  let recordsProcessed = 0;
  let usageRecords = 0;
  const uniquePaths = [...new Set(paths.map((p) => path.resolve(p)))];
  const fingerprints = {};
  const errors = [];
  let readable = 0;
  let lackingRequestLog = false;
  const pending = [];
  for (const key of uniquePaths) {
    let fingerprint;
    try {
      fingerprint = storeFingerprint(key);
    } catch (err) {
      errors.push({ store: key, message: err?.message || String(err) });
      continue;
    }
    if (prior && sameFingerprint(prior.stores?.[key], fingerprint)) {
      pending.push({ key, fingerprint, unchanged: true });
      continue;
    }
    pending.push({ key, fingerprint, unchanged: false });
  }
  const unchanged = prior && pending.length > 0 && pending.every((entry) => entry.unchanged);
  if (unchanged) {
    return { supported: true, recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0, skipped: true, errors: [] };
  }
  for (const entry of pending) {
    let rows;
    try {
      rows = await readStoreRows(entry.key);
    } catch (err) {
      // A store that cannot be read must not cause a partial rebuild that
      // replaces complete totals with a subset; it also must not fall back to
      // the per-turn reader (that store DOES have a request log). Skip this
      // cycle and retry.
      errors.push({ store: entry.key, message: err?.message || String(err) });
      continue;
    }
    if (!rows) {
      // Readable but without the request table: the whole provider must use
      // the legacy per-turn parser so both reads agree.
      lackingRequestLog = true;
      continue;
    }
    readable += 1;
    fingerprints[entry.key] = entry.fingerprint;
    stores[entry.key] = { fingerprint: entry.fingerprint };
    for (const row of rows) {
      recordsProcessed += 1;
      const totals = requestTotals(row);
      const created = row.created_at;
      if (!totals || created == null) continue;
      const bucketStart = bucketStartOf(created);
      if (!bucketStart) continue;
      const model = requestModel(row.extra);
      const identity = String(row.history_id || `${entry.key}:${recordsProcessed}`);
      const updated = Number(row.updated_at) || 0;
      const previous = merged.get(identity);
      if (previous && updated <= previous.updated) continue;
      merged.set(identity, { model, bucketStart, totals, updated });
      usageRecords += 1;
    }
  }
  if (lackingRequestLog) {
    return { supported: false, recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
  }
  if (errors.length > 0 && (readable === 0 || prior)) {
    // First run without prior state may rebuild from the readable subset;
    // after that, dropping an unreadable store's contribution would silently
    // lose its usage, so keep the ledger and retry.
    return {
      supported: true,
      error: errors.map((error) => `${error.store}: ${error.message}`).join("; "),
      recordsProcessed,
      eventsAggregated: 0,
      bucketsQueued: 0,
    };
  }

  const rebuilt = new Map();
  for (const row of merged.values()) {
    const key = `${row.model}|${row.bucketStart}`;
    if (!rebuilt.has(key)) rebuilt.set(key, { model: row.model, bucketStart: row.bucketStart, totals: { ...row.totals } });
    else {
      const target = rebuilt.get(key).totals;
      for (const field of Object.keys(row.totals)) target[field] = (target[field] || 0) + row.totals[field];
    }
  }

  const hourlyState = {
    version: 1,
    buckets: { ...(cursors.hourly?.buckets || {}) },
    groupQueued: { ...(cursors.hourly?.groupQueued || {}) },
    modelAttributionPolicy: { ...(cursors.hourly?.modelAttributionPolicy || {}) },
  };
  const zeroTotals = {
    input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0,
    billable_total_tokens: 0, total_cost_usd: 0, conversation_count: 0,
  };
  const oldKeys = Object.keys(hourlyState.buckets).filter((key) => key.startsWith(`${SOURCE}|`));
  const newKeys = new Set([...rebuilt.values()].map((entry) => `${SOURCE}|${entry.model}|${entry.bucketStart}`));
  const rows = [];
  for (const key of oldKeys) {
    if (newKeys.has(key)) continue;
    const bucket = hourlyState.buckets[key];
    if (!bucket?.totals || (bucket.totals.total_tokens || 0) === 0) continue;
    bucket.totals = { ...zeroTotals };
    const rest = key.slice(SOURCE.length + 1);
    const split = rest.indexOf("|");
    rows.push({ model: rest.slice(0, split), bucketStart: rest.slice(split + 1), totals: zeroTotals });
  }
  for (const entry of rebuilt.values()) {
    const key = `${SOURCE}|${entry.model}|${entry.bucketStart}`;
    const previous = hourlyState.buckets[key];
    if (previous && JSON.stringify(previous.totals) === JSON.stringify(entry.totals)) continue;
    hourlyState.buckets[key] = { totals: { ...entry.totals }, queuedKey: null };
    rows.push({ model: entry.model, bucketStart: entry.bucketStart, totals: entry.totals });
  }

  if (rows.length === 0 && prior) {
    return { supported: true, recordsProcessed, eventsAggregated: 0, bucketsQueued: 0, skipped: true };
  }

  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  const lines = rows.map((row) => JSON.stringify({
    source: SOURCE,
    model: row.model,
    hour_start: row.bucketStart,
    input_tokens: row.totals.input_tokens,
    cached_input_tokens: row.totals.cached_input_tokens,
    cache_creation_input_tokens: row.totals.cache_creation_input_tokens,
    output_tokens: row.totals.output_tokens,
    reasoning_output_tokens: row.totals.reasoning_output_tokens,
    total_tokens: row.totals.total_tokens,
    billable_total_tokens: row.totals.billable_total_tokens,
    total_cost_usd: 0,
    conversation_count: row.totals.conversation_count,
  }));
  if (lines.length) await fs.promises.appendFile(queuePath, `${lines.join("\n")}\n`);

  hourlyState.updatedAt = new Date().toISOString();
  cursors.hourly = hourlyState;
  cursors.traeRequests = {
    version: LEDGER_VERSION,
    stores: { ...(prior?.stores || {}), ...stores },
    updatedAt: hourlyState.updatedAt,
  };
  // The per-turn ledger would subtract contributions that this rebuild already
  // replaced; drop it so a later fallback starts from a clean rebuild.
  delete cursors.trae;

  if (typeof onProgress === "function") {
    onProgress({ recordsProcessed, eventsAggregated: usageRecords, bucketsQueued: rows.length });
  }
  return {
    supported: true,
    recordsProcessed,
    eventsAggregated: usageRecords,
    bucketsQueued: rows.length,
  };
}

module.exports = { parseTraeRequestsIncremental, __readStoreRequests: readStoreRequests };
