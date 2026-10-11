"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  buildSessionAnalytics,
  listSessionsForBrowser,
  readOpencodeSessions,
  resolveOpencodeDatabase,
} = require("../src/lib/session-analytics");
const { ensurePricingLoaded } = require("../src/lib/pricing");

const T0 = Date.parse("2026-09-01T10:00:00.000Z");

// Mirrors the real OpenCode schema closely enough that a renamed column or a
// changed json_extract path breaks these rows instead of quietly zeroing them.
function createOpencodeDb(dir, { sessions = [], messages = [], parts = [] } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "opencode.db"));
  db.exec(`CREATE TABLE session (
      id TEXT PRIMARY KEY, parent_id TEXT, title TEXT, directory TEXT, agent TEXT, model TEXT,
      cost REAL, tokens_input INTEGER, tokens_output INTEGER, tokens_reasoning INTEGER,
      tokens_cache_read INTEGER, tokens_cache_write INTEGER,
      time_created INTEGER, time_updated INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  const session = db.prepare(`INSERT INTO session (id, parent_id, title, directory, agent, model, cost,
    tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
    time_created, time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const s of sessions) {
    session.run(s.id, s.parent_id ?? null, s.title ?? null, s.directory ?? "D:/work/site", s.agent ?? "build",
      s.model ?? '{"id":"space-bunny-free","providerID":"opencode"}', s.cost ?? 0,
      s.tokens_input ?? 0, s.tokens_output ?? 0, s.tokens_reasoning ?? 0,
      s.tokens_cache_read ?? 0, s.tokens_cache_write ?? 0,
      s.time_created ?? T0, s.time_updated ?? (T0 + 60000));
  }
  const message = db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)");
  for (const m of messages) message.run(m.id, m.session_id, m.time_created, JSON.stringify(m.data));
  const part = db.prepare("INSERT INTO part (id, message_id, session_id, time_created, data) VALUES (?,?,?,?,?)");
  for (const p of parts) part.run(p.id, p.message_id, p.session_id, p.time_created ?? T0, JSON.stringify(p.data));
  db.close();
  return path.join(dir, "opencode.db");
}

function userTurn(id, sessionId, at) {
  return { id, session_id: sessionId, time_created: at, data: { role: "user", time: { created: at } } };
}

function assistantTurn(id, sessionId, tokens, model = "space-bunny-free", at = T0 + 1000) {
  return {
    id, session_id: sessionId, time_created: at,
    data: {
      role: "assistant", modelID: model, providerID: "opencode", time: { created: at },
      tokens: {
        input: tokens.input ?? 0,
        output: tokens.output ?? 0,
        reasoning: tokens.reasoning ?? 0,
        cache: { read: tokens.cacheRead ?? 0, write: tokens.cacheWrite ?? 0 },
      },
    },
  };
}

function promptPart(messageId, sessionId, text, id = `prt_${messageId}`) {
  return { id, message_id: messageId, session_id: sessionId, data: { type: "text", text } };
}

function toolPart(messageId, sessionId, tool, id = `pto_${messageId}_${tool}`) {
  return { id, message_id: messageId, session_id: sessionId, data: { type: "tool", tool } };
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tt-opencode-"));
}

function scan(home, env = {}) {
  return readOpencodeSessions({ home, env: { ...env } });
}

test("a conversation's totals come from the session table, column for column", () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{
      id: "ses_root",
      title: "Wire the ledger",
      tokens_input: 1000,
      tokens_output: 200,
      tokens_reasoning: 50,
      tokens_cache_read: 7000,
      tokens_cache_write: 300,
    }],
  });
  const [{ row }] = scan(home);
  assert.equal(row.source, "opencode");
  assert.deepEqual(row.tokens, {
    input_tokens: 1000,
    cached_input_tokens: 7000,
    cache_creation_input_tokens: 300,
    output_tokens: 200,
    reasoning_output_tokens: 50,
    total_tokens: 8550,
  });
  assert.equal(row.total_tokens, 8550);
  assert.equal(row.title, "Wire the ledger");
  assert.equal(row.project_key, "site");
});

