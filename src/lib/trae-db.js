const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openTraeSnapshot } = require("./trae-snapshot");
const { withTraeSqlite } = require("./trae-sqlite");

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

async function readTraeUsageRows(dbPath, { env = process.env } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let snapshot;
    try { snapshot = openTraeSnapshot(dbPath, env); }
    catch (err) {
      // A writer can also change the files while the snapshot opens. Retry
      // that too, and report the specific failure once attempts run out.
      if (err?.transient && attempt < 2) continue;
      throw err;
    }
    try {
      let result;
      try { result = await withTraeSqlite(snapshot, projectUsage); }
      catch (err) {
        // A writer may have changed pages while SQLite was reading. Discard
        // every projected row and retry; never publish a mixed snapshot.
        if (snapshot.isStable()) throw err;
        continue;
      }
      if (snapshot.isStable()) return result;
    } finally { snapshot.close(); }
  }
  throw error("database changed during the read; retry after TRAE finishes its current turn.");
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
async function readTraeCnLocalRows(dbPath, { lastId = 0, env = process.env } = {}) {
  const watermark = Number.isSafeInteger(lastId) && lastId > 0 ? lastId : 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    let snapshot;
    try { snapshot = openTraeSnapshot(dbPath, env); }
    catch (err) {
      if (err?.transient && attempt < 2) continue;
      throw err;
    }
    try {
      let result;
      try { result = await withTraeSqlite(snapshot, (queryRows) => projectTraeCnLocalRows(queryRows, watermark)); }
      catch (err) {
        if (snapshot.isStable()) throw err;
        continue;
      }
      if (snapshot.isStable()) return result;
    } finally { snapshot.close(); }
  }
  throw error("database changed during the read; retry after TRAE finishes its current turn.");
}

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

async function readTraeSessionRows(dbPath, { env = process.env } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let snapshot;
    try { snapshot = openTraeSnapshot(dbPath, env); }
    catch (err) {
      if (err?.transient && attempt < 2) continue;
      throw err;
    }
    try {
      let result;
      try { result = await withTraeSqlite(snapshot, projectTraeSessionRows); }
      catch (err) {
        if (snapshot.isStable()) throw err;
        continue;
      }
      if (snapshot.isStable()) return result;
    } finally { snapshot.close(); }
  }
  throw error("database changed during the read; retry after TRAE finishes its current turn.");
}

module.exports = { resolveTraeDbPaths, readTraeUsageRows, resolveTraeCnLocalDbPath, readTraeCnLocalRows, readTraeSessionRows };
