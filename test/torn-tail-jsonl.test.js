const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseWorkbuddyIncremental,
  parseAgentJsonlIncremental,
  parseCodebuddyIncremental,
  resolvePrimeAgentSessionFiles,
} = require("../src/lib/rollout");

async function tmpDir(prefix) {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeText(filePath, text) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, text, "utf8");
}

async function appendText(filePath, text) {
  await fs.promises.appendFile(filePath, text, "utf8");
}

// WorkBuddy writes providerData.rawUsage per round-trip.
function workbuddyLine(messageId, tsMs) {
  return JSON.stringify({
    sessionId: "wb-s1",
    timestamp: tsMs,
    providerData: {
      messageId,
      rawUsage: {
        prompt_tokens: 1000,
        completion_tokens: 500,
        cache_read_input_tokens: 200,
      },
    },
  });
}

// Agent JSONL (autoclaw family) carries Claude-shaped usage with short names.
function agentJsonlLine(responseId, tsIso) {
  return JSON.stringify({
    type: "message",
    message: {
      role: "assistant",
      responseId,
      timestamp: tsIso,
      usage: { input: 10, output: 5 },
    },
  });
}

function codebuddyUsageLine(agentId, ts, usageJson) {
  return `[${ts}] [info] [AgentReporter] [${agentId}] Agent execution successful with usage: ${usageJson}`;
}

test("workbuddy holds a torn tail line and counts it once completed", async () => {
  const tmp = await tmpDir("tt-wb-tail-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const file = path.join(tmp, "sessions", "wb-s1.jsonl");
  const line1 = `${workbuddyLine("m1", 1730000000000)}\n`;
  // Half-written record (no trailing newline): the JSON is cut off mid-token.
  const torn = `{"sessionId":"wb-s1","timestamp":1730000001000,"providerData":{"messageId":"m2","rawUsage":{"prompt_to`;
  await writeText(file, line1 + torn);

  const cursors = {};
  const first = await parseWorkbuddyIncremental({
    projectFiles: [file],
    cursors,
    queuePath,
    defaultModel: "wb-model",
  });
  assert.equal(first.eventsAggregated, 1, "only the complete record counts");
  assert.equal(
    cursors.workbuddy.fileOffsets[file].size,
    Buffer.byteLength(line1, "utf8"),
    "cursor stops before the torn line instead of skipping past it",
  );

  // The writer completes the record and appends its newline.
  await appendText(file, `kens":900,"completion_tokens":400,"cache_read_input_tokens":100}}}\n`);
  const second = await parseWorkbuddyIncremental({
    projectFiles: [file],
    cursors,
    queuePath,
    defaultModel: "wb-model",
  });
  assert.equal(second.eventsAggregated, 1, "the completed record counts exactly once");
});

test("workbuddy counts a complete-but-unterminated final line exactly once", async () => {
  const tmp = await tmpDir("tt-wb-tail2-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const file = path.join(tmp, "sessions", "wb-s2.jsonl");
  // Whole JSON object, writer has not appended the newline yet.
  const text = `${workbuddyLine("n1", 1730000100000)}\n${workbuddyLine("n2", 1730000101000)}`;
  await writeText(file, text);

  const cursors = {};
  const first = await parseWorkbuddyIncremental({
    projectFiles: [file],
    cursors,
    queuePath,
    defaultModel: "wb-model",
  });
  assert.equal(first.eventsAggregated, 2, "the unterminated final record is complete JSON and counts");

  const second = await parseWorkbuddyIncremental({
    projectFiles: [file],
    cursors,
    queuePath,
    defaultModel: "wb-model",
  });
  assert.equal(second.eventsAggregated, 0, "re-running does not double-count the tail record");
});

test("agent-jsonl holds a torn tail and counts it after completion", async () => {
  const tmp = await tmpDir("tt-agent-tail-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const file = path.join(tmp, "sessions", "a1.jsonl");
  const line1 = `${agentJsonlLine("resp-1", "2026-11-08T10:00:00.000Z")}\n`;
  const torn = `{"type":"message","message":{"role":"assistant","timestamp":"2026-11-08T10:00:10.000Z","responseId":"resp-2","usage":{"inp`;
  await writeText(file, line1 + torn);

  const cursors = {};
  const first = await parseAgentJsonlIncremental({ projectFiles: [file], cursors, queuePath });
  assert.equal(first.eventsAggregated, 1);
  assert.equal(
    cursors.autoclaw.fileOffsets[file].size,
    Buffer.byteLength(line1, "utf8"),
    "cursor stops at the torn record",
  );

  await appendText(file, `ut":10,"output":5}}}\n`);
  const second = await parseAgentJsonlIncremental({ projectFiles: [file], cursors, queuePath });
  assert.equal(second.eventsAggregated, 1, "the completed record counts once");
});

test("codebuddy holds a torn log tail and counts it after completion", async () => {
  const tmp = await tmpDir("tt-cb-tail-");
  const queuePath = path.join(tmp, "queue.jsonl");
  const file = path.join(tmp, "logs", "craft.log");
  const usage1 = `{"inputTokens":100,"outputTokens":50,"totalTokens":150,"cacheTokens":20,"cachedWriteTokens":0,"cachedMissTokens":80}`;
  const line1 = `${codebuddyUsageLine("agent-1", "2026/7/1 16:56:02.200", usage1)}\n`;
  const torn = `[2026/7/1 16:56:03.300] [info] [AgentReporter] [agent-2] Agent execution successful with usage: {"inputTokens":60,"outp`;
  await writeText(file, line1 + torn);

  const cursors = {};
  const first = await parseCodebuddyIncremental({ projectFiles: [file], cursors, queuePath });
  assert.equal(first.eventsAggregated, 1, "only the complete usage line counts");
  assert.equal(
    cursors.codebuddy.fileOffsets[file].size,
    Buffer.byteLength(line1, "utf8"),
    "cursor stops at the torn log line",
  );

  await appendText(file, `utTokens":30,"totalTokens":90}\n`);
  const second = await parseCodebuddyIncremental({ projectFiles: [file], cursors, queuePath });
  assert.equal(second.eventsAggregated, 1, "the completed log line counts once");
});

test("prime agent discovers session-artifacts trees and excludes the rlm index", async () => {
  const tmp = await tmpDir("tt-prime-resolve-");
  const agentDir = path.join(tmp, ".prime", "agent");
  await writeText(path.join(agentDir, "sessions", "root.jsonl"), "{}\n");
  await writeText(path.join(agentDir, "session-artifacts", "root", "sub-abc.jsonl"), "{}\n");
  await writeText(path.join(agentDir, "session-artifacts", "root", "rlm-subagents.jsonl"), "[]\n");

  const env = { ...process.env, TOKENTRACKER_PRIME_AGENT_DIR: agentDir, HOME: tmp, USERPROFILE: tmp };
  delete env.TOKENTRACKER_PRIME_AGENT_HOME;
  const files = resolvePrimeAgentSessionFiles(env);
  const names = files.map((f) => path.basename(f)).sort();
  assert.deepEqual(names, ["root.jsonl", "sub-abc.jsonl"], "child transcripts join discovery; the index never does");
});
