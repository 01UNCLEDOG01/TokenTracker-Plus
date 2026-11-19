"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { resolveOpenclawSessionFiles, parseOpenclawIncremental } = require("../src/lib/rollout");
const { ensureOpenclawSessionPluginFiles } = require("../src/lib/openclaw-session-plugin");
const { cmdSync } = require("../src/commands/sync");
const { withHome } = require("./helpers/with-home");
let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); } catch {}

for (const agentId of ["main", "agents"]) test(`OpenClaw SQLite imports and auto hooks are idempotent for agent ${agentId}`, { skip: !DatabaseSync }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-openclaw-sqlite-"));
  let db;
  t.after(() => { db?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const home = path.join(root, "oc");
  const agent = path.join(home, "agents", agentId);
  fs.mkdirSync(path.join(agent, "agent"), { recursive: true });
  fs.mkdirSync(path.join(agent, "session-sqlite-import-archive"));
  const dbPath = path.join(agent, "agent", "openclaw-agent.sqlite");
  db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE session_windows(session_id TEXT PRIMARY KEY, session_key TEXT, updated_at INTEGER, reason TEXT); CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT, created_at INTEGER)");
  db.exec(`INSERT INTO session_windows VALUES ('s1', 'agent:${agentId}:main', 1, 'initial'), ('checkpoint', 'agent:${agentId}:main', 100, 'compaction')`);
  const event = (id, timestamp, model) => ({ type: "message", id, timestamp, message: {
    role: "assistant", model, content: "PRIVATE CONTENT MUST NOT BE COPIED", provider: "openai",
    usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 10, totalTokens: 130 },
  } });
  const first = event("e1", "2026-10-09T23:45:00Z", "gpt-5.4");
  const insert = db.prepare("INSERT INTO transcript_events VALUES (?, ?, ?, 1)");
  insert.run("s1", 0, JSON.stringify(first));
  insert.run("checkpoint", 0, JSON.stringify(event("checkpoint-copy", "2026-10-09T23:45:00Z", "gpt-5.4")));
  fs.writeFileSync(path.join(agent, "session-sqlite-import-archive", "s1-topic-42.jsonl"), JSON.stringify(first) + "\n");
  const queuePath = path.join(root, "queue.jsonl");
  const cursors = { files: {} };
  const files = await resolveOpenclawSessionFiles({ TOKENTRACKER_OPENCLAW_HOME: home });
  assert.ok(files.includes(dbPath));
  const sync = () => parseOpenclawIncremental({ sessionFiles: files, cursors, queuePath });
  assert.equal((await sync()).eventsAggregated, 1);
  assert.equal((await sync()).eventsAggregated, 0);
  insert.run("s1", 1, JSON.stringify(event("e2", "2026-10-10T00:15:00Z", "gpt-5.5")));
  assert.equal((await sync()).eventsAggregated, 1);
  assert.equal((await sync()).eventsAggregated, 0);
  const rows = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.model), ["gpt-5.4", "gpt-5.5"]);
  assert.deepEqual(rows.map((r) => r.hour_start), ["2026-10-09T23:30:00.000Z", "2026-10-10T00:00:00.000Z"]);
  for (const row of rows) {
    assert.equal(row.input_tokens, 20);
    assert.equal(row.cached_input_tokens, 80);
    assert.equal(row.cache_creation_input_tokens, 10);
    assert.equal(row.total_tokens, 130);
  }
  assert.ok(!JSON.stringify(cursors).includes("PRIVATE CONTENT"));

  const trackerDir = path.join(root, "tracker");
  if (agentId === "agents") {
    db.exec(`CREATE TABLE session_nodes(session_key TEXT PRIMARY KEY, current_session_id TEXT);
      INSERT INTO session_nodes VALUES ('agent:${agentId}:main', 's1');
      INSERT INTO session_windows VALUES ('newer-but-not-current', 'agent:${agentId}:main', 200, 'reset')`);
  }
  const pluginDir = path.join(root, "plugin");
  await ensureOpenclawSessionPluginFiles({ pluginDir, trackerDir, openclawHome: home });
  const pluginPath = path.join(pluginDir, "openclaw-session-sync", "index.js");
  // Exercise generated ESM rather than matching its source text.
  const module = await import(pathToFileURL(pluginPath).href);
  const handlers = {};
  module.default({ on: (name, fn) => { handlers[name] = fn; } });
  const cp = require("node:child_process");
  const originalSpawn = cp.spawn;
  const calls = [];
  cp.spawn = (...args) => { calls.push(args); return { unref() {} }; };
  try { await handlers.agent_end({}, { sessionKey: `agent:${agentId}:main`, agentId }); }
  finally { cp.spawn = originalSpawn; }
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].env.TOKENTRACKER_OPENCLAW_PREV_SESSION_ID, "s1");
  assert.equal(calls[0][2].env.TOKENTRACKER_OPENCLAW_PREV_TOTAL_TOKENS, undefined);
  const restoreHome = withHome(root);
  const names = ["TOKENTRACKER_OPENCLAW_AGENT_ID", "TOKENTRACKER_OPENCLAW_PREV_SESSION_ID", "TOKENTRACKER_OPENCLAW_HOME", "TOKENTRACKER_OPENCLAW_SESSION_KEY", "TOKENTRACKER_DEVICE_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) {
      if (calls[0][2].env[name] && name !== "TOKENTRACKER_DEVICE_TOKEN") process.env[name] = calls[0][2].env[name];
      else delete process.env[name];
    }
    await cmdSync(["--auto", "--from-openclaw"]);
    const autoQueue = path.join(root, ".tokentracker", "tracker", "queue.jsonl");
    const firstAuto = fs.readFileSync(autoQueue, "utf8");
    const autoRows = firstAuto.trim().split("\n").map(JSON.parse);
    assert.equal(autoRows.reduce((sum, row) => sum + row.total_tokens, 0), 260);
    await cmdSync(["--auto", "--from-openclaw"]);
    assert.equal(fs.readFileSync(autoQueue, "utf8"), firstAuto);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
    restoreHome();
  }
});

