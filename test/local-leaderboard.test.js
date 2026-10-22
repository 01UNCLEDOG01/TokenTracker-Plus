"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { computeLocalLeaderboard } = require("../src/lib/local-api");

const NOW = Date.parse("2026-10-21T12:00:00Z");

function row(source, model, hourStart, tokens) {
  return { source, model, hour_start: hourStart, total_tokens: tokens };
}

const ROWS = [
  row("claude", "model-a", "2026-10-19T10:00:00Z", 100), // current week (Mon)
  row("codex", "model-a", "2026-10-20T10:00:00Z", 50),
  row("opencode", "model-a", "2026-10-21T10:00:00Z", 30),
  row("gemini", "model-a", "2026-10-13T10:00:00Z", 999), // previous week, same month
  row("workbuddy", "model-a", "2026-09-01T10:00:00Z", 500), // total only
];

function run(overrides = {}) {
  return computeLocalLeaderboard(ROWS, [], {
    period: "week",
    nowMs: NOW,
    displayName: "Test Device",
    machineId: "machine-test",
    ...overrides,
  });
}

test("week/month/total read the local history windows", () => {
  const week = run();
  assert.equal(week.entries.length, 1);
  assert.equal(week.entries[0].total_tokens, 180);
  assert.equal(week.from, "2026-10-19");
  assert.equal(week.to, "2026-10-25");

  const month = run({ period: "month" });
  assert.equal(month.entries[0].total_tokens, 1179);
  assert.equal(month.from, "2026-10-01");
  assert.equal(month.to, "2026-10-31");

  const total = run({ period: "total" });
  assert.equal(total.entries[0].total_tokens, 1679);
  assert.equal(total.from, "2026-09-01");
  assert.equal(total.to, "2026-10-21");
});

test("provider columns partition the same tokens as the total", () => {
  const week = run().entries[0];
  assert.equal(week.claude_tokens, 100);
  assert.equal(week.gpt_tokens, 50);
  assert.equal(week.opencode_tokens, 30);
  assert.equal(week.gemini_tokens, 0);
  assert.equal(week.other_tokens, 0);

  const total = run({ period: "total" }).entries[0];
  assert.equal(total.gemini_tokens, 999);
  assert.equal(total.other_tokens, 500);
  const columnSum = [
    "gpt_tokens",
    "claude_tokens",
    "gemini_tokens",
    "cursor_tokens",
    "kiro_tokens",
    "copilot_tokens",
    "kimi_tokens",
    "opencode_tokens",
    "openclaw_tokens",
    "hermes_tokens",
    "other_tokens",
  ].reduce((sum, key) => sum + total[key], 0);
  assert.equal(columnSum, total.total_tokens);
});

test("the local row is a single self entry with the local profile label", () => {
  const payload = run();
  assert.equal(payload.source, "local");
  assert.equal(payload.total_entries, 1);
  assert.equal(payload.total_pages, 1);
  assert.equal(payload.me, payload.entries[0]);
  assert.equal(payload.entries[0].rank, 1);
  assert.equal(payload.entries[0].is_me, true);
  assert.equal(payload.entries[0].display_name, "Test Device");
  assert.equal(payload.entries[0].machine_id, "machine-test");
  assert.equal(payload.entries[0].user_id, null);
  assert.ok(Array.isArray(payload.entries[0].badges));
});

test("an empty window stays empty instead of inventing a zero row", () => {
  const payload = computeLocalLeaderboard([], [], {
    period: "week",
    nowMs: NOW,
    displayName: "Test Device",
  });
  assert.deepEqual(payload.entries, []);
  assert.equal(payload.me, null);
  assert.equal(payload.total_entries, 0);
  // The window is still the current Monday..Sunday even with no rows.
  assert.equal(payload.from, "2026-10-19");
  assert.equal(payload.to, "2026-10-25");
});
