/**
 * TRAE CN merged-app request-log parser test.
 *
 * The unified Trae CN IDE records every LLM call in server_history_info
 * (token_usage = prompt + completion for that request). Its chat_turn rows only
 * carry the LAST call of a turn, which under-counted multi-call agent turns.
 * parseTraeCnLocalIncremental books per-request rows:
 *   - hourly rows land under source "trae-cn" with half-hour buckets;
 *   - project attribution joins extra_info.workspace_path → a git checkout;
 *   - a v2 (per-turn) ledger migrates by replacing, not stacking;
 *   - a periodic/forced full rescan reconciles late corrections;
 *   - cloud-only canonical sessions survive a full rebuild.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { parseTraeCnLocalIncremental } = require("../src/lib/rollout");

const T0 = Math.floor(Date.UTC(2026, 9, 18, 10) / 1000); // seconds, like the store
const HOUR = `${new Date(T0 * 1000).toISOString().slice(0, 13)}:00:00.000Z`;

function row(id, { model = "deepseek-v4.1-flash", absPath = null, total = 150, output = 50, session = "sess-1", offset = 0, exact = null } = {}) {
  return {
    id: String(id),
    session_id: session,
    created_at: T0 + offset,
    updated_at: T0 + offset,
    model,
    usage: exact === null ? { total, output } : { total, output, exact },
    absolute_path: absPath,
  };
}

function makeReader(rowsRef) {
  const read = async (_, { lastRowId = 0 }) => {
    const all = rowsRef();
    return {
      maxRowId: all.reduce((max, r) => Math.max(max, Number(r.id)), 0),
      rows: all.filter((r) => Number(r.id) > lastRowId),
    };
  };
  return read;
}

async function fixture(t) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-trae-cn-requests-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = path.join(dir, "proj");
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "config"),
    '[remote "origin"]\n\turl = https://github.com/example/trae-cn-project.git\n',
  );
  const dbPath = path.join(dir, "database.db");
  fs.writeFileSync(dbPath, "store");
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
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function latestByKey(rows, keyFn) {
  const map = new Map();
  for (const row of rows) map.set(keyFn(row), row);
  return map;
}

const traeHourly = (rows) => rows.filter((r) => r.source === "trae-cn" && !r.kind);
const bookedTotal = (cursors) => Object.entries(cursors.hourly?.buckets || {})
  .filter(([key]) => key.startsWith("trae-cn|"))
  .reduce((sum, [, bucket]) => sum + (bucket.totals.total_tokens || 0), 0);

function appendToStore(fixture) {
  fs.appendFileSync(fixture.dbPath, "x");
}

test("TRAE CN request rows feed hourly/project queues and advance the rowid watermark", async (t) => {
  const f = await fixture(t);
  const rows = [
    row(1, { absPath: f.project, total: 300, output: 20 }),
    row(2, { absPath: f.project, total: 500, output: 40, model: "kimi-k2.7-code" }),
    row(3, { absPath: null, total: 200, output: 10, session: "sess-2" }),
  ];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };

  const res = await parseTraeCnLocalIncremental(args);
  assert.equal(res.recordsProcessed, 3);
  assert.equal(res.eventsAggregated, 3);
  assert.equal(f.cursors.traeCnLocal.version, 5);
  assert.equal(f.cursors.traeCnLocal.lastRowId, 3);

  const hourly = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model.toLowerCase()}|${r.hour_start}`);
  assert.equal(hourly.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 500, "two calls merge in one bucket");
  assert.equal(hourly.get("deepseek-v4.1-flash|" + HOUR).input_tokens, 470, "prompt = total - output");
  assert.equal(hourly.get("kimi-k2.7-code|" + HOUR).total_tokens, 500);

  const projectRows = latestByKey(
    readRows(f.projectQueuePath).filter((r) => r.source === "trae-cn"),
    (r) => `${r.project_key}|${r.hour_start}`,
  );
  assert.equal(projectRows.size, 1, "both attributable calls share one project bucket");
  assert.equal([...projectRows.values()][0].total_tokens, 800, "project rows exclude the unattributed call");
});

test("TRAE CN unchanged store is skipped; a grow books only the new calls", async (t) => {
  const f = await fixture(t);
  const rows = [row(1, { total: 300, output: 20 })];
  let lastWatermark = null;
  const readRowsImpl = async (_, { lastRowId = 0 }) => {
    lastWatermark = lastRowId;
    const all = rows;
    return {
      maxRowId: all.reduce((max, r) => Math.max(max, Number(r.id)), 0),
      rows: all.filter((r) => Number(r.id) > lastRowId),
    };
  };
  const args = { ...f, readRowsImpl };

  await parseTraeCnLocalIncremental(args);
  assert.equal(lastWatermark, 0, "first read starts from zero");

  const before = fs.readFileSync(f.queuePath, "utf8");
  const skipped = await parseTraeCnLocalIncremental(args);
  assert.equal(skipped.recordsProcessed, 0, "identical signature skips the decrypt");
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), before);

  rows.push(row(2, { total: 200, output: 10 }));
  appendToStore(f);
  const grown = await parseTraeCnLocalIncremental(args);
  assert.equal(grown.recordsProcessed, 1, "only the new call is read");
  assert.equal(f.cursors.traeCnLocal.lastRowId, 2);
  const latest = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(latest.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 500, "new call adds to the bucket");
});

test("TRAE CN exact_* rows book the provider-raw split including cache read", async (t) => {
  const f = await fixture(t);
  const rows = [
    // Client-shaped row (values arrive as strings, like the real JSON):
    // prompt 262922 cache-inclusive, cache_read 261000, output 1194
    // reasoning-inclusive with a 998 reasoning subset; 262922 + 1194 = 264116.
    // exact arrives already coerced by the reader layer (numbers); the mocked
    // readRowsImpl here bypasses that layer, so the fixture feeds its output.
    row(1, {
      total: 264116,
      output: 203,
      exact: {
        prompt: 262922,
        output: 1194,
        cacheRead: 261000,
        reasoning: 998,
      },
    }),
    // A cache-less exact row under a different model, so the buckets stay
    // independent: prompt 5000 + output 500 = 5500, cache 0.
    row(2, { total: 5500, output: 10, model: "kimi-k2.7-code", session: "sess-2", exact: { prompt: 5000, output: 500, cacheRead: 0, reasoning: null } }),
  ];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  const res = await parseTraeCnLocalIncremental(args);
  assert.equal(res.recordsProcessed, 2);
  assert.equal(res.eventsAggregated, 2);

  const hourly = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model.toLowerCase()}|${r.hour_start}`);
  const split = hourly.get("deepseek-v4.1-flash|" + HOUR);
  assert.equal(split.cached_input_tokens, 261000, "cache read lands in its own column");
  assert.equal(split.cache_observed_input_tokens, 262922, "coverage signal sums the exact-carrying input side");
  assert.equal(split.input_tokens, 262922 - 261000, "fresh input = cache-inclusive prompt minus cache read");
  assert.equal(split.output_tokens, 1194, "exact output wins over the item_token_usage estimate");
  assert.equal(split.reasoning_output_tokens, 998, "reasoning subset is split out for display");
  assert.equal(split.total_tokens, 264116);

  const plain = traeHourly(readRows(f.queuePath)).find((r) => r.model.toLowerCase() === "kimi-k2.7-code");
  assert.equal(plain.cached_input_tokens, 0, "a zero-cache exact row books zero cache");
  assert.equal(plain.input_tokens, 5000);
  assert.equal(plain.output_tokens, 500);
  assert.equal(plain.reasoning_output_tokens, 0);
  assert.equal(plain.cache_observed_input_tokens, 5000, "the zero-cache exact row still reports its measured input side");
});

test("TRAE CN request reader rejects exact_* splits that fail the identity", async (t) => {
  const { extractRequestUsageFields } = require("../src/lib/trae-db");
  const T = 264116;
  // The happy path (values arrive as strings, like the real JSON).
  assert.deepEqual(extractRequestUsageFields(
    { exact_prompt_tokens_v1: "262922", exact_output_tokens_v1: "1194", exact_cache_read_input_tokens_v1: "261000", exact_reasoning_tokens_v1: "998" },
    T,
  ), { prompt: 262922, output: 1194, cacheRead: 261000, reasoning: 998 });
  // prompt + output != total: the split cannot be trusted — null sends the
  // row to the total-only estimate (input = total - item output, cache 0).
  assert.equal(extractRequestUsageFields(
    { exact_prompt_tokens_v1: "9999", exact_output_tokens_v1: "1194", exact_cache_read_input_tokens_v1: "8000", exact_reasoning_tokens_v1: "998" },
    T,
  ), null);
  // A cache-read larger than the cache-inclusive prompt is semantically
  // impossible and drops just that field.
  assert.deepEqual(extractRequestUsageFields(
    { exact_prompt_tokens_v1: "262922", exact_output_tokens_v1: "1194", exact_cache_read_input_tokens_v1: "999999" },
    T,
  ), { prompt: 262922, output: 1194, cacheRead: null, reasoning: null });
  // Negative or non-numeric values reject that field only (null), leaving a
  // valid output for the consumer to derive the prompt from total - output.
  assert.deepEqual(extractRequestUsageFields(
    { exact_prompt_tokens_v1: "-5", exact_output_tokens_v1: "1194" },
    T,
  ), { prompt: null, output: 1194, cacheRead: null, reasoning: null });
  // A split where every field is invalid carries nothing.
  assert.equal(extractRequestUsageFields(
    { exact_prompt_tokens_v1: "-5", exact_output_tokens_v1: "-6" },
    T,
  ), null);
  // Rows without any exact fields carry no split at all.
  assert.equal(extractRequestUsageFields({ config_name: "deepseek-v4.1-flash" }, T), null);
});

test("TRAE CN v3 request ledger (pre-cache) migrates by full rebuild", async (t) => {
  const f = await fixture(t);
  f.cursors.traeCnLocal = { version: 3, lastRowId: 9, signature: "old-request-ledger" };
  f.cursors.hourly = {
    version: 1,
    buckets: {
      [`trae-cn|deepseek-v4.1-flash|${HOUR}`]: { totals: { input_tokens: 150, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 150, billable_total_tokens: 150, total_cost_usd: 0, conversation_count: 1 } },
    },
    // A stale queued marker for this group must NOT suppress the re-enqueue:
    // the rebuilt totals (with the coverage signal) differ from what the old
    // queue rows carry, and the dashboard aggregates the queue, not these
    // buckets (owner-reported 2026-11-07: 1,834/2,174 keys kept serving
    // signal-less rows when the marker survived).
    groupQueued: { [`trae-cn|${HOUR}`]: 1 },
  };
  const rows = [row(10, { total: 264116, output: 203, exact: { prompt: 262922, output: 1194, cacheRead: 261000, reasoning: 998 } })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  const res = await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.version, 5, "ledger upgrades to v5");
  const hourly = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model.toLowerCase()}|${r.hour_start}`);
  const bucket = hourly.get("deepseek-v4.1-flash|" + HOUR);
  // Rebuild REPLACES the old total-only booking; the cache split lands.
  assert.equal(bucket.total_tokens, 264116);
  assert.equal(bucket.cached_input_tokens, 261000);
  assert.equal(bucket.input_tokens, 1922);
});

test("TRAE CN migrates the v2 per-turn ledger by replacing, never stacking", async (t) => {
  const f = await fixture(t);
  f.cursors.traeCnLocal = { version: 2, lastId: 9, signature: "legacy-turn-ledger" };
  f.cursors.hourly = {
    version: 1,
    buckets: {
      [`trae-cn|old-model|${HOUR}`]: { totals: { input_tokens: 500, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 500, billable_total_tokens: 500, total_cost_usd: 0, conversation_count: 1 } },
    },
    groupQueued: {},
  };
  const rows = [row(10, { total: 200, output: 10 })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };

  await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.version, 5);
  assert.equal(bookedTotal(f.cursors), 200, "old per-turn booking is replaced by the request-log totals");
  const latest = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(latest.get("old-model|" + HOUR).total_tokens, 0, "retired model bucket is zeroed");
  assert.equal(latest.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 200);
});

test("TRAE CN full rescan reconciles a downward usage correction", async (t) => {
  const f = await fixture(t);
  const rows = [row(1, { total: 200, output: 10 })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  await parseTraeCnLocalIncremental(args);
  assert.equal(bookedTotal(f.cursors), 200);

  rows[0] = row(1, { total: 120, output: 10 });
  f.cursors.traeCnLocal.lastFullScanAt = 0;
  appendToStore(f);
  await parseTraeCnLocalIncremental(args);
  assert.equal(bookedTotal(f.cursors), 120, "the correction replaces the old total");
  const latest = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(latest.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 120);
});

test("TRAE CN store replacement forces a rebuild instead of trusting the watermark", async (t) => {
  const f = await fixture(t);
  const rows = [row(1, { total: 300, output: 10 })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  await parseTraeCnLocalIncremental(args);
  assert.equal(f.cursors.traeCnLocal.lastRowId, 1);

  f.cursors.traeCnLocal.identity = "replaced-store";
  rows[0] = row(1, { total: 90, output: 10, session: "new-session" });
  appendToStore(f);
  await parseTraeCnLocalIncremental(args);
  assert.equal(bookedTotal(f.cursors), 90, "a new store re-derives from its own rows");
});

test("TRAE CN holds booked history when a full read projects nothing", async (t) => {
  const f = await fixture(t);
  const rows = [row(1, { total: 300, output: 10 })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  await parseTraeCnLocalIncremental(args);
  const queueBefore = fs.readFileSync(f.queuePath, "utf8");

  rows.length = 0;
  f.cursors.traeCnLocal.lastFullScanAt = 0;
  appendToStore(f);
  const held = await parseTraeCnLocalIncremental(args);
  assert.equal(held.eventsAggregated, 0);
  assert.equal(fs.readFileSync(f.queuePath, "utf8"), queueBefore, "an empty projection must not wipe history");
  assert.equal(bookedTotal(f.cursors), 300);
  assert.equal(f.cursors.traeCnLocal.lastFullScanAt, 0, "the hold stays retryable (cursor not advanced)");
});

test("TRAE CN keeps cloud-only canonical sessions during a full rebuild", async (t) => {
  const f = await fixture(t);
  const cloudBucket = HOUR;
  f.cursors.traeCn = {
    version: 1,
    sessions: {
      "cloud-only": {
        model: "cloud-model",
        bucketStart: cloudBucket,
        totals: { input_tokens: 100, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 0, total_tokens: 120, billable_total_tokens: 120, conversation_count: 1 },
      },
    },
    prunedBeforeMs: 0,
  };
  const rows = [row(1, { total: 300, output: 10, session: "local-session" })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  await parseTraeCnLocalIncremental(args);
  const latest = latestByKey(traeHourly(readRows(f.queuePath)), (r) => `${r.model}|${r.hour_start}`);
  assert.equal(latest.get("cloud-model|" + cloudBucket).total_tokens, 120, "cloud-only usage survives");
  assert.equal(latest.get("deepseek-v4.1-flash|" + HOUR).total_tokens, 300);
  assert.equal(bookedTotal(f.cursors), 420);
});

test("TRAE CN enabling project output later backfills the project queue", async (t) => {
  const f = await fixture(t);
  const rows = [row(1, { total: 400, output: 20, absPath: f.project })];
  await parseTraeCnLocalIncremental({ ...f, projectQueuePath: undefined, readRowsImpl: makeReader(() => rows) });
  assert.equal(readRows(f.projectQueuePath).length, 0);

  appendToStore(f);
  const res = await parseTraeCnLocalIncremental({ ...f, readRowsImpl: makeReader(() => rows) });
  assert.ok(res.projectBucketsQueued > 0, "project output (re)enabled triggers a full rebuild");
  const projectRows = readRows(f.projectQueuePath).filter((r) => r.source === "trae-cn");
  assert.equal(projectRows.at(-1).project_key, "example/trae-cn-project");
  assert.equal(projectRows.at(-1).total_tokens, 400);
});

test("TRAE CN leaves cursor state retryable when the queue append fails", async (t) => {
  const f = await fixture(t);
  const rows = [row(1, { total: 300, output: 10 })];
  const args = { ...f, readRowsImpl: makeReader(() => rows) };
  await parseTraeCnLocalIncremental(args);
  const before = structuredClone(f.cursors);

  rows.push(row(2, { total: 200, output: 10 }));
  appendToStore(f);
  const append = fs.promises.appendFile.bind(fs.promises);
  const failure = new Error("synthetic queue failure");
  const mock = t.mock.method(fs.promises, "appendFile", async (file, ...rest) => {
    if (file === f.queuePath) throw failure;
    return append(file, ...rest);
  });
  await assert.rejects(parseTraeCnLocalIncremental(args), (err) => err === failure);
  assert.deepEqual(f.cursors, before, "watermark must stay retryable");
  mock.mock.restore();
  const retried = await parseTraeCnLocalIncremental(args);
  assert.equal(retried.recordsProcessed, 1, "the missed call is replayed");
  assert.equal(f.cursors.traeCnLocal.lastRowId, 2);
});
