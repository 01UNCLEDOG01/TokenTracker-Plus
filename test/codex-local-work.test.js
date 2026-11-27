"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const {
  EVENT_NAME,
  createCodexLocalWorkWatcher,
  executorIdsFromProcesses,
  localThreadEnvironment,
  observationForEvent,
  usageCounters,
} = require("../src/lib/codex-local-work");
const { parseCodexLocalWorkIncremental } = require("../src/lib/rollout");

const TOTAL = {
  inputTokens: 1000,
  cachedInputTokens: 200,
  cacheWriteInputTokens: 50,
  outputTokens: 100,
  reasoningOutputTokens: 20,
  totalTokens: 1100,
};
const LAST = {
  inputTokens: 300,
  cachedInputTokens: 100,
  cacheWriteInputTokens: 0,
  outputTokens: 30,
  reasoningOutputTokens: 10,
  totalTokens: 330,
};

test("local Work ownership requires the matching executor and no native rollout", () => {
  const text = [
    "\"C:\\Program Files\\Codex\\codex.exe\" -c features.code_mode_host=true exec-server --environment-id local-a",
    "codex app-server --environment-id wrong",
    "bash -c \"codex exec-server --environment-id local-b\"",
  ].join("\n");
  const ids = executorIdsFromProcesses(text);
  assert.deepEqual([...ids], ["local-a"]);
  const thread = {
    id: "01234567-1234-1234-1234-123456789abc",
    model: "gpt-test",
    path: null,
    originator: "codex_work_web",
    threadSource: "user",
    environments: [{ environmentId: "local-a", cwd: "C:\\work\\project" }],
  };
  assert.equal(localThreadEnvironment(thread, ids)?.cwd, "C:\\work\\project");
  assert.equal(localThreadEnvironment({ ...thread, path: "rollout.jsonl" }, ids), null);
  assert.equal(localThreadEnvironment({ ...thread, originator: "codex_work_cca", threadSource: "user" }, ids), null);
  assert.equal(localThreadEnvironment({ ...thread, environments: [{ environmentId: "cloud", cwd: "C:\\work" }] }, ids), null);
});

test("local Work checkpoints consume one baseline and append only new request deltas", () => {
  const state = { version: 1, threads: {}, buckets: {} };
  const base = {
    accountKey: "account",
    thread: { id: "thread-1", name: "Work task", model: "gpt-test", status: { type: "active" } },
    environmentId: "executor-1",
    cwd: "C:\\work",
    turnId: "turn-1",
    state,
    now: "2026-11-27T01:00:00.000Z",
  };
  assert.equal(observationForEvent({
    ...base,
    baselineOnly: true,
    tokenUsage: { last: LAST, total: TOTAL },
  }), null);
  const nextTotal = { ...TOTAL, inputTokens: 1300, outputTokens: 130, totalTokens: 1430 };
  const observation = observationForEvent({
    ...base,
    baselineOnly: false,
    tokenUsage: { last: LAST, total: nextTotal },
  });
  assert.deepEqual(observation.usage, usageCounters(LAST));
  assert.equal(observation.conversationCount, 1);
  assert.equal(observation.model, "gpt-test");
  assert.equal(observationForEvent({
    ...base,
    baselineOnly: false,
    tokenUsage: { last: LAST, total: nextTotal },
  }), null);
});

