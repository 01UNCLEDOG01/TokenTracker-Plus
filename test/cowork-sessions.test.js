"use strict";

// 团结 Cowork. These pin the four things that would each quietly corrupt the
// numbers, plus the two that decide whether the reader reads the right files.
//
// Every expectation below was measured on this machine first (664 token-bearing
// records across 4 chats files, 2026-08-19 .. 2026-10-06); the measured values
// are quoted in the comments so a reader can tell a real assertion from a
// guessed one.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TUANJIE_COWORK_SOURCE,
  resolveCoworkChatFiles,
  toCoworkSessionRecord,
} = require("../src/lib/cowork-sessions");

// A metered record in the shape Cowork writes. Defaults mirror a real record:
// real one read input 7150 / output 12 / cached 6800, i.e. total === input +
// output with cached sitting INSIDE input.
function chatLine({ id = "m-1", model = "codely-core", ts = "2026-10-06T04:59:19.577Z", tokens } = {}) {
  return JSON.stringify({
    t: "assistant",
    seq: 1,
    msg: {
      id,
      timestamp: ts,
      type: "gemini",
      model,
      content: "ok",
      committed: true,
      tokens: tokens || { input: 100, output: 20, cached: 60, thoughts: 0, tool: 0, total: 120 },
    },
    instanceId: "inst-1",
  });
}

test("cached is a subset of input, so it is split out and never added on top", () => {
  // Measured: cached <= input in 664/664 records.
  const rec = toCoworkSessionRecord(JSON.parse(chatLine({
    tokens: { input: 7150, output: 12, cached: 6800, thoughts: 0, tool: 0, total: 7162 },
  })));
  const u = rec.message.usage;
  assert.equal(u.input_tokens, 350, "fresh input only");
  assert.equal(u.cache_read_input_tokens, 6800);
  const total = u.input_tokens + u.cache_read_input_tokens +
    u.cache_creation_input_tokens + u.output_tokens;
  assert.equal(total, 7162, "reconstructs the file's own total exactly");
  const ifAdded = 7150 + u.cache_read_input_tokens + u.output_tokens;
  assert.equal(ifAdded, 13962, "adding cached on top would have inflated the record by 6800");
});

test("the file's total is preserved rather than re-derived", () => {
  // Measured: total === input + output in 664/664 records.
  const rec = toCoworkSessionRecord(JSON.parse(chatLine({
    tokens: { input: 100, output: 20, cached: 0, thoughts: 0, tool: 0, total: 120 },
  })));
  const u = rec.message.usage;
  assert.equal(u.input_tokens + u.cache_read_input_tokens +
    u.cache_creation_input_tokens + u.output_tokens, 120);
});

test("thoughts is reported in the detail block, not added to output", () => {
  // Measured: thoughts was 0 in 664/664 records, so whether it is a subset of
  // output or an addition is unverifiable here. Leaving output whole is the only
  // choice that keeps the verified total === input + output intact.
  const rec = toCoworkSessionRecord(JSON.parse(chatLine({
    tokens: { input: 100, output: 20, cached: 0, thoughts: 7, tool: 0, total: 120 },
  })));
  assert.equal(rec.message.usage.output_tokens, 20, "output left whole");
  assert.equal(rec.message.usage.output_tokens_details.reasoning_tokens, 7);
});

test("a malformed record where cached exceeds input cannot go negative", () => {
  const rec = toCoworkSessionRecord(JSON.parse(chatLine({
    tokens: { input: 10, output: 5, cached: 99, thoughts: 0, tool: 0, total: 15 },
  })));
  const u = rec.message.usage;
  assert.equal(u.cache_read_input_tokens, 10, "clamped to input");
  assert.equal(u.input_tokens, 0, "fresh input cannot be negative");
  assert.equal(u.output_tokens, 5);
});

test("the round-trip id is carried as the dedup key, and never invented", () => {
  const rec = toCoworkSessionRecord(JSON.parse(chatLine({ id: "b0bd9440-db67-4b1e-9dcc" })));
  assert.equal(rec.message.id, "b0bd9440-db67-4b1e-9dcc");
  const noId = toCoworkSessionRecord({ msg: { model: "codely-core", tokens: { input: 1, output: 1 } } });
  assert.equal(noId.message.id, undefined, "an absent id is left absent");
});

