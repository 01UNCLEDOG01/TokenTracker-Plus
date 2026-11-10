"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, afterEach } = require("node:test");

const transfer = require("../src/lib/local-usage-transfer");

const originalHome = process.env.TOKENTRACKER_HOME;
const dirs = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.TOKENTRACKER_HOME;
  else process.env.TOKENTRACKER_HOME = originalHome;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function rootWithRows(rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-transfer-"));
  dirs.push(root);
  const tracker = path.join(root, "tracker");
  fs.mkdirSync(tracker, { recursive: true });
  fs.writeFileSync(path.join(tracker, "queue.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  return root;
}

function row(hour, tokens = 100) {
  return { source: "antigravity", model: "gemini-3.8-flash-n", hour_start: hour, total_tokens: tokens };
}

// Strictly increasing hourly stamps so window/pagination assertions are exact.
function hourAt(i) {
  return new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString();
}

test("export, preview and import merge only new (source, model, hour) keys", async () => {
  const source = rootWithRows([row("2026-10-01T00:00:00Z"), row("2026-10-01T00:30:00Z")]);
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot, bytes } = await transfer.buildSnapshot();
  assert.equal(snapshot.rows.length, 2);
  assert.ok(bytes > 0);
  assert.equal(snapshot.truncated, false);
  assert.equal(snapshot.total_rows, 2);

  const target = rootWithRows([row("2026-10-01T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = target;
  const preview = await transfer.previewSnapshot(snapshot);
  assert.equal(preview.fresh, 1);
  assert.equal(preview.duplicate, 1);
  assert.equal(preview.before, 1);
  assert.equal(preview.after, 2);

  const result = await transfer.importSnapshot(snapshot, preview.token);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  const lines = fs.readFileSync(path.join(target, "tracker", "queue.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
});

test("a machine refuses its own snapshot", async () => {
  const root = rootWithRows([row("2026-10-02T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = root;
  const { snapshot } = await transfer.buildSnapshot();
  await assert.rejects(() => transfer.previewSnapshot(snapshot), (error) => error.code === "self_import");
});

test("import rejects a token minted for different queue contents", async () => {
  const source = rootWithRows([row("2026-10-03T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot } = await transfer.buildSnapshot();
  const target = rootWithRows([]);
  process.env.TOKENTRACKER_HOME = target;
  const preview = await transfer.previewSnapshot(snapshot);
  fs.appendFileSync(path.join(target, "tracker", "queue.jsonl"), JSON.stringify(row("2026-10-03T01:00:00Z")) + "\n");
  await assert.rejects(
    () => transfer.importSnapshot(snapshot, preview.token),
    (error) => error.code === "preview_changed",
  );
});

test("malformed snapshots are rejected", async () => {
  process.env.TOKENTRACKER_HOME = rootWithRows([]);
  await assert.rejects(() => transfer.previewSnapshot({ kind: "other" }), (error) => error.code === "invalid_snapshot");
  await assert.rejects(
    () => transfer.previewSnapshot({ kind: "tokentracker-local-usage", version: 1, machine: { id: "x" }, rows: [] }),
    (error) => error.code === "invalid_snapshot",
  );
});

test("describeLocalUsage streams the queue: skips malformed lines and reports exact bytes", async () => {
  const qp = path.join(rootWithRows([]), "tracker", "queue.jsonl");
  process.env.TOKENTRACKER_HOME = path.dirname(path.dirname(qp));
  const good = [row("2026-10-04T00:00:00Z"), row("2026-10-04T01:00:00Z", 200)];
  fs.writeFileSync(qp, ["", JSON.stringify(good[0]), "{broken", JSON.stringify(good[1]), ""].join("\n"));
  const stats = await transfer.describeLocalUsage();
  assert.equal(stats.rows, 2);
  assert.equal(stats.bytes, fs.statSync(qp).size);
  assert.ok(stats.max_bytes > 0);
});

test("describeLocalUsage reports zeros for a machine with no queue yet", async () => {
  process.env.TOKENTRACKER_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tt-transfer-empty-"));
  dirs.push(process.env.TOKENTRACKER_HOME);
  const stats = await transfer.describeLocalUsage();
  assert.equal(stats.rows, 0);
  assert.equal(stats.bytes, 0);
});

test("export windows an oversized queue to the newest rows that fit the cap", async () => {
  const hours = Array.from({ length: 200 }, (_, i) => hourAt(i));
  const source = rootWithRows(hours.map((h, i) => row(h, i)));
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot, bytes, truncated, total_rows } = await transfer.buildSnapshot({ maxBytes: 4096 });
  assert.equal(truncated, true);
  assert.equal(total_rows, 200);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.total_rows, 200);
  assert.ok(bytes <= 4096);
  assert.ok(snapshot.rows.length < 200);
  // The window carries the newest rows: it must end at the last hour written.
  assert.equal(snapshot.rows[snapshot.rows.length - 1].hour_start, hours[hours.length - 1]);
  assert.equal(snapshot.window.from, snapshot.rows[0].hour_start);
  assert.equal(snapshot.window.to, hours[hours.length - 1]);
  // Untruncated export stays whole under the default cap.
  const full = await transfer.buildSnapshot();
  assert.equal(full.truncated, false);
  assert.equal(full.snapshot.rows.length, 200);
});

test("export pages backwards with an inclusive before bound (boundary hour re-sent, dedup absorbs it)", async () => {
  const hours = Array.from({ length: 120 }, (_, i) => hourAt(i));
  const source = rootWithRows(hours.map((h, i) => row(h, i)));
  process.env.TOKENTRACKER_HOME = source;

  const seen = new Map(); // rowKey -> count across batches
  const record = (rows) => {
    for (const r of rows) seen.set(transfer.rowKey(r), (seen.get(transfer.rowKey(r)) || 0) + 1);
  };

  let before;
  let batches = 0;
  for (;;) {
    const { snapshot, truncated } = await transfer.buildSnapshot({ maxBytes: 4096, before });
    assert.ok(snapshot.rows.length > 0, "every non-final batch exports rows");
    record(snapshot.rows);
    batches += 1;
    assert.ok(batches < 500, "pagination terminates");
    if (!truncated) break;
    const from = snapshot.window.from;
    if (before != null && from >= before) break; // no progress: stop instead of looping
    before = from;
  }
  // Full coverage: every queued row reached exactly once or twice (the
  // inclusive bound re-sends the boundary hour, which import dedup absorbs).
  assert.equal(seen.size, 120);
  assert.ok([...seen.values()].every((c) => c <= 2));
  assert.ok(batches >= 2, "an oversized queue pages through multiple batches");
});

test("a truncated snapshot still imports with dedup on the target", async () => {
  const hours = Array.from({ length: 100 }, (_, i) => `2026-10-01T${String(i % 24).padStart(2, "0")}:00:00Z`);
  const source = rootWithRows(hours.map((h, i) => row(h, i)));
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot } = await transfer.buildSnapshot({ maxBytes: 4096 });
  assert.equal(snapshot.truncated, true);

  // Target already holds the newest hour → those keys must not re-import.
  const target = rootWithRows([row(hours[hours.length - 1], 99)]);
  process.env.TOKENTRACKER_HOME = target;
  const preview = await transfer.previewSnapshot(snapshot);
  assert.equal(preview.fresh, snapshot.rows.length - 1);
  assert.equal(preview.duplicate, 1);
  const result = await transfer.importSnapshot(snapshot, preview.token);
  assert.equal(result.imported, snapshot.rows.length - 1);
  assert.equal(result.skipped, 1);
});

test("import creates the queue on a fresh machine and skips the backup", async () => {
  const source = rootWithRows([row("2026-10-05T00:00:00Z"), row("2026-10-05T01:00:00Z")]);
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot } = await transfer.buildSnapshot();

  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "tt-transfer-fresh-"));
  dirs.push(fresh);
  fs.mkdirSync(path.join(fresh, "tracker"), { recursive: true });
  process.env.TOKENTRACKER_HOME = fresh;

  const preview = await transfer.previewSnapshot(snapshot);
  const result = await transfer.importSnapshot(snapshot, preview.token);
  assert.equal(result.imported, 2);
  const qp = path.join(fresh, "tracker", "queue.jsonl");
  assert.equal(fs.readFileSync(qp, "utf8").trim().split("\n").length, 2);
  assert.equal(fs.readdirSync(path.join(fresh, "tracker")).filter((f) => f.startsWith("queue.jsonl.bak-")).length, 0);
});

test("export of an empty selection returns no window instead of throwing", async () => {
  const source = rootWithRows([row("2026-10-06T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot, truncated, total_rows } = await transfer.buildSnapshot({ before: "2026-01-01T00:00:00Z" });
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.window, undefined);
  assert.equal(truncated, false);
  assert.equal(total_rows, 0);
});

// --- full backup (gzip, whole queue) ---
// Same env convention as the windowed tests above: TOKENTRACKER_HOME points at
// a root that contains tracker/queue.jsonl. Explicit {home} args mean the
// $home/.tokentracker/tracker layout — do not mix the two conventions.

const { PassThrough } = require("node:stream");

async function collectFullBackup(home) {
  process.env.TOKENTRACKER_HOME = home;
  const sink = new PassThrough();
  const chunks = [];
  sink.on("data", (c) => chunks.push(c));
  sink.writeHead = function (status, headers) {
    this.status = status;
    this.headers = headers;
  };
  const counts = await transfer.streamFullBackup(sink);
  const buffer = Buffer.concat(chunks);
  return { buffer, counts, sink };
}

test("full backup round trip: gzips the whole queue and imports with dedup", async () => {
  const source = rootWithRows(Array.from({ length: 500 }, (_, i) => row(hourAt(i), i)));
  const { buffer, counts, sink } = await collectFullBackup(source);
  assert.equal(sink.status, 200);
  assert.equal(sink.headers["Content-Type"], "application/gzip");
  assert.equal(counts.rows, 500);
  assert.ok(buffer.length < Buffer.byteLength(JSON.stringify(Array.from({ length: 500 }, (_, i) => row(hourAt(i), i)))), "gzip shrinks the payload");

  const target = rootWithRows([row(hourAt(499), 499)]); // newest hour already present
  process.env.TOKENTRACKER_HOME = target;
  const preview = await transfer.previewFullBackup(buffer);
  assert.equal(preview.format, "ndjson-gzip");
  assert.equal(preview.rows, 500);
  assert.equal(preview.fresh, 499);
  assert.equal(preview.duplicate, 1);

  const imported = await transfer.importFullBackup(buffer, preview.token);
  assert.equal(imported.imported, 499);
  assert.equal(imported.skipped, 1);
  const lines = fs.readFileSync(path.join(target, "tracker", "queue.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 500);

  const previewAgain = await transfer.previewFullBackup(buffer);
  assert.equal(previewAgain.fresh, 0);
  assert.equal(previewAgain.duplicate, 500);
});

test("full backup refuses this machine's own file before scanning rows", async () => {
  const root = rootWithRows([row(hourAt(0))]);
  const { buffer } = await collectFullBackup(root);
  await assert.rejects(
    () => transfer.previewFullBackup(buffer),
    (error) => error.code === "self_import",
  );
});

test("full backup rejects corrupt gzip and malformed headers", async () => {
  const target = rootWithRows([row(hourAt(0))]);
  process.env.TOKENTRACKER_HOME = target;
  await assert.rejects(
    () => transfer.previewFullBackup(Buffer.from("not gzip at all")),
    (error) => error.code === "invalid_backup",
  );
  // Valid gzip of garbage: gunzip succeeds but the header line is wrong.
  const zlib = require("node:zlib");
  const garbage = zlib.gzipSync(JSON.stringify({ hello: "world" }) + "\n");
  await assert.rejects(
    () => transfer.previewFullBackup(garbage),
    (error) => error.code === "invalid_backup",
  );
});

test("full backup of an empty queue is rejected on import", async () => {
  const source = rootWithRows([]);
  const { buffer } = await collectFullBackup(source);
  const target = rootWithRows([row(hourAt(0))]);
  process.env.TOKENTRACKER_HOME = target;
  await assert.rejects(
    () => transfer.previewFullBackup(buffer),
    (error) => error.code === "empty_backup",
  );
});

test("full backup rejects a token minted for a different file or queue state", async () => {
  const source = rootWithRows([row(hourAt(0)), row(hourAt(1))]);
  const { buffer } = await collectFullBackup(source);
  const target = rootWithRows([]);
  process.env.TOKENTRACKER_HOME = target;
  const preview = await transfer.previewFullBackup(buffer);
  await assert.rejects(
    () => transfer.importFullBackup(buffer, "bogus-token"),
    (error) => error.code === "preview_changed",
  );
  // Same token, target queue grew since preview → signature mismatch.
  fs.appendFileSync(path.join(target, "tracker", "queue.jsonl"), JSON.stringify(row(hourAt(2))) + "\n");
  await assert.rejects(
    () => transfer.importFullBackup(buffer, preview.token),
    (error) => error.code === "preview_changed",
  );
});
