"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildSessionAnalytics } = require("../src/lib/session-analytics");

// Antigravity usage buckets are UTC half-hour granules, so a session that
// never crosses a bucket boundary yields one distinct usage timestamp. The
// rate denominator must fall back to the measured session span instead of
// dividing the whole output by the 1s seed (v44 regression, 20k+ tok/s).
function writeAntigravitySession(home, uuid, createdAts) {
  const logsDir = path.join(home, ".gemini", "antigravity", "brain", uuid, ".system_generated", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const lines = createdAts.map((created_at, index) => JSON.stringify({
    type: "PLANNER_RESPONSE",
    step_index: index,
    created_at,
    content: `planner output chunk ${index} with enough text for the estimator to attribute a nonzero token count to this response line of the conversation`,
  }));
  fs.writeFileSync(path.join(logsDir, "transcript.jsonl"), lines.join("\n") + "\n");
  const conversations = path.join(home, ".gemini", "antigravity", "conversations");
  fs.mkdirSync(conversations, { recursive: true });
  // The conversation db is optional for the scan; an empty file exercises the
  // unreadable-db fallback (readAntigravityConversationDb → null).
  fs.writeFileSync(path.join(conversations, `${uuid}.db`), "");
}

test("a single half-hour usage bucket rates against the measured span, not the 1s seed", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-antigravity-speed-"));
  try {
    // Both responses land in the 21:30 bucket → one distinct usage timestamp.
    writeAntigravitySession(home, "aaaaaaaa-1111-4111-8111-111111111111", [
      "2026-10-13T21:40:00.000Z",
      "2026-10-13T21:50:00.000Z",
    ]);
    // Control: the second response crosses into the 22:00 bucket → two
    // distinct timestamps keep the qoder-precedent interval denominator.
    writeAntigravitySession(home, "bbbbbbbb-2222-4222-8222-222222222222", [
      "2026-10-13T21:40:00.000Z",
      "2026-10-13T22:10:00.000Z",
    ]);

    const sessions = await buildSessionAnalytics({ home, force: true, cacheTtlMs: 0 });
    const byId = new Map(sessions.map((row) => [row.session_id, row]));

    const collapsed = byId.get("aaaaaaaa-1111-4111-8111-111111111111");
    assert.ok(collapsed, "in-bucket session must be listed");
    assert.equal(collapsed.speed_active_ms, 0);
    assert.equal(collapsed.active_ms, 10 * 60 * 1000);
    assert.equal(collapsed.performance_source, "wall-clock");
    assert.equal(collapsed.performance.estimated_duration_ms, 10 * 60 * 1000);
    const output = (collapsed.output_tokens || 0) + (collapsed.reasoning_output_tokens || 0);
    assert.ok(output > 0, "fixture must produce output tokens");
    assert.ok(Math.abs(collapsed.performance.estimated_tokens_per_second - output / 600) < 1e-9);

    const straddling = byId.get("bbbbbbbb-2222-4222-8222-222222222222");
    assert.ok(straddling, "bucket-straddling session must be listed");
    // 1s seed + the 30-minute bucket gap capped at five minutes.
    assert.equal(straddling.speed_active_ms, 301_000);
    assert.equal(straddling.performance.estimated_duration_ms, 301_000);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