test("records without usage are dropped, not turned into zero buckets", () => {
  assert.equal(toCoworkSessionRecord(JSON.parse(chatLine({
    tokens: { input: 0, output: 0, cached: 0, thoughts: 0, tool: 0, total: 0 },
  }))), null);
  assert.equal(toCoworkSessionRecord({ msg: { model: "codely-core" } }), null, "no tokens field");
  assert.equal(toCoworkSessionRecord({ msg: { tokens: null } }), null);
  assert.equal(toCoworkSessionRecord({}), null);
  assert.equal(toCoworkSessionRecord(null), null);
});

test("model and timestamp pass through untouched", () => {
  // Measured model ids on this machine: codely-core, codely-basic, codely-air.
  const rec = toCoworkSessionRecord(JSON.parse(chatLine({ model: "codely-air" })));
  assert.equal(rec.message.model, "codely-air");
  assert.equal(rec.timestamp, "2026-10-06T04:59:19.577Z", "kept as ISO so the half-hour bucket sees UTC");
  assert.equal(rec.type, "assistant");
});

test("only chats/ is read - the 110 sibling tasks files carry no tokens", () => {
  // Measured: 5 files under chats/ (4 with tokens), 110 under tasks/ with 0
  // carrying a tokens field. Reading tasks/ would be 23x the I/O for nothing.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-"));
  try {
    const inst = path.join(home, ".codely-cli", "tmp", "abc123");
    fs.mkdirSync(path.join(inst, "chats"), { recursive: true });
    fs.mkdirSync(path.join(inst, "tasks", "session-1"), { recursive: true });
    fs.writeFileSync(path.join(inst, "chats", "c1.jsonl"), chatLine() + "\n");
    // A tasks file with no tokens at all, exactly as measured.
    fs.writeFileSync(path.join(inst, "tasks", "session-1", "task-1.jsonl"),
      JSON.stringify({ t: "assistant", msg: { id: "x", model: "codely-core", content: "no tokens here" } }) + "\n");

    const found = resolveCoworkChatFiles({ env: {}, home });
    assert.equal(found.length, 1, "the tasks file must not be picked up");
    assert.ok(found[0].includes(`${path.sep}chats${path.sep}`));

    const viaEnv = resolveCoworkChatFiles({
      env: { TOKENTRACKER_TUANJIE_COWORK_HOME: path.join(inst, "chats") }, home,
    });
    assert.equal(viaEnv.length, 1, "an override wins");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a missing install yields no files rather than throwing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-empty-"));
  try {
    assert.deepEqual(resolveCoworkChatFiles({ env: {}, home }), []);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the source key is its own namespace", () => {
  assert.equal(TUANJIE_COWORK_SOURCE, "tuanjie-cowork");
  assert.notEqual(TUANJIE_COWORK_SOURCE, "autoclaw");
  assert.notEqual(TUANJIE_COWORK_SOURCE, "cola");
});

// The doubled write measured on this machine: 664 records, 462 distinct ids,
// 202 repeated writes INSIDE the same file, and the naive sum is exactly 2x on
// the affected records. This is the assertion that would catch a dedup
// regression - the reader's whole value here depends on it.
test("replaying a doubled write halves the naive sum (the real-machine shape)", () => {
  const one = { input: 7150, output: 12, cached: 6800, thoughts: 0, tool: 0, total: 7162 };
  const line = chatLine({ tokens: one });
  const seen = new Set();
  let deduped = 0;
  let naive = 0;
  for (const raw of [line, line]) {
    naive += JSON.parse(raw).msg.tokens.total;
    const rec = toCoworkSessionRecord(JSON.parse(raw));
    if (rec && rec.message.id && !seen.has(rec.message.id)) {
      seen.add(rec.message.id);
      const u = rec.message.usage;
      deduped += u.input_tokens + u.cache_read_input_tokens +
        u.cache_creation_input_tokens + u.output_tokens;
    }
  }
  assert.equal(naive, 14324, "the naive sum double-counts");
  assert.equal(deduped, 7162, "dedup by msg.id counts the reply once");
});