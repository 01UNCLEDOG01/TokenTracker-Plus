const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: wait } = require("node:timers/promises");

const { openTraeSnapshot } = require("./trae-snapshot");
const { withTraeSqlite } = require("./trae-sqlite");
const { acquireTraeReadGuard } = require("./trae-read-guard");
const { normalizeTraeUsage } = require("./trae-usage");

const TOKEN_FIELDS = [
  "prompt_tokens", "prompt_tokens_total", "input_tokens",
  "completion_tokens", "completion_tokens_total", "output_tokens",
  "total_tokens", "cache_read_input_tokens", "cache_creation_input_tokens",
  "reasoning_tokens", "reasoning_output_tokens",
];

function resolveTraeDbPaths(env = process.env, { platform = process.platform, home = os.homedir() } = {}) {
  const explicit = String(env.TOKENTRACKER_TRAE_DB || "").trim();
  if (explicit) return [path.resolve(explicit)];
  const customHome = String(env.TOKENTRACKER_TRAE_HOME || "").trim();
  const parent = platform === "win32"
    ? env.APPDATA || path.join(home, "AppData", "Roaming")
    : platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : env.XDG_CONFIG_HOME || path.join(home, ".config");
  const roots = customHome ? [customHome] : [path.join(parent, "Trae"), path.join(parent, "TRAE SOLO")];
  const result = [];
  for (const root of roots) {
    // A decrypted sibling may be an old export. Only an explicit DB override
    // opts into one; normal discovery always reads the current application DB.
    for (const module of ["ai-agent", "ai-chat"]) {
      const candidate = path.resolve(root, "ModularData", module, "database.db");
      let present;
      try { present = fs.statSync(candidate).isFile(); }
      catch (err) {
        // Permission failures must reach the reader's diagnostics, not masquerade
        // as an absent installation and silently drop an entire usage history.
        present = err.code !== "ENOENT" && err.code !== "ENOTDIR";
      }
      if (present) {
        result.push(candidate);
        break;
      }
    }
  }
  return [...new Set(result)];
}

function error(message) {
  return new Error(`Cannot read TRAE usage: ${message}`);
}

// A blocked or unavailable PowerShell (execution policy, AV, stripped system)
// must degrade to the pre-1.18 guard-less read instead of failing every
// collection while TRAE CN is live. The degraded read gives up the SHM lock
// that defers TRAE's checkpoint — the stability check below still rejects
// torn snapshots (stat + WAL header/frame re-verification), which is the
// same risk tier 1.18 shipped in before the guard existed; what the guard
// adds on top is fewer retry storms and deferred TRAE checkpoints, not a
// correctness guarantee. Warn once per process so the degraded mode stays
// discoverable without spamming every sync cycle.
let guardFallbackWarned = false;
function warnTraeGuardFallback(guardErr) {
  if (guardFallbackWarned) return;
  guardFallbackWarned = true;
  console.warn(`[trae-db] shared read guard unavailable (${guardErr?.message || guardErr}); reading without it — unstable snapshots are caught by the stability check instead of the SHM lock.`);
}

async function readStableTraeSnapshot(dbPath, env, project, waitImpl = wait, guardImpl = acquireTraeReadGuard) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    let snapshot;
    let guard = null;
    try {
      try {
        guard = await guardImpl(dbPath);
      } catch (guardErr) {
        // A busy guard (a competing holder) stays a retryable failure — the
        // read would burn the attempt on an unstable snapshot anyway. Every
        // other guard failure (blocked PowerShell, dead helper) degrades to
        // the guard-less read above.
        if (guardErr?.transient) throw guardErr;
        warnTraeGuardFallback(guardErr);
      }
      snapshot = openTraeSnapshot(dbPath, env);
      const result = await withTraeSqlite(snapshot, project);
      if (snapshot.isStable() && (!guard || guard.isHeld())) return result;
      lastError = error("database changed during the read; retry after TRAE finishes its current turn.");
    } catch (err) {
      // Invalid keys/schemas and permission failures are not writer races.
      if (!err?.transient && (!snapshot || snapshot.isStable())) throw err;
      lastError = err;
    } finally {
      try { snapshot?.close(); } finally { await guard?.release(); }
    }
    // Release SQLite and file handles before waiting; other readers can run.
    if (attempt < 2) await waitImpl((attempt + 1) * 1000);
  }
  throw lastError;
}

async function readTraeUsageRows(dbPath, { env = process.env, waitImpl, guardImpl } = {}) {
  return readStableTraeSnapshot(dbPath, env, projectUsage, waitImpl, guardImpl);
}

