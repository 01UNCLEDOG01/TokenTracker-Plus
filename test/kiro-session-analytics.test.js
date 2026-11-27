"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const {
  buildSessionAnalytics,
  listSessionsForBrowser,
  scanKiroSessionFile,
} = require("../src/lib/session-analytics");

test("Kiro CLI sessions are listed with T3 titles and verified parent grouping", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-kiro-session-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const sessionDir = path.join(home, ".kiro", "sessions", "workspace", "sess_child-kiro");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify({
    id: "child-kiro",
    modelId: "auto",
    title: "Native Kiro title",
    cwd: path.join(home, "project"),
    createdAt: "2026-11-27T01:55:00.000Z",
  }));
  fs.writeFileSync(path.join(sessionDir, "messages.jsonl"), [
    { id: "u1", timestamp: "2026-11-27T01:55:00.000Z",
      payload: { type: "user", content: "Please inspect the failing sync path in this project." } },
    { id: "a1", timestamp: "2026-11-27T01:56:00.000Z",
      payload: { type: "assistant", content: "I inspected the sync path and found the stale cursor." } },
    { id: "t1", timestamp: "2026-11-27T01:56:01.000Z", payload: { type: "turn_end" } },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const parentDir = path.join(home, ".kiro", "sessions", "workspace", "sess_parent-kiro");
  fs.mkdirSync(parentDir, { recursive: true });
  fs.writeFileSync(path.join(parentDir, "session.json"), JSON.stringify({
    id: "parent-kiro",
    modelId: "auto",
    title: "Parent Kiro title",
    cwd: path.join(home, "project"),
    createdAt: "2026-11-27T01:50:00.000Z",
  }));
  fs.writeFileSync(path.join(parentDir, "messages.jsonl"), [
    { id: "pu1", timestamp: "2026-11-27T01:50:00.000Z",
      payload: { type: "user", content: "Plan the delegated work across the project." } },
    { id: "pa1", timestamp: "2026-11-27T01:51:00.000Z",
      payload: { type: "assistant", content: "I planned the delegated work and started the child." } },
    { id: "pt1", timestamp: "2026-11-27T01:51:01.000Z", payload: { type: "turn_end" } },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const legacyDir = path.join(home, ".kiro", "sessions", "cli");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "child-kiro.json"), JSON.stringify({
    session_id: "child-kiro",
    session_state: {
      rts_model_state: { model_info: { model_id: "auto" } },
      conversation_metadata: { user_turn_metadatas: [{
        loop_id: { rand: 99 },
        message_ids: ["legacy-assistant"],
        input_token_count: 9000,
        output_token_count: 9000,
        request_start_timestamp_ms: Date.parse("2026-11-27T01:40:00.000Z"),
      }] },
    },
  }));

  const userdata = path.join(home, ".t3", "userdata");
  fs.mkdirSync(userdata, { recursive: true });
  fs.writeFileSync(path.join(userdata, "settings.json"), JSON.stringify({
    providerInstances: {
      kiro: { driver: "acpRegistry", config: { agentId: "kiro", source: "registry" } },
    },
  }));
  const db = new DatabaseSync(path.join(userdata, "statev2.sqlite"));
  db.exec(`
    CREATE TABLE orchestration_v2_projection_threads(
      thread_id TEXT PRIMARY KEY, title TEXT, payload_json TEXT, deleted_at TEXT
    );
    CREATE TABLE orchestration_v2_projection_provider_threads(
      thread_id TEXT NOT NULL, driver TEXT NOT NULL, provider_instance_id TEXT,
      payload_json TEXT NOT NULL
    );
  `);
  db.prepare("INSERT INTO orchestration_v2_projection_threads VALUES(?,?,?,NULL)").run(
    "parent-thread", "Parent work", "{}",
  );
  db.prepare("INSERT INTO orchestration_v2_projection_threads VALUES(?,?,?,NULL)").run(
    "child-thread", "T3 child title",
    JSON.stringify({ lineage: { parentThreadId: "parent-thread", relationshipToParent: "subagent" } }),
  );
  const insertProvider = db.prepare(
    "INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?,?,?)",
  );
  insertProvider.run("parent-thread", "acpRegistry", "kiro",
    JSON.stringify({ nativeThreadRef: { nativeId: "parent-kiro", strength: "strong" } }));
  insertProvider.run("child-thread", "acpRegistry", "kiro",
    JSON.stringify({ nativeThreadRef: { nativeId: "child-kiro", strength: "strong" } }));
  db.close();

  const direct = await scanKiroSessionFile(path.join(sessionDir, "messages.jsonl"));
  assert.equal(direct.length, 1);
  const sessions = await buildSessionAnalytics({ home, force: true, cacheTtlMs: 0 });
  const row = sessions.find((session) => session.source === "kiro" && session.session_id === "child-kiro");
  assert.ok(row);
  assert.equal(row.title, "T3 child title");
  assert.equal(row.parent_session_id, "parent-kiro");
  assert.equal(row.usage_source, "kiro-cli-transcript");
  assert.equal(row.usage_precision, "estimated");
  assert.equal(row.total_tokens, direct[0].total_tokens,
    "a legacy copy of the same Kiro session must not be added to its V2 transcript");
  assert.ok(row.total_tokens > 0);
  const listed = listSessionsForBrowser(sessions);
  const child = listed.sessions.find((session) => session.session_id === "child-kiro");
  const parent = listed.sessions.find((session) => session.session_id === "parent-kiro");
  assert.equal(child.parent_session_hash, parent.session_hash);
  assert.equal(child.thread_kind, "subagent");
});
