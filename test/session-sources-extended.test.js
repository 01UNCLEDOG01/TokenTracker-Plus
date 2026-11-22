"use strict";

// Junie / OpenCodeReview / Amp — the 2026-11-22 upstream-coverage batch
// (TM/tokscale formats; no live installs on the build machines, so fixtures
// follow the tokscale readers verbatim and every temp dir is per-run mkdtemp
// with a finally cleanup — never fixture literals inside the repo).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { parseAgentJsonlIncremental, parseAmpIncremental } = require("../src/lib/rollout");
const {
  resolveJunieSessionFiles,
  resolveOpenCodeReviewSessionFiles,
  resolveAmpThreadFiles,
  parseAmpThreadUsage,
  scanJunieSession,
  scanOpenCodeReviewSession,
  scanAmpSession,
} = require("../src/lib/agent-jsonl-sessions");

async function readJsonLines(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return raw.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
}

function latestRows(rows) {
  const byKey = new Map();
  for (const row of rows) byKey.set(`${row.source}|${row.model}|${row.hour_start}`, row);
  return [...byKey.values()];
}

async function makeCtx(prefix) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const env = { ...process.env, HOME: tmp };
  return {
    tmp,
    env,
    queuePath: path.join(tmp, "queue.jsonl"),
    cleanup: () => fs.rm(tmp, { recursive: true, force: true, maxRetries: 3 }),
  };
}

// ── Junie ────────────────────────────────────────────────────────────────────

function junieUsageEvent(timestampMs, modelUsage) {
  return JSON.stringify({
    timestampMs,
    event: {
      agentEvent: {
        kind: "LlmResponseMetadataEvent",
        agent: { name: "junie-agent" },
        modelUsage,
      },
    },
  });
}

test("junie resolver honors TOKENTRACKER_JUNIE_HOME and finds events.jsonl only", async () => {
  const ctx = await makeCtx("tt-junie-");
  try {
    const sessionDir = path.join(ctx.tmp, ".junie", "sessions", "session-abc");
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, "events.jsonl"), "{}\n", "utf8");
    await fs.writeFile(path.join(sessionDir, "notes.txt"), "x\n", "utf8");
    const files = resolveJunieSessionFiles({ env: { TOKENTRACKER_JUNIE_HOME: path.join(ctx.tmp, ".junie") } });
    assert.deepStrictEqual(files, [path.join(sessionDir, "events.jsonl")]);
  } finally {
    await ctx.cleanup();
  }
});

test("junie one event with several modelUsage rows expands to one record per model", async () => {
  const ctx = await makeCtx("tt-junie-");
  try {
    const sessionDir = path.join(ctx.tmp, ".junie", "sessions", "session-xyz");
    await fs.mkdir(sessionDir, { recursive: true });
    const endTs = Date.UTC(2026, 10, 22, 9, 40, 0); // 09:30 bucket (end 09:40)
    const lines = [
      JSON.stringify({ timestampMs: endTs - 60_000, event: { agentEvent: { kind: "UserPromptEvent" } } }),
      junieUsageEvent(endTs, [
        { model: "claude-opus-4-8", inputTokens: 100, outputTokens: 20, cacheInputTokens: 300, cacheCreateTokens: 10, reasoningTokens: 5, time: 40_000 },
        { model: "qwen3.8-flash", input: 30, output: 6, time: 5_000 },
      ]),
    ];
    await fs.writeFile(path.join(sessionDir, "events.jsonl"), lines.join("\n") + "\n", "utf8");

    const files = resolveJunieSessionFiles({ env: ctx.env, home: ctx.tmp });
    assert.equal(files.length, 1);
    const cursors = { version: 1, files: {}, updatedAt: null };
    const res = await parseAgentJsonlIncremental({
      projectFiles: files,
      cursors,
      queuePath: ctx.queuePath,
      env: ctx.env,
      source: "junie",
    });
    // Two modelUsage rows → two events; the user prompt carries no usage.
    assert.equal(res.eventsAggregated, 2);

    const rows = latestRows(await readJsonLines(ctx.queuePath));
    assert.ok(rows.every((r) => r.source === "junie"));
    const opus = rows.find((r) => r.model === "claude-opus-4-8");
    // Back-anchored by usage.time: end 09:40 − 40s latency → 09:39:20, 09:30 bucket.
    assert.equal(opus.hour_start, "2026-11-22T09:30:00.000Z");
    assert.equal(opus.input_tokens, 100);
    assert.equal(opus.output_tokens, 20 + 5); // reasoning folds into output
    assert.equal(opus.cached_input_tokens, 300);
    assert.equal(opus.cache_creation_input_tokens, 10);
    const qwen = rows.find((r) => r.model === "qwen3.8-flash");
    assert.equal(qwen.input_tokens, 30);
    assert.equal(qwen.output_tokens, 6);

    // Re-running the same files must not double count (composite row keys).
    const before = await fs.readFile(ctx.queuePath, "utf8");
    await parseAgentJsonlIncremental({ cursors, queuePath: ctx.queuePath, env: ctx.env, source: "junie" });
    assert.equal(await fs.readFile(ctx.queuePath, "utf8"), before);
  } finally {
    await ctx.cleanup();
  }
});

