"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { readT3NativeMetadata } = require("../src/lib/t3-native-metadata");

test("T3 metadata maps current ACP native ids to titles and explicit parents", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-t3-metadata-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const userdata = path.join(home, ".t3", "userdata");
  fs.mkdirSync(userdata, { recursive: true });
  fs.writeFileSync(path.join(userdata, "settings.json"), JSON.stringify({
    providerInstances: {
      kiro_instance: { driver: "acpRegistry", config: { agentId: "kiro", source: "registry" } },
      antigravity_instance: { driver: "acpRegistry", config: { agentId: "antigravity", source: "registry" } },
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
    "parent-thread",
    "Parent task",
    "{}",
  );
  db.prepare("INSERT INTO orchestration_v2_projection_threads VALUES(?,?,?,NULL)").run(
    "child-thread",
    "Delegated Kiro task",
    JSON.stringify({ lineage: { parentThreadId: "parent-thread", relationshipToParent: "subagent" } }),
  );
  const provider = db.prepare(
    "INSERT INTO orchestration_v2_projection_provider_threads VALUES(?,?,?,?)",
  );
  provider.run("parent-thread", "acpRegistry", "kiro_instance",
    JSON.stringify({ nativeThreadRef: { nativeId: "parent-kiro", strength: "strong" } }));
  provider.run("child-thread", "acpRegistry", "kiro_instance",
    JSON.stringify({ nativeThreadRef: { nativeId: "child-kiro", strength: "strong" } }));
  provider.run("parent-thread", "antigravity", null,
    JSON.stringify({ nativeThreadRef: { nativeId: "parent-antigravity", strength: "strong" } }));
  provider.run("child-thread", "kiro", null,
    JSON.stringify({ nativeThreadRef: { nativeId: "weak-kiro", strength: "weak" } }));
  provider.run("child-thread", "kiro", null,
    JSON.stringify({ nativeThreadRef: { nativeId: "unrated-kiro" } }));
  db.close();

  const metadata = readT3NativeMetadata(
    ["child-kiro", "parent-antigravity", "weak-kiro", "unrated-kiro"],
    { home, env: {} },
  );
  assert.deepEqual(metadata.get("kiro\0child-kiro"), {
    title: "Delegated Kiro task",
    parentSessionId: "parent-kiro",
    threadId: "child-thread",
    client: "kiro",
  });
  assert.deepEqual(metadata.get("antigravity\0parent-antigravity"), {
    title: "Parent task",
    parentSessionId: null,
    threadId: "parent-thread",
    client: "antigravity",
  });
  assert.equal(metadata.has("kiro\0weak-kiro"), false);
  assert.equal(metadata.has("kiro\0unrated-kiro"), false);
});
