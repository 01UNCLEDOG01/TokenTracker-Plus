const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAsyncQueueReader } = require("../src/lib/async-queue-reader");
const { resolveQueueRow } = require("../src/lib/local-api");

const parseRow = (row) => ({
  key: `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`,
  row,
});

const row = (source, tokens) => ({ source, model: "m", hour_start: "2026-10-13T23:00:00.000Z", total_tokens: tokens });

function tempQueue(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-queue-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "queue.jsonl");
}

test("an estimate source never loses its counts to a later empty row, other sources still supersede", () => {
  const pos = row("antigravity", 425);
  const zero = row("antigravity", 0);
  assert.equal(resolveQueueRow(pos, zero), pos, "the empty row must not blank the hour");
  assert.equal(
    resolveQueueRow(pos, { ...zero, total_tokens: undefined }),
    pos,
    "a missing count is still no count",
  );
  assert.equal(resolveQueueRow(zero, pos), pos, "usage appearing later must win");
  assert.equal(resolveQueueRow(pos, row("antigravity", 900)).total_tokens, 900, "a newer real number still supersedes");
  assert.equal(resolveQueueRow(undefined, zero), zero, "the first write for a key is kept even when it is zero");
  assert.equal(resolveQueueRow(row("cursor", 425), row("cursor", 0)).total_tokens, 425, "cursor is the other estimate source");
  // The narrowness is the point: a provider that reports zero on purpose wins.
  assert.equal(resolveQueueRow(row("claude", 425), row("claude", 0)).total_tokens, 0);
  assert.equal(resolveQueueRow(row("qoder", 425), row("qoder", 0)).total_tokens, 0, "qoder zeroing out generic model placeholders on refinement must not be suppressed");
});

test("rows sharing one key inside a single fresh parse obey the hook too", async (t) => {
  const file = tempQueue(t);
  const row = (tokens) => `{"source":"antigravity","model":"claude-antigravity","hour_start":"2026-10-13T23:00:00.000Z","total_tokens":${tokens}}`;
  fs.writeFileSync(file, `${row(700)}\n${row(0)}\n`);
  const read = createAsyncQueueReader({ parseRow, resolve: resolveQueueRow, label: "test-fresh" });
  const rows = await read(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_tokens, 700, "the zero row is later in the log but reports nothing");
});

test("the reader keeps the reported row across reloads, appends and a newline-less tail", async (t) => {
  const file = tempQueue(t);
  const read = createAsyncQueueReader({ parseRow, resolve: resolveQueueRow, label: "test" });
  const row = (tokens) => `${JSON.stringify({ source: "antigravity", model: "claude-antigravity", hour_start: "2026-10-13T23:00:00.000Z", total_tokens: tokens })}\n`;
  const sum = async () => {
    const rows = await read(file);
    return rows.reduce((s, r) => s + (Number(r.total_tokens) || 0), 0);
  };

  fs.writeFileSync(file, row(700));
  assert.equal(await sum(), 700);

  fs.appendFileSync(file, row(0));
  assert.equal(await sum(), 700, "a zero append on the growth path must not blank the hour");

  fs.appendFileSync(file, row(1200));
  assert.equal(await sum(), 1200, "a real supersede still lands");

  fs.appendFileSync(file, '{"source":"antigravity","model":"claude-antigravity","hour_start":"2026-10-13T23:00:00.000Z","total_tokens":0}');
  assert.equal(await sum(), 1200, "the provisional tail obeys the same rule");
});

test("without a resolve hook the reader keeps the plain last-write-wins log", async (t) => {
  const file = tempQueue(t);
  const read = createAsyncQueueReader({ parseRow, label: "test-default" });
  fs.writeFileSync(file, [
    '{"source":"s","model":"m","hour_start":"2026-10-13T23:00:00.000Z","total_tokens":700}',
    '{"source":"s","model":"m","hour_start":"2026-10-13T23:00:00.000Z","total_tokens":0}',
    "",
  ].join("\n"));
  const rows = await read(file);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_tokens, 0, "the default hook must stay exactly as it was for other readers");
});
