"use strict";

// The session page reads Antigravity's chunked transcript
// (logs/chunks/transcript/NNNNNNNN.jsonl), while the sync pipeline reads the
// whole-stream transcript.jsonl. Two bugs made every session that Token
// Monitor had not ingested yet fall back to the text estimator: the db-path
// resolver rejected the chunk directory, and joining byte chunks with "\n"
// produced unparseable halves at every split record.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, afterEach } = require("node:test");

const { resolveAntigravityDbPath } = require("../src/lib/rollout");
const { readAntigravityTranscriptChunks } = require("../src/lib/session-analytics");

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-antigravity-chunks-"));
  tempDirs.push(dir);
  return dir;
}

describe("resolveAntigravityDbPath", () => {
  const root = path.join("/tmp", "ag");
  const uuid = "9bfda5ee-7664-4add-a6ba-63d9fe49c8ad";
  const expected = path.join(root, "conversations", `${uuid}.db`);
  const logs = path.join(root, "brain", uuid, ".system_generated", "logs");

  it("resolves the chunked transcript directory the session scanner reads", () => {
    assert.equal(
      resolveAntigravityDbPath(path.join(logs, "chunks", "transcript", "00000000.jsonl")),
      expected,
    );
  });

  it("still resolves the whole-stream transcript files", () => {
    assert.equal(resolveAntigravityDbPath(path.join(logs, "transcript.jsonl")), expected);
    assert.equal(resolveAntigravityDbPath(path.join(logs, "transcript_full.jsonl")), expected);
  });

  it("ignores paths outside the antigravity brain directory", () => {
    assert.equal(resolveAntigravityDbPath(path.join(root, "brain", uuid, "notes.jsonl")), null);
  });
});

describe("readAntigravityTranscriptChunks", () => {
  it("re-joins a record that straddles a chunk boundary", () => {
    const dir = tempDir();
    const records = [
      { type: "PLANNER_RESPONSE", step_index: 1, input_tokens: 13356 },
      { type: "PLANNER_RESPONSE", step_index: 3, input_tokens: 14155 },
    ];
    const stream = records.map((r) => `${JSON.stringify(r)}\n`).join("");
    const cut = stream.indexOf("\n") + 1 + 12;
    const first = path.join(dir, "00000000.jsonl");
    const second = path.join(dir, "00000001.jsonl");
    fs.writeFileSync(first, stream.slice(0, cut));
    fs.writeFileSync(second, stream.slice(cut));

    const raw = readAntigravityTranscriptChunks([first, second]);
    const parsed = raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(parsed, records);
  });
});
