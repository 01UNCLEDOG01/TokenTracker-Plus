"use strict";

// Compaction must be semantics-preserving: the compacted queue folds through
// the SAME reader hooks (local-api readQueueData) into the exact same rows.
// Fixture covers the tricky folds: identical re-appends, zero-token rows
// arriving after real ones (resolveQueueRow keeps the non-empty row), the
// antigravity retraction pair, malformed lines, and upload-side control rows.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, afterEach } = require("node:test");

const { compactUsageQueue, TOKEN_SUM_FIELDS } = require("../scripts/compact-usage-queue.cjs");
const { readQueueData } = require("../src/lib/local-api");

const originalHome = process.env.TOKENTRACKER_HOME;
const dirs = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.TOKENTRACKER_HOME;
  else process.env.TOKENTRACKER_HOME = originalHome;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const row = (over = {}) => JSON.stringify({
  source: "codex", model: "gpt-5.6-sol", hour_start: "2026-11-10T10:00:00.000Z",
  input_tokens: 10, cached_input_tokens: 0, cache_creation_input_tokens: 0,
  output_tokens: 5, reasoning_output_tokens: 0, total_tokens: 15,
  billable_total_tokens: 15, total_cost_usd: 0, conversation_count: 1,
  ...over,
});

test("compaction folds duplicates, keeps reader semantics and control rows, and is self-verifying", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-"));
  dirs.push(home);
  process.env.TOKENTRACKER_HOME = home;
  const tracker = path.join(home, "tracker");
  fs.mkdirSync(tracker, { recursive: true });
  const queuePath = path.join(tracker, "queue.jsonl");
  const statePath = path.join(tracker, "queue.state.json");

  const lines = [
    // Same bucket re-appended byte-identically (restart replay).
    row(), row(), row(),
    // A zero-token row after a real one: resolveQueueRow keeps the non-empty row.
    row({ total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, conversation_count: 0 }),
    // Antigravity retraction: usage_retracted zero row supersedes the real one.
    JSON.stringify({ source: "antigravity", model: "gemini-3.8-flash-n", hour_start: "2026-11-10T11:00:00.000Z", input_tokens: 100, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 50, reasoning_output_tokens: 0, total_tokens: 150, billable_total_tokens: 150, total_cost_usd: 0, conversation_count: 2 }),
    JSON.stringify({ source: "antigravity", model: "gemini-3.8-flash-n", hour_start: "2026-11-10T11:00:00.000Z", input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, conversation_count: 0, usage_retracted: true }),
    // A different bucket that only exists once.
    row({ hour_start: "2026-11-10T12:00:00.000Z" }),
    // Upload-side control rows: the newer stamp must survive, the older one drop.
    JSON.stringify({ kind: "account_session_state", source: "trae-cn", session_id: "s1", model: "composer-1", snapshot_verified_at: "2026-11-10T09:00:00.000Z", bucket_start: "2026-11-10T09:00:00.000Z", total_tokens: 10, input_tokens: 10, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 }),
    JSON.stringify({ kind: "account_session_state", source: "trae-cn", session_id: "s1", model: "composer-1", snapshot_verified_at: "2026-11-10T10:00:00.000Z", bucket_start: "2026-11-10T09:00:00.000Z", total_tokens: 20, input_tokens: 20, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0 }),
    // Malformed line is dropped by the reader; compaction may drop it too.
    "{broken",
  ];
  fs.writeFileSync(queuePath, lines.join("\n") + "\n");
  fs.writeFileSync(statePath, JSON.stringify({ offset: 500, updatedAt: "2026-11-10T00:00:00.000Z" }));

  const rowsBefore = await readQueueData(queuePath);
  assert.equal(rowsBefore.length, 3, "reader folds fixture to 3 rows: codex main, antigravity retracted, codex second hour");

  const logs = [];
  const result = await compactUsageQueue({
    queuePath,
    statePath,
    log: (line) => logs.push(line),
    holdLock: async () => {},
  });

  assert.equal(result.rowsBefore, 3);
  assert.equal(result.rowsRecheck, 3, "post-swap reader fold identical");

  const rowsAfter = await readQueueData(queuePath);
  assert.equal(JSON.stringify(rowsAfter), JSON.stringify(rowsBefore), "rows byte-equivalent after compaction");

  // Fold semantics survived: codex is last-write-wins (the zero row came
  // later and codex is not in the estimate-protection set).
  const mainRow = rowsAfter.find((r) => r.hour_start === "2026-11-10T10:00:00.000Z");
  assert.equal(Number(mainRow.total_tokens), 0, "codex is last-write-wins (no estimate protection)");
  const antRow = rowsAfter.find((r) => r.hour_start === "2026-11-10T11:00:00.000Z");
  assert.equal(Number(antRow.total_tokens), 0, "explicit retraction supersedes");

  // Estimate-protected sources keep their non-zero row when a zero follows.
  const rowsCursor = await (async () => {
    const extra = path.join(home, "tracker-cursor-check.jsonl");
    fs.writeFileSync(extra, [
      JSON.stringify({ source: "cursor", model: "composer-1", hour_start: "2026-11-10T13:00:00.000Z", input_tokens: 7, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 0, total_tokens: 10, billable_total_tokens: 10, total_cost_usd: 0, conversation_count: 1 }),
      JSON.stringify({ source: "cursor", model: "composer-1", hour_start: "2026-11-10T13:00:00.000Z", input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, conversation_count: 0 }),
    ].join("\n") + "\n");
    return readQueueData(extra);
  })();
  const cursorRow = rowsCursor.find((r) => r.hour_start === "2026-11-10T13:00:00.000Z");
  assert.equal(Number(cursorRow.total_tokens), 10, "estimate sources keep the non-zero row (protection set)");

  // Control rows survive with the NEWER stamp only.
  const text = fs.readFileSync(queuePath, "utf8");
  const kindLines = text.split("\n").filter((line) => line.includes("account_session_state"));
  assert.equal(kindLines.length, 1, "older control row dropped, newer kept");
  assert.ok(kindLines[0].includes("2026-11-10T10:00:00.000Z"), "kept the newer verified stamp");

  // Malformed line is gone; token sums conserved.
  assert.ok(!text.includes("{broken"));
  for (const field of TOKEN_SUM_FIELDS) {
    const before = rowsBefore.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
    const after = rowsAfter.reduce((acc, r) => acc + (Number(r[field]) || 0), 0);
    assert.equal(after, before, `${field} conserved`);
  }

  // Backup + cursor reset happened.
  assert.ok(fs.existsSync(`${queuePath}.bak-20261111-compact`), "backup created");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(state.offset, 0, "upload cursor reset for a full idempotent replay");
  assert.ok(!fs.existsSync(`${queuePath}.snapshot.json`), "reader snapshot cache invalidated");
  assert.ok(logs.some((line) => line.includes("verification passed")));
});

