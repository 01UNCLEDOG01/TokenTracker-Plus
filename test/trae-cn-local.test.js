/**
 * TRAE CN merged-app local database parser test.
 *
 * The unified Trae CN IDE keeps its turns in a SQLCipher store that the SOLO
 * CN cloud bill never covers (zero session-id overlap, verified on the real
 * store). parseTraeCnLocalIncremental consumes projected rows (the caller owns
 * the decrypt) and feeds both the hourly queue and the project queue. This
 * suite verifies, with the reader injected:
 *   - hourly rows land under source "trae-cn" with half-hour buckets
 *   - project attribution joins absolute_path → a real git checkout
 *   - the rowid watermark advances and a re-run adds nothing
 *   - rows without a resolvable project are counted hourly but stay out of
 *     the project queue
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { parseTraeCnLocalIncremental } = require("../src/lib/rollout");

const T0 = Math.floor(Date.UTC(2026, 9, 18, 10) / 1000); // seconds, like the store

function row(id, { model = "doubao-seed-1.6", path: absolutePath = null, prompt = 100, completion = 50, session = "sess-1" } = {}) {
  return {
    id: String(id),
    session_id: session,
    created_at: T0 + id * 60,
    updated_at: T0 + id * 60,
    model,
    usage: { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion },
    project_id: absolutePath ? "proj-1" : null,
    absolute_path: absolutePath,
  };
}

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-trae-cn-local-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "proj");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "config"),
    '[remote "origin"]\n\turl = https://github.com/example/trae-cn-project.git\n',
  );
  const dbPath = path.join(dir, "database.db");
  fs.writeFileSync(dbPath, "");
  return {
    dir,
    project,
    dbPath,
    cursors: {},
    queuePath: path.join(dir, "queue.jsonl"),
    projectQueuePath: path.join(dir, "project.queue.jsonl"),
    publicRepoResolver: async ({ projectRef }) => ({
      status: "public_verified",
      projectKey: "example/trae-cn-project",
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

test("TRAE CN local rows feed hourly and project queues with a rowid watermark", async (t) => {
  const f = await fixture(t);
  const rows = [
    row(34, { path: f.project }),
    row(35, { path: f.project }),
    row(36, { path: null }), // no project directory — hourly only
  ];
  let calls = 0;
  const readRowsImpl = async (dbPath, { lastId }) => {
    calls += 1;
    return rows.filter((r) => Number(r.id) > lastId);
  };
  const args = {
    dbPath: f.dbPath,
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
    readRowsImpl,
  };

  const res1 = await parseTraeCnLocalIncremental(args);
  assert.equal(res1.recordsProcessed, 3);
  assert.equal(res1.eventsAggregated, 3);
  assert.equal(res1.projectBucketsQueued, 1, "both turns share one project half-hour bucket");
  assert.equal(f.cursors.traeCnLocal.lastId, 36, "watermark advanced to the max rowid");

  const hourly = readRows(f.queuePath).filter((r) => r.source === "trae-cn");
  assert.equal(hourly.length, 1, "all three turns land in the same half-hour bucket");
  assert.equal(hourly[0].total_tokens, 450);

  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "trae-cn");
  assert.equal(projectRows.length, 1);
  assert.equal(projectRows[0].project_key, "example/trae-cn-project");
  assert.equal(projectRows[0].total_tokens, 300, "only the two attributable turns");
});

test("TRAE CN local feed skips unchanged stores and ingests only new rows", async (t) => {
  const f = await fixture(t);
  const rows = [row(34, { path: f.project }), row(35, { path: f.project })];
  let lastId = 0;
  const readRowsImpl = async (dbPath, { lastId: watermark }) => {
    lastId = watermark;
    return rows.filter((r) => Number(r.id) > watermark);
  };
  const args = {
    dbPath: f.dbPath,
    cursors: f.cursors,
    queuePath: f.queuePath,
    projectQueuePath: f.projectQueuePath,
    publicRepoResolver: f.publicRepoResolver,
    readRowsImpl,
  };

  await parseTraeCnLocalIncremental(args);
  assert.equal(lastId, 0, "first read starts from zero");

  // Same file signature + watermark consumed: the GB-scale decrypt is skipped.
  const res2 = await parseTraeCnLocalIncremental(args);
  assert.equal(res2.recordsProcessed, 0);

  // Store grows: only the new row is read (the reader filters by watermark).
  // Appending changes the file signature, so the signature gate re-opens it.
  rows.push(row(36, { path: f.project, prompt: 10, completion: 5 }));
  fs.appendFileSync(f.dbPath, "x");
  const res3 = await parseTraeCnLocalIncremental(args);
  assert.equal(res3.recordsProcessed, 1);
  assert.equal(res3.projectBucketsQueued, 1);
  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "trae-cn");
  assert.equal(projectRows.length, 2, "new half-hour bucket appended");
  assert.equal(f.cursors.traeCnLocal.lastId, 36);
});
