"use strict";

// AutoClaw and Cola share one JSONL shape; these pin the three things that are
// easy to get wrong and that would each quietly corrupt the numbers: the
// reasoning key spelling differs between the two apps, these files' own
// totalTokens excludes reasoning while the canonical shape folds it into output,
// and a user record carries no usage but is still what opens a turn.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  AUTOCLAW_SOURCE,
  COLA_SOURCE,
  resolveAutoClawSessionFiles,
  resolveColaSessionFiles,
  toAgentSessionRecord,
  claudeShapedUsage,
} = require("../src/lib/agent-jsonl-sessions");

// A metered assistant round-trip, in the shape both apps write.
function assistantLine({ model, usage, ts = 1789402136719, id = "resp-1" }) {
  return JSON.stringify({
    type: "message",
    message: { role: "assistant", model, timestamp: ts, responseId: id, content: [], usage },
  });
}

test("both reasoning spellings land in the same canonical place", () => {
  // AutoClaw writes reasoningTokens, Cola writes reasoning.
  const autoclaw = claudeShapedUsage({
    input: 10, output: 20, cacheRead: 30, cacheWrite: 40, reasoningTokens: 5, totalTokens: 100,
  });
  const cola = claudeShapedUsage({
    input: 10, output: 20, cacheRead: 30, cacheWrite: 40, reasoning: 5, totalTokens: 100,
  });
  assert.deepEqual(autoclaw, cola, "one spelling difference must not change the result");
  assert.equal(autoclaw.reasoning_output_tokens, undefined, "the canonical shape folds reasoning into output");
  assert.equal(autoclaw.output_tokens, 25, "output 20 + reasoning 5");
  assert.equal(autoclaw.output_tokens_details.reasoning_tokens, 5, "and still reports it in the detail");
  assert.equal(autoclaw.input_tokens, 10);
  assert.equal(autoclaw.cache_read_input_tokens, 30);
  assert.equal(autoclaw.cache_creation_input_tokens, 40);
});

test("the files' own totalTokens is ignored - it drops reasoning", () => {
  // The real AutoClaw record reads 18969/542/13504/0 with reasoningTokens 463
  // and totalTokens 33015, which is input+output+cacheRead+cacheWrite only.
  const usage = claudeShapedUsage({
    input: 18969, output: 542, cacheRead: 13504, cacheWrite: 0, reasoningTokens: 463, totalTokens: 33015,
  });
  const total = usage.input_tokens + usage.cache_read_input_tokens +
    usage.cache_creation_input_tokens + usage.output_tokens;
  assert.equal(total, 33478, "reasoning counted once, inside output");
  assert.notEqual(total, 33015, "not the file's totalTokens, which omits reasoning");
});

test("an all-zero usage record yields no record at all", () => {
  assert.equal(claudeShapedUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoningTokens: 0 }), null);
  assert.equal(claudeShapedUsage(null), null);
  assert.equal(toAgentSessionRecord({ type: "message", message: { role: "assistant", usage: { input: 0, output: 0 } } }), null);
});

test("a user record is kept, because the scanner opens a turn on it", () => {
  const rec = toAgentSessionRecord({ type: "message", message: { role: "user", timestamp: 1789402136719, content: "hi" } });
  assert.ok(rec, "dropping it would read every file as zero usage");
  assert.equal(rec.type, "user");
  assert.equal(rec.message.content, "hi");
});

test("the assistant record carries the round-trip id used for dedup", () => {
  const line = JSON.parse(assistantLine({
    model: "zaicoding_glm-5.3",
    usage: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, reasoningTokens: 0, totalTokens: 10 },
  }));
  const rec = toAgentSessionRecord(line);
  assert.equal(rec.type, "assistant");
  assert.equal(rec.message.id, "resp-1", "without it a rescan counts the same reply twice");
  assert.equal(rec.message.model, "zaicoding_glm-5.3");
  assert.equal(rec.timestamp, 1789402136719);

  const noId = toAgentSessionRecord({ type: "message", message: { role: "assistant", usage: { input: 1, output: 1 }, content: [] } });
  assert.equal(noId.message.id, undefined, "an absent id is left absent, never invented");
});

test("non-message records and unparsable lines are ignored", () => {
  assert.equal(toAgentSessionRecord({ type: "session", message: { role: "assistant", usage: { input: 1, output: 1 } } }), null);
  assert.equal(toAgentSessionRecord(null), null);
  assert.equal(toAgentSessionRecord("not an object"), null);
});

test("each source reads only its own install, and an override wins", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentjsonl-"));
  try {
    // AutoClaw: ~/.openclaw-autoclaw/agents/<agent>/sessions/*.jsonl
    const acSessions = path.join(home, ".openclaw-autoclaw", "agents", "main", "sessions");
    fs.mkdirSync(acSessions, { recursive: true });
    fs.writeFileSync(path.join(acSessions, "a.jsonl"), assistantLine({ usage: { input: 1, output: 1 } }) + "\n");
    // The trajectory file sits beside the session and repeats its usage.
    fs.writeFileSync(path.join(acSessions, "a.trajectory.jsonl"), assistantLine({ usage: { input: 1, output: 1 } }) + "\n");

    const colaSessions = path.join(home, ".cola", "sessions", "desktop-local");
    fs.mkdirSync(colaSessions, { recursive: true });
    fs.writeFileSync(path.join(colaSessions, "b.jsonl"), assistantLine({ usage: { input: 1, output: 1, reasoning: 1 } }) + "\n");

    const ac = resolveAutoClawSessionFiles({ env: {}, home });
    assert.equal(ac.length, 1, "the .trajectory.jsonl sibling must not be read as a second source");
    assert.ok(!ac[0].endsWith(".trajectory.jsonl"));

    const co = resolveColaSessionFiles({ env: {}, home });
    assert.equal(co.length, 1);

    // An explicit override points the resolver somewhere else entirely.
    const alt = fs.mkdtempSync(path.join(os.tmpdir(), "agentjsonl-alt-"));
    fs.writeFileSync(path.join(alt, "z.jsonl"), assistantLine({ usage: { input: 1, output: 1 } }) + "\n");
    const viaEnv = resolveAutoClawSessionFiles({ env: { TOKENTRACKER_AUTOCLAW_HOME: alt }, home });
    assert.equal(viaEnv.length, 1);
    assert.ok(viaEnv[0].startsWith(path.resolve(alt)));
    fs.rmSync(alt, { recursive: true, force: true });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the two sources are distinct keys", () => {
  assert.notEqual(AUTOCLAW_SOURCE, COLA_SOURCE);
  assert.equal(AUTOCLAW_SOURCE, "autoclaw");
  assert.equal(COLA_SOURCE, "cola");
});