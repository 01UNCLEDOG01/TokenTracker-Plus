"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const { readDshSessions, buildDshSessionRow, resetDshIncrementalCacheForTests, getDshIncrementalStatsForTests } = require("../src/lib/session-analytics");

// Harness writes {type, seq, time, data}; usage sits only on assistant/message
// and the routed model only on request/context.
function record(type, seq, time, data, extra = {}) {
  return JSON.stringify({ type, seq, time, data, ...extra });
}

function sessionHeader(id, { cwd = "C:\\work\\proj", parent = null, createdAt = 1791590000000 } = {}) {
  return JSON.stringify({
    type: "session", version: 4, id, createdAt, cwd,
    parentSession: parent, isSeeded: false, origin: parent ? "subagent" : "user",
  });
}

function usage(inputTokens, outputTokens, totalTokens, cacheReadTokens) {
  return { inputTokens, outputTokens, totalTokens, cacheReadTokens };
}

function transcript(id, opts = {}) {
  const lines = [sessionHeader(id, opts)];
  if (opts.title) lines.push(record("session/title", 2, opts.start + 10, { title: opts.title }));
  const models = opts.models || [{ model: "deepseek-flash", usages: opts.usages || [] }];
  let seq = 10;
  lines.push(record("turn/start", seq++, opts.start + 20, { turn: 1 }));
  if (opts.userPrompt) lines.push(record("user/message", seq++, opts.start + 30, { turn: 1, message: { role: "user", content: [{ type: "text", text: opts.userPrompt }] } }));
  for (const group of models) {
    lines.push(record("request/context", seq++, opts.start + 40, { provider: "apigoto", model: group.model, contextWindow: 1000000 }));
    for (const u of group.usages) {
      lines.push(record("assistant/message", seq++, opts.start + 50, { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: u }));
    }
  }
  for (const tool of opts.tools || []) {
    lines.push(record("tool/call", seq++, opts.start + 60, { turn: 1, tool: { name: tool } }));
    lines.push(record("tool/result", seq++, opts.start + 61, { turn: 1, tool: { name: tool } }));
  }
  if (opts.repeatedPrompt) lines.push(record("user/message", seq++, opts.start + 70, { turn: 1, message: { role: "user", content: [{ type: "text", text: opts.userPrompt }] } }));
  lines.push(record("turn/end", seq++, opts.start + 80, { turn: 1, reason: { kind: "completed" } }));
  return lines.join("\n") + "\n";
}

function sandbox(withSession = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-sessions-"));
  if (withSession) {
    const dir = path.join(home, ".dsh", "sessions", "--C-work-proj--", "abc-123");
    fs.mkdirSync(dir, { recursive: true });
    return { home, dir };
  }
  return { home, dir: null };
}

async function rowsFrom(home) {
  return (await readDshSessions({ home })).map((entry) => entry.row);
}

test("reads one plain dsh transcript into a session row", async () => {
  const { home, dir } = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), transcript("abc-123", {
      cwd: "C:\\work\\proj",
      title: "题库清理",
      start: 1791590000000,
      userPrompt: "继续清理六爻题库",
      tools: ["run_code", "str_replace_editor"],
      usages: [usage(1000, 200, 1400, 200), usage(500, 100, 650, 50)],
    }));
    const rows = await rowsFrom(home);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row.source, "dsh");
    assert.equal(row.session_id, "abc-123");
    assert.equal(row.title, "题库清理");
    assert.equal(row.model, "deepseek-flash");
    assert.equal(row.turns, 1);
    assert.equal(row.edit_turns, 1, "str_replace_editor marks the turn as an edit");
    assert.equal(row.retry_turns, 0);
    assert.equal(row.project_ref, "C:\\work\\proj");
    assert.equal(row.tokens.input_tokens, 1500);
    assert.equal(row.tokens.output_tokens, 300);
    assert.equal(row.tokens.cached_input_tokens, 250);
    assert.equal(row.total_tokens, 2050, "1500 in + 300 out + 250 cache-read");
    assert.equal(row.model_usage.length, 1);
    assert.equal(row.model_usage[0].usage_events, 2);
    assert.ok(Number(row.cost_usd) > 0, "a priced model must cost something");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a concatenated multi-frame zstd log loses no frame", async () => {
  const { home, dir } = sandbox();
  const plain = sandbox();
  try {
    const full = transcript("abc-123", {
      title: "two frames",
      start: 1791590000000,
      usages: [usage(1000, 200, 1200, 0), usage(700, 70, 770, 0)],
    });
    // Harness appends one independent frame per write, so a real artifact is
    // frame(head records) + frame(newer records) - not two whole transcripts.
    const lines = full.trimEnd().split("\n");
    const cut = Math.ceil(lines.length / 2);
    const head = `${lines.slice(0, cut).join("\n")}\n`;
    const tail = `${lines.slice(cut).join("\n")}\n`;
    fs.writeFileSync(path.join(dir, "session.v4.jsonl.zstd"), Buffer.concat([
      zlib.zstdCompressSync(Buffer.from(head, "utf8")),
      zlib.zstdCompressSync(Buffer.from(tail, "utf8")),
    ]));
    fs.writeFileSync(path.join(plain.dir, "session.v4.jsonl"), full);

    const zipped = await rowsFrom(home);
    const plainRows = await rowsFrom(plain.home);
    assert.equal(zipped.length, 1);
    assert.ok(zipped[0].total_tokens > 0, "the session must carry usage");
    assert.equal(zipped[0].total_tokens, plainRows[0].total_tokens,
      "decompressing only the first frame would undercount the session");
    assert.equal(zipped[0].total_tokens, 1970, "1700 in + 270 out over both frames");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(plain.home, { recursive: true, force: true });
  }
});

