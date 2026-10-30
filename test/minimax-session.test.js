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
const {
  discoverMinimaxSessionFiles,
  readMinimaxCodeSession,
} = require("../src/lib/minimax-session");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-minimax-session-"));
  const sessionDir = path.join(root, "v2", "sessions", "2026", "10", "01", "10-00-00-000-session_bXZzX2RlbW8");
  fs.mkdirSync(sessionDir, { recursive: true });
  const messagesPath = path.join(sessionDir, "messages.jsonl");
  const lines = [
    { message_id: "u1", turn_id: "t1", message: { role: "user", content: "审查表单", timestamp: 1793000000000 } },
    {
      message_id: "a1",
      turn_id: "t1",
      message: {
        role: "assistant",
        model: "MiniMax-M3.1-Flash",
        timestamp: 1793000001000,
        usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 5, totalTokens: 135 },
      },
    },
    // replay copy of the same assistant reply must not count twice
    {
      message_id: "a1",
      turn_id: "t1",
      message: {
        role: "assistant",
        model: "MiniMax-M3.1-Flash",
        timestamp: 1793000001000,
        usage: { input: 100, output: 10, cacheRead: 20, cacheWrite: 5, totalTokens: 135 },
      },
    },
    {
      message_id: "a2",
      turn_id: "t2",
      message: {
        role: "assistant",
        model: "MiniMax-M3.1-Flash",
        timestamp: 1793000005000,
        usage: { input: 50, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 55 },
      },
    },
    { message_id: "tr1", turn_id: "t2", message: { role: "toolResult", toolName: "bash", isError: false, timestamp: 1793000004000 } },
  ];
  fs.writeFileSync(messagesPath, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  fs.writeFileSync(
    path.join(sessionDir, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, sessionId: "mvs_demo", createdAtMs: 1793000000000 }),
  );
  const dbPath = path.join(root, "v2", "sqlite", "runtime-state.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE local_runtime_sessions (" +
      "session_id TEXT PRIMARY KEY, title TEXT, workspace_dir TEXT, project_id INTEGER, " +
      "created_at_ms INTEGER, updated_at_ms INTEGER, archived INTEGER, status TEXT, " +
      "error_message TEXT, error_code INTEGER, session_type TEXT, parent_session_id TEXT, extra_data_json TEXT);",
  );
  db.prepare(
    "INSERT INTO local_runtime_sessions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    "mvs_demo",
    "审查账号表单与登录注册交互",
    "F:\\work\\demo",
    1,
    1793000000000,
    1793000006000,
    1,
    "idle",
    "Cron definition was deleted before execution",
    50110,
    "branch",
    null,
    '{"effectiveModel":"minimax/MiniMax-M3.1-Flash"}',
  );
  db.close();
  return { root, messagesPath };
}

sqliteTest("reads title/workspace/tokens/calls from MiniMax messages + runtime sessions", async () => {
  const { root, messagesPath } = createFixture();
  try {
    const row = await readMinimaxCodeSession(messagesPath);
    assert.equal(row.session_id, "mvs_demo");
    assert.equal(row.title, "审查账号表单与登录注册交互");
    assert.equal(row.project_ref, "F:\\work\\demo");
    assert.equal(row.model_calls, 2);
    assert.equal(row.turns, 1);
    assert.equal(row.tool_calls, 1);
    assert.equal(row.tokens.input_tokens, 150);
    assert.equal(row.tokens.cached_input_tokens, 20);
    assert.equal(row.tokens.cache_creation_input_tokens, 5);
    assert.equal(row.tokens.output_tokens, 15);
    assert.equal(row.tokens.total_tokens, 190);
    assert.equal(row.model, "MiniMax-M3.1-Flash");
    assert.equal(row.archived, true);
    assert.equal(row.error, "Cron definition was deleted before execution");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

sqliteTest("discovers sessions under an explicit MINIMAX_DATA_DIR", () => {
  const { root, messagesPath } = createFixture();
  try {
    const files = discoverMinimaxSessionFiles({ MINIMAX_DATA_DIR: root });
    assert.deepEqual(files, [path.resolve(messagesPath)]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