async function projectUsage(queryRows) {
  const tables = await queryRows("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_turn'");
  // history_v2.token_usage can be a context-size snapshot rather than billed
  // usage. Do not synthesize input tokens from those scalar values.
  if (!tables.length) throw error("unsupported database schema: chat_turn table is missing.");
  const columns = new Set((await queryRows("PRAGMA table_info(chat_turn)")).map((row) => row.name));
  if (!columns.has("context") || (!columns.has("created_at") && !columns.has("updated_at"))) {
    throw error("unsupported chat_turn schema.");
  }
  const column = (name, fallback = "NULL") => columns.has(name) ? `"${name}"` : fallback;
  const date = columns.has("created_at") && columns.has("updated_at")
    ? 'COALESCE("created_at", "updated_at")' : column("created_at", column("updated_at"));
  const modelPaths = [
    "persist_user_message_context.model_info.display_model_name",
    "persist_user_message_context.model_info.model_name",
    "persist_user_message_context.model_info.config_name", "model_name", "model",
    "agent_model", "selected_model.name", "selectedModel.name",
  ];
  const model = modelPaths.map((field) => `CASE WHEN json_type(context, '$.${field}') = 'text'
    THEN NULLIF(NULLIF(TRIM(json_extract(context, '$.${field}')), ''), '-') END`);
  const fields = TOKEN_FIELDS.map((field) => `CASE
    WHEN json_type(context, '$.token_usage.${field}') IN ('integer', 'real')
    THEN json_extract(context, '$.token_usage.${field}') END AS "${field}"`);
  const invalidFields = TOKEN_FIELDS.map((field) =>
    `COALESCE(json_type(context, '$.token_usage.${field}') NOT IN ('integer', 'real', 'null'), 0)`);
  // Project inside SQLite: prompts, messages, session titles, fee/account data,
  // and the rest of the context never cross into JS results or cursor state.
  const query = `SELECT CAST(${column("id", "rowid")} AS TEXT) AS id,
    ${column("session_id")} AS session_id, ${column("turn_id")} AS turn_id,
    ${date} AS created_at, ${column("updated_at")} AS updated_at,
    COALESCE(${model.join(", ")}, 'trae-unknown') AS model,
    ${fields.join(", ")}, (${invalidFields.join(" OR ")}) AS invalid_usage
    FROM chat_turn WHERE CASE WHEN json_valid(context)
      THEN json_type(context, '$.token_usage') = 'object' ELSE 0 END`;
  return (await queryRows(query)).map((row) => {
    const usage = {};
    let invalid = Boolean(row.invalid_usage);
    for (const field of TOKEN_FIELDS) {
      const value = row[field];
      if (value == null) continue;
      if (!Number.isSafeInteger(value) || value < 0) invalid = true;
      else usage[field] = value;
    }
    return {
      id: row.id, session_id: row.session_id, turn_id: row.turn_id,
      created_at: row.created_at, updated_at: row.updated_at,
      model: row.model, usage: invalid ? null : usage,
    };
  });
}

async function readTraeCnLocalRows(dbPath, { lastId = 0, env = process.env, waitImpl, guardImpl } = {}) {
  const watermark = Number.isSafeInteger(lastId) && lastId > 0 ? lastId : 0;
  return readStableTraeSnapshot(dbPath, env,
    queryRows => projectTraeCnLocalRows(queryRows, watermark), waitImpl, guardImpl);
}

// ── TRAE CN per-request usage (the merged app's own request log) ──
// `chat_turn.context.token_usage` only carries the last LLM call of a turn;
// an agent turn can issue dozens of calls (verified: one 137-call turn whose
// chat_turn row held 195k tokens while the request log held 17.9M). The
// app's own `server_history_info` table records every call with
// token_usage (= prompt + completion for that request) and
// item_token_usage (= that message's own output), plus model attribution in
// extra_info (config_name / auto_router_model_name_v1) — coverage verified as
// 100% of usage rows on the real store. This reader returns those calls
// incrementally by rowid so a sync only touches newly written pages instead of
// re-scanning the multi-GB SQLCipher table.
//
// Older stores without server_history_info fall back to the chat_turn
// projection (one row per turn, last-call totals) so nothing regresses on
// stores that never shipped the request log.
function normalizeRequestModel(extra) {
  if (!extra || typeof extra !== "object") return "trae-unknown";
  const router = extra.auto_router_model_name_v1;
  const config = extra.config_name;
  if (typeof router === "string" && router.trim()) return router.trim();
  if (typeof config === "string" && config.trim()) return config.trim();
  return "trae-unknown";
}