test("the per-model split uses OpenCode's own model id, so pricing matches the hourly row", async () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{ id: "ses_mix", tokens_input: 3000, tokens_output: 500 }],
    messages: [
      assistantTurn("m1", "ses_mix", { input: 1000, output: 200 }, "space-bunny-free", T0 + 100),
      assistantTurn("m2", "ses_mix", { input: 2000, output: 300 }, "deepseek-v4-flash-free", T0 + 200),
    ],
  });
  await ensurePricingLoaded();
  const [{ row }] = scan(home);
  assert.deepEqual(row.model_usage.map((m) => `${m.model}:${m.total_tokens}`).sort(),
    ["deepseek-v4-flash-free:2300", "space-bunny-free:1200"]);
  assert.equal(row.model, "mixed", "two models in one conversation is reported as mixed");
  assert.ok(row.cost_usd > 0, "a priced conversation costs money");
  assert.equal(row.model_usage.find((m) => m.model === "space-bunny-free").pricing.source, "curated:fuzzy");
});

test("an unpriced model leaves the conversation's money as a lower bound, not a zero", async () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{ id: "ses_free", tokens_input: 1000, tokens_output: 100 }],
    messages: [assistantTurn("m1", "ses_free", { input: 1000, output: 100 }, "x-preview-f-free")],
  });
  await ensurePricingLoaded();
  const [{ row }] = scan(home);
  assert.equal(row.cost_usd, 0);
  assert.equal(row.cost_is_partial, true, "an unpriced model has to be named, not hidden");
});

test("edit turns, retries and sub-agent calls come from the message and part rows", () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{ id: "ses_work", tokens_input: 2000, tokens_output: 100 }],
    messages: [
      userTurn("u1", "ses_work", T0),
      assistantTurn("a1", "ses_work", { input: 500, output: 50 }, "space-bunny-free", T0 + 1000),
      assistantTurn("a2", "ses_work", { input: 500, output: 50 }, "space-bunny-free", T0 + 1500),
      userTurn("u2", "ses_work", T0 + 2000),
      userTurn("u3", "ses_work", T0 + 3000),
    ],
    parts: [
      promptPart("u1", "ses_work", "add the launcher"),
      promptPart("u2", "ses_work", "add the launcher"),
      promptPart("u3", "ses_work", "add the launcher now"),
      toolPart("a1", "ses_work", "read"),
      toolPart("a1", "ses_work", "patch", "pto_patch"),
      toolPart("a2", "ses_work", "task"),
    ],
  });
  const [{ row }] = scan(home);
  assert.equal(row.turns, 3, "three user prompts");
  assert.equal(row.retry_turns, 1, "the repeated prompt counts as one retry");
  assert.equal(row.edit_turns, 1, "`patch` is an edit for OpenCode");
  assert.equal(row.subagent_calls, 1);
  assert.deepEqual(row.subagent_types, { task: 1 });
  assert.equal(row.productive, true);
});

test("a read-only tool call does not make a conversation productive", () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{ id: "ses_read", tokens_input: 100 }],
    messages: [userTurn("u1", "ses_read", T0), assistantTurn("a1", "ses_read", { input: 100 })],
    parts: [promptPart("u1", "ses_read", "what does this do"), toolPart("a1", "ses_read", "read")],
  });
  const [{ row }] = scan(home);
  assert.equal(row.edit_turns, 0);
  assert.equal(row.productive, false);
});

test("a sub-agent conversation keeps its parent so the list can nest it", () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{ id: "ses_root", title: "Parent" }, { id: "ses_child", parent_id: "ses_root", title: "Child" }],
  });
  const rows = scan(home).map((entry) => entry.row);
  const root = rows.find((row) => row.session_id === "ses_root");
  const child = rows.find((row) => row.session_id === "ses_child");
  assert.equal(child.parent_session_id, "ses_root");
  assert.notEqual(child.session_hash, root.session_hash);
});

test("duration counts working time, not the wall-clock span of a resumed session", () => {
  const home = tempHome();
  createOpencodeDb(path.join(home, ".local", "share", "opencode"), {
    sessions: [{
      id: "ses_long", time_created: T0, time_updated: T0 + 86400000, tokens_input: 20,
    }],
    messages: [
      userTurn("u1", "ses_long", T0),
      assistantTurn("a1", "ses_long", { input: 10 }, "space-bunny-free", T0 + 30000),
      assistantTurn("a2", "ses_long", { input: 10 }, "space-bunny-free", T0 + 60000),
    ],
  });
  const [{ row }] = scan(home);
  assert.equal(row.started_at, new Date(T0).toISOString());
  assert.equal(row.ended_at, new Date(T0 + 86400000).toISOString());
  assert.equal(row.duration_ms, 60000, "two minutes of activity, not a day of wall clock");
});