test("local Work event ledger adds to Codex buckets once and survives a restart cursor", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-codex-local-work-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const eventsPath = path.join(dir, "codex-local-work.events.jsonl");
  const queuePath = path.join(dir, "queue.jsonl");
  const rows = [
    {
      kind: EVENT_NAME,
      observedAt: "2026-11-27T01:01:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      model: "gpt-test",
      conversationCount: 1,
      usage: usageCounters(LAST),
    },
    {
      kind: EVENT_NAME,
      observedAt: "2026-11-27T01:02:00.000Z",
      threadId: "thread-1",
      turnId: "turn-1",
      model: "gpt-test",
      conversationCount: 0,
      usage: usageCounters(LAST),
    },
  ];
  fs.writeFileSync(eventsPath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  const cursors = {};
  const first = await parseCodexLocalWorkIncremental({ eventsPath, cursors, queuePath });
  assert.equal(first.eventsAggregated, 2);
  assert.equal(first.bucketsQueued, 1);
  const queued = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].source, "codex");
  assert.equal(queued[0].total_tokens, usageCounters(LAST).total * 2);
  assert.equal(queued[0].conversation_count, 1);

  const second = await parseCodexLocalWorkIncremental({
    eventsPath,
    cursors: JSON.parse(JSON.stringify(cursors)),
    queuePath,
  });
  assert.equal(second.eventsAggregated, 0);
  assert.equal(second.bucketsQueued, 0);

  const resetCursors = { hourly: JSON.parse(JSON.stringify(cursors.hourly)) };
  const third = await parseCodexLocalWorkIncremental({
    eventsPath,
    cursors: resetCursors,
    queuePath,
  });
  assert.equal(third.eventsAggregated, 0);
  assert.equal(third.bucketsQueued, 0);
  const bucket = Object.values(resetCursors.hourly.buckets)
    .find((value) => value.totals.total_tokens === usageCounters(LAST).total * 2);
  assert.ok(bucket);
  assert.equal(bucket.totals.total_tokens, usageCounters(LAST).total * 2);
});

test("local Work event ledger restores its contribution after a full cursor rebuild", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-codex-local-work-rebuild-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const eventsPath = path.join(dir, "codex-local-work.events.jsonl");
  const queuePath = path.join(dir, "queue.jsonl");
  fs.writeFileSync(eventsPath, `${JSON.stringify({
    kind: EVENT_NAME,
    eventId: "event-1",
    observedAt: "2026-11-27T01:01:00.000Z",
    threadId: "thread-1",
    turnId: "turn-1",
    model: "gpt-test",
    conversationCount: 1,
    usage: usageCounters(LAST),
  })}\n`);
  const first = await parseCodexLocalWorkIncremental({ eventsPath, cursors: {}, queuePath });
  assert.equal(first.eventsAggregated, 1);

  const rebuilt = {};
  const second = await parseCodexLocalWorkIncremental({ eventsPath, cursors: rebuilt, queuePath });
  assert.equal(second.eventsAggregated, 0);
  assert.equal(second.bucketsQueued, 1);
  const queued = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(queued.at(-1).total_tokens, usageCounters(LAST).total);
  assert.equal(Object.values(rebuilt.hourly.buckets)[0].totals.total_tokens, usageCounters(LAST).total);
});

test("local Work event ledger ignores duplicate event ids replayed from byte zero", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-codex-local-work-duplicate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const eventsPath = path.join(dir, "codex-local-work.events.jsonl");
  const checkpointPath = path.join(dir, "codex-local-work.events.checkpoint.json");
  const queuePath = path.join(dir, "queue.jsonl");
  const row = {
    kind: EVENT_NAME,
    eventId: "event-duplicate",
    observedAt: "2026-11-27T01:01:00.000Z",
    threadId: "thread-1",
    turnId: "turn-1",
    model: "gpt-test",
    conversationCount: 1,
    usage: usageCounters(LAST),
  };
  fs.writeFileSync(eventsPath, `${JSON.stringify(row)}\n${JSON.stringify(row)}\n`);
  const cursors = {};
  const first = await parseCodexLocalWorkIncremental({ eventsPath, cursors, queuePath });
  assert.equal(first.eventsAggregated, 1);
  fs.rmSync(checkpointPath);
  const second = await parseCodexLocalWorkIncremental({
    eventsPath,
    cursors: { hourly: JSON.parse(JSON.stringify(cursors.hourly)) },
    queuePath,
  });
  assert.equal(second.eventsAggregated, 1);
  assert.equal(Object.values(cursors.hourly.buckets)[0].totals.total_tokens, usageCounters(LAST).total);
});

