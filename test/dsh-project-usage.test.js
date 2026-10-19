/**
 * DeepSeek Harness project-attribution test.
 *
 * The DSH session record stamps the launch cwd; parseDshIncremental resolves
 * it to a project scope and mirrors the same deltas into the project queue.
 * This suite verifies, against a tempdir fixture with a real git checkout:
 *   - one-time backfill: an install that predates the project pass attributes
 *     the whole stored contribution on the first project-enabled sync, without
 *     double-counting the hourly queue
 *   - idempotency: a third run adds nothing
 *   - growth: an appended delta lands in both queues, project delta only
 *   - replacement: adopting a new artifact path subtracts the old project
 *     scope before the new contribution is added
 *
 * No real harness install is required; the public-repo resolver is mocked.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");

const { parseDshIncremental } = require("../src/lib/rollout");

const T0 = new Date("2026-05-01T12:00:00Z").getTime();

function headerLine(id, cwd) {
  return JSON.stringify({
    type: "session",
    version: 0,
    id,
    createdAt: T0,
    cwd,
  });
}

function requestHeaderLine(seq, model = "deepseek-v4-pro") {
  return JSON.stringify({
    type: "request/header",
    seq,
    time: T0,
    data: { header: { config: { provider: "deepseek-official", model } } },
  });
}

function assistantLine(seq, usage, { time = T0 } = {}) {
  return JSON.stringify({
    type: "assistant/message",
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { role: "assistant", content: [], source: { model: "deepseek-v4-pro" }, id: `m-${seq}` },
      usage,
    },
  });
}

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-dsh-project-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // A real git checkout: the project resolver reads origin from .git/config.
  const project = path.join(dir, "proj");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "config"),
    '[remote "origin"]\n\turl = https://github.com/example/dsh-project.git\n',
  );
  const sessionDir = path.join(dir, ".dsh", "sessions", "--proj--", "sess-1");
  fs.mkdirSync(sessionDir, { recursive: true });
  const logPath = path.join(sessionDir, "session.jsonl");
  return {
    dir,
    project,
    logPath,
    cursors: {},
    queuePath: path.join(dir, "queue.jsonl"),
    projectQueuePath: path.join(dir, "project.queue.jsonl"),
    publicRepoResolver: async ({ projectRef }) => ({
      status: "public_verified",
      projectKey: "example/dsh-project",
      projectRef,
    }),
  };
}

function readRows(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("DSH project backfill attributes stored history without double-counting hourly", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(
    f.logPath,
    [
      headerLine("sess-1", f.project),
      requestHeaderLine(0),
      assistantLine(1, { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheWriteTokens: 5, reasoningTokens: 7 }),
      "",
    ].join("\n"),
  );

  // Pass 1 mirrors an install that predates the project pass: hourly only.
  const res1 = await parseDshIncremental({
    sessionFiles: [f.logPath],
    cursors: f.cursors,
    queuePath: f.queuePath,
  });
  assert.equal(res1.eventsAggregated, 1);
  assert.equal(fs.existsSync(f.projectQueuePath), false, "no project queue without the pass");
  const hourlyRows1 = readRows(f.queuePath).filter((r) => r.source === "dsh");
  assert.equal(hourlyRows1.length, 1);
  const hourlyTotal = hourlyRows1[0].total_tokens;

  // Pass 2 turns the project pass on: the unchanged file is force-scanned once
  // and its whole stored contribution lands in the project queue, while the
  // hourly queue gains nothing.
  const res2 = await parseDshIncremental({
    sessionFiles: [f.logPath],
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
  });
  assert.equal(res2.eventsAggregated, 0, "no hourly delta on backfill");
  assert.equal(res2.projectBucketsQueued, 1, "the stored contribution is attributed");
  const hourlyRows2 = readRows(f.queuePath).filter((r) => r.source === "dsh");
  assert.equal(hourlyRows2.length, hourlyRows1.length, "hourly queue unchanged");
  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "dsh");
  assert.equal(projectRows.length, 1);
  assert.equal(projectRows[0].project_key, "example/dsh-project");
  assert.equal(projectRows[0].total_tokens, hourlyTotal, "backfilled total matches hourly");
});

test("DSH project pass is idempotent and attributes appended growth only", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(
    f.logPath,
    [
      headerLine("sess-1", f.project),
      requestHeaderLine(0),
      assistantLine(1, { inputTokens: 100, outputTokens: 50 }),
      "",
    ].join("\n"),
  );
  const args = {
    sessionFiles: [f.logPath],
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
  };
  await parseDshIncremental(args);
  await parseDshIncremental(args);
  const projectRowsAfterBackfill = readRows(f.projectQueuePath).length;

  // Third run: unchanged file, marker set, nothing new anywhere.
  const res3 = await parseDshIncremental(args);
  assert.equal(res3.eventsAggregated, 0);
  assert.equal(res3.projectBucketsQueued, 0);
  assert.equal(readRows(f.projectQueuePath).length, projectRowsAfterBackfill);

  // Append a second delta: hourly and project each gain exactly that delta.
  fs.appendFileSync(
    f.logPath,
    assistantLine(2, { inputTokens: 20, outputTokens: 5 }, { time: T0 + 40 * 60 * 1000 }) + "\n",
  );
  const res4 = await parseDshIncremental(args);
  assert.equal(res4.eventsAggregated, 1);
  const hourlyRows = readRows(f.queuePath).filter((r) => r.source === "dsh");
  assert.equal(hourlyRows.length, 2, "second half-hour bucket");
  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "dsh");
  assert.equal(projectRows.length, 2, "project queue mirrors the growth");
  const growth = projectRows.find((r) => r.total_tokens === 25);
  assert.ok(growth, "appended delta (20 input + 5 output) attributed");
});

test("DSH replacement subtracts the old project scope before re-adding", async (t) => {
  const f = await fixture(t);
  const sessionDirA = f.logPath;
  fs.writeFileSync(
    sessionDirA,
    [
      headerLine("sess-1", f.project),
      requestHeaderLine(0),
      assistantLine(1, { inputTokens: 100, outputTokens: 50 }),
      "",
    ].join("\n"),
  );
  const args = {
    sessionFiles: [sessionDirA],
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
  };
  await parseDshIncremental(args);
  const before = readRows(f.projectQueuePath).find((r) => r.source === "dsh");
  assert.equal(before.total_tokens, 150);

  // Harness replacement: a new artifact directory adopts the same session id.
  // The replacement must be a verifiable superset of the prior contribution
  // (the parser defers regressions), so it re-states the old delta and adds a
  // second one — the project total must land at exactly 175, not 325.
  const sessionDirB = path.join(path.dirname(path.dirname(sessionDirA)), "sess-1b", "session.jsonl");
  fs.mkdirSync(path.dirname(sessionDirB), { recursive: true });
  fs.writeFileSync(
    sessionDirB,
    [
      headerLine("sess-1", f.project),
      requestHeaderLine(0),
      assistantLine(1, { inputTokens: 100, outputTokens: 50 }),
      assistantLine(2, { inputTokens: 20, outputTokens: 5 }, { time: T0 + 40 * 60 * 1000 }),
      "",
    ].join("\n"),
  );
  const res2 = await parseDshIncremental({ ...args, sessionFiles: [sessionDirB] });
  assert.equal(res2.eventsAggregated, 2);
  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "dsh");
  assert.equal(projectRows.length, 2);
  const bucket1 = projectRows.find((r) => r.total_tokens === 150);
  const bucket2 = projectRows.find((r) => r.total_tokens === 25);
  assert.ok(bucket1 && bucket2, "replaced scope replaces (not adds) the old contribution");
  const hourlyRows = readRows(f.queuePath).filter((r) => r.source === "dsh");
  assert.equal(hourlyRows.length, projectRows.length, "hourly and project stay in lockstep");
});
