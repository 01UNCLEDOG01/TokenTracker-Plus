"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  readAntigravityTokscaleUsage,
  mergeAntigravityTokscaleRows,
} = require("../src/lib/antigravity-tokscale");

function usage(sessionId, modelId, timestamp, input, cacheRead, output, reasoning = 0) {
  return JSON.stringify({
    type: "usage",
    sessionId,
    modelId,
    timestamp,
    input,
    cacheRead,
    cacheWrite: 0,
    output,
    reasoning,
  });
}

test("aggregates tokscale usage rows by UTC hour and model", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ag-cache-"));
  const dir = path.join(home, "sessions");
  fs.mkdirSync(dir, { recursive: true });
  try {
    const t = Date.UTC(2026, 9, 4, 5, 10);
    fs.writeFileSync(path.join(dir, "a.jsonl"), [
      JSON.stringify({ type: "session_meta", sessionId: "s1", timestamp: null }),
      usage("s1", "gemini-3.8-flash-n", t, 100, 900, 50, 10),
      usage("s1", "gemini-3.8-flash-n", t + 10 * 60_000, 200, 800, 40, 5),
      usage("s2", "claude-sonnet-4-6", Date.UTC(2026, 9, 5, 8, 0), 10, 0, 20),
    ].join("\n") + "\n");

    const snapshot = readAntigravityTokscaleUsage({ dir });
    assert.equal(snapshot.files, 1);
    assert.deepEqual([...snapshot.coveredDays].sort(), ["2026-10-04", "2026-10-05"]);
    const gemini = snapshot.rows.find((row) => row.model === "gemini-3.8-flash-n");
    assert.equal(gemini.hour_start, "2026-10-04T05:00:00.000Z");
    assert.equal(gemini.input_tokens, 300);
    assert.equal(gemini.cached_input_tokens, 1700);
    assert.equal(gemini.output_tokens, 90);
    assert.equal(gemini.reasoning_output_tokens, 15);
    assert.equal(gemini.total_tokens, 2105);
    assert.equal(gemini.usage_precision, "exact");
    assert.equal(snapshot.bySession.get("s1").requests, 2);
    assert.equal(snapshot.bySession.get("s1").usage.total_tokens, 2105);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("replaces estimates only on days the cache covers", () => {
  const covered = { source: "antigravity", model: "gemini-3.8-flash-n", hour_start: "2026-10-04T06:00:00.000Z", total_tokens: 1 };
  const uncovered = { source: "antigravity", model: "gemini-3.8-flash-n", hour_start: "2026-10-12T06:00:00.000Z", total_tokens: 2 };
  const other = { source: "claude", model: "sonnet", hour_start: "2026-10-04T06:00:00.000Z", total_tokens: 3 };
  const cacheRow = { source: "antigravity", model: "gemini-3.8-flash-n", hour_start: "2026-10-04T05:00:00.000Z", total_tokens: 100 };
  const merged = mergeAntigravityTokscaleRows([covered, uncovered, other], {
    rows: [cacheRow],
    coveredDays: new Set(["2026-10-04"]),
  });
  assert.deepEqual(merged.map((row) => row.total_tokens), [2, 3, 100]);
  assert.equal(merged.some((row) => row === covered), false, "the covered estimate is removed");
});

test("an absent cache yields no rows and changes nothing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ag-empty-"));
  try {
    const snapshot = readAntigravityTokscaleUsage({ dir: path.join(home, "missing") });
    assert.equal(snapshot.rows.length, 0);
    assert.equal(snapshot.coveredDays.size, 0);
    const rows = [{ source: "antigravity", total_tokens: 1 }];
    assert.deepEqual(mergeAntigravityTokscaleRows(rows, snapshot), rows);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
