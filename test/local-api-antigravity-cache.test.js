"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test, beforeEach, afterEach } = require("node:test");

let tmpHome;
let prevHome;
let prevUserProfile;
let prevCacheDir;
let queuePath;
let cacheDir;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ag-api-"));
  queuePath = path.join(tmpHome, "queue.jsonl");
  cacheDir = path.join(tmpHome, "tokscale-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  prevHome = process.env.HOME;
  prevUserProfile = process.env.USERPROFILE;
  prevCacheDir = process.env.TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR = cacheDir;
});

afterEach(() => {
  const restore = (key, value) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  restore("HOME", prevHome);
  restore("USERPROFILE", prevUserProfile);
  restore("TOKENTRACKER_TOKSCALE_ANTIGRAVITY_DIR", prevCacheDir);
  try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

function row({ model, hour, tokens }) {
  return {
    source: "antigravity", model, hour_start: hour,
    input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: tokens, billable_total_tokens: tokens,
    total_cost_usd: 0, conversation_count: 0,
  };
}

async function request(handler, url) {
  const urlObj = new URL(`http://localhost${url}`);
  const base = Readable.from([]);
  base.method = "GET";
  base.url = urlObj.pathname + urlObj.search;
  base.headers = { host: "localhost" };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    end(body) { if (body) chunks.push(body); },
  };
  assert.equal(await handler(base, res, urlObj), true);
  return JSON.parse(chunks.join(""));
}

test("the local API prefers measured antigravity days and keeps other estimates", async () => {
  fs.writeFileSync(queuePath, [
    row({ model: "gemini-3.8-flash-n", hour: "2026-10-04T06:00:00.000Z", tokens: 1000 }),
    row({ model: "gemini-3.8-flash-n", hour: "2026-10-12T06:00:00.000Z", tokens: 2000 }),
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  fs.writeFileSync(path.join(cacheDir, "session.jsonl"), JSON.stringify({
    type: "usage", sessionId: "s1", modelId: "gemini-3.8-flash-n",
    timestamp: Date.UTC(2026, 9, 4, 5, 10), input: 100, cacheRead: 900,
    cacheWrite: 0, output: 50, reasoning: 10,
  }) + "\n");

  delete require.cache[require.resolve("../src/lib/local-api")];
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({
    queuePath,
    trackerDataDir: path.join(tmpHome, ".tokentracker", "tracker"),
  });
  const body = await request(handler, "/functions/tokentracker-usage-model-breakdown?from=2026-10-04&to=2026-10-12&tz=Asia/Shanghai");
  const antigravity = body.sources.find((source) => source.source === "antigravity");
  assert.ok(antigravity, "antigravity source is present");
  assert.equal(antigravity.totals.total_tokens, 3060, "1060 measured + 2000 uncovered estimate");
  assert.equal(antigravity.models.length, 1);
  assert.equal(antigravity.models[0].model, "gemini-3.8-flash-n");
  assert.equal(antigravity.models[0].totals.total_tokens, 3060);
});