// ── OpenCodeReview ───────────────────────────────────────────────────────────

test("opencodereview maps llm_response rows and session_start cwd", async () => {
  const ctx = await makeCtx("tt-ocr-");
  try {
    const repoDir = path.join(ctx.tmp, ".opencodereview", "sessions", "repo-encoded");
    await fs.mkdir(repoDir, { recursive: true });
    const endMs = Date.UTC(2026, 10, 22, 21, 5, 0); // 21:00 UTC bucket
    const lines = [
      JSON.stringify({ type: "session_start", cwd: "/work/demo" }),
      JSON.stringify({
        type: "llm_response",
        timestamp: new Date(endMs).toISOString(),
        duration_ms: 12_000,
        model: "glm-5.3-flash",
        usage: { prompt_tokens: 500, completion_tokens: 80, cache_read_tokens: 1500, cache_write_tokens: 25 },
      }),
    ];
    await fs.writeFile(path.join(repoDir, "s1.jsonl"), lines.join("\n") + "\n", "utf8");

    const files = resolveOpenCodeReviewSessionFiles({ env: ctx.env, home: ctx.tmp });
    assert.equal(files.length, 1);
    const cursors = { version: 1, files: {}, updatedAt: null };
    const res = await parseAgentJsonlIncremental({
      projectFiles: files,
      cursors,
      queuePath: ctx.queuePath,
      env: ctx.env,
      source: "opencodereview",
    });
    assert.equal(res.eventsAggregated, 1);
    const rows = latestRows(await readJsonLines(ctx.queuePath));
    const row = rows.find((r) => r.source === "opencodereview");
    // Back-anchored by duration_ms: end 21:05 − 12s → still the 21:00 bucket.
    assert.equal(row.hour_start, "2026-11-22T21:00:00.000Z");
    assert.equal(row.input_tokens, 500);
    assert.equal(row.output_tokens, 80);
    assert.equal(row.cached_input_tokens, 1500);
    assert.equal(row.cache_creation_input_tokens, 25);

    // The session scanner reads the same file for the sessions page.
    const session = await scanOpenCodeReviewSession(path.join(repoDir, "s1.jsonl"));
    assert.equal(session.source, "opencodereview");
    assert.equal(session.project_ref, "/work/demo");
    assert.equal(session.tokens.total_tokens > 0, true);
  } finally {
    await ctx.cleanup();
  }
});

// ── Amp ──────────────────────────────────────────────────────────────────────