test("zstd appends are decoded frame-by-frame without re-reading the head", async () => {
  resetDshIncrementalCacheForTests();
  const { home, dir } = sandbox();
  try {
    const file = path.join(dir, "session.v4.jsonl.zstd");
    const head = [
      sessionHeader("abc-123", { start: 1791590000000 }),
      record("turn/start", 10, 1791590000020, { turn: 1 }),
      record("request/context", 11, 1791590000040, { provider: "apigoto", model: "deepseek-flash" }),
      record("assistant/message", 12, 1791590000050, { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: usage(100, 20, 120, 0) }),
    ].join("\n") + "\n";
    fs.writeFileSync(file, zlib.zstdCompressSync(Buffer.from(head, "utf8")));
    const first = await rowsFrom(home);
    assert.equal(first[0].total_tokens, 120);
    assert.equal(getDshIncrementalStatsForTests().fullReads, 1);

    const tail = record("assistant/message", 13, 1791590000060, {
      turn: 1, step: 2, message: { role: "assistant", content: [] }, usage: usage(10, 5, 15, 0),
    }) + "\n";
    fs.appendFileSync(file, zlib.zstdCompressSync(Buffer.from(tail, "utf8")));
    const second = await rowsFrom(home);
    assert.equal(second[0].total_tokens, 135);
    assert.equal(getDshIncrementalStatsForTests().incrementalReads, 1, "only the appended frame is decoded");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a torn trailing line is skipped instead of dropping the session", async () => {
  const { home, dir } = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"),
      transcript("abc-123", { start: 1791590000000, usages: [usage(400, 100, 500, 0)] })
      + '{"type":"assistant/message","seq":99,"tim');
    const rows = await rowsFrom(home);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].total_tokens, 500);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("sub-agent transcripts link back through parentSession", async () => {
  const { home } = sandbox(false);
  try {
    const root = path.join(home, ".dsh", "sessions", "--C-work-proj--", "root-1");
    const child = path.join(home, ".dsh", "sessions", "--C-work-proj--", "kid-1");
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(child, { recursive: true });
    fs.writeFileSync(path.join(root, "session.v4.jsonl"), transcript("root-1", { start: 1791590000000, usages: [usage(900, 100, 1000, 0)] }));
    fs.writeFileSync(path.join(child, "session.v4.jsonl"), transcript("kid-1", {
      start: 1791590000000, parent: "root-1", usages: [usage(200, 50, 250, 0)],
    }));
    const rows = await rowsFrom(home);
    const byId = new Map(rows.map((r) => [r.session_id, r]));
    assert.equal(byId.get("root-1").parent_session_id, null);
    assert.equal(byId.get("kid-1").parent_session_id, "root-1");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("usage is attributed to the model in force when the record was written", async () => {
  const { home, dir } = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), transcript("abc-123", {
      start: 1791590000000,
      models: [
        { model: "deepseek-flash", usages: [usage(1000, 100, 1100, 0)] },
        { model: "glm-5.2", usages: [usage(300, 50, 350, 0)] },
      ],
    }));
    const rows = await rowsFrom(home);
    assert.equal(rows[0].model, "mixed");
    const byModel = new Map(rows[0].model_usage.map((u) => [u.model, u]));
    assert.equal(byModel.get("deepseek-flash").total_tokens, 1100);
    assert.equal(byModel.get("glm-5.2").total_tokens, 350);
    assert.equal(rows[0].total_tokens, 1450);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a repeated user request counts as a retry turn", async () => {
  const { home, dir } = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), transcript("abc-123", {
      start: 1791590000000,
      userPrompt: "再来一次",
      repeatedPrompt: true,
      usages: [usage(100, 10, 110, 0)],
    }));
    const rows = await rowsFrom(home);
    assert.equal(rows[0].retry_turns, 1);
    assert.equal(rows[0].first_pass, false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("an empty or missing home yields no rows and never reaches for the real machine", async () => {
  const { home } = sandbox(false);
  try {
    assert.deepEqual(await rowsFrom(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
  // A sandbox with no .dsh directory must not fall back to ~/.dsh: pinning the
  // caller's home is what keeps a test (or a second profile) from reading the
  // machine's own conversations.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-bare-"));
  try {
    const rows = await readDshSessions({ home: bare });
    assert.equal(rows.length, 0, "the real ~/.dsh must not leak into a sandboxed read");
  } finally {
    fs.rmSync(bare, { recursive: true, force: true });
  }
});

test("a transcript with neither usage nor turns produces no row", async () => {
  const { home, dir } = sandbox();
  try {
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), sessionHeader("abc-123") + "\n");
    assert.equal(await buildDshSessionRow(path.join(dir, "session.v4.jsonl")), null);
    assert.deepEqual(await rowsFrom(home), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the per-file row cache serves unchanged transcripts and still sees appends", async () => {
  resetDshIncrementalCacheForTests();
  const { home, dir } = sandbox();
  try {
    const file = path.join(dir, "session.v4.jsonl");
    fs.writeFileSync(file, transcript("abc-123", {
      title: "缓存回归",
      start: 1791590000000,
      usages: [usage(1000, 200, 1400, 200)],
    }));
    const first = (await readDshSessions({ home, verifyRead: true })).map((entry) => entry.row);
    assert.equal(first.length, 1);
    assert.equal(first[0].total_tokens, 1400, "1000 in + 200 out + 200 cache-read");
    assert.equal(getDshIncrementalStatsForTests().fullReads, 1, "the first read is a full parse");

    // Unchanged tree, forced verification: served from the cache, same row.
    const cached = (await readDshSessions({ home, verifyRead: true })).map((entry) => entry.row);
    assert.deepEqual(cached.map((row) => row.total_tokens), first.map((row) => row.total_tokens));
    assert.equal(cached[0].title, "缓存回归");

    // An appended usage row changes the file stat; the cache must not serve
    // the stale totals on the next read.
    fs.appendFileSync(file, record("assistant/message", 90, 1791590000090,
      { turn: 1, step: 2, message: { role: "assistant", content: [] }, usage: usage(10, 20, 30, 0) }) + "\n");
    const after = (await readDshSessions({ home, verifyRead: true })).map((entry) => entry.row);
    assert.equal(after.length, 1);
    assert.equal(after[0].total_tokens, 1430, "1400 plus the appended 10+20");
    assert.equal(getDshIncrementalStatsForTests().incrementalReads, 1, "the append is fed incrementally");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

// The rate is only defensible if its denominator covers the generation that
// produced the numerator: a reasoning step queues and thinks before the first
// visible chunk, and its tool-call tail is not generation time at all.
test("dsh generation time spans step start to the last streamed chunk", async () => {
  const { home, dir } = sandbox();
  try {
    const base = 1791590000000;
    const msg = (turn, step, at, usages, stream) => record("assistant/message", 50 + at, at, {
      turn, step, message: { role: "assistant", content: [] }, usage: usages, stream,
    });
    const lines = [
      sessionHeader("abc-123", { cwd: "C:\work\proj", createdAt: base }),
      record("turn/start", 1, base + 20, { turn: 1 }),
      record("request/context", 2, base + 25, { provider: "apigoto", model: "deepseek-flash", contextWindow: 1000000 }),
      // step 1 queues and reasons for 4s, then streams for 2s.
      record("step/start", 3, base + 1000, { turn: 1, step: 1 }),
      msg(1, 1, base + 5000, usage(100, 400, 500, 0), [
        { type: "chunk", time: base + 5000, chunk: { type: "text-delta" } },
        { type: "chunk", time: base + 7000, chunk: { type: "finish" } },
      ]),
      record("step/end", 5, base + 20000, { turn: 1, step: 1 }),
      // step 2 emits two messages: one lead-in, counted once, ending at the
      // later of the two chunks.
      record("step/start", 6, base + 21000, { turn: 1, step: 2 }),
      msg(1, 2, base + 23000, usage(10, 50, 60, 0), [
        { type: "chunk", time: base + 23000, chunk: { type: "text-delta" } },
        { type: "chunk", time: base + 24000, chunk: { type: "text-delta" } },
      ]),
      msg(1, 2, base + 25000, usage(10, 50, 60, 0), [
        { type: "chunk", time: base + 25000, chunk: { type: "text-delta" } },
      ]),
      record("step/end", 9, base + 40000, { turn: 1, step: 2 }),
      // step 3 waits on a tool after its only chunk: the tail is not generation.
      record("step/start", 10, base + 41000, { turn: 1, step: 3 }),
      msg(1, 3, base + 42000, usage(10, 100, 110, 0), [
        { type: "chunk", time: base + 42000, chunk: { type: "text-delta" } },
        { type: "chunk", time: base + 43000, chunk: { type: "finish" } },
      ]),
      record("step/end", 12, base + 120000, { turn: 1, step: 3 }),
      record("turn/end", 13, base + 121000, { turn: 1, reason: { kind: "completed" } }),
    ];
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), lines.join("\n") + "\n");
    const rows = await rowsFrom(home);
    assert.equal(rows.length, 1);
    const perf = rows[0].performance;
    // step1 6000ms/400 + step2 4000ms/100 + step3 2000ms/100
    assert.equal(perf.estimated_output_tokens, 600);
    assert.equal(perf.estimated_duration_ms, 12000);
    assert.equal(perf.estimated_request_count, 3);
    assert.equal(perf.estimated_tokens_per_second, 50);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("dsh falls back to the chunk span when a step carries no start event", async () => {
  const { home, dir } = sandbox();
  try {
    const base = 1791590000000;
    const lines = [
      sessionHeader("abc-123", { cwd: "C:\work\proj", createdAt: base }),
      record("turn/start", 1, base + 20, { turn: 1 }),
      record("assistant/message", 2, base + 9000, {
        turn: 1, step: 7, message: { role: "assistant", content: [] }, usage: usage(100, 200, 300, 0),
        stream: [
          { type: "chunk", time: base + 5000, chunk: { type: "text-delta" } },
          { type: "chunk", time: base + 7000, chunk: { type: "finish" } },
        ],
      }),
      record("turn/end", 3, base + 91000, { turn: 1, reason: { kind: "completed" } }),
    ];
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), lines.join("\n") + "\n");
    const perf = (await rowsFrom(home))[0].performance;
    assert.equal(perf.estimated_output_tokens, 200);
    assert.equal(perf.estimated_duration_ms, 2000, "first chunk to last chunk");
    assert.equal(perf.estimated_tokens_per_second, 100);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("DSH failed-retry steps (v4 attempt / v1 failed-finish chunk) drop the speed sample but keep tokens", async () => {
  // Upstream #1080 follow-through: v4 records the failed try as
  // assistant/attempt; v1 has no attempt event — the failed try ends as a
  // top-level assistant/chunk whose chunk is a finish with an error or
  // aborted reason. The retry span includes failed work and backoff, so the
  // step can never be a clean sample even though the eventual message books
  // its tokens.
  const { home, dir } = sandbox();
  try {
    const start = 1791590000000;
    const lines = [
      sessionHeader("fail-retry", { createdAt: start }),
      record("request/context", 10, start + 40, { provider: "apigoto", model: "deepseek-flash", contextWindow: 1000000 }),
      // Step 1: starts, dies with a v1-style error finish chunk, and the
      // retried attempt books usage under the same turn/step.
      record("step/start", 11, start + 1000, { turn: 1, step: 1 }),
      record("assistant/chunk", 12, start + 2000, { turn: 1, step: 1, chunk: { type: "finish", reason: { kind: "error" } } }),
      record("assistant/message", 13, start + 5000, { turn: 1, step: 1, message: { role: "assistant", content: [] }, usage: usage(1000, 300, 1300, 0), stream: [{ time: start + 4900 }, { time: start + 4950 }] }),
      // Step 2: clean — the only honest sample.
      record("step/start", 14, start + 6000, { turn: 1, step: 2 }),
      record("assistant/message", 15, start + 8000, { turn: 1, step: 2, message: { role: "assistant", content: [] }, usage: usage(500, 200, 700, 0), stream: [{ time: start + 7100 }, { time: start + 8000 }] }),
      // Step 3: v4-style attempt failure marker.
      record("step/start", 16, start + 9000, { turn: 1, step: 3 }),
      record("assistant/attempt", 17, start + 9500, { turn: 1, step: 3 }),
      record("assistant/message", 18, start + 12000, { turn: 1, step: 3, message: { role: "assistant", content: [] }, usage: usage(500, 150, 650, 0), stream: [{ time: start + 11000 }, { time: start + 11500 }] }),
      record("turn/end", 19, start + 13000, { turn: 1, reason: { kind: "completed" } }),
    ];
    fs.writeFileSync(path.join(dir, "session.v4.jsonl"), lines.join("\n") + "\n");
    const row = (await rowsFrom(home))[0];
    // All three steps' tokens stay booked — only the TIMING samples drop.
    assert.equal(row.tokens.output_tokens, 650);
    const perf = row.performance;
    assert.equal(perf.estimated_request_count, 1, "failed steps (v1 chunk + v4 attempt) must not become samples");
    assert.equal(perf.estimated_output_tokens, 200);
    assert.equal(perf.estimated_tokens_per_second, 100, "step 2: 200 tokens over 2s");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