test("compaction refuses an unreadable/empty queue without touching it", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-bad-"));
  dirs.push(home);
  process.env.TOKENTRACKER_HOME = home;
  const tracker = path.join(home, "tracker");
  fs.mkdirSync(tracker, { recursive: true });
  const queuePath = path.join(tracker, "queue.jsonl");
  fs.writeFileSync(queuePath, "{broken\n{also broken\n");
  const before = fs.readFileSync(queuePath, "utf8");

  await assert.rejects(
    () => compactUsageQueue({ queuePath, statePath: path.join(tracker, "queue.state.json") }),
    /no rows/,
  );
  assert.equal(fs.readFileSync(queuePath, "utf8"), before, "original untouched on refusal");
});

test("a second run reuses the existing backup instead of overwriting it", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-compact-twice-"));
  dirs.push(home);
  process.env.TOKENTRACKER_HOME = home;
  const tracker = path.join(home, "tracker");
  fs.mkdirSync(tracker, { recursive: true });
  const queuePath = path.join(tracker, "queue.jsonl");
  const statePath = path.join(tracker, "queue.state.json");
  fs.writeFileSync(queuePath, row() + "\n" + row() + "\n");
  fs.writeFileSync(statePath, JSON.stringify({ offset: 0 }));

  await compactUsageQueue({ queuePath, statePath });
  const backup = `${queuePath}.bak-20261111-compact`;
  const firstBackup = fs.readFileSync(backup, "utf8");
  await compactUsageQueue({ queuePath, statePath });
  assert.equal(fs.readFileSync(backup, "utf8"), firstBackup, "backup not overwritten on rerun");
});
