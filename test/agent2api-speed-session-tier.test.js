"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

// The speed tab used to read ONLY the Agent2API gateway ledger, so models
// whose CLI talks to providers directly (DeepSeek Harness, Codex, …) never
// appeared even though the sessions page shows their wall-clock speed. The
// endpoint now folds the session sidecar's per-model performance in as a
// second, clearly-labelled evidence tier. Three semantics are load-bearing:
//
// 1. A multi-model session carries ONE wall-clock measurement — its duration
//    must be counted once per session, not once per model row (three rows each
//    claiming the session's 1.29s would read as a third of the real speed).
// 2. Gateway rows win: a model the gateway measured keeps its per-request
//    numbers; the session tier only fills models the gateway never saw.
// 3. The day range filters both tiers with the sessions page's own scoping
//    (a session counts when any of its days falls inside the range).

function writeFixtureDb(dbPath, rows) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "CREATE TABLE requests (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, "
      + "client TEXT, client_model TEXT, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, "
      + "total_tokens INTEGER, cache_read_tokens INTEGER, status INTEGER, duration_ms INTEGER, "
      + "first_response_ms INTEGER)",
  );
  for (const row of rows) {
    db.prepare("INSERT INTO requests (ts, client, client_model, model, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, status, duration_ms, first_response_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(...row);
  }
  db.close();
}

