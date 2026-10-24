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

test("export, preview and import merge only new (source, model, hour) keys", () => {
  const source = rootWithRows([row("2026-10-01T00:00:00Z"), row("2026-10-01T00:30:00Z")]);
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot, bytes } = transfer.buildSnapshot();
  assert.equal(snapshot.rows.length, 2);
  assert.ok(bytes > 0);

  const target = rootWithRows([row("2026-10-01T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = target;
  const preview = transfer.previewSnapshot(snapshot);
  assert.equal(preview.fresh, 1);
  assert.equal(preview.duplicate, 1);
  assert.equal(preview.before, 1);
  assert.equal(preview.after, 2);

  const result = transfer.importSnapshot(snapshot, preview.token);
  assert.equal(result.imported, 1);
  assert.equal(result.skipped, 1);
  const lines = fs.readFileSync(path.join(target, "tracker", "queue.jsonl"), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
});

test("a machine refuses its own snapshot", () => {
  const root = rootWithRows([row("2026-10-02T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = root;
  const { snapshot } = transfer.buildSnapshot();
  assert.throws(() => transfer.previewSnapshot(snapshot), (error) => error.code === "self_import");
});

test("import rejects a token minted for different queue contents", () => {
  const source = rootWithRows([row("2026-10-03T00:00:00Z")]);
  process.env.TOKENTRACKER_HOME = source;
  const { snapshot } = transfer.buildSnapshot();
  const target = rootWithRows([]);
  process.env.TOKENTRACKER_HOME = target;
  const preview = transfer.previewSnapshot(snapshot);
  fs.appendFileSync(path.join(target, "tracker", "queue.jsonl"), JSON.stringify(row("2026-10-03T01:00:00Z")) + "\n");
  assert.throws(
    () => transfer.importSnapshot(snapshot, preview.token),
    (error) => error.code === "preview_changed",
  );
});

test("malformed snapshots are rejected", () => {
  process.env.TOKENTRACKER_HOME = rootWithRows([]);
  assert.throws(() => transfer.previewSnapshot({ kind: "other" }), (error) => error.code === "invalid_snapshot");
  assert.throws(
    () => transfer.previewSnapshot({ kind: "tokentracker-local-usage", version: 1, machine: { id: "x" }, rows: [] }),
    (error) => error.code === "invalid_snapshot",
  );
});
