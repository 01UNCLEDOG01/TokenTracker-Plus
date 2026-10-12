"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test, beforeEach, afterEach } = require("node:test");
const { computeRowCost } = require("../src/lib/pricing");

// scopedQueueRows() is the single injection point every usage endpoint reads
// through, so these tests drive the real handler and compare the response with
// and without a Qoder international transcript tree. Anything the card needs
// has to show up in the payload, not in the module's own unit.
let tmpHome;
let prevHome;
let prevUserProfile;
let prevProjectsDir;
let projects;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-qintl-home-"));
  projects = path.join(tmpHome, "qoder-projects");
  fs.mkdirSync(projects, { recursive: true });
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevProjectsDir = process.env.QODER_PROJECTS_DIR;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.QODER_PROJECTS_DIR = projects;
});

afterEach(() => {
  const restore = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("HOME", prevHome);
  restore("USERPROFILE", prevUserProfile);
  restore("QODER_PROJECTS_DIR", prevProjectsDir);
  try {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function freshHandler(queuePath) {
  delete require.cache[require.resolve("../src/lib/local-api")];
  const { createLocalApiHandler } = require("../src/lib/local-api");
  return createLocalApiHandler({
    queuePath,
    trackerDataDir: path.join(tmpHome, ".tokentracker", "tracker"),
  });
}

function makeReq(endpoint, method = "GET") {
  const urlObj = new URL(`http://localhost${endpoint}`);
  const base = Readable.from([]);
  base.method = method;
  base.url = urlObj.pathname + urlObj.search;
  base.headers = { host: "localhost" };
  return { base, urlObj };
}

async function call(handler, endpoint) {
  const { base, urlObj } = makeReq(endpoint);
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(base, res, urlObj);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(""));
}

const QUEUE_ROW = {
  source: "claude",
  model: "claude-sonnet-4-6",
  hour_start: "2026-04-20T10:00:00.000Z",
  input_tokens: 100,
  cached_input_tokens: 0,
  cache_creation_input_tokens: 0,
  output_tokens: 20,
  reasoning_output_tokens: 0,
  total_tokens: 120,
  conversation_count: 1,
};

function writeQueue(queuePath) {
  fs.writeFileSync(queuePath, JSON.stringify(QUEUE_ROW) + "\n");
}

function writeIntlTranscript(creditsList) {
  const dir = path.join(projects, "C--work-proj");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "sess-1.jsonl"),
    creditsList
      .map((credits, i) =>
        JSON.stringify({
          type: "assistant",
          timestamp: `2026-10-09T0${6 + i}:00:00.000Z`,
          message: { role: "assistant", model: "gpt-5.6-high", usage: { input_tokens: 0, output_tokens: 0, credits } },
        })
      )
      .join("\n") + "\n"
  );
}

const SUMMARY = "/functions/tokentracker-usage-summary?from=2026-01-01&to=2026-12-31";
const DAILY = "/functions/tokentracker-usage-daily?from=2026-01-01&to=2026-12-31";
const BREAKDOWN = "/functions/tokentracker-usage-model-breakdown?from=2026-01-01&to=2026-12-31";

test("the credit spend reaches every usage endpoint and carries derived tokens", async () => {
  const queuePath = path.join(tmpHome, "queue.jsonl");
  writeQueue(queuePath);
  const withoutTranscripts = {
    summary: await call(freshHandler(queuePath), SUMMARY),
    daily: await call(freshHandler(queuePath), DAILY),
    breakdown: await call(freshHandler(queuePath), BREAKDOWN),
  };

  writeIntlTranscript([2, 3]);
  const handler = freshHandler(queuePath);
  const summary = await call(handler, SUMMARY);
  const daily = await call(handler, DAILY);
  const breakdown = await call(handler, BREAKDOWN);

  const base = Number(withoutTranscripts.summary.totals.total_cost_usd);
  const costDelta = Number(summary.totals.total_cost_usd) - base;
  assert.ok(Math.abs(costDelta - 0.05) < 1e-9, `5 credits must add $0.05, got ${costDelta}`);
  // 5 credits = $0.05, which at the qwen3.8-flash input rate (0.15 USD/MTok)
  // is ~333,333 derived tokens. They are derived, never read off the wire.
  const derived = Math.round((0.05 / 0.15) * 1e6);
  assert.equal(summary.totals.total_tokens, withoutTranscripts.summary.totals.total_tokens + derived, "the derived tokens land on the cloud total");
  assert.equal(
    summary.totals.conversation_count,
    withoutTranscripts.summary.totals.conversation_count,
    "requests are not conversations",
  );

  // Both records of writeIntlTranscript land on 2026-10-09 Beijing time, so
  // that is the single day that gains money and derived tokens.
  const creditDay = daily.data.find((d) => d.day === "2026-10-09");
  assert.ok(creditDay, "the transcript day must be present in the daily rows");
  assert.ok(Math.abs(Number(creditDay.total_cost_usd) - 0.05) < 1e-9);
  assert.equal(creditDay.total_tokens, derived, "the credit day carries its derived tokens");

  const qoder = breakdown.sources.find((s) => s.source === "qoder");
  assert.ok(qoder, "the breakdown must carry a qoder source");
  assert.equal(qoder.totals.total_tokens, derived);
  assert.equal(qoder.totals.total_cost_usd, "0.050000");
  assert.equal(qoder.models.length, 1);
  assert.equal(qoder.models[0].model, "gpt-5.6-high");
  // Without this the dashboard labels the money "Estimated from model pricing"
  // for a source that has no model pricing at all.
  assert.equal(qoder.models[0].cost_source, "provider_reported");
  assert.equal(withoutTranscripts.breakdown.sources.find((s) => s.source === "qoder"), undefined);
});

test("an absent transcript tree adds nothing", async () => {
  const queuePath = path.join(tmpHome, "queue.jsonl");
  writeQueue(queuePath);
  const handler = freshHandler(queuePath);
  const summary = await call(handler, SUMMARY);
  const breakdown = await call(handler, BREAKDOWN);
  assert.equal(breakdown.sources.find((s) => s.source === "qoder"), undefined);
  assert.equal(summary.totals.total_tokens, 120);
  // Priced off the same table the endpoint uses, so a rate refresh cannot turn
  // this into a red that has nothing to do with the credit injection.
  assert.equal(Number(summary.totals.total_cost_usd), computeRowCost(QUEUE_ROW), JSON.stringify(summary.totals));
});
