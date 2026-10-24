"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { snapshotSession, reconcileSessionArchive, sessionArchivePath, readSessionArchive, serializeSessionArchive } = require("../src/lib/session-archive");
const { buildSessionAnalytics, listSessionsForBrowser } = require("../src/lib/session-analytics");

function row(total = 12) {
  return {
    session_hash: "hash-one", session_id: "session-one", source: "claude", model: "claude-a",
    total_tokens: total, tokens: { input_tokens: total - 2, output_tokens: 2, total_tokens: total },
    model_usage: [{ model: "claude-a", input_tokens: total - 2, output_tokens: 2, total_tokens: total }],
    usage_buckets: [{ timestamp: "2026-07-18T05:00:00Z", model: "claude-a", input_tokens: total - 2, output_tokens: 2, total_tokens: total }],
    started_at: "2026-07-18T05:00:00Z", ended_at: "2026-07-18T05:00:01Z", active_ms: 1000,
    title: "PROMPT_SECRET", content: "BODY_SECRET", _cache_key: "private-file-path",
    performance: { estimated_output_tokens: 2, estimated_duration_ms: 1000, estimated_tokens_per_second: 2 },
  };
}

test("snapshot excludes content, titles, paths to transcripts and nested arbitrary fields", () => {
  const input = row();
  input.tokens.body = "BODY_SECRET";
  input.model_usage[0].priority_long_context_input_tokens = 3;
  input.model_usage[0].ultrafast_long_context_output_tokens = 2;
  input.model_usage[0].prompt = "MODEL_SECRET";
  input.usage_buckets[0].tool_args = "ARGS_SECRET";
  input.performance.auth = "AUTH_SECRET";
  const snapshot = snapshotSession(input);
  const text = JSON.stringify(snapshot);
  for (const secret of ["PROMPT_SECRET", "BODY_SECRET", "MODEL_SECRET", "ARGS_SECRET", "AUTH_SECRET", "private-file-path"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.equal(snapshot.total_tokens, 12);
  assert.equal(snapshot.model_usage[0].priority_long_context_input_tokens, 3);
  assert.equal(snapshot.model_usage[0].ultrafast_long_context_output_tokens, 2);
  assert.equal(snapshot.usage_buckets[0].total_tokens, 12);
  assert.equal(snapshot.performance.estimated_tokens_per_second, 2);
});

test("live snapshots replace previous totals and never add them together", () => {
  const previous = [snapshotSession(row(12))];
  const updated = reconcileSessionArchive([row(14)], previous);
  assert.equal(updated.snapshots.length, 1);
  assert.equal(updated.snapshots[0].total_tokens, 14);
  assert.equal(updated.retained.length, 0);
  const removed = reconcileSessionArchive([], updated.snapshots);
  assert.equal(removed.retained.length, 1);
  assert.equal(removed.retained[0].archived, true);
  assert.equal(removed.retained[0].session_store_bytes, 0);
  const restored = reconcileSessionArchive([row(16)], removed.snapshots);
  assert.equal(restored.retained.length, 0);
  assert.equal(restored.snapshots[0].total_tokens, 16);
});

test("missing fragments retain only events not already present in a surviving copy", () => {
  const event = (hash, input) => ({ hash, model: "claude-a", timestamp: "2026-07-18T05:00:00Z", input_tokens: input, output_tokens: 0, total_tokens: input });
  const previous = [{ ...row(30), _cache_key: "old-fragment", _archive_usage_events: [event("prefix", 10), event("old-tail", 20)] }];
  const current = [{ ...row(40), _cache_key: "new-fragment", _archive_usage_events: [event("prefix", 10), event("new-tail", 30)] }];
  const merged = reconcileSessionArchive(current, previous);
  assert.equal(merged.retained.length, 1);
  assert.equal(merged.retained[0].total_tokens, 20);
  assert.equal(merged.retained[0].model_usage[0].total_tokens, 20);
  assert.equal(merged.snapshots.reduce((sum, item) => sum + item.total_tokens, 0), 60);
  const deleted = reconcileSessionArchive([], merged.snapshots);
  assert.equal(deleted.retained.reduce((sum, item) => sum + item.total_tokens, 0), 60);
});

test("an empty refresh cannot erase a positive saved fragment", () => {
  const saved = [{ ...row(12), _cache_key: "fragment" }];
  const empty = [{ ...row(0), _cache_key: "fragment", tokens: {} }];
  const result = reconcileSessionArchive(empty, saved);
  assert.equal(result.snapshots[0].total_tokens, 12);
  assert.equal(result.retained[0].total_tokens, 12);
});

test("old model-enum-only Antigravity snapshots are corrected without discarding new measured history", () => {
  const previous = { ...row(1318), source: "antigravity", parser_version: 33, tokens: { input_tokens: 1318, total_tokens: 1318 } };
  const current = { ...row(0), source: "antigravity", version: 35, native_model_enum: 1318, tokens: { total_tokens: 0 } };
  const corrected = reconcileSessionArchive([current], [previous]);
  assert.equal(corrected.snapshots[0].total_tokens, 0);
  assert.equal(corrected.retained.length, 0);
  const measured = reconcileSessionArchive([current], [{ ...previous, parser_version: 35 }]);
  assert.equal(measured.retained[0].total_tokens, 1318);
});

test("archive is compressed and independently versioned, corrupt bytes are not silently overwritten", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-session-archive-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.deepEqual(readSessionArchive(home), []);
  const file = sessionArchivePath(home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const zipped = serializeSessionArchive([row()]);
  fs.writeFileSync(file, zipped);
  assert.equal(readSessionArchive(home)[0].total_tokens, 12);
  assert.ok(zipped.length < gunzipSync(zipped).length);
  fs.writeFileSync(file, "invalid gzip");
  assert.throws(() => readSessionArchive(home));
});

test("deleted source files retain only metadata, cannot resume, and reappearance never duplicates", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-archive-integration-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, ".claude", "projects", "project-a");
  const file = path.join(dir, "session-one.jsonl");
  fs.mkdirSync(dir, { recursive: true });
  const data = [
    { type: "user", sessionId: "session-one", cwd: dir, timestamp: "2026-07-18T05:00:00Z", message: { content: "PROMPT_SECRET" } },
    { type: "assistant", sessionId: "session-one", cwd: dir, timestamp: "2026-07-18T05:00:01Z", message: { id: "message-one", model: "claude-a", usage: { input_tokens: 10, output_tokens: 2 }, content: [] } },
  ].map(JSON.stringify).join("\n") + "\n";
  fs.writeFileSync(file, data);
  const first = await buildSessionAnalytics({ home, force: true });
  assert.equal(first.filter((item) => item.session_id === "session-one").length, 1);
  const snapshot = readSessionArchive(home).find((item) => item.session_id === "session-one");
  assert.equal(snapshot.total_tokens, 12);
  assert.equal(JSON.stringify(snapshot).includes("PROMPT_SECRET"), false);
  fs.unlinkSync(file);
  const deleted = await buildSessionAnalytics({ home, force: true });
  const retained = deleted.find((item) => item.session_id === "session-one");
  assert.equal(retained.archived, true);
  assert.equal(retained.total_tokens, 12);
  const browser = listSessionsForBrowser(deleted).sessions.find((item) => item.session_id === "session-one");
  assert.equal(browser.resume_command, null);
  assert.equal(browser.archived, true);
  const metaPath = path.join(home, ".tokentracker", "tracker", "session.queue.jsonl.meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath));
  meta.version = 0;
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  assert.equal((await buildSessionAnalytics({ home, force: true })).find((item) => item.session_id === "session-one").total_tokens, 12);
  fs.writeFileSync(file, data);
  const restored = await buildSessionAnalytics({ home, force: true });
  const matching = restored.filter((item) => item.session_id === "session-one");
  assert.equal(matching.length, 1);
  assert.equal(matching[0].total_tokens, 12);
  assert.equal(Boolean(matching[0].archived), false);
  assert.equal(readSessionArchive(home).filter((item) => item.session_id === "session-one").length, 1);
});

function writeFragment(home, folder, messageId, inputTokens) {
  const directory = path.join(home, ".claude", "projects", folder);
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "session-one.jsonl");
  fs.writeFileSync(file, [
    { type: "user", sessionId: "session-one", timestamp: "2026-07-18T05:00:00Z", message: { content: "fixture" } },
    { type: "assistant", sessionId: "session-one", timestamp: "2026-07-18T05:00:01Z", message: { id: messageId, model: "claude-a", usage: { input_tokens: inputTokens, output_tokens: 2 }, content: [] } },
  ].map(JSON.stringify).join("\n") + "\n");
  return file;
}

