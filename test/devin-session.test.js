"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (_e) { }

const sqliteTest = typeof DatabaseSync === "function" ? test : test.skip;
const { readDevinSessions } = require("../src/lib/devin-session");

function createDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-devin-session-"));
  const dbPath = path.join(dir, "sessions.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE sessions (id TEXT PRIMARY KEY, working_directory TEXT, backend_type TEXT, model TEXT, agent_mode TEXT, created_at INTEGER, last_activity_at INTEGER, title TEXT, hidden INTEGER DEFAULT 0);" +
      "CREATE TABLE message_nodes (row_id INTEGER PRIMARY KEY, session_id TEXT, node_id TEXT, chat_message TEXT);",
  );
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "s1", "F:\\work\\demo", "windsurf", "swe-1-6-slow", "accept-edits", 1793331820, 1793332792, "Security check", 0,
  );
  const assistant = (requestId, output, duration, ttft) => JSON.stringify({
    role: "assistant",
    metadata: {
      request_id: requestId,
      generation_model: "swe-1-6-slow",
      started_generation_at: "2026-10-30T03:43:42.643943700Z",
      created_at: "2026-10-30T03:43:43.888448100Z",
      metrics: { input_tokens: 100, output_tokens: output, cache_read_tokens: 20, cache_creation_tokens: 0, ttft_ms: ttft, total_time_ms: duration },
    },
  });
  const insertNode = db.prepare("INSERT INTO message_nodes VALUES (?, ?, ?, ?)");
  insertNode.run(1, "s1", "n1", assistant("r1", 200, 4000, 1000));
  insertNode.run(2, "s1", "n2", assistant("r1", 200, 4000, 1000)); // replay copy
  insertNode.run(3, "s1", "n3", assistant("r2", 300, 6000, 2000));
  insertNode.run(4, "s1", "n4", JSON.stringify({ role: "user", content: "go" }));
  db.close();
  return { dir, dbPath };
}

sqliteTest("dedupes Devin request ids and maps provider timing to a session rate", async () => {
  const { dir, dbPath } = createDb();
  try {
    const rows = await readDevinSessions(dbPath);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.session_id, "s1");
    assert.equal(row.title, "Security check");
    assert.equal(row.project_ref, "F:\\work\\demo");
    assert.equal(row.model_calls, 2);
    assert.equal(row.turns, 1);
    assert.equal(row.tokens.input_tokens, 200);
    assert.equal(row.tokens.output_tokens, 500);
    assert.equal(row.tokens.cached_input_tokens, 40);
    assert.equal(row.tokens.total_tokens, 740);
    assert.equal(row.performance.estimated_request_count, 2);
    assert.equal(row.performance.estimated_output_tokens, 500);
    assert.equal(row.performance.estimated_duration_ms, 10000);
    assert.equal(row.performance.first_response_sample_count, 2);
    assert.equal(row.performance.first_response_total_ms, 3000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
