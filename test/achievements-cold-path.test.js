const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

// KI-033: the achievements endpoint used to await buildSessionAnalytics() on a
// cold cache, so its first request blocked for the whole session rescan (30s+ on
// a degraded machine). It must now answer from the stored sidecar and rebuild in
// the background. This asserts the response is fast AND that the session-derived
// badges still carry their stored values rather than dropping to zero.
test("a cold achievements request does not block on the session scan", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ach-cold-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const tracker = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(tracker, { recursive: true });

  const queue = path.join(tracker, "queue.jsonl");
  fs.writeFileSync(queue, `${JSON.stringify({
    source: "codex", model: "gpt-6", hour_start: "2026-10-20T10:00:00.000Z",
    input_tokens: 1000, output_tokens: 500, cached_input_tokens: 0,
    cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: 1500, billable_total_tokens: 1500, total_cost_usd: 0.01, conversation_count: 1,
  })}\n`);

  // A stored session snapshot with a strong speed sample: these are the values
  // the response must preserve while the background rebuild runs.
  const sidecar = path.join(tracker, "session.queue.jsonl");
  fs.writeFileSync(sidecar, `${JSON.stringify({
    session_id: "kept", session_hash: "abc123", source: "codex", version: 36,
    total_tokens: 1500, duration_ms: 3_600_000, ended_at: "2026-10-20T11:00:00.000Z",
    performance: { estimated_tokens_per_second: 300, estimated_duration_ms: 600000, estimated_output_tokens: 5000 },
  })}\n`);

  const handler = createLocalApiHandler({ queuePath: queue });
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, new URL(req.url, "http://127.0.0.1"))).catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const startedAt = Date.now();
  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/functions/tokentracker-achievements`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
  const elapsed = Date.now() - startedAt;
  const payload = JSON.parse(body);

  assert.ok(elapsed < 5000, `cold request must not wait for the session scan (took ${elapsed}ms)`);
  assert.equal(payload.sessions_pending, true, "the client is told the sidecar is still rebuilding");
  const sprinter = payload.achievements.find((badge) => badge.id === "sprinter");
  const marathon = payload.achievements.find((badge) => badge.id === "session_marathon");
  assert.equal(sprinter.metric_value, 300, "stored speed sample must survive the cold response");
  assert.equal(marathon.metric_value, 3_600_000, "stored session length must survive the cold response");
});
