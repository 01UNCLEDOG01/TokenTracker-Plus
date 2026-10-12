"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { readZcodeSessions } = require("../src/lib/session-analytics");

const ENV = { TOKENTRACKER_WSL_MODE: "native-only" };

// ZCode stores INCLUSIVE counters (cache inside input, reasoning inside
// output), so the fixture has to be written the way the app writes it or the
// test proves nothing about the split. The DDL is copied from a real ZCode
// database: the collector's own SELECT names these columns, and a thinner table
// reads back zero rows and lets the test pass for the wrong reason.
function fixture(options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-sessions-"));
  const dbPath = path.join(home, ".zcode", "cli", "db", "db.sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE session (
      id text primary key, project_id text, workspace_id text, parent_id text, slug text,
      directory text, path text, title text, version text, share_url text,
      summary_additions integer, summary_deletions integer, summary_files integer,
      summary_diffs integer, revert integer, permission text,
      time_created integer not null, time_updated integer not null, time_compacting integer,
      time_archived integer, task_type text, title_source text, title_message_id text,
      time_title_updated integer, trace_id text);
    CREATE TABLE message (
      id text primary key, session_id text not null, time_created integer not null,
      time_updated integer not null, data text not null, sequence integer);
    CREATE TABLE part (
      id text primary key, message_id text not null, session_id text not null,
      time_created integer not null, time_updated integer not null, data text not null,
      sequence integer);
    CREATE TABLE model_usage (
      id text primary key, logical_request_id text not null, attempt_index integer not null default 0,
      session_id text not null, turn_id text, trace_id text, span_id text,
      assistant_message_id text, parent_user_message_id text, query_source text not null,
      provider_id text not null, model_id text not null, variant text, agent text, mode text,
      task_type text, status text not null check(status in ('running', 'completed', 'error', 'cancelled')),
      started_at integer not null, first_token_at integer, completed_at integer, duration_ms integer,
      time_to_first_token_ms integer, finish_reason text, tool_call_count integer not null default 0,
      input_tokens integer not null default 0, output_tokens integer not null default 0,
      reasoning_tokens integer not null default 0, cache_creation_input_tokens integer not null default 0,
      cache_read_input_tokens integer not null default 0, provider_total_tokens integer,
      computed_total_tokens integer not null default 0, retry_count integer not null default 0,
      retryable integer not null default 0 check(retryable in (0, 1)),
      cancelled_by_user integer not null default 0 check(cancelled_by_user in (0, 1)),
      context_exceeded integer not null default 0 check(context_exceeded in (0, 1)),
      error_type text, error_code text, error_message text, raw_usage_json text,
      provider_metadata_json text);
  `);
  const now = options.now || 1791300000000;
  db.prepare(`INSERT INTO session (id, parent_id, title, directory, time_created, time_updated)
    VALUES (?,?,?,?,?,?)`).run("sess_1", options.parentId ?? null, "题库核查", "C:\\work\\proj", now - 5000, now);

  // input 1000 already contains cache read 300 and write 100; output 200
  // already contains reasoning 50.
  const usage = (id, status, at, input, output, reasoning, write, read) => db.prepare(
    `INSERT INTO model_usage (id, logical_request_id, session_id, provider_id, model_id, status,
      query_source, started_at, input_tokens, output_tokens, reasoning_tokens,
      cache_creation_input_tokens, cache_read_input_tokens) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id, id, "sess_1", "builtin:bigmodel", "GLM-5.3-Flash", status, "main", at,
    input, output, reasoning, write, read);
  usage("u1", "completed", now - 4000, 1000, 200, 50, 100, 300);
  if (options.withError) usage("u2", "error", now - 3000, 9000, 9000, 9000, 9000, 9000);

  const user = (id, text, at) => {
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)")
      .run(id, "sess_1", at, at, JSON.stringify({ id, role: "user", time: { created: at } }));
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)")
      .run(`${id}_p`, id, "sess_1", at, at, JSON.stringify({ type: "text", text }));
  };
  user("m_user_1", "开始核查", now - 3500);
  if (options.repeatPrompt) user("m_user_2", "开始核查", now - 2500);

  for (const [index, tool] of (options.tools || []).entries()) {
    const mid = `m_asst_${index}`;
    const at = now - 2000;
    db.prepare("INSERT INTO message (id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?)")
      .run(mid, "sess_1", at, at, JSON.stringify({
        id: mid, role: "assistant", modelID: "GLM-5.3-Flash",
        providerID: "account:bigmodel-start-plan", time: { created: at },
      }));
    db.prepare("INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?,?,?,?,?,?)")
      .run(`${mid}_p`, mid, "sess_1", at, at + 100, JSON.stringify({ type: "tool", tool }));
  }
  db.close();
  return home;
}

function rows(options) {
  const home = fixture(options);
  try {
    return readZcodeSessions({ home, env: ENV }).map((entry) => entry.row);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test("inclusive counters are split before they are booked", () => {
  const out = rows({});
  assert.equal(out.length, 1);
  const row = out[0];
  assert.equal(row.source, "zcode");
  assert.equal(row.title, "题库核查");
  assert.equal(row.model, "GLM-5.3-Flash");
  assert.equal(row.tokens.input_tokens, 600, "1000 raw input minus 300 read and 100 write");
  assert.equal(row.tokens.cached_input_tokens, 300);
  assert.equal(row.tokens.cache_creation_input_tokens, 100);
  assert.equal(row.tokens.output_tokens, 150, "200 raw output minus 50 reasoning");
  assert.equal(row.tokens.reasoning_output_tokens, 50);
  assert.equal(row.total_tokens, 1200, "the five disjoint columns, not 1650");
  assert.equal(row.model_usage.length, 1);
  assert.equal(row.model_usage[0].total_tokens, 1200);
  assert.equal(row.model_usage[0].usage_events, 1);
  assert.ok(Number(row.cost_usd) > 0, "a priced model must cost something");
});

test("failed requests are not billed", () => {
  assert.equal(rows({ withError: true })[0].total_tokens, rows({})[0].total_tokens,
    "a status='error' row must not move the totals");
});

test("tool parts decide edit turns and sub-agent calls", () => {
  const row = rows({ tools: ["Edit", "Bash", "Agent"] })[0];
  assert.equal(row.turns, 1);
  assert.equal(row.edit_turns, 1, "the turn used Edit");
  assert.equal(row.productive, true);
  assert.equal(row.subagent_calls, 1);
  assert.deepEqual(row.subagent_types, { agent: 1 });
});

test("a repeated user prompt counts as a retry, not a first-pass delivery", () => {
  const row = rows({ repeatPrompt: true })[0];
  assert.equal(row.turns, 2);
  assert.equal(row.retry_turns, 1);
  assert.equal(row.first_pass, false);
});

test("an absent database yields nothing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "zcode-empty-"));
  try {
    assert.deepEqual(readZcodeSessions({ home, env: ENV }), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a session with neither usage nor turns is dropped", () => {
  const home = fixture({});
  try {
    const db = new DatabaseSync(path.join(home, ".zcode", "cli", "db", "db.sqlite"));
    db.prepare(`INSERT INTO session (id, title, directory, time_created, time_updated)
      VALUES (?,?,?,?,?)`).run("sess_empty", null, "C:\\work\\other", 1, 2);
    db.close();
    const out = readZcodeSessions({ home, env: ENV }).map((entry) => entry.row);
    assert.equal(out.length, 1, "only the session with real usage survives");
    assert.equal(out[0].session_id, "sess_1");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
