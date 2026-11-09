const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  parseVibeIncremental,
  parseJcodeIncremental,
  parseCopilotSessionStateIncremental,
} = require("../src/lib/rollout");

async function tmpDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeText(filePath, text) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

async function readQueue(queuePath) {
  const raw = await fs.readFile(queuePath, "utf8").catch(() => "");
  return raw.split(/\n+/).filter(Boolean).map((line) => JSON.parse(line));
}

test("vibe counts cumulative stats once, then only the delta on rewrite", async () => {
  const tmp = await tmpDir("tt-vibe-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const meta = path.join(tmp, "session_ab12", "meta.json");
  const snapshot = (prompt, completion, cached) => JSON.stringify({
    session_id: "sess-1",
    start_time: "2026-11-08T10:00:00Z",
    end_time: "2026-11-08T10:05:00Z",
    config: { active_model: "codestral-latest" },
    stats: {
      session_prompt_tokens: prompt,
      session_completion_tokens: completion,
      session_cached_tokens: cached,
    },
  });
  await writeText(meta, snapshot(15000, 1200, 5000));

  const cursors = {};
  const first = await parseVibeIncremental({ sessionFiles: [meta], cursors, queuePath });
  assert.equal(first.eventsAggregated, 1);

  // Cumulative totals rewritten by the running harness: only the delta counts.
  await writeText(meta, snapshot(18000, 1500, 6000));
  const second = await parseVibeIncremental({ sessionFiles: [meta], cursors, queuePath });
  assert.equal(second.eventsAggregated, 1, "the rewrite counts only its delta");

  // An unchanged snapshot is skipped entirely.
  const third = await parseVibeIncremental({ sessionFiles: [meta], cursors, queuePath });
  assert.equal(third.eventsAggregated, 0);

  // Queue rows are full bucket snapshots keyed by (source, model, hour) and
  // the reader takes the latest: row 1 is the first snapshot, row 2 replaces
  // it after the rewrite (10000 in + 5000 cached + 1200 out → 12000 + 6000 +
  // 1500). The vibe parser itself only fed the 3300-token delta.
  const rows = await readQueue(queuePath);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].total_tokens, 16200);
  assert.equal(rows[1].total_tokens, 19500);
  assert.equal(rows[1].input_tokens, 12000);
  assert.equal(rows[1].cached_input_tokens, 6000);
});