// ── SQLite transcript archives (TM #1508, upstream tokscale 4.23) ──
// Deleted/reset sessions persist in `session_transcript_archives` as identity
// or zstd JSONL blobs (pretty-printed records allowed), possibly before their
// transcript file is published. The same event in the store, its published
// file and an archive generation must count exactly once.

test("OpenClaw SQLite archives: identity + zstd generations dedup; archive-only store counts", { skip: !DatabaseSync }, async (t) => {
  const zlib = require("node:zlib");
  const crypto = require("node:crypto");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-openclaw-archives-"));
  let db;
  t.after(() => { db?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const home = path.join(root, "oc");
  const agent = path.join(home, "agents", "main");
  fs.mkdirSync(path.join(agent, "agent"), { recursive: true });
  const dbPath = path.join(agent, "agent", "openclaw-agent.sqlite");
  db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE session_windows(session_id TEXT PRIMARY KEY, session_key TEXT, updated_at INTEGER, reason TEXT);
    CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT, created_at INTEGER);
    CREATE TABLE session_transcript_archives (
      session_id TEXT NOT NULL, generation TEXT NOT NULL, encoding TEXT NOT NULL,
      archive_blob BLOB NOT NULL, archive_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL,
      published_at INTEGER, PRIMARY KEY (session_id, generation)) STRICT`);
  const event = (id, timestamp, model) => ({ type: "message", id, timestamp, message: {
    role: "assistant", model, content: "PRIVATE CONTENT MUST NOT APPEAR", provider: "openai",
    usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 10, totalTokens: 130 },
  } });
  const e1 = event("e1", "2026-10-09T23:45:00Z", "gpt-5.4");
  const e2 = event("e2", "2026-10-10T00:15:00Z", "gpt-5.5");
  const insertArchive = (generation, text, { compress = false } = {}) => {
    const blob = compress ? zlib.zstdCompressSync(Buffer.from(text, "utf8")) : Buffer.from(text, "utf8");
    db.prepare("INSERT INTO session_transcript_archives (session_id, generation, encoding, archive_blob, archive_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("old-session", generation, compress ? "zstd" : "identity", blob,
        crypto.createHash("sha256").update(blob).digest("hex"), 1756548001);
  };
  insertArchive("plain", JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n");
  // The same events again in a zstd generation — identity dedup collapses them.
  insertArchive("compressed", JSON.stringify(e1) + "\n" + JSON.stringify(e2) + "\n", { compress: true });
  // Archive-only store: transcript_events/session_windows stay empty.

  const files = await resolveOpenclawSessionFiles({ TOKENTRACKER_OPENCLAW_HOME: home });
  assert.ok(files.includes(dbPath));
  const cursors = { files: {} };
  const queuePath = path.join(root, "queue.jsonl");
  const first = await parseOpenclawIncremental({ sessionFiles: files, cursors, queuePath });
  assert.equal(first.eventsAggregated, 2);
  const second = await parseOpenclawIncremental({ sessionFiles: files, cursors, queuePath });
  assert.equal(second.eventsAggregated, 0);
  const rows = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((r) => r.model), ["gpt-5.4", "gpt-5.5"]);
  assert.ok(!JSON.stringify(cursors).includes("PRIVATE CONTENT"));
});

test("OpenClaw SQLite archives: dedup vs live/published, bad rows skip, created_at fallback", { skip: !DatabaseSync }, async (t) => {
  const zlib = require("node:zlib");
  const crypto = require("node:crypto");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-openclaw-archives-bad-"));
  let db;
  t.after(() => { db?.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const home = path.join(root, "oc");
  const agent = path.join(home, "agents", "main");
  fs.mkdirSync(path.join(agent, "agent"), { recursive: true });
  fs.mkdirSync(path.join(agent, "session-sqlite-import-archive"));
  const dbPath = path.join(agent, "agent", "openclaw-agent.sqlite");
  db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE session_windows(session_id TEXT PRIMARY KEY, session_key TEXT, updated_at INTEGER, reason TEXT);
    CREATE TABLE transcript_events(session_id TEXT, seq INTEGER, event_json TEXT, created_at INTEGER);
    CREATE TABLE session_transcript_archives (
      session_id TEXT NOT NULL, generation TEXT NOT NULL, encoding TEXT NOT NULL,
      archive_blob BLOB NOT NULL, archive_sha256 TEXT NOT NULL, created_at INTEGER NOT NULL,
      published_at INTEGER, PRIMARY KEY (session_id, generation)) STRICT`);
  const event = (id, timestamp, model) => ({ type: "message", id, timestamp, message: {
    role: "assistant", model, content: "PRIVATE CONTENT MUST NOT APPEAR", provider: "openai",
    usage: { input: 100, output: 20, cacheRead: 80, cacheWrite: 10, totalTokens: 130 },
  } });
  const e1 = event("e1", "2026-10-09T23:45:00Z", "gpt-5.4");
  const e3 = event("e3", null, "gpt-5.5"); // no timestamp — created_at fallback
  delete e3.timestamp;
  const insertArchive = (generation, text, { compress = false, encoding = null, digest = null } = {}) => {
    const blob = compress ? zlib.zstdCompressSync(Buffer.from(text, "utf8")) : Buffer.from(text, "utf8");
    db.prepare("INSERT INTO session_transcript_archives (session_id, generation, encoding, archive_blob, archive_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("s1", generation, encoding ?? (compress ? "zstd" : "identity"), blob,
        digest ?? crypto.createHash("sha256").update(blob).digest("hex"), 1790000000);
  };
  // Live store and its published import-archive copy both hold e1.
  db.prepare("INSERT INTO session_windows VALUES ('s1', 'agent:main:main', 1, 'initial')").run();
  db.prepare("INSERT INTO transcript_events VALUES (?, ?, ?, 1)").run("s1", 0, JSON.stringify(e1));
  fs.writeFileSync(path.join(agent, "session-sqlite-import-archive", "s1-topic-1.jsonl"), JSON.stringify(e1) + "\n");
  // Bad rows must skip without sinking the good ones.
  insertArchive("bad-sha", JSON.stringify(e1), { digest: "0".repeat(64) });
  insertArchive("bad-zstd", "not zstd", { compress: false, encoding: "zstd" });
  insertArchive("bad-encoding", JSON.stringify(e1), { encoding: "gzip" });
  insertArchive("bad-json", "not JSON");
  // Overlap generation (e1 again) + a timestamp-less entry rescued by created_at.
  insertArchive("dup", JSON.stringify(e1) + "\n");
  insertArchive("fallback", JSON.stringify(e3) + "\n", { compress: true });

  const files = await resolveOpenclawSessionFiles({ TOKENTRACKER_OPENCLAW_HOME: home });
  const cursors = { files: {} };
  const queuePath = path.join(root, "queue.jsonl");
  const first = await parseOpenclawIncremental({ sessionFiles: files, cursors, queuePath });
  // e1 queued once (published file), e3 rescued by the created_at fallback.
  assert.equal(first.eventsAggregated, 2);
  const again = await parseOpenclawIncremental({ sessionFiles: files, cursors, queuePath });
  assert.equal(again.eventsAggregated, 0);
  const rows = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(rows.map((r) => r.model), ["gpt-5.4", "gpt-5.5"]);
  const createdIso = new Date(1790000000 * 1000).toISOString();
  const expectedHour = `${createdIso.slice(0, 14)}${Number(createdIso.slice(14, 16)) < 30 ? "00" : "30"}:00.000Z`;
  assert.equal(rows[1].hour_start, expectedHour);
  assert.ok(!JSON.stringify(cursors).includes("PRIVATE CONTENT"));
});

test("splitOpenclawArchiveJsonValues splits JSONL and pretty-printed values", () => {
  const { splitOpenclawArchiveJsonValues } = require("../src/lib/rollout");
  assert.deepEqual(splitOpenclawArchiveJsonValues('{"a":1}\n{"b":2}\n'), ['{"a":1}', '{"b":2}']);
  const pretty = JSON.stringify({ message: { content: 'brace } inside "quoted" text' }, usage: { totalTokens: 1 } }, null, 2);
  assert.deepEqual(splitOpenclawArchiveJsonValues(pretty), [pretty]);
  assert.deepEqual(splitOpenclawArchiveJsonValues('{"x":"[not a split]"}{"y":2}'), ['{"x":"[not a split]"}', '{"y":2}']);
  assert.deepEqual(splitOpenclawArchiveJsonValues('{"a":1'), []);
  assert.deepEqual(splitOpenclawArchiveJsonValues(""), []);
});
