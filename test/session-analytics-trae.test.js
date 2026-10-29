"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const initSqlJs = require("sql.js");

const {
  scanTraeSessions,
  discoverSessionFiles,
  SIDECAR_VERSION,
} = require("../src/lib/session-analytics");

let sql;
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-trae-sessions-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Plain-SQLite fixture (same approach as trae-db.test.js): the snapshot reader
// accepts unencrypted stores; the SQLCipher page path is covered by the
// trae-sqlite/trae-snapshot suites. Schema mirrors the live TRAE stores —
// including the deleted_at columns the session layer deliberately ignores.
async function fixtureDb(build) {
  sql ||= initSqlJs();
  const SQL = await sql;
  const db = new SQL.Database();
  try {
    db.run(`CREATE TABLE project (project_id TEXT PRIMARY KEY, absolute_path TEXT);
      CREATE TABLE chat_session (id INTEGER PRIMARY KEY, session_id TEXT, project_id TEXT,
        session_title TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
      CREATE TABLE chat_turn (id INTEGER PRIMARY KEY, session_id TEXT, turn_id TEXT,
        turn_status TEXT, created_at INTEGER, updated_at INTEGER, context TEXT);`);
    build(db);
    return Buffer.from(db.export());
  } finally { db.close(); }
}

async function writeDb(t, build) {
  const dir = temp(t);
  const file = path.join(dir, "database.db");
  fs.writeFileSync(file, await fixtureDb(build));
  return { dir, file };
}

const insertSession = (db, [id, sessionId, projectId, title, created, updated, deleted]) =>
  db.run("INSERT INTO chat_session VALUES (?, ?, ?, ?, ?, ?, ?)", [id, sessionId, projectId, title, created, updated, deleted]);
const insertTurn = (db, [id, sessionId, turnId, status, created, updated, context]) =>
  db.run("INSERT INTO chat_turn VALUES (?, ?, ?, ?, ?, ?, ?)", [id, sessionId, turnId, status, created, updated, JSON.stringify(context)]);

test("TRAE session scan groups turns per session with title, project and reported usage", async (t) => {
  const { file } = await writeDb(t, (db) => {
    db.run("INSERT INTO project VALUES ('p1', 'C:\\repo\\demo')");
    // Soft-deleted by the merge artifact: still listed, stats visible.
    insertSession(db, [1, "sess-1", "p1", "优化后台管理数据看板-67", 1793200000, 1793285000, 1793285000]);
    insertSession(db, [2, "sess-2", null, "零用量会话", 1793200000, 1793200100, 1793200100]);
    // Prompt is fresh-only, cache on top, reasoning reported separately —
    // the exclusive shape the usage queue books without inference.
    insertTurn(db, [1, "sess-1", "turn-1", "completed", 1793280000, 1793280060, {
      model_name: "DeepSeek-V4.1-Flash",
      token_usage: { prompt_tokens: 20, completion_tokens: 20, cache_read_input_tokens: 80, reasoning_tokens: 5, total_tokens: 125 },
    }]);
    // Activity-only turn: no token_usage object at all — counts as a turn,
    // never as tokens or a usage event.
    insertTurn(db, [2, "sess-1", "turn-2", "completed", 1793280120, 1793280180, { model_name: "DeepSeek-V4.1-Flash" }]);
    // Counters that do not validate normalize to null usage (activity only).
    insertTurn(db, [3, "sess-1", "turn-3", "error", 1793280240, 1793280250, { token_usage: { prompt_tokens: -1 } }]);
    insertTurn(db, [4, "sess-2", "turn-a", "completed", 1793281000, 1793281010, {
      model_name: "GLM-5.3",
      token_usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
    }]);
  });

  const rows = await scanTraeSessions(file, { source: "trae-cn" });
  assert.equal(rows.length, 2);
  const first = rows.find((row) => row.session_id === "sess-1");
  assert.equal(first.source, "trae-cn");
  assert.equal(first.title, "优化后台管理数据看板-67");
  assert.equal(first.project_ref, "C:\\repo\\demo");
  assert.equal(first.project_key, "demo");
  assert.deepEqual(first.tokens, {
    input_tokens: 20,
    cached_input_tokens: 80,
    cache_creation_input_tokens: 0,
    output_tokens: 20,
    reasoning_output_tokens: 5,
    total_tokens: 125,
  });
  assert.equal(first.turns, 3);
  assert.equal(first.usage_events, 1);
  assert.equal(first.model_calls, 1);
  assert.equal(first.model, "deepseek-v4.1-flash");
  assert.equal(first.usage_precision, "reported");
  assert.equal(first.model_usage.length, 1);
  assert.equal(first.model_usage[0].model, "deepseek-v4.1-flash");
  assert.equal(first.model_usage[0].usage_events, 1);
  // Seconds-resolution store timestamps surface as ISO bounds and minute
  // buckets carry the turn's usage under its model.
  const startIso = new Date(1793280000 * 1000).toISOString();
  assert.equal(first.started_at, startIso);
  const bucket = first.usage_buckets.find((b) => b.timestamp === startIso);
  assert.equal(bucket.total_tokens, 125);
  assert.equal(bucket.usage_events, 1);
  // Soft-deleted sessions keep their stats (merge artifact, owner ruling).
  const second = rows.find((row) => row.session_id === "sess-2");
  assert.equal(second.title, "零用量会话");
  assert.equal(second.tokens.total_tokens, 60);
  assert.equal(second.project_ref, null);
  assert.equal(second.cost_usd > 0, true);
  assert.equal(second.model_usage[0].pricing.status, "priced");
});