test("local Work event ledger leaves an incomplete tail for the next sync", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-codex-local-work-partial-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const eventsPath = path.join(dir, "codex-local-work.events.jsonl");
  const queuePath = path.join(dir, "queue.jsonl");
  const first = {
    kind: EVENT_NAME,
    eventId: "event-1",
    observedAt: "2026-11-27T01:01:00.000Z",
    threadId: "thread-1",
    turnId: "turn-1",
    model: "gpt-test",
    conversationCount: 1,
    usage: usageCounters(LAST),
  };
  const second = {
    ...first,
    eventId: "event-2",
    observedAt: "2026-11-27T01:02:00.000Z",
    conversationCount: 0,
  };
  const secondText = JSON.stringify(second);
  fs.writeFileSync(eventsPath, `${JSON.stringify(first)}\n${secondText.slice(0, 20)}`);
  const cursors = {};
  const initial = await parseCodexLocalWorkIncremental({ eventsPath, cursors, queuePath });
  assert.equal(initial.eventsAggregated, 1);
  fs.appendFileSync(eventsPath, `${secondText.slice(20)}\n`);
  const resumed = await parseCodexLocalWorkIncremental({ eventsPath, cursors, queuePath });
  assert.equal(resumed.eventsAggregated, 1);
  const bucket = Object.values(cursors.hourly.buckets)[0];
  assert.equal(bucket.totals.total_tokens, usageCounters(LAST).total * 2);
  assert.equal(bucket.totals.conversation_count, 1);
});

test("the persistent watcher discovers a running local Work thread and records its next delta", async (t) => {
  const trackerDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-codex-local-work-watch-"));
  t.after(() => fs.rmSync(trackerDir, { recursive: true, force: true }));
  const thread = {
    id: "watched-thread",
    name: "Web-started local task",
    model: "gpt-test",
    path: null,
    originator: "codex_work_web",
    threadSource: "user",
    status: { type: "active" },
    environments: [{ environmentId: "executor-local", cwd: "C:\\work\\project" }],
  };
  class Socket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      this.sent = [];
    }
    addEventListener(name, fn) { this.on(name, fn); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; }
  }
  const socket = new Socket();
  const watcher = createCodexLocalWorkWatcher({
    trackerDir,
    pollMs: 60_000,
    makeSocket: () => ({ socket, destroy: () => {} }),
    findExecutorIds: async () => new Set(["executor-local"]),
    authReader: () => ({ accessToken: "fixture", accountId: "account", accountKey: "account-key" }),
  });
  t.after(() => watcher.stop());
  watcher.start();
  await new Promise((resolve) => setImmediate(resolve));
  socket.readyState = 1;
  socket.emit("open");
  await new Promise((resolve) => setImmediate(resolve));

  const initialize = socket.sent.find((message) => message.method === "initialize");
  assert.ok(initialize);
  socket.emit("message", {
    data: JSON.stringify({ id: initialize.id, result: {} }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const list = socket.sent.find((message) => message.method === "thread/list");
  assert.ok(list);
  assert.deepEqual(list.params.originators, ["codex_work_cca", "codex_work_web"]);
  socket.emit("message", {
    data: JSON.stringify({ id: list.id, result: { data: [thread], nextCursor: null } }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  const resume = socket.sent.find((message) => message.method === "thread/resume");
  assert.ok(resume);
  socket.emit("message", {
    data: JSON.stringify({ id: resume.id, result: {} }),
  });
  await new Promise((resolve) => setImmediate(resolve));

  const notify = (total) => socket.emit("message", {
    data: JSON.stringify({
      method: "thread/tokenUsage/updated",
      params: { threadId: thread.id, turnId: "turn-1", tokenUsage: { last: LAST, total } },
    }),
  });
  notify(TOTAL);
  await new Promise((resolve) => setImmediate(resolve));
  notify({ ...TOTAL, inputTokens: TOTAL.inputTokens + LAST.inputTokens,
    outputTokens: TOTAL.outputTokens + LAST.outputTokens,
    totalTokens: TOTAL.totalTokens + LAST.totalTokens });

  const eventsPath = watcher.paths.events;
  for (let attempt = 0; attempt < 20 && !fs.existsSync(eventsPath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const rows = fs.existsSync(eventsPath)
    ? fs.readFileSync(eventsPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, EVENT_NAME);
  // Thread.model is current configuration, not per-turn execution telemetry.
  assert.equal(rows[0].model, "unknown");
  assert.equal(rows[0].usage.total, LAST.totalTokens);
});