test("vibe skips non-session JSON without inventing a baseline", async () => {
  const tmp = await tmpDir("tt-vibe2-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const stray = path.join(tmp, "notes_2026.json");
  await writeText(stray, JSON.stringify({ hello: "world" }));

  const cursors = {};
  const result = await parseVibeIncremental({ sessionFiles: [stray], cursors, queuePath });
  assert.equal(result.eventsAggregated, 0);
  assert.ok(cursors.vibe.files[stray], "file identity is remembered to avoid re-reads");
});

test("jcode honors split vs subset cache accounting and never double-counts a migrated message", async () => {
  const tmp = await tmpDir("tt-jcode-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const snapshot = path.join(tmp, "session_alpha.json");
  const journal = path.join(tmp, "session_alpha.journal.jsonl");
  const tsIso = "2026-06-16T12:00:01Z";

  await writeText(snapshot, JSON.stringify({
    id: "alpha",
    model: "claude-sonnet-4",
    working_dir: "/repo",
    messages: [
      {
        id: "split-a",
        role: "assistant",
        timestamp: tsIso,
        // Anthropic-shaped: cache_creation present -> all buckets independent.
        token_usage: { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 800, cache_creation_input_tokens: 50, reasoning_output_tokens: 25 },
      },
      {
        id: "subset-b",
        role: "assistant",
        timestamp: "2026-06-16T12:00:02Z",
        // OpenAI-shaped: no creation field -> cache reads are a subset of input.
        token_usage: { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 600 },
      },
    ],
  }));

  const cursors = {};
  const first = await parseJcodeIncremental({ sessionFiles: [snapshot], cursors, queuePath });
  assert.equal(first.eventsAggregated, 2);
  // Both messages land in one (source, model, half-hour) bucket, so the queue
  // carries one full snapshot row combining them: split input 1200 + subset
  // input (1000 − 600) = 1600; cached 800+600; creation 50; output 300+400;
  // reasoning 25; total 1600+1400+700+50+25 = 3775.
  const rows = await readQueue(queuePath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input_tokens, 1600, "split keeps input as reported; subset removes cache reads");
  assert.equal(rows[0].cache_creation_input_tokens, 50);
  assert.equal(rows[0].reasoning_output_tokens, 25);
  assert.equal(rows[0].total_tokens, 3775);

  // The same message id appears in the journal first, then a rewritten
  // snapshot carries it: it must count exactly once (shared dedup namespace).
  const betaSnap = path.join(tmp, "session_beta.json");
  const betaJrnl = path.join(tmp, "session_beta.journal.jsonl");
  const msg = { id: "b1", role: "assistant", timestamp: tsIso, token_usage: { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 50 } };
  await writeText(betaJrnl, JSON.stringify({ meta: { model: "gpt-6.2" }, append_messages: [msg] }) + "\n");
  const cursors2 = {};
  const jrnlOnly = await parseJcodeIncremental({ sessionFiles: [betaJrnl], cursors: cursors2, queuePath });
  assert.equal(jrnlOnly.eventsAggregated, 1);
  await writeText(betaSnap, JSON.stringify({ id: "beta", model: "gpt-6.2", messages: [msg] }));
  const withSnap = await parseJcodeIncremental({ sessionFiles: [betaSnap, betaJrnl], cursors: cursors2, queuePath });
  assert.equal(withSnap.eventsAggregated, 0, "migration from journal to snapshot does not double-count");
});

test("copilot session-state counts usage_record events with inclusive input", async () => {
  const tmp = await tmpDir("tt-copilot-ss-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const events = path.join(tmp, "c79fb3cc", "events.jsonl");
  await writeText(events, [
    JSON.stringify({ type: "session.start", data: { sessionId: "c79fb3cc", context: { cwd: "/repo" } }, id: "start-1", timestamp: "2026-11-02T10:00:00.000Z" }),
    JSON.stringify({ type: "session.usage_record", data: { usage: { model: "gpt-6.1-sol", inputTokens: 32832, outputTokens: 32, cacheReadTokens: 0, cacheWriteTokens: 32829, reasoningTokens: 0 } }, id: "ev-1", timestamp: "2026-11-02T10:01:00.000Z" }),
    JSON.stringify({ type: "session.shutdown", data: { modelMetrics: { "gpt-6.1-sol": { usage: { inputTokens: 999999, outputTokens: 1 } } } }, id: "sh-1", timestamp: "2026-11-02T10:02:00.000Z" }),
  ].join("\n") + "\n");

  const cursors = {};
  const first = await parseCopilotSessionStateIncremental({ sessionFiles: [events], cursors, queuePath });
  assert.equal(first.eventsAggregated, 1, "only usage_record counts; the shutdown cumulative block never does");
  const rows = await readQueue(queuePath);
  assert.equal(rows[0].input_tokens, 3, "input = 32832 - 0 cache read - 32829 cache write");

  const second = await parseCopilotSessionStateIncremental({ sessionFiles: [events], cursors, queuePath });
  assert.equal(second.eventsAggregated, 0, "re-running counts nothing");
});

test("copilot session-state falls back to the model_change model and skips auto", async () => {
  const tmp = await tmpDir("tt-copilot-mc-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const events = path.join(tmp, "d1", "events.jsonl");
  await writeText(events, [
    JSON.stringify({ type: "session.start", data: { sessionId: "d1" }, id: "s", timestamp: "2026-11-02T10:00:00.000Z" }),
    JSON.stringify({ type: "session.model_change", data: { newModel: "gpt-6-luna" }, id: "mc", timestamp: "2026-11-02T10:00:10.000Z" }),
    JSON.stringify({ type: "session.usage_record", data: { usage: { inputTokens: 100, outputTokens: 10 } }, id: "u", timestamp: "2026-11-02T10:01:00.000Z" }),
  ].join("\n") + "\n");
  const cursors = {};
  await parseCopilotSessionStateIncremental({ sessionFiles: [events], cursors, queuePath });
  const rows = await readQueue(queuePath);
  assert.equal(rows[0].model, "gpt-6-luna", "a usage_record without its own model inherits model_change");
});
