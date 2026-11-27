"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { pathToFileURL } = require("node:url");
const {
  readAntigravitySessionMetadata,
  summaryDbForConversationDb,
} = require("../src/lib/antigravity-session-metadata");

function fixture(t, row) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-antigravity-summary-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const conversationDb = path.join(dir, "conversations", `${row.conversation_id}.db`);
  fs.mkdirSync(path.dirname(conversationDb), { recursive: true });
  fs.writeFileSync(conversationDb, "");
  const summaryDb = summaryDbForConversationDb(conversationDb);
  const db = new DatabaseSync(summaryDb);
  db.exec(`
    CREATE TABLE conversation_summaries(
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      agent_name TEXT,
      status TEXT,
      not_fully_idle INTEGER,
      last_user_input_time TEXT,
      last_modified_time TEXT,
      workspace_uris TEXT,
      parent_conversation_id TEXT
    );
  `);
  db.prepare("INSERT INTO conversation_summaries VALUES(?,?,?,?,?,?,?,?,?,?)").run(
    row.conversation_id,
    row.title ?? null,
    row.preview ?? null,
    row.agent_name ?? null,
    row.status ?? null,
    row.not_fully_idle ?? null,
    row.last_user_input_time ?? null,
    row.last_modified_time ?? null,
    row.workspace_uris ?? null,
    row.parent_conversation_id ?? null,
  );
  db.close();
  return conversationDb;
}

test("native summary supplies title, workspace and live running state", (t) => {
  const now = Date.parse("2026-11-27T02:00:00Z");
  const workspace = path.join(os.tmpdir(), "tt-antigravity-workspace");
  const conversationDbPath = fixture(t, {
    conversation_id: "11111111-1111-1111-1111-111111111111",
    title: "Fix the local sync queue",
    status: "CASCADE_RUN_STATUS_RUNNING",
    not_fully_idle: 1,
    last_user_input_time: "2026-11-27 01:58:00+00:00",
    last_modified_time: "2026-11-27 01:59:30+00:00",
    workspace_uris: JSON.stringify([pathToFileURL(workspace).href]),
    parent_conversation_id: "22222222-2222-2222-2222-222222222222",
  });
  assert.deepEqual(
    readAntigravitySessionMetadata({
      conversationDbPath,
      conversationId: "11111111-1111-1111-1111-111111111111",
      nowMs: now,
    }),
    {
      title: "Fix the local sync queue",
      preview: null,
      workspace,
      parentSessionId: "22222222-2222-2222-2222-222222222222",
      source: "antigravity-conversation-summaries",
      liveStatus: "running",
      turnEnded: false,
      lastActivityAt: Date.parse("2026-11-27T01:59:30Z"),
      lastUserInputAt: Date.parse("2026-11-27T01:58:00Z"),
    },
  );
});

test("idle summaries finish a turn; stale running rows stop claiming live status", (t) => {
  const idle = fixture(t, {
    conversation_id: "33333333-3333-3333-3333-333333333333",
    preview: "Finished task",
    status: "CASCADE_RUN_STATUS_IDLE",
    not_fully_idle: 0,
    last_user_input_time: "2026-11-27 01:00:00+00:00",
    last_modified_time: "2026-11-27 01:02:00+00:00",
  });
  assert.equal(readAntigravitySessionMetadata({
    conversationDbPath: idle,
    conversationId: "33333333-3333-3333-3333-333333333333",
    nowMs: Date.parse("2026-11-27T02:00:00Z"),
  }).liveStatus, "idle");

  const stale = fixture(t, {
    conversation_id: "44444444-4444-4444-4444-444444444444",
    status: "CASCADE_RUN_STATUS_RUNNING",
    last_user_input_time: "2026-11-27 00:00:00+00:00",
    last_modified_time: "2026-11-27 00:00:00+00:00",
  });
  assert.equal(readAntigravitySessionMetadata({
    conversationDbPath: stale,
    conversationId: "44444444-4444-4444-4444-444444444444",
    nowMs: Date.parse("2026-11-27T02:00:00Z"),
  }).liveStatus, "unknown");

  const missingTimestamp = fixture(t, {
    conversation_id: "55555555-5555-4555-8555-555555555555",
    status: "CASCADE_RUN_STATUS_RUNNING",
  });
  assert.equal(readAntigravitySessionMetadata({
    conversationDbPath: missingTimestamp,
    conversationId: "55555555-5555-4555-8555-555555555555",
    nowMs: Date.parse("2026-11-27T02:00:00Z"),
  }).liveStatus, "unknown");
});