test("speed endpoint folds session wall-clock rows under gateway priority", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-speed-tier-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const tracker = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(tracker, { recursive: true });
  const queue = path.join(tracker, "queue.jsonl");
  fs.writeFileSync(queue, "");

  const dbPath = path.join(home, ".agent2api", "agent2api.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // Base time: 2026-11-08 02:00 UTC — comfortably inside any day window the
  // request below uses (no tz params default to UTC day keys).
  const base = Date.UTC(2026, 10, 8, 2, 0, 0);
  // Gateway measured glm-5.3-flash: 2 requests, 600 output tokens over 2000ms
  // → 300 tok/s; the sidecar ALSO has a glm row whose numbers must be ignored.
  writeFixtureDb(dbPath, [
    [base, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 1000, 300, 1300, 0, 200, 1200, 900],
    [base + 60_000, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 1000, 300, 1300, 0, 200, 800, 700],
  ]);

  // Session sidecar: one MULTI-model dsh session (one wall-clock measurement
  // 10_000ms shared by both model rows) plus one single-model codex session.
  // Session A: model-alpha 6_000 output / 80 events, model-beta 4_000 / 20
  // events → the 10s duration is split, not summed: alpha 600 tok/s, beta 400.
  // Session B: gpt-6.1-sol 1_000 output over 5_000ms → 200 tok/s.
  const sidecar = path.join(tracker, "session.queue.jsonl");
  const multiPerf = { estimated_output_tokens: 10_000, estimated_duration_ms: 10_000, estimated_request_count: 100, estimated_tokens_per_second: 1000 };
  const sessions = [
    {
      session_id: "multi", session_hash: "hash-multi", source: "dsh", version: 47,
      started_at: "2026-11-08T01:00:00.000Z", ended_at: "2026-11-08T02:00:00.000Z",
      total_tokens: 20_000, duration_ms: 10_000, turns: 100,
      model_usage: [
        { model: "model-alpha", output_tokens: 6_000, usage_events: 80, performance: multiPerf },
        { model: "model-beta", output_tokens: 4_000, usage_events: 20, performance: multiPerf },
      ],
      performance: multiPerf,
    },
    {
      session_id: "single", session_hash: "hash-single", source: "codex", version: 47,
      started_at: "2026-11-08T01:30:00.000Z", ended_at: "2026-11-08T01:40:00.000Z",
      total_tokens: 1_000, duration_ms: 5_000, turns: 5,
      model_usage: [
        { model: "gpt-6.1-sol", output_tokens: 1_000, usage_events: 5, performance: { estimated_output_tokens: 1_000, estimated_duration_ms: 5_000, estimated_request_count: 5, estimated_tokens_per_second: 200 } },
      ],
      performance: { estimated_output_tokens: 1_000, estimated_duration_ms: 5_000, estimated_request_count: 5, estimated_tokens_per_second: 200 },
    },
    // A glm row that must be IGNORED: the gateway already measured this model.
    {
      session_id: "shadow", session_hash: "hash-shadow", source: "codex", version: 47,
      started_at: "2026-11-08T01:45:00.000Z", ended_at: "2026-11-08T01:50:00.000Z",
      total_tokens: 99_000, duration_ms: 99_000, turns: 9,
      model_usage: [
        { model: "glm-5.3-flash", output_tokens: 99_000, usage_events: 9, performance: { estimated_output_tokens: 99_000, estimated_duration_ms: 99_000, estimated_request_count: 9, estimated_tokens_per_second: 1 } },
      ],
      performance: { estimated_output_tokens: 99_000, estimated_duration_ms: 99_000, estimated_request_count: 9, estimated_tokens_per_second: 1 },
    },
  ];
  fs.writeFileSync(sidecar, sessions.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const handler = createLocalApiHandler({
    queuePath: queue,
    trackerDataDir: tracker,
  });
  // Point the gateway resolver at the fixture database.
  const previousDbEnv = process.env.TOKENTRACKER_AGENT2API_DB;
  process.env.TOKENTRACKER_AGENT2API_DB = dbPath;
  t.after(() => {
    if (previousDbEnv === undefined) delete process.env.TOKENTRACKER_AGENT2API_DB;
    else process.env.TOKENTRACKER_AGENT2API_DB = previousDbEnv;
  });

  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, new URL(req.url, "http://127.0.0.1"))).catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();

  const body = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/functions/tokentracker-agent2api-speed?from=2026-11-08&to=2026-11-08`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(data));
    }).on("error", reject);
  });
  const payload = JSON.parse(body);
  assert.equal(payload.available, true);
  // The gateway-measured model must appear EXACTLY ONCE. Without the
  // priority filter the session row would ride along as a duplicate model
  // line (and a React key collision in the UI), so assert the row count and
  // the absence of a session-sourced glm before reading the per-model fields.
  assert.equal(payload.models.length, 4);
  assert.ok(!payload.models.some(function (m) {
    return m.model === "glm-5.3-flash" && m.speed_source === "session";
  }), "the session tier must not duplicate a model the gateway measured");
  const byModel = new Map(payload.models.map((m) => [m.model, m]));

  // Gateway tier keeps its measured numbers and is labelled.
  const gateway = byModel.get("glm-5.3-flash");
  assert.ok(gateway, "gateway model must be present");
  assert.equal(gateway.speed_source, "gateway");
  assert.equal(gateway.requests, 2);
  assert.equal(gateway.output_tokens, 600);
  assert.equal(gateway.tokens_per_second, 300);
  assert.equal(gateway.avg_first_response_ms, 800);

  // Session tier fills the models the gateway never saw, correctly splitting
  // the one wall-clock measurement of the multi-model session.
  const alpha = byModel.get("model-alpha");
  assert.ok(alpha, "session model-alpha must be folded in");
  assert.equal(alpha.speed_source, "session");
  assert.equal(alpha.requests, 80);
  assert.equal(alpha.output_tokens, 6_000);
  assert.equal(alpha.tokens_per_second, 600);
  assert.equal(alpha.avg_first_response_ms, null);

  const beta = byModel.get("model-beta");
  assert.ok(beta, "session model-beta must be folded in");
  assert.equal(beta.speed_source, "session");
  assert.equal(beta.output_tokens, 4_000);
  assert.equal(beta.tokens_per_second, 400);

  const sol = byModel.get("gpt-6.1-sol");
  assert.ok(sol, "single-model session must be folded in");
  assert.equal(sol.speed_source, "session");
  assert.equal(sol.tokens_per_second, 200);

  // Rows sort by output tokens across both tiers.
  const outputs = payload.models.map((m) => m.output_tokens);
  assert.deepEqual(outputs, [...outputs].sort((a, b) => b - a));
});

test("speed endpoint session tier respects the day range", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-speed-range-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const tracker = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(tracker, { recursive: true });
  const queue = path.join(tracker, "queue.jsonl");
  fs.writeFileSync(queue, "");

  // No gateway database at all: the endpoint used to answer available:false
  // with no models; now the session tier alone can still answer.
  const sidecar = path.join(tracker, "session.queue.jsonl");
  const session = {
    session_id: "s", session_hash: "h", source: "dsh", version: 47,
    started_at: "2026-11-07T23:00:00.000Z", ended_at: "2026-11-08T01:00:00.000Z",
    total_tokens: 500, duration_ms: 2_000, turns: 2,
    model_usage: [
      { model: "deepseek-flash", output_tokens: 500, usage_events: 2, performance: { estimated_output_tokens: 500, estimated_duration_ms: 2_000, estimated_request_count: 2, estimated_tokens_per_second: 250 } },
    ],
    performance: { estimated_output_tokens: 500, estimated_duration_ms: 2_000, estimated_request_count: 2, estimated_tokens_per_second: 250 },
  };
  fs.writeFileSync(sidecar, JSON.stringify(session) + "\n");

  const handler = createLocalApiHandler({
    queuePath: queue,
    trackerDataDir: tracker,
  });
  // The real gateway DB may exist on this machine — hide it.
  const previousDbEnv = process.env.TOKENTRACKER_AGENT2API_DB;
  process.env.TOKENTRACKER_AGENT2API_DB = path.join(home, "missing", "agent2api.db");
  t.after(() => {
    if (previousDbEnv === undefined) delete process.env.TOKENTRACKER_AGENT2API_DB;
    else process.env.TOKENTRACKER_AGENT2API_DB = previousDbEnv;
  });

  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res, new URL(req.url, "http://127.0.0.1"))).catch((error) => {
      res.statusCode = 500;
      res.end(String(error));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const call = (query) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port(server)}/functions/tokentracker-agent2api-speed${query}`, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
  function port(server) { return server.address().port; }

  // The session spans 11-07 23:00 → 11-08 01:00 UTC. withinDayRange semantics
  // (same as the sessions page): a session counts when its END day is >= from
  // AND its START day is <= to. A session spanning midnight therefore appears
  // in BOTH days' windows; only a fully disjoint window (11-06) excludes it.
  const today = await call("?from=2026-11-08&to=2026-11-08");
  assert.equal(today.available, true);
  assert.ok(today.models.some((m) => m.model === "deepseek-flash" && m.speed_source === "session"));

  const yesterday = await call("?from=2026-11-07&to=2026-11-07");
  assert.ok(yesterday.models.some((m) => m.model === "deepseek-flash"),
    "a midnight-spanning session counts in both of its days' windows");

  const older = await call("?from=2026-11-06&to=2026-11-06");
  assert.equal(older.models.length, 0);
});
