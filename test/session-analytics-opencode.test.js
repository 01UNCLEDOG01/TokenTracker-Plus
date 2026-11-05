"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); } catch { /* Node 20 */ }
const sqliteTest = DatabaseSync ? test : test.skip;
const { scanOpencodeSessions, discoverSessionFiles, buildSessionAnalytics, listSessionsForBrowser, summarizeSessions, sessionsToCsv, resumeCommandFor, resolveSessionSidecarPath, resetOpencodeInputCacheForTests, getOpencodeInputCacheStatsForTests } = require("../src/lib/session-analytics");
const { readOpencodeDbMessages, parseOpencodeDbIncremental } = require("../src/lib/rollout");
const T0 = Date.UTC(2026, 9, 8, 10);
const SECRET = "private prompt and assistant body never retained";

function fixture(t, { sessionTable = "session", v1 = true, v2 = false } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-opencode-sessions-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dbPath = path.join(home, ".local", "share", "opencode", "opencode.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  if (sessionTable) db.exec(`CREATE TABLE ${sessionTable} (id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER)`);
  if (v1) db.exec("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  if (v2) db.exec("CREATE TABLE session_message (id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, type TEXT, data TEXT)");
  return { home, dbPath, db, sessionTable };
}
function session(f, id, { parent = null, title = "Agent-authored title" } = {}) {
  f.db.prepare(`INSERT INTO ${f.sessionTable} VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, parent, title, "C:\\repo\\opencode-app", T0, T0 + 10000);
}
function message(f, { table = "message", id = "assistant", sessionId = "ses_root", role = "assistant", start = T0, end = start + 10000, model = "claude-sonnet-4-5", tokens = { input: 100, output: 50, reasoning: 10, cache: { read: 25, write: 5 } }, nested = table === "session_message" } = {}) {
  const data = { role, content: SECRET, parts: [{ text: SECRET }], time: { created: start, completed: end }, path: { cwd: "/repo/fallback" } };
  if (role === "assistant") {
    Object.assign(data, { tokens }, nested ? { model: { id: model, providerID: "anthropic" } } : { modelID: model, providerID: "anthropic" });
  }
  const values = [id, sessionId, start, end];
  if (table === "session_message") values.push(role);
  values.push(JSON.stringify(data));
  f.db.prepare(`INSERT INTO ${table} VALUES (${values.map(() => "?").join(",")})`).run(...values);
}

for (const [name, options, table] of [
  ["v1 with an empty v2 table", { v2: true }, "message"],
  ["v2 beta session_v2", { v1: false, v2: true, sessionTable: "session_v2" }, "session_message"],
  ["upstream v2 session", { v1: false, v2: true }, "session_message"],
]) {
  sqliteTest(`OpenCode ${name} aggregates numeric usage, model, turns and local metadata`, async (t) => {
    const f = fixture(t, options);
    session(f, "ses_root");
    message(f, { table, role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
    message(f, { table });
    f.db.close();
    const rows = await scanOpencodeSessions(f.dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total_tokens, 190);
    assert.equal(rows[0].tokens.reasoning_output_tokens, 10);
    assert.equal(rows[0].turns, 1);
    assert.equal(rows[0].duration_ms, 11000);
    assert.equal(rows[0].model, "claude-sonnet-4-5");
    assert.equal(rows[0].project_key, "opencode-app");
    assert.equal(rows[0].title, "Agent-authored title");
    const browser = listSessionsForBrowser(rows).sessions[0];
    assert.equal(browser.resume_command, "opencode --session ses_root");
    assert.equal(browser.project_ref, "C:\\repo\\opencode-app");
    const summary = summarizeSessions(rows);
    const exported = JSON.stringify(summary) + sessionsToCsv(rows);
    assert.equal(exported.includes(SECRET), false);
    assert.equal(exported.includes("Agent-authored title"), false);
    assert.equal(exported.includes("C:\\\\repo"), false);
    assert.equal(exported.includes("ses_root"), false);
    assert.equal(JSON.stringify(rows).includes(SECRET), false);
  });
}

sqliteTest("transitional OpenCode data deduplicates message IDs and retains new v2 tails", async (t) => {
  const f = fixture(t, { v2: true });
  session(f, "ses_root");
  message(f, { role: "user", id: "user" });
  message(f);
  message(f, { table: "session_message", role: "user", id: "user" });
  message(f, { table: "session_message" });
  message(f, { table: "session_message", id: "tail", start: T0 + 3600000, model: "gpt-5.4" });
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows[0].total_tokens, 380);
  assert.equal(rows[0].turns, 1);
  assert.equal(rows[0].usage_events, 2);
  assert.equal(rows[0].model, "mixed");
  assert.equal(rows[0].duration_ms, 20000);
  assert.equal(rows[0].model_usage.length, 2);
});

sqliteTest("forked OpenCode history matches usage sync and links child sessions", async (t) => {
  const f = fixture(t);
  session(f, "ses_root");
  session(f, "ses_fork", { parent: "ses_root", title: null });
  message(f);
  message(f, { id: "copied", sessionId: "ses_fork" });
  message(f, { id: "tail", sessionId: "ses_fork", start: T0 + 3600000 });
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  const queuePath = path.join(f.home, "queue.jsonl");
  await parseOpencodeDbIncremental({ dbMessages: readOpencodeDbMessages(f.dbPath), dbPath: f.dbPath, cursors: {}, queuePath, source: "opencode" });
  const latest = new Map(fs.readFileSync(queuePath, "utf8").trim().split("\n").map((line) => {
    const row = JSON.parse(line);
    return [`${row.source}:${row.model}:${row.hour_start}`, row];
  }));
  assert.equal(rows.reduce((sum, row) => sum + row.total_tokens, 0), [...latest.values()].reduce((sum, row) => sum + row.total_tokens, 0));
  assert.equal(rows.reduce((sum, row) => sum + row.total_tokens, 0), 380);
  assert.equal(rows.find((row) => row.session_id === "ses_fork").title, null);
  const browser = listSessionsForBrowser(rows).sessions;
  assert.equal(browser.find((row) => row.session_id === "ses_root").combined_total_tokens, 380);
  assert.equal(browser.find((row) => row.session_id === "ses_fork").parent_session_hash, browser.find((row) => row.session_id === "ses_root").session_hash);
});

sqliteTest("fork copy IDs cannot take ownership from their known ancestor", async (t) => {
  const f = fixture(t);
  session(f, "root");
  session(f, "fork", { parent: "root" });
  message(f, { id: "z_root", sessionId: "root" });
  message(f, { id: "a_fork", sessionId: "fork" });
  message(f, { id: "fork_tail", sessionId: "fork", start: T0 + 3600000 });
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows.find((row) => row.session_id === "root").total_tokens, 190);
  assert.equal(rows.find((row) => row.session_id === "fork").total_tokens, 190);
  const browser = listSessionsForBrowser(rows).sessions;
  assert.equal(browser.length, 2);
  const root = browser.find((row) => row.session_id === "root");
  const fork = browser.find((row) => row.session_id === "fork");
  assert.equal(fork.parent_session_hash, root.session_hash);
  assert.equal(fork.orphaned_subagent, false);
  assert.equal(root.combined_total_tokens, 380);
});

sqliteTest("fork ownership follows known ancestors across generations and terminates on unknown parents and cycles", async (t) => {
  const f = fixture(t);
  session(f, "root");
  session(f, "child", { parent: "root" });
  session(f, "grandchild", { parent: "child" });
  session(f, "orphan", { parent: "missing" });
  session(f, "cycle_a", { parent: "cycle_b" });
  session(f, "cycle_b", { parent: "cycle_a" });
  message(f, { id: "a_grandchild", sessionId: "grandchild" });
  message(f, { id: "b_child", sessionId: "child" });
  message(f, { id: "z_root", sessionId: "root" });
  message(f, { id: "orphan", sessionId: "orphan", start: T0 + 3600000 });
  message(f, { id: "cycle_a", sessionId: "cycle_a", start: T0 + 7200000 });
  message(f, { id: "cycle_b", sessionId: "cycle_b", start: T0 + 7200000 });
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows.find((row) => row.session_id === "root").total_tokens, 190);
  assert.equal(rows.reduce((sum, row) => sum + row.total_tokens, 0), 570);
  const browser = listSessionsForBrowser(rows).sessions;
  assert.equal(browser.find((row) => row.session_id === "orphan").orphaned_subagent, true);
});

sqliteTest("OpenCode without a session table uses message project metadata without a prompt title", async (t) => {
  const f = fixture(t, { sessionTable: null });
  message(f);
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows[0].project_ref, "/repo/fallback");
  assert.equal(rows[0].title, null);
});

sqliteTest("OpenCode usage buckets scope multi-day sessions and leave lifetime metrics intact", async (t) => {
  const f = fixture(t);
  session(f, "ses_root");
  message(f);
  message(f, { id: "day2", start: T0 + 86400000 });
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  const filtered = listSessionsForBrowser(rows, { from: "2026-10-09", to: "2026-10-09", timeZone: "UTC" });
  assert.equal(filtered.sessions[0].total_tokens, 190);
  assert.equal(filtered.sessions[0].duration_ms, 20000);
  assert.equal(filtered.sessions[0].model_usage[0].total_tokens, 190);
});

sqliteTest("OpenCode date filters use event time instead of later database migration updates", async (t) => {
  const f = fixture(t);
  session(f, "ses_root");
  message(f);
  message(f, { id: "unfinished", start: T0 + 3600000 });
  f.db.exec("UPDATE message SET data = json_remove(data, '$.time.completed') WHERE id = 'unfinished'");
  f.db.prepare("UPDATE message SET time_updated = ?").run(T0 + 90 * 86400000);
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  const originalDay = listSessionsForBrowser(rows, { from: "2026-10-08", to: "2026-10-08", timeZone: "UTC" });
  assert.equal(originalDay.session_count, 1);
  assert.equal(originalDay.sessions[0].total_tokens, 380);
  assert.equal(listSessionsForBrowser(rows, { from: "2027-01-06", to: "2027-01-06", timeZone: "UTC" }).session_count, 0);
});

sqliteTest("OpenCode record updates and missing completions never become active runtime", async (t) => {
  const f = fixture(t);
  session(f, "ses_root");
  message(f, { role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f);
  message(f, { id: "unfinished", start: T0 + 3600000 });
  f.db.prepare("UPDATE message SET time_updated = ? WHERE id IN ('user', 'unfinished')").run(T0 + 90 * 86400000);
  f.db.exec("UPDATE message SET data = json_remove(data, '$.time.completed') WHERE id = 'unfinished'");
  f.db.close();
  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows[0].duration_ms, 11000);
  assert.equal(rows[0].started_at, new Date(T0 - 1000).toISOString());
  assert.equal(rows[0].ended_at, new Date(T0 + 3600000).toISOString());
  assert.equal(rows[0].total_tokens, 380);
  assert.equal(rows[0].turns, 1);
});

sqliteTest("OpenCode discovery respects HOME, XDG_DATA_HOME, OPENCODE_HOME and Windows install mode", async (t) => {
  const f = fixture(t);
  f.db.close();
  assert.deepEqual((await discoverSessionFiles(f.home, {}, { platform: "darwin" })).opencode, [f.dbPath]);
  const customDir = path.join(f.home, "custom");
  fs.mkdirSync(customDir);
  fs.copyFileSync(f.dbPath, path.join(customDir, "opencode.db"));
  assert.deepEqual((await discoverSessionFiles(f.home, { OPENCODE_HOME: customDir }, { platform: "darwin" })).opencode, [path.join(customDir, "opencode.db")]);
  assert.deepEqual((await discoverSessionFiles(f.home, { XDG_DATA_HOME: path.join(f.home, ".local", "share") }, { platform: "darwin" })).opencode, [f.dbPath]);
  for (const [mode, expected] of [["both", [f.dbPath, path.join(customDir, "opencode.db")]], ["native-only", [f.dbPath]], ["wsl-only", [path.join(customDir, "opencode.db")]]]) {
    const result = await discoverSessionFiles(f.home, { TOKENTRACKER_WSL_MODE: mode }, { platform: "win32", probeWsl: true, discoverWslHome: (provider) => provider === ".local/share/opencode" ? customDir : null });
    assert.deepEqual(result.opencode, expected);
  }
});

sqliteTest("failed OpenCode rebuild retains complete cache and retries even with unchanged stats", async (t) => {
  const f = fixture(t);
  session(f, "ses_root");
  message(f);
  f.db.close();
  const previousHome = process.env.OPENCODE_HOME;
  const previousMode = process.env.TOKENTRACKER_WSL_MODE;
  process.env.OPENCODE_HOME = path.dirname(f.dbPath);
  process.env.TOKENTRACKER_WSL_MODE = "native-only";
  t.after(() => {
    if (previousHome === undefined) delete process.env.OPENCODE_HOME; else process.env.OPENCODE_HOME = previousHome;
    if (previousMode === undefined) delete process.env.TOKENTRACKER_WSL_MODE; else process.env.TOKENTRACKER_WSL_MODE = previousMode;
  });
  const first = await buildSessionAnalytics({ home: f.home, force: true });
  assert.equal(first.length, 1);
  const sidecar = resolveSessionSidecarPath(f.home);
  const before = fs.readFileSync(sidecar, "utf8");
  const beforeMeta = fs.readFileSync(`${sidecar}.meta.json`, "utf8");
  const healthy = fs.readFileSync(f.dbPath);
  fs.writeFileSync(f.dbPath, "broken SQLite database");
  for (const force of [true, false, false]) {
    const failed = await buildSessionAnalytics({ home: f.home, force });
    assert.equal(failed.skippedFiles, 1);
    assert.equal(failed[0].total_tokens, first[0].total_tokens);
    assert.equal(fs.readFileSync(sidecar, "utf8"), before);
    assert.equal(fs.readFileSync(`${sidecar}.meta.json`, "utf8"), beforeMeta);
  }
  fs.writeFileSync(f.dbPath, healthy);
  assert.equal((await buildSessionAnalytics({ home: f.home })).skippedFiles, 0);
  assert.equal(fs.existsSync(`${sidecar}.meta.json.opencode-incomplete`), false);
});

test("OpenCode resume commands reject flags and shell metacharacters", () => {
  assert.equal(resumeCommandFor("opencode", "ses_123"), "opencode --session ses_123");
  for (const id of ["--help", "abc;echo secret", "abc\nnode", "$(whoami)"]) assert.equal(resumeCommandFor("opencode", id), null);
});

sqliteTest("v1 incremental refresh appends new rows, replaces updates and falls back on deletion", async (t) => {
  resetOpencodeInputCacheForTests();
  const f = fixture(t);
  f.db.exec("CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  session(f, "ses_root");
  message(f, { role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f, { id: "assistant", start: T0, end: T0 + 10000 });

  const first = await scanOpencodeSessions(f.dbPath);
  assert.equal(first.length, 1);
  assert.equal(first[0].total_tokens, 190);
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 1, incrementalReads: 0 });

  message(f, { id: "assistant-2", start: T0 + 20000, end: T0 + 30000, tokens: { input: 10, output: 5 } });
  const appended = await scanOpencodeSessions(f.dbPath);
  assert.equal(appended[0].total_tokens, 205, "the second message is added without re-reading the whole table");
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 1, incrementalReads: 1 });

  const original = JSON.parse(f.db.prepare("SELECT data FROM message WHERE id = 'assistant'").get().data);
  original.tokens = { input: 20, output: 5, reasoning: 10, cache: { read: 25, write: 5 } };
  original.time.completed = T0 + 40000;
  f.db.prepare("UPDATE message SET data = ?, time_updated = ? WHERE id = 'assistant'")
    .run(JSON.stringify(original), T0 + 40000);
  const updated = await scanOpencodeSessions(f.dbPath);
  assert.equal(updated[0].total_tokens, 80, "the replacement row is used, not added to the old one");
  assert.equal(getOpencodeInputCacheStatsForTests().incrementalReads, 2);

  f.db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)")
    .run("p1", "assistant", "ses_root", T0 + 50000, T0 + 50000, JSON.stringify({ type: "tool", tool: "edit" }));
  const withPart = await scanOpencodeSessions(f.dbPath);
  assert.equal(withPart[0].edit_turns, 1, "a new part is merged without a full part-table scan");
  assert.equal(getOpencodeInputCacheStatsForTests().incrementalReads, 3);

  f.db.prepare("DELETE FROM message WHERE id = 'assistant-2'").run();
  const afterDelete = await scanOpencodeSessions(f.dbPath);
  assert.equal(afterDelete[0].total_tokens, 65, "a row count drop triggers a full rebuild");
  assert.equal(getOpencodeInputCacheStatsForTests().fullReads, 2);
  f.db.close();
});

sqliteTest("OpenCode tool parts drive edit turns and sub-agent calls", async (t) => {
  const f = fixture(t);
  // The production reader probes part/session_part; the shared fixture has no
  // part table, so this case creates one the way OpenCode ships it.
  f.db.exec("CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  session(f, "ses_root");
  message(f, { role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f, { id: "assistant" });
  const part = (id, messageId, tool) => f.db
    .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, messageId, "ses_root", T0, T0 + 1000, JSON.stringify({ type: "tool", tool, callID: id }));
  // Two sub-agent launches in one assistant message: the panel's subagents row
  // is a call count, so both must survive.
  part("p1", "assistant", "task");
  part("p2", "assistant", "Task");
  // An edit and a patch, in the same message: one edit turn, and "patch" only
  // counts because OpenCode's edit set adds it to the shared list.
  part("p3", "assistant", "edit");
  part("p4", "assistant", "patch");
  part("p5", "assistant", "read");
  // A non-tool part must never be read as a tool call.
  f.db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)")
    .run("p6", "assistant", "ses_root", T0, T0 + 1000, JSON.stringify({ type: "text", text: "hi" }));
  f.db.close();

  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.subagent_calls, 2, "two task calls, matched case-insensitively");
  assert.deepEqual(row.subagent_types, { task: 2 });
  assert.equal(row.edit_turns, 1, "edit tools in one message are one edit turn");
});

sqliteTest("newer OpenCode session_part without an id column scans toolbox without a crash", async (t) => {
  // Regression: the newest OpenCode schema keeps tool parts in `session_part`,
  // whose primary key is the composite (message_id, ordinal, type) — there is
  // no `id` column. The reader used to emit a constant `id` in the SELECT and
  // ORDER BY for every part table, throwing `no such column: id` and skipping
  // the whole opencode session scan (incomplete marker, stale sessions page).
  const f = fixture(t, { v2: true, sessionTable: "session_v2" });
  f.db.exec("CREATE TABLE session_part (message_id TEXT, session_id TEXT, ordinal INTEGER, type TEXT, call_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  session(f, "ses_root");
  message(f, { table: "session_message", role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f, { table: "session_message", id: "assistant", model: "deepseek-v4.1-flash-free" });
  f.db.prepare("INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("assistant", "ses_root", 0, "tool", "c1", T0, T0 + 1000, JSON.stringify({ type: "tool", tool: "task", callID: "c1" }));
  f.db.prepare("INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("assistant", "ses_root", 1, "tool", "c2", T0, T0 + 1000, JSON.stringify({ type: "tool", tool: "edit", callID: "c2" }));
  f.db.close();

  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.total_tokens, 190);
  assert.equal(row.subagent_calls, 1, "session_part task call is counted");
  assert.deepEqual(row.subagent_types, { task: 1 });
  assert.equal(row.edit_turns, 1, "session_part edit tool is one edit turn");
});

sqliteTest("transitional opencode with legacy part (id) and session_part (no id) both scan", async (t) => {
  // Mirrors a real box mid-migration: `part` still carries tool rows keyed by a
  // string id, while the newer `session_part` table exists without an id column.
  // Both must be readable in a single full scan (this is the layout that
  // previously crashed when the constant `id` hit session_part).
  const f = fixture(t, { v2: true, sessionTable: "session_v2" });
  f.db.exec("CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  f.db.exec("CREATE TABLE session_part (message_id TEXT, session_id TEXT, ordinal INTEGER, type TEXT, call_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  session(f, "ses_root");
  message(f, { table: "session_message", role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f, { table: "session_message", id: "assistant", model: "deepseek-v4.1-flash-free" });
  f.db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)")
    .run("p_legacy", "assistant", "ses_root", T0, T0 + 1000, JSON.stringify({ type: "tool", tool: "read", callID: "p_legacy" }));
  f.db.prepare("INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("assistant", "ses_root", 0, "tool", "c1", T0, T0 + 1000, JSON.stringify({ type: "tool", tool: "edit", callID: "c1" }));
  f.db.close();

  const rows = await scanOpencodeSessions(f.dbPath);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.total_tokens, 190);
  assert.equal(row.edit_turns, 1, "session_part edit is attributed");
});

sqliteTest("spent opencode retry budget still self-heals via a readability probe", async (t) => {
  const f = fixture(t);
  session(f, "ses_root");
  message(f);
  f.db.close();

  const previousHome = process.env.OPENCODE_HOME;
  const previousMode = process.env.TOKENTRACKER_WSL_MODE;
  process.env.OPENCODE_HOME = path.dirname(f.dbPath);
  process.env.TOKENTRACKER_WSL_MODE = "native-only";
  t.after(() => {
    if (previousHome === undefined) delete process.env.OPENCODE_HOME; else process.env.OPENCODE_HOME = previousHome;
    if (previousMode === undefined) delete process.env.TOKENTRACKER_WSL_MODE; else process.env.TOKENTRACKER_WSL_MODE = previousMode;
  });

  // First healthy build caches opencode rows and leaves no marker.
  const first = await buildSessionAnalytics({ home: f.home, force: true });
  assert.equal(first.length, 1);
  const markerPath = `${resolveSessionSidecarPath(f.home)}.meta.json.opencode-incomplete`;
  assert.equal(fs.existsSync(markerPath), false);

  // Simulate a transient read failure that inflated the retry budget to the
  // INCOMPLETE_RETRY_LIMIT without changing the database (mtime/stat unchanged,
  // db still readable). The cached stat still matches, so without a readability
  // probe the source would be skipped and the marker would persist forever.
  const spent = JSON.stringify({ attempts: 3, since: new Date().toISOString(), last_attempt_at: new Date().toISOString() });
  fs.writeFileSync(markerPath, `${spent}\n`);

  const healed = await buildSessionAnalytics({ home: f.home });
  assert.equal(healed.length, 1);
  assert.equal(fs.existsSync(markerPath), false, "a readable opencode db rescans and clears the spent marker");
});

sqliteTest("full layout reads new session_message/session_part rows incrementally", async (t) => {
  resetOpencodeInputCacheForTests();
  const f = fixture(t, { v2: true, sessionTable: "session_v2" });
  f.db.exec("CREATE TABLE session_part (message_id TEXT, session_id TEXT, ordinal INTEGER, type TEXT, call_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)");
  session(f, "ses_root");
  message(f, { table: "session_message", role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f, { table: "session_message", id: "assistant", model: "deepseek-v4.1-flash-free" });
  f.db.prepare("INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("assistant", "ses_root", 0, "tool", "c1", T0, T0 + 1000, JSON.stringify({ type: "tool", tool: "edit", callID: "c1" }));

  const first = await scanOpencodeSessions(f.dbPath);
  assert.equal(first.length, 1);
  assert.equal(first[0].total_tokens, 190);
  assert.equal(first[0].edit_turns, 1, "full-layout part is read on the cold scan");
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 1, incrementalReads: 0 });

  // New tail message + a new tool part land while the process is warm: the full
  // layout must catch them with an incremental read, not re-read the whole db.
  message(f, { table: "session_message", id: "assistant-2", start: T0 + 3600000, model: "deepseek-v4.1-flash-free" });
  f.db.prepare("INSERT INTO session_part (message_id, session_id, ordinal, type, call_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run("assistant-2", "ses_root", 0, "tool", "c2", T0 + 3600000, T0 + 3601000, JSON.stringify({ type: "tool", tool: "task", callID: "c2" }));
  const second = await scanOpencodeSessions(f.dbPath);
  assert.equal(second[0].total_tokens, 380, "second assistant message merged without a full re-read");
  assert.equal(second[0].subagent_calls, 1, "session_part task added incrementally");
  assert.equal(second[0].edit_turns, 1, "original edit turn preserved");
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 1, incrementalReads: 1 });
  f.db.close();
});

sqliteTest("full layout falls back to a full rebuild when a row is deleted", async (t) => {
  resetOpencodeInputCacheForTests();
  const f = fixture(t, { v2: true, sessionTable: "session_v2" });
  session(f, "ses_root");
  message(f, { table: "session_message", role: "user", id: "user", start: T0 - 1000, end: T0 - 1000 });
  message(f, { table: "session_message", id: "assistant", model: "deepseek-v4.1-flash-free" });
  const first = await scanOpencodeSessions(f.dbPath);
  assert.equal(first[0].total_tokens, 190);
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 1, incrementalReads: 0 });

  message(f, { table: "session_message", id: "tail", start: T0 + 3600000, model: "deepseek-v4.1-flash-free" });
  const grown = await scanOpencodeSessions(f.dbPath);
  assert.equal(grown[0].total_tokens, 380);
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 1, incrementalReads: 1 });

  f.db.prepare("DELETE FROM session_message WHERE id = 'tail'").run();
  const afterDelete = await scanOpencodeSessions(f.dbPath);
  assert.equal(afterDelete[0].total_tokens, 190, "a deleted tail forces a full rebuild");
  assert.deepEqual(getOpencodeInputCacheStatsForTests(), { fullReads: 2, incrementalReads: 1 });
  f.db.close();
});