test("TRAE session scan lists a session whose turns carry no usage at all", async (t) => {
  const { file } = await writeDb(t, (db) => {
    insertSession(db, [1, "sess-empty", null, "空会话", 1793200000, 1793200100, null]);
    insertTurn(db, [1, "sess-empty", "turn-1", "completed", 1793200000, 1793200050, {}]);
  });
  const rows = await scanTraeSessions(file, { source: "trae" });
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.title, "空会话");
  assert.equal(row.tokens.total_tokens, 0);
  assert.equal(row.turns, 1);
  assert.equal(row.usage_events, 0);
  assert.equal(row.usage_precision, "unavailable");
  assert.equal(row.model, "unknown");
  // Wall-clock span falls back to the chat_session row's own timestamps.
  assert.equal(row.started_at, new Date(1793200000 * 1000).toISOString());
});

test("TRAE alias counters are booked once and multi-model sessions read as mixed", async (t) => {
  const { file } = await writeDb(t, (db) => {
    insertSession(db, [1, "sess-mix", null, "混合模型", 1793200000, 1793200200, null]);
    insertTurn(db, [1, "sess-mix", "turn-1", "completed", 1793200000, 1793200060, {
      model_name: "DeepSeek-V4.1-Flash",
      token_usage: { prompt_tokens: 100, input_tokens: 100, completion_tokens: 20, output_tokens: 20, total_tokens: 120 },
    }]);
    insertTurn(db, [2, "sess-mix", "turn-2", "completed", 1793200120, 1793200180, {
      model_name: "GLM-5.3",
      token_usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 },
    }]);
  });
  const rows = await scanTraeSessions(file, { source: "trae" });
  assert.equal(rows.length, 1);
  const row = rows[0];
  // prompt_tokens and input_tokens are aliases — the input side must be 300,
  // not 600 (normalizeTraeUsage owns the resolution).
  assert.equal(row.tokens.input_tokens, 300);
  assert.equal(row.tokens.output_tokens, 50);
  assert.equal(row.tokens.total_tokens, 350);
  assert.equal(row.model, "mixed");
  assert.equal(row.model_usage.length, 2);
  assert.equal(row.version, SIDECAR_VERSION);
});

test("discovery lists TRAE and Trae CN databases from the environment", async (t) => {
  const home = temp(t);
  const intl = path.join(home, "intl-database.db");
  const cn = path.join(home, "cn-database.db");
  fs.writeFileSync(intl, "not a real store");
  fs.writeFileSync(cn, "not a real store");
  const discovered = await discoverSessionFiles(home, {
    HOME: home,
    TOKENTRACKER_TRAE_DB: intl,
    TOKENTRACKER_TRAE_CN_LOCAL_DB: cn,
  });
  assert.deepEqual(discovered.trae, [intl]);
  assert.deepEqual(discovered.traeCn, [cn]);
  // The explicit CN override wins even on a platform without the merged app path.
  const cnOverride = await discoverSessionFiles(home, {
    HOME: home,
    TOKENTRACKER_TRAE_CN_LOCAL_DB: cn,
  }, { platform: "linux" });
  assert.deepEqual(cnOverride.traeCn, [cn]);
});