test("removing one same-session fragment preserves its tokens after the other is removed", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-archive-fragments-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const a = writeFragment(home, "a", "message-a", 10);
  const b = writeFragment(home, "b", "message-b", 20);
  const first = await buildSessionAnalytics({ home, force: true });
  assert.equal(listSessionsForBrowser(first).sessions[0].total_tokens, 34);
  fs.unlinkSync(a);
  const partial = await buildSessionAnalytics({ home, force: true });
  assert.equal(listSessionsForBrowser(partial).sessions[0].total_tokens, 34);
  fs.unlinkSync(b);
  const deleted = await buildSessionAnalytics({ home, force: true });
  assert.equal(listSessionsForBrowser(deleted).sessions[0].total_tokens, 34);
});

test("restoring two identical same-session copies does not double the retained totals", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-archive-copies-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const a = writeFragment(home, "a", "same-message", 10);
  await buildSessionAnalytics({ home, force: true });
  fs.unlinkSync(a);
  await buildSessionAnalytics({ home, force: true });
  writeFragment(home, "b", "same-message", 10);
  writeFragment(home, "c", "same-message", 10);
  const restored = await buildSessionAnalytics({ home, force: true });
  assert.equal(listSessionsForBrowser(restored).sessions[0].total_tokens, 12);
  assert.equal(readSessionArchive(home).reduce((sum, item) => sum + item.total_tokens, 0), 12);
});

