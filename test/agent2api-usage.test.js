"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { parseAgent2ApiIncremental } = require("../src/lib/rollout.js");

// The gateway's requests table is append-only with inclusive prompt tokens:
// total_tokens === prompt_tokens + completion_tokens and cache_read_tokens is
// a subset of prompt_tokens. The parser must split fresh input out of the
// prompt (the usage queue sums disjoint components) and count only HTTP 200
// rows, acknowledging failures so the cursor keeps moving.

function writeFixtureDb(dbPath, rows) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE requests (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, "
      + "client_model TEXT, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, "
      + "total_tokens INTEGER, cache_read_tokens INTEGER, status INTEGER)",
  );
  for (const row of rows) db.prepare("INSERT INTO requests (ts, client_model, model, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(...row);
  db.close();
}

function readQueueRows(queuePath) {
  const raw = fs.readFileSync(queuePath, "utf8").trim();
  return raw ? raw.split(/\n/).map((line) => JSON.parse(line)) : [];
}

test("agent2api parser splits inclusive prompt tokens into disjoint queue totals", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-agent2api-"));
  const dbPath = path.join(dir, "agent2api.db");
  const queuePath = path.join(dir, "queue.jsonl");
  const base = Date.UTC(2026, 9, 13, 9, 5, 0);
  writeFixtureDb(dbPath, [
    // prompt 150000 with cache_read 140000 → fresh input 10000; total 150300.
    [base, "glm-5.3-flash", "glm-5.3-flash", 150000, 300, 150300, 140000, 200],
    // failed attempts carry no billed usage and must not aggregate.
    [base + 60_000, "glm-5.3-flash", "glm-5.3-flash", 0, 0, 0, 0, 500],
    [base + 120_000, "glm-5.3-flash", "glm-5.3-flash", 0, 0, 0, 0, 408],
    // a second success inside the same half-hour bucket.
    [base + 180_000, "glm-5.3-flash", "glm-5.3-flash", 20_000, 1_000, 21_000, 15_000, 200],
  ]);

  const cursors = {};
  const first = await parseAgent2ApiIncremental({ cursors, queuePath, dbPath, env: {} });
  assert.equal(first.recordsProcessed, 4);
  assert.equal(first.eventsAggregated, 2);
  assert.equal(first.bucketsQueued, 1);

  const rows = readQueueRows(queuePath);
  assert.equal(rows.length, 1);
  const [row] = rows;
  assert.equal(row.source, "agent2api");
  assert.equal(row.model, "glm-5.3-flash");
  assert.equal(row.hour_start, "2026-10-13T09:00:00.000Z");
  assert.equal(row.input_tokens, 10000 + 5000);
  assert.equal(row.cached_input_tokens, 140000 + 15000);
  assert.equal(row.output_tokens, 300 + 1000);
  assert.equal(row.total_tokens, 150300 + 21000);
  assert.equal(row.total_tokens, row.input_tokens + row.cached_input_tokens + row.output_tokens);
  assert.equal(row.conversation_count, 2);

  assert.equal(cursors.agent2api.version, 1);
  assert.equal(cursors.agent2api.lastRowId, 4);

  // A rescan without a db change must not re-aggregate (fingerprint gate).
  const second = await parseAgent2ApiIncremental({ cursors, queuePath, dbPath, env: {} });
  assert.equal(second.recordsProcessed, 0);
  assert.equal(readQueueRows(queuePath).length, 1);

  // New rows beyond the cursor are picked up incrementally, and a failure row
  // past the cursor is acknowledged without aggregating.
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.prepare("INSERT INTO requests (ts, client_model, model, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    base + 240_000, "glm-5.3-flash", "glm-5.3-flash", 1_000, 100, 1_100, 900, 200);
  db.close();
  const third = await parseAgent2ApiIncremental({ cursors, queuePath, dbPath, env: {} });
  assert.equal(third.eventsAggregated, 1);
  const grown = readQueueRows(queuePath);
  assert.equal(grown.length, 2);
  // Queue rows are full bucket snapshots: the re-emitted bucket carries the
  // updated total (171,300 + 1,100) and the server's per-bucket upsert makes
  // the latest row win.
  assert.equal(grown[1].total_tokens, 172_400);
  assert.equal(cursors.agent2api.lastRowId, 5);

  fs.rmSync(dir, { recursive: true, force: true });
});

test("agent2api parser tolerates a missing database", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-agent2api-missing-"));
  const cursors = {};
  const out = await parseAgent2ApiIncremental({
    cursors,
    queuePath: path.join(dir, "queue.jsonl"),
    dbPath: path.join(dir, "absent.db"),
    env: {},
  });
  assert.equal(out.recordsProcessed, 0);
  assert.equal(cursors.agent2api.lastRowId, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