test("amp thread reconciliation: ledger is authoritative, message usage fills gaps", () => {
  const thread = {
    id: "thread-partial",
    created: Date.UTC(2026, 10, 4, 12, 0, 0),
    usageLedger: {
      events: [
        { timestamp: "2026-11-08T12:00:00Z", model: "claude-sonnet-4-0", credits: 0.75, tokens: { input: 100, output: 20 } },
      ],
    },
    messages: [
      { role: "assistant", messageId: 1, usage: { model: "claude-sonnet-4-0", inputTokens: 100, outputTokens: 20, credits: 0.75 } },
      { role: "assistant", messageId: 2, usage: { model: "claude-sonnet-4-0", inputTokens: 50, outputTokens: 10, credits: 0.4 } },
    ],
  };
  const rows = parseAmpThreadUsage(thread, { fileMtimeMs: Date.UTC(2026, 10, 8, 13, 0, 0) });
  // Ledger row + the unmatched message row — never both copies of row 1.
  assert.equal(rows.length, 2);
  assert.equal(rows.every((r) => r.message.model === "claude-sonnet-4-0"), true);
  const ledgerRow = rows.find((r) => r.message.usage.input_tokens === 100);
  const unmatchedRow = rows.find((r) => r.message.usage.input_tokens === 50);
  assert.ok(ledgerRow && unmatchedRow);
  // Ledger timestamp wins over the fallbacks for the matched row; the
  // unmatched message row rides the thread-created fallback.
  assert.equal(ledgerRow.timestamp, Date.parse("2026-11-08T12:00:00Z"));
  assert.equal(unmatchedRow.timestamp, Date.UTC(2026, 10, 4, 12, 0, 0));
});

test("amp incremental parser queues rows once and skips unchanged files", async () => {
  const ctx = await makeCtx("tt-amp-");
  try {
    const threadsDir = path.join(ctx.tmp, ".local", "share", "amp", "threads");
    await fs.mkdir(threadsDir, { recursive: true });
    const threadPath = path.join(threadsDir, "thread-1.json");
    const thread = {
      id: "thread-1",
      created: Date.UTC(2026, 10, 8, 12, 0, 0),
      usageLedger: {
        events: [
          { timestamp: "2026-11-08T12:30:00Z", model: "claude-sonnet-4-0", credits: 1, tokens: { input: 200, output: 40 } },
          { timestamp: "2026-11-08T13:30:00Z", model: "glm-5.3-flash", credits: 0.2, tokens: { input: 10, output: 2 } },
        ],
      },
      messages: [],
    };
    await fs.writeFile(threadPath, JSON.stringify(thread), "utf8");

    assert.deepStrictEqual(resolveAmpThreadFiles({ env: { TOKENTRACKER_AMP_HOME: threadsDir } }), [threadPath]);

    const cursors = { version: 1, files: {}, updatedAt: null };
    const res1 = await parseAmpIncremental({ projectFiles: [threadPath], cursors, queuePath: ctx.queuePath, env: ctx.env });
    assert.equal(res1.eventsAggregated, 2);
    assert.equal(res1.bucketsQueued, 2);
    const rows = latestRows(await readJsonLines(ctx.queuePath));
    assert.ok(rows.every((r) => r.source === "amp"));
    assert.equal(rows.find((r) => r.model === "claude-sonnet-4-0").input_tokens, 200);

    // Same file untouched → zero new events.
    const res2 = await parseAmpIncremental({ projectFiles: [threadPath], cursors, queuePath: ctx.queuePath, env: ctx.env });
    assert.equal(res2.eventsAggregated, 0);
    assert.equal(res2.filesProcessed, 0);

    // Thread grows (file rewritten with a new ledger event) → only the delta.
    thread.usageLedger.events.push({ timestamp: "2026-11-08T14:30:00Z", model: "claude-sonnet-4-0", credits: 1, tokens: { input: 90, output: 5 } });
    await fs.writeFile(threadPath, JSON.stringify(thread), "utf8");
    const res3 = await parseAmpIncremental({ projectFiles: [threadPath], cursors, queuePath: ctx.queuePath, env: ctx.env });
    assert.equal(res3.eventsAggregated, 1);

    // The sessions-page scanner rides the rawLines seam.
    const session = await scanAmpSession(threadPath);
    assert.equal(session.source, "amp");
    assert.equal(session.tokens.total_tokens, 200 + 40 + 10 + 2 + 90 + 5);
  } finally {
    await ctx.cleanup();
  }
});