test("truncating a source to empty does not overwrite its positive snapshot", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-archive-truncated-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = writeFragment(home, "a", "same-message", 10);
  await buildSessionAnalytics({ home, force: true });
  fs.writeFileSync(file, "");
  await buildSessionAnalytics({ home, force: true });
  fs.unlinkSync(file);
  const deleted = await buildSessionAnalytics({ home, force: true });
  assert.equal(listSessionsForBrowser(deleted).sessions[0].total_tokens, 12);
});

test("legacy heterogeneous fragments retain their separate model costs", async (t) => {
  const { computeRowCost } = require("../src/lib/pricing");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-archive-legacy-cost-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const directory = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(directory, { recursive: true });
  const fragments = [
    { ...row(1000000), model: "claude-sonnet-4-6", tokens: { input_tokens: 1000000, total_tokens: 1000000 }, model_usage: undefined },
    { ...row(2000000), model: "claude-opus-4-6", tokens: { input_tokens: 2000000, total_tokens: 2000000 }, model_usage: undefined },
  ].map(({ _cache_key, ...value }) => value);
  fs.writeFileSync(path.join(directory, "session.queue.jsonl"), fragments.map(JSON.stringify).join("\n") + "\n");
  const expected = fragments.reduce((sum, item) => sum + computeRowCost({ source: item.source, model: item.model, ...item.tokens }), 0);
  const rows = await buildSessionAnalytics({ home, force: true });
  assert.equal(listSessionsForBrowser(rows).sessions[0].cost_usd, expected);
  assert.equal(readSessionArchive(home).length, 2);
});

test("a failed transcript read does not overwrite archive or the last complete sidecar", async (t) => {
  const { Readable } = require("node:stream");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-archive-read-error-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = writeFragment(home, "a", "same-message", 10);
  await buildSessionAnalytics({ home, force: true });
  const archiveBefore = fs.readFileSync(sessionArchivePath(home));
  const sidecar = path.join(home, ".tokentracker", "tracker", "session.queue.jsonl");
  const sidecarBefore = fs.readFileSync(sidecar);
  const original = fs.createReadStream;
  const mock = t.mock.method(fs, "createReadStream", function (filePath, options) {
    if (String(filePath) !== file) return original.call(this, filePath, options);
    const input = new Readable({ read() {} });
    process.nextTick(() => { const error = new Error("fixture permission denied"); error.code = "EACCES"; input.destroy(error); });
    return input;
  });
  const failed = await buildSessionAnalytics({ home, force: true });
  assert.ok(failed.skippedFiles > 0);
  assert.deepEqual(fs.readFileSync(sessionArchivePath(home)), archiveBefore);
  assert.deepEqual(fs.readFileSync(sidecar), sidecarBefore);
  mock.mock.restore();
  const recovered = await buildSessionAnalytics({ home });
  assert.equal(recovered.find((item) => item.session_id === "session-one").total_tokens, 12);
  assert.equal(Boolean(recovered.find((item) => item.session_id === "session-one").archived), false);
});