function normalizeRequestPath(extra) {
  if (!extra || typeof extra !== "object") return null;
  for (const field of ["workspace_path", "workspace_folder"]) {
    const value = extra[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// The v1 exact_* fields (when the client writes them) split token_usage into
// its provider-raw parts — verified against the real store:
//   exact_prompt_tokens_v1  cache-INCLUSIVE prompt (OpenAI/DeepSeek semantics,
//                           same reading the chat_turn leg's credits formula
//                           confirmed: fresh + cache_read*(p/4) + output*q);
//   exact_output_tokens_v1  completion (reasoning-INCLUSIVE per
//                           exact_token_semantics_v1
//                           provider_raw_usage_completion_includes_reasoning);
//   exact_cache_read_input_tokens_v1  the cached subset of the prompt;
//   exact_reasoning_tokens_v1         the reasoning subset of the output.
// prompt + output == token_usage on every observed row, and that identity is
// enforced here — a row failing it (half-migrated client, semantic drift)
// falls back to the total-only estimate downstream rather than booking a
// wrong split. JSON stores these as strings, so everything goes through
// Number() first.
function exactRequestInt(value, { max = null } = {}) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  if (max !== null && n > max) return null;
  return n;
}

function extractRequestUsageFields(extraInfo, total) {
  if (!extraInfo || typeof extraInfo !== "object") return null;
  const prompt = exactRequestInt(extraInfo.exact_prompt_tokens_v1, { max: total });
  const output = exactRequestInt(extraInfo.exact_output_tokens_v1, { max: total });
  if (prompt === null && output === null) return null;
  if (prompt !== null && output !== null && prompt + output !== total) return null;
  return {
    prompt,
    output,
    cacheRead: exactRequestInt(extraInfo.exact_cache_read_input_tokens_v1, { max: prompt }),
    reasoning: exactRequestInt(extraInfo.exact_reasoning_tokens_v1, { max: output }),
  };
}

async function projectTraeCnRequestRows(queryRows, watermark) {
  const tables = new Set((await queryRows(
    "SELECT name FROM sqlite_master WHERE type='table'",
  )).map((row) => row.name));
  if (!tables.has("server_history_info")) return null;
  const columns = new Set((await queryRows("PRAGMA table_info(server_history_info)")).map((row) => row.name));
  if (!columns.has("token_usage")) return null;
  const maxRowId = Number((await queryRows("SELECT max(rowid) AS m FROM server_history_info"))[0]?.m || 0);
  const item = columns.has("item_token_usage") ? "t.item_token_usage" : "0";
  const extra = columns.has("extra_info") ? "t.extra_info" : "NULL";
  const session = columns.has("conversation_id")
    ? "t.conversation_id"
    : columns.has("session_id") ? "t.session_id" : "NULL";
  const rows = await queryRows(`SELECT CAST(t.rowid AS TEXT) AS id, ${session} AS session_id,
    COALESCE(t.created_at, t.updated_at) AS created_at, t.updated_at AS updated_at,
    t.token_usage AS total_tokens, ${item} AS output_tokens, ${extra} AS extra_info
    FROM server_history_info t
    WHERE t.rowid > ${watermark} AND t.token_usage > 0
    ORDER BY t.rowid ASC`);
  return {
    maxRowId,
    rows: rows.map((row) => {
      let extraInfo = null;
      if (typeof row.extra_info === "string") {
        try { extraInfo = JSON.parse(row.extra_info); } catch (_error) { extraInfo = null; }
      }
      const total = Number(row.total_tokens);
      const output = Number(row.output_tokens);
      const valid = Number.isSafeInteger(total) && total >= 0;
      return {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        model: normalizeRequestModel(extraInfo),
        usage: valid
          ? {
              total,
              output: Number.isSafeInteger(output) ? Math.min(Math.max(output, 0), total) : 0,
              exact: extractRequestUsageFields(extraInfo, total),
            }
          : null,
        absolute_path: normalizeRequestPath(extraInfo),
      };
    }),
  };
}

async function projectTraeCnLegacyRows(queryRows, watermark) {
  const rows = await projectTraeCnLocalRows(queryRows, watermark);
  const maxRowId = Number((await queryRows("SELECT max(rowid) AS m FROM chat_turn"))[0]?.m || 0);
  return {
    maxRowId,
    rows: rows.map((row) => {
      const totals = row.usage ? normalizeTraeUsage(row.usage, { model: row.model }) : null;
      return {
        id: row.id,
        session_id: row.session_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        model: row.model,
        usage: totals ? { total: totals.total_tokens, output: totals.output_tokens } : null,
        absolute_path: row.absolute_path,
      };
    }),
  };
}

async function readTraeCnUsageRows(dbPath, { lastRowId = 0, env = process.env, waitImpl, guardImpl } = {}) {
  const watermark = Number.isSafeInteger(lastRowId) && lastRowId > 0 ? lastRowId : 0;
  return readStableTraeSnapshot(dbPath, env, async (queryRows) => {
    const requestRows = await projectTraeCnRequestRows(queryRows, watermark);
    return requestRows || projectTraeCnLegacyRows(queryRows, watermark);
  }, waitImpl, guardImpl);
}

// ── TRAE CN merged-app local database ──
// The unified "Trae CN" IDE (the Work CN × CN merge) keeps its turns in
// %APPDATA%/Trae CN/ModularData/ai-agent/database.db. The SOLO CN cloud bill
// does not cover those sessions (verified: zero session-id overlap), so this
// store is the only source for that usage. The reader joins each turn with
// its chat_session → project row so the caller can attribute projects.
function resolveTraeCnLocalDbPath({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const explicit = String(env.TOKENTRACKER_TRAE_CN_LOCAL_DB || "").trim();
  if (explicit) return path.resolve(explicit);
  if (platform !== "win32") return null;
  const parent = env.APPDATA || path.join(home, "AppData", "Roaming");
  return path.join(parent, "Trae CN", "ModularData", "ai-agent", "database.db");
}

// Same projection as readTraeUsageRows' chat_turn query, plus the
// chat_session → project join for cwd attribution and a rowid watermark so
// the 3.7 GB decrypt only re-runs when the store actually grew.
async function projectTraeCnLocalRows(queryRows, watermark) {
  const columns = new Set((await queryRows("PRAGMA table_info(chat_turn)")).map((row) => row.name));
  const modelPaths = [
    "persist_user_message_context.model_info.display_model_name",
    "persist_user_message_context.model_info.model_name",
    "persist_user_message_context.model_info.config_name", "model_name", "model",
    "agent_model", "selected_model.name", "selectedModel.name",
  ];
  const model = modelPaths.map((field) => `CASE WHEN json_type(t.context, '$.${field}') = 'text'
    THEN NULLIF(NULLIF(TRIM(json_extract(t.context, '$.${field}')), ''), '-') END`);
  const fields = TOKEN_FIELDS.map((field) => `CASE
    WHEN json_type(t.context, '$.token_usage.${field}') IN ('integer', 'real')
    THEN json_extract(t.context, '$.token_usage.${field}') END AS "${field}"`);
  const invalidFields = TOKEN_FIELDS.map((field) =>
    `COALESCE(json_type(t.context, '$.token_usage.${field}') NOT IN ('integer', 'real', 'null'), 0)`);
  const query = `SELECT CAST(t.rowid AS TEXT) AS id,
    t.session_id AS session_id,
    COALESCE(t.created_at, t.updated_at) AS created_at,
    t.updated_at AS updated_at,
    COALESCE(${model.join(", ")}, 'trae-unknown') AS model,
    ${fields.join(", ")}, (${invalidFields.join(" OR ")}) AS invalid_usage,
    cs.project_id AS project_id, p.absolute_path AS absolute_path
    FROM chat_turn t
    LEFT JOIN chat_session cs ON cs.session_id = t.session_id
    LEFT JOIN project p ON p.project_id = cs.project_id
    WHERE CASE WHEN json_valid(t.context)
      THEN json_type(t.context, '$.token_usage') = 'object' ELSE 0 END
      AND t.rowid > ${watermark}
    ORDER BY t.rowid ASC`;
  return (await queryRows(query)).map((row) => {
    const usage = {};
    let invalid = Boolean(row.invalid_usage);
    for (const field of TOKEN_FIELDS) {
      const value = row[field];
      if (value == null) continue;
      if (!Number.isSafeInteger(value) || value < 0) invalid = true;
      else usage[field] = value;
    }
    return {
      id: row.id, session_id: row.session_id,
      created_at: row.created_at, updated_at: row.updated_at,
      model: row.model, usage: invalid ? null : usage,
      project_id: row.project_id, absolute_path: row.absolute_path,
    };
  });
}

// ── Session-layer projection (session browser) ──
// Same stores the usage side reads, shaped for per-session grouping. Sessions
// AND turns are returned regardless of deleted_at: the 2026-10-29 Work CN ×
// SOLO CN merge marked the entire local history soft-deleted while the turns
// carry real billed usage (owner ruling: deleted sessions' stats stay visible;
// the rows are the only record that usage ever happened). token_usage is
// returned RAW — normalizeTraeUsage (the exact normalizer the usage queue
// books) owns alias precedence, inclusive/exclusive disambiguation and the
// Gemini repairs, so the session browser cannot drift from the card.
async function projectTraeSessionRows(queryRows) {
  const columns = new Set((await queryRows("PRAGMA table_info(chat_turn)")).map((row) => row.name));
  const sessionColumns = new Set((await queryRows("PRAGMA table_info(chat_session)")).map((row) => row.name));
  if (!columns.has("session_id") || !sessionColumns.has("session_id")) {
    throw error("unsupported database schema: chat_turn/chat_session session_id is missing.");
  }
  const modelPaths = [
    "persist_user_message_context.model_info.display_model_name",
    "persist_user_message_context.model_info.model_name",
    "persist_user_message_context.model_info.config_name", "model_name", "model",
    "agent_model", "selected_model.name", "selectedModel.name",
  ];
  const model = modelPaths.map((field) => `CASE WHEN json_type(t.context, '$.${field}') = 'text'
    THEN NULLIF(NULLIF(TRIM(json_extract(t.context, '$.${field}')), ''), '-') END`);
  // turn_id/turn_status are the signal columns; older schemas without them
  // still scan (null turnId, zero-error accounting) — same conditional
  // projection the usage side uses for its optional columns.
  const turnId = columns.has("turn_id") ? "t.turn_id AS turn_id" : "NULL AS turn_id";
  const turnStatus = columns.has("turn_status") ? "t.turn_status AS turn_status" : "NULL AS turn_status";
  const turnQuery = `SELECT t.session_id AS session_id, ${turnId}, ${turnStatus},
    COALESCE(t.created_at, t.updated_at) AS created_at, t.updated_at AS updated_at,
    COALESCE(${model.join(", ")}, 'trae-unknown') AS model,
    json_extract(t.context, '$.token_usage') AS token_usage,
    json_type(t.context, '$.token_usage') AS usage_type
    FROM chat_turn t
    WHERE json_valid(t.context)
    ORDER BY t.rowid ASC`;
  const sessionQuery = `SELECT cs.session_id AS session_id, cs.session_title AS session_title,
    cs.created_at AS created_at, cs.updated_at AS updated_at,
    p.absolute_path AS absolute_path
    FROM chat_session cs
    LEFT JOIN project p ON p.project_id = cs.project_id
    ORDER BY cs.rowid ASC`;
  const turnRows = await queryRows(turnQuery);
  const sessionRows = await queryRows(sessionQuery);
  return {
    sessions: sessionRows.map((row) => ({
      sessionId: String(row?.session_id || "").trim(),
      title: typeof row?.session_title === "string" ? row.session_title : null,
      createdMs: row?.created_at, updatedMs: row?.updated_at,
      projectPath: typeof row?.absolute_path === "string" ? row.absolute_path : null,
    })),
    turns: turnRows.map((row) => ({
      sessionId: String(row?.session_id || "").trim(),
      turnId: row?.turn_id == null ? null : String(row.turn_id),
      turnStatus: row?.turn_status == null ? null : String(row.turn_status),
      createdMs: row?.created_at, updatedMs: row?.updated_at,
      model: row?.model || null,
      usagePresent: row?.usage_type === "object",
      tokenUsage: row?.token_usage == null ? null : String(row.token_usage),
    })),
  };
}

async function readTraeSessionRows(dbPath, { env = process.env, waitImpl, guardImpl } = {}) {
  return readStableTraeSnapshot(dbPath, env, projectTraeSessionRows, waitImpl, guardImpl);
}

module.exports = {
  resolveTraeDbPaths, readTraeUsageRows, resolveTraeCnLocalDbPath, readTraeCnLocalRows, readTraeCnUsageRows, readTraeSessionRows,
  // Test seam: the exact_* split extraction and its identity validation.
  extractRequestUsageFields,
  // Test seam: the fallback warning is once-per-process; tests reset it to
  // assert the once-ness across reads.
  __resetTraeGuardFallbackWarnForTest: () => { guardFallbackWarned = false; },
};
