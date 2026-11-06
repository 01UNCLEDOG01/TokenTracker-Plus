/**
 * Trae (international) per-request ledger test.
 *
 * The desktop app's `server_history_info` records every model call; the legacy
 * chat_turn parser only saw the last call of a turn. These stores are small,
 * so the ledger is re-derived on every change and deduplicated by history_id.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { parseTraeRequestsIncremental } = require("../src/lib/trae-requests");

const T0 = Math.floor(Date.UTC(2026, 10, 6, 10) / 1000);
const HOUR = `${new Date(T0 * 1000).toISOString().slice(0, 13)}:00:00.000Z`;

function requestRow(historyId, { total = 1000, item = 20, model = "deepseek-v4.1-flash", offset = 0, exact = null } = {}) {
  return {
    history_id: historyId,
    session_id: "sess-1",
    created_at: T0 + offset,
    updated_at: T0 + offset,
    total,
    item,
    extra: exact === null
      ? { config_name: model }
      : { config_name: model, ...exact },
  };
}

async function store(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-trae-requests-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, "database.db");
  fs.writeFileSync(dbPath, "store");
  return { dir, dbPath, queuePath: path.join(dir, "queue.jsonl"), cursors: {} };
}

function readRows(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

function latest(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), row);
  return map;
}

test("TRAE request rows book every call with the exact cache split", async (t) => {
  const f = await store(t);
  const rows = [
    requestRow("h1", { total: 5000, item: 200, exact: { exact_prompt_tokens_v1: 4800, exact_output_tokens_v1: 200, exact_cache_read_input_tokens_v1: 4600, exact_reasoning_tokens_v1: 50 } }),
    requestRow("h2", { total: 1000, item: 40, exact: { exact_prompt_tokens_v1: 900, exact_output_tokens_v1: 100, exact_cache_read_input_tokens_v1: 0 } }),
    requestRow("h3", { total: 500, item: 30, model: "kimi-k2.7-code", offset: 60 }),
  ];
  const res = await parseTraeCnStub(f, rows);
  assert.equal(res.supported, true);
  assert.equal(res.recordsProcessed, 3);
  assert.equal(res.eventsAggregated, 3);

  const hourly = latest(readRows(f.queuePath).filter((r) => r.source === "trae"), (r) => `${r.model}|${r.hour_start}`);
  const split = hourly.get("deepseek-v4.1-flash|" + HOUR);
  assert.equal(split.total_tokens, 6000, "two calls merge in one bucket");
  assert.equal(split.cached_input_tokens, 4600);
  assert.equal(split.input_tokens, 1100, "fresh prompt = (4800-4600) + (900-0)");
  assert.equal(split.output_tokens, 250, "output excludes the reasoning subset");
  assert.equal(split.reasoning_output_tokens, 50);
  assert.equal(split.conversation_count, 2);
  assert.equal(hourly.get("kimi-k2.7-code|" + HOUR).total_tokens, 500);
  assert.equal(f.cursors.traeRequests.version, 1);
  assert.equal(f.cursors.trae, undefined, "the per-turn ledger is retired");
});

function parseTraeCnStub(f, rows) {
  return parseTraeRequestsIncremental({
    dbPaths: [f.dbPath],
    cursors: f.cursors,
    queuePath: f.queuePath,
    readStoreRows: async () => rows,
  });
}

test("TRAE unchanged stores are skipped; a grow re-derives the ledger once", async (t) => {
  const f = await store(t);
  const rows = [requestRow("h1", { total: 1000, item: 20 })];
  await parseTraeCnStub(f, rows);
  assert.equal(f.cursors.traeRequests.stores[path.resolve(f.dbPath)].fingerprint.main.length > 0, true);

  const before = fs.readFileSync(f.queuePath, "utf8");
  const skipped = await parseTraeCnStub(f, rows);
  assert.equal(skipped.skipped, true);
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), before);

  rows.push(requestRow("h2", { total: 500, item: 10 }));
  fs.appendFileSync(f.dbPath, "x");
  const grown = await parseTraeCnStub(f, rows);
  assert.equal(grown.recordsProcessed, 2, "a changed store re-derives the full ledger");
  const hourly = latest(readRows(f.queuePath).filter((r) => r.source === "trae"), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(hourly.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 1500);
});

test("TRAE rebuild zeroes stale buckets instead of stacking", async (t) => {
  const f = await store(t);
  f.cursors.hourly = {
    version: 1,
    buckets: {
      [`trae|old-model|${HOUR}`]: { totals: { input_tokens: 300, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 300, billable_total_tokens: 300, total_cost_usd: 0, conversation_count: 1 } },
    },
    groupQueued: {},
  };
  f.cursors.trae = { version: 3, turns: {} };
  const rows = [requestRow("h1", { total: 1000, item: 20 })];
  await parseTraeCnStub(f, rows);
  const hourly = latest(readRows(f.queuePath).filter((r) => r.source === "trae"), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(hourly.get("old-model|" + HOUR).total_tokens, 0, "retired per-turn bucket is zeroed");
  assert.equal(hourly.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 1000);
  assert.equal(f.cursors.trae, undefined);
});

test("TRAE stores without the request table report unsupported for fallback", async (t) => {
  const f = await store(t);
  const res = await parseTraeRequestsIncremental({
    dbPaths: [f.dbPath],
    cursors: f.cursors,
    queuePath: f.queuePath,
    readStoreRows: async () => null,
  });
  assert.equal(res.supported, false);
  assert.equal(fs.existsSync(f.queuePath), false);
});

test("TRAE keeps the prior ledger when a store read fails", async (t) => {
  const f = await store(t);
  await parseTraeCnStub(f, [requestRow("h1", { total: 1000, item: 20 })]);
  const cursorsBefore = structuredClone(f.cursors);
  const queueBefore = fs.readFileSync(f.queuePath, "utf8");
  fs.appendFileSync(f.dbPath, "y");
  const res = await parseTraeRequestsIncremental({
    dbPaths: [f.dbPath],
    cursors: f.cursors,
    queuePath: f.queuePath,
    readStoreRows: async () => { throw new Error("database changed during the read"); },
  });
  assert.equal(res.supported, true);
  assert.match(res.error, /database changed/);
  assert.deepEqual(f.cursors, cursorsBefore, "cursor state stays retryable");
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), queueBefore, "queue unchanged on failure");
});

test("TRAE request rows dedupe copies across stores by history_id", async (t) => {
  const f = await store(t);
  const second = path.join(f.dir, "second.db");
  fs.writeFileSync(second, "store2");
  fs.appendFileSync(f.dbPath, "z");
  const rowsA = [requestRow("shared", { total: 1000, item: 20, offset: 0 })];
  const rowsB = [requestRow("shared", { total: 1000, item: 20, offset: 0 }), requestRow("only-b", { total: 200, item: 5, offset: 0 })];
  const res = await parseTraeRequestsIncremental({
    dbPaths: [f.dbPath, second],
    cursors: f.cursors,
    queuePath: f.queuePath,
    readStoreRows: async (dbPath) => (dbPath === second ? rowsB : rowsA),
  });
  assert.equal(res.recordsProcessed, 3);
  const hourly = latest(readRows(f.queuePath).filter((r) => r.source === "trae"), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(hourly.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 1200, "the shared call is counted once");
});

test("TRAE timestamp buckets floor to the half-hour and tolerate ms values", async (t) => {
  const f = await store(t);
  const rows = [
    requestRow("h1", { total: 1000, item: 20, offset: 0 }),
    { ...requestRow("h2", { total: 1000, item: 20 }), created_at: (T0 + 1800) * 1000 },
  ];
  await parseTraeCnStub(f, rows);
  const hourly = latest(readRows(f.queuePath).filter((r) => r.source === "trae"), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(hourly.size, 2, "the second call lands in the next half-hour");
});
