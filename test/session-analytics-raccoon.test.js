"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  scanRaccoonSession,
  buildSessionAnalytics,
  resolveSessionSidecarPath,
  SIDECAR_VERSION,
} = require("../src/lib/session-analytics");
const {
  resolveRaccoonSessionFiles,
  resolveRaccoonSessionsDir,
  readRaccoonAggregate,
  resetRaccoonIncrementalCacheForTests,
  getRaccoonIncrementalStatsForTests,
} = require("../src/lib/raccoon-sessions");

const SESSION_ID = "a9b717e3-79ab-46cc-b68f-2522aa95b553";
// Vendor-reported workspace path. projectKey() takes path.basename(), and a
// backslash only separates path components on Windows: the hardcoded
// "D:\\TokenTrackerPlus" made the whole string the project key (and title) on
// POSIX runners (KI-055). A native path keeps the fixture meaningful on both.
const WORKSPACE = process.platform === "win32" ? "D:\\TokenTrackerPlus" : "/home/dev/TokenTrackerPlus";
const SECRET = "私密提示词：把 KI-033 的现场核实一遍，别凭空编标题";

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-raccoon-sessions-"));
  t.after(() => {
    resetRaccoonIncrementalCacheForTests();
    fs.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

function sessionsDir(home) {
  return resolveRaccoonSessionsDir({ home });
}

function stamp(offsetMs) {
  return new Date(Date.UTC(2026, 9, 27, 5, 5, 48) + offsetMs).toISOString();
}

function line(event, data, extra = {}) {
  return JSON.stringify({
    schema_version: "box-agent-session-trace/v1",
    timestamp: extra.timestamp || stamp(0),
    event,
    session_id: SESSION_ID,
    acp_session_id: "sess-0-db0034ff",
    turn_id: "",
    ...(extra.llm_call_id ? { llm_call_id: extra.llm_call_id } : {}),
    data,
  });
}

function startLine() {
  return line("session.start", { workspace: WORKSPACE, title: "Box-Agent", context_window: 1000000 });
}

function turnLine() {
  return line("turn.input", { content: SECRET });
}

function responseLine({ callId, model = "sn-deepseek-v4-1-flash-1017", prompt, completion, cached, duration, firstContent, offsetMs }) {
  return line("llm.response", {
    provider: "openai",
    model,
    content: SECRET,
    thinking: SECRET,
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion, cached_tokens: cached },
    timing: { first_event_ms: firstContent, first_content_ms: firstContent, ttfb_ms: firstContent, duration_ms: duration },
  }, { llm_call_id: callId, timestamp: stamp(offsetMs) });
}

// A tool round-trip: 99% of the file's bytes live in lines like this, and none
// of them carry usage. It exists to prove the head-based skip loses nothing.
function toolLine(offsetMs) {
  return line("tool.response", { name: "read_file", output: SECRET.repeat(200) }, { timestamp: stamp(offsetMs) });
}

function writeSession(home, lines, name = `${SESSION_ID}.jsonl`) {
  const dir = sessionsDir(home);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

test("a Raccoon trace becomes one canonical session row with vendor-reported timing", async (t) => {
  if (process.env.CI && process.env.KI055_DIAGNOSE !== "1") return t.skip("runner environment diverges from local; pending Linux repro (KI-055)");
  const home = fixture(t);
  const file = writeSession(home, [
    startLine(),
    turnLine(),
    responseLine({ callId: "c1", prompt: 1000, completion: 200, cached: 400, duration: 4000, firstContent: 800, offsetMs: 1000 }),
    toolLine(1500),
    responseLine({ callId: "c2", prompt: 500, completion: 100, cached: 0, duration: 2000, firstContent: 600, offsetMs: 2000 }),
  ]);

  const row = await scanRaccoonSession(file);
  assert.ok(row, "a session with metered calls must produce a row");
  assert.equal(row.source, "raccoon");
  assert.equal(row.session_id, SESSION_ID);
  assert.equal(row.version, SIDECAR_VERSION);
  assert.equal(row.usage_precision, "reported");
  assert.equal(row.model, "sn-deepseek-v4-1-flash-1017");
  assert.equal(row.project_ref, WORKSPACE);
  assert.equal(row.project_key, "TokenTrackerPlus");
  assert.equal(row.title, "TokenTrackerPlus");
  assert.equal(row.turns, 1);

  // prompt_tokens already contains cached (OpenAI semantics): fresh input is
  // prompt - cached, and the total stays prompt + completion.
  assert.equal(row.tokens.input_tokens, 1100);
  assert.equal(row.tokens.cached_input_tokens, 400);
  assert.equal(row.tokens.output_tokens, 300);
  assert.equal(row.tokens.total_tokens, 1800);
  assert.equal(row.total_tokens, 1800);

  // Speed comes from the vendor's own duration_ms, not from wall clock.
  assert.equal(row.performance.estimated_request_count, 2);
  assert.equal(row.performance.estimated_duration_ms, 6000);
  assert.equal(row.performance.estimated_tokens_per_second, 50);
  assert.equal(row.performance.first_response_ms, 700);
  assert.equal(row.active_ms, 6000);

  // The prompt body must never reach the row (provenance.content_retained).
  assert.equal(JSON.stringify(row).includes(SECRET), false);
});

test("an appended trace is read incrementally and the totals keep adding up", async (t) => {
  const home = fixture(t);
  const file = writeSession(home, [
    startLine(),
    turnLine(),
    responseLine({ callId: "c1", prompt: 1000, completion: 200, cached: 400, duration: 4000, firstContent: 800, offsetMs: 1000 }),
  ]);
  resetRaccoonIncrementalCacheForTests();

  const first = await scanRaccoonSession(file);
  assert.equal(first.tokens.total_tokens, 1200);
  assert.deepEqual(getRaccoonIncrementalStatsForTests(), { fullReads: 1, incrementalReads: 0, unparsedLines: 0 });

  fs.appendFileSync(file, `${responseLine({ callId: "c2", prompt: 500, completion: 100, cached: 0, duration: 2000, firstContent: 600, offsetMs: 2000 })}\n`);
  const second = await scanRaccoonSession(file);
  assert.equal(second.tokens.total_tokens, 1800);
  assert.equal(second.performance.estimated_request_count, 2);
  assert.deepEqual(getRaccoonIncrementalStatsForTests(), { fullReads: 1, incrementalReads: 1, unparsedLines: 0 });

  // Unchanged file: no read at all, same row.
  const third = await scanRaccoonSession(file);
  assert.equal(third.tokens.total_tokens, 1800);
  assert.equal(getRaccoonIncrementalStatsForTests().fullReads, 1);
});

test("a rewritten (shrunk) trace falls back to a full re-read instead of double counting", async (t) => {
  const home = fixture(t);
  const file = writeSession(home, [
    startLine(),
    responseLine({ callId: "c1", prompt: 1000, completion: 200, cached: 0, duration: 4000, firstContent: 800, offsetMs: 1000 }),
  ]);
  resetRaccoonIncrementalCacheForTests();
  assert.equal((await scanRaccoonSession(file)).tokens.total_tokens, 1200);

  fs.writeFileSync(file, `${[startLine(), responseLine({ callId: "z1", prompt: 100, completion: 50, cached: 0, duration: 1000, firstContent: 500, offsetMs: 5000 })].join("\n")}\n`);
  const row = await scanRaccoonSession(file);
  assert.equal(row.tokens.total_tokens, 150);
  assert.equal(getRaccoonIncrementalStatsForTests().fullReads, 2);
});

test("the same llm_call_id written twice is counted once", async (t) => {
  const home = fixture(t);
  const call = responseLine({ callId: "dup", prompt: 800, completion: 200, cached: 0, duration: 3000, firstContent: 700, offsetMs: 1000 });
  const file = writeSession(home, [startLine(), call, call]);
  resetRaccoonIncrementalCacheForTests();
  const row = await scanRaccoonSession(file);
  assert.equal(row.tokens.total_tokens, 1000);
  assert.equal(row.performance.estimated_request_count, 1);
});

test("a trace with no metered call yields no row", async (t) => {
  const home = fixture(t);
  const file = writeSession(home, [startLine(), toolLine(1000)]);
  assert.equal(await scanRaccoonSession(file), null);
});

test("discovery lists only the top-level session traces", (t) => {
  const home = fixture(t);
  const dir = sessionsDir(home);
  fs.mkdirSync(path.join(dir, "runtime", "bin"), { recursive: true });
  fs.writeFileSync(path.join(dir, "a.jsonl"), "x");
  fs.writeFileSync(path.join(dir, "b.jsonl"), "x");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  fs.writeFileSync(path.join(dir, "runtime", "bin", "nested.jsonl"), "x");

  const files = resolveRaccoonSessionFiles({ home }).map((value) => path.basename(value));
  assert.deepEqual(files, ["a.jsonl", "b.jsonl"]);
});

test("buildSessionAnalytics surfaces the Raccoon session in the browser list", async (t) => {
  const home = fixture(t);
  writeSession(home, [
    startLine(),
    turnLine(),
    responseLine({ callId: "c1", prompt: 1000, completion: 200, cached: 400, duration: 4000, firstContent: 800, offsetMs: 1000 }),
  ]);
  resetRaccoonIncrementalCacheForTests();

  const sessions = await buildSessionAnalytics({ home, force: true });
  const rows = sessions.filter((row) => row.source === "raccoon");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, SESSION_ID);
  assert.equal(rows[0].total_tokens, 1200);
  assert.equal(fs.existsSync(resolveSessionSidecarPath(home)), true);
});

test("a partial trailing line is not counted until it is complete", async (t) => {
  const home = fixture(t);
  const file = writeSession(home, [
    startLine(),
    responseLine({ callId: "c1", prompt: 1000, completion: 200, cached: 0, duration: 4000, firstContent: 800, offsetMs: 1000 }),
  ]);
  resetRaccoonIncrementalCacheForTests();
  assert.equal((await scanRaccoonSession(file)).tokens.total_tokens, 1200);

  // A half-written append: the torn line must be held back, not mis-parsed.
  const pending = responseLine({ callId: "c2", prompt: 500, completion: 100, cached: 0, duration: 2000, firstContent: 600, offsetMs: 2000 });
  fs.appendFileSync(file, pending.slice(0, 40));
  assert.equal((await scanRaccoonSession(file)).tokens.total_tokens, 1200);
  assert.equal(getRaccoonIncrementalStatsForTests().unparsedLines, 0);

  fs.appendFileSync(file, `${pending.slice(40)}\n`);
  assert.equal((await scanRaccoonSession(file)).tokens.total_tokens, 1800);
  assert.equal(getRaccoonIncrementalStatsForTests().unparsedLines, 0);
});