test("no database means no OpenCode rows, and no damage to the other sources", () => {
  const home = tempHome();
  assert.deepEqual(scan(home), []);
  assert.equal(resolveOpencodeDatabase(home), path.join(home, ".local", "share", "opencode", "opencode.db"));
});

test("OPENCODE_HOME and XDG_DATA_HOME decide where the database is read from", () => {
  const home = tempHome();
  const explicit = path.join(home, "elsewhere");
  createOpencodeDb(explicit, { sessions: [{ id: "ses_x", title: "From OPENCODE_HOME", tokens_input: 5 }] });
  assert.equal(scan(home, { OPENCODE_HOME: explicit })[0].row.session_id, "ses_x");
  const xdg = path.join(home, "xdg");
  createOpencodeDb(path.join(xdg, "opencode"), { sessions: [{ id: "ses_y", tokens_input: 5 }] });
  assert.equal(scan(home, { XDG_DATA_HOME: xdg })[0].row.session_id, "ses_y");
  // An explicit OPENCODE_HOME still wins over XDG.
  assert.equal(scan(home, { XDG_DATA_HOME: xdg, OPENCODE_HOME: explicit })[0].row.session_id, "ses_x");
});

test("a changed conversation is re-read and an unchanged one is reused from the cache", async () => {
  const home = tempHome();
  const dir = path.join(home, ".local", "share", "opencode");
  createOpencodeDb(dir, {
    sessions: [{
      id: "ses_api", title: "Ship the panel", tokens_input: 1000, tokens_output: 200,
      tokens_cache_read: 500, time_created: T0, time_updated: T0 + 5000,
    }, {
      id: "ses_idle", title: "Already finished", tokens_input: 400, time_created: T0, time_updated: T0 + 1000,
    }],
    messages: [
      userTurn("u1", "ses_api", T0),
      assistantTurn("a1", "ses_api", { input: 1000, output: 200, cacheRead: 500 }, "space-bunny-free", T0 + 1000),
      assistantTurn("a2", "ses_idle", { input: 400 }, "space-bunny-free", T0 + 2000),
    ],
    parts: [promptPart("u1", "ses_api", "ship it"), toolPart("a1", "ses_api", "write")],
  });
  await ensurePricingLoaded();

  const first = await buildSessionAnalytics({ home, force: true });
  const api = first.find((row) => row.session_id === "ses_api");
  assert.ok(api, "the conversation is in the sidecar");
  assert.equal(api.total_tokens, 1700);
  assert.equal(first.find((row) => row.session_id === "ses_idle").total_tokens, 400);
  const browser = listSessionsForBrowser(first, {});
  assert.equal(browser.sessions.find((row) => row.source === "opencode").total_tokens, 1700);
  assert.ok(browser.sessions.find((row) => row.source === "opencode").cost_usd > 0);

  // A new assistant turn, written without touching the session row: the file
  // signature notices the database changed and the per-conversation stat key
  // notices this one conversation grew, so the new tokens must show up.
  const db = new DatabaseSync(path.join(dir, "opencode.db"));
  db.prepare("INSERT INTO message (id, session_id, time_created, data) VALUES (?,?,?,?)").run(
    "a3", "ses_api", T0 + 4000,
    JSON.stringify({ role: "assistant", modelID: "space-bunny-free", time: { created: T0 + 4000 },
      tokens: { input: 300, output: 0, cache: { read: 0, write: 0 } } }),
  );
  db.close();

  const second = await buildSessionAnalytics({ home, cacheTtlMs: 0 });
  const apiAgain = second.find((row) => row.session_id === "ses_api");
  assert.equal(apiAgain.total_tokens, 1700, "the session table stays the authority for a conversation's totals");
  assert.equal(apiAgain.model_usage.find((m) => m.model === "space-bunny-free").total_tokens, 2000,
    "the per-model split follows the new message row, so the cache did not freeze the old read");
});
