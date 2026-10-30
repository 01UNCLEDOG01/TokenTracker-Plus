"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchGlobalModels, cachePath } = require("../src/lib/global-models");

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-global-models-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const PAYLOAD = {
  data: {
    updated_at: "2026-10-30T05:00:00.000Z",
    attribution: ["LMArena leaderboard dataset", "Source: OpenRouter", "SWE-bench Verified", "Artificial Analysis"],
    items: [
      { rank: 1, model: "claude-opus-5.5", display_name: "Anthropic: Claude Opus 5.5", provider: "anthropic", composite: 86.3, input_per_million_usd: 4, output_per_million_usd: 20, source_count: 2, provisional: true, signals: { aa_intelligence: 58.4, openrouter_share_pct: 4.27 } },
      { rank: 2, model: "deepseek-v4.1-flash", provider: "deepseek", composite: 83.8, signals: { openrouter_share_pct: 30.5 } },
    ],
  },
};

test("fetches, normalizes and caches the global board", async () => {
  const home = sandbox();
  try {
    let calls = 0;
    const first = await fetchGlobalModels({
      home,
      nowMs: 1000,
      fetchImpl: async () => { calls += 1; return response(PAYLOAD); },
    });
    assert.equal(calls, 1);
    assert.equal(first.stale, false);
    assert.equal(first.items.length, 2);
    assert.equal(first.items[0].composite, 86.3);
    assert.equal(first.items[0].signals.aa_intelligence, 58.4);

    const second = await fetchGlobalModels({
      home,
      nowMs: 2000,
      fetchImpl: async () => { calls += 1; return response(PAYLOAD); },
    });
    assert.equal(calls, 1, "fresh cache must not refetch");
    assert.equal(second.items[0].model, "claude-opus-5.5");
  } finally {
    cleanup(home);
  }
});

test("serves the last good cache when the source fails", async () => {
  const home = sandbox();
  try {
    await fetchGlobalModels({ home, nowMs: 1000, fetchImpl: async () => response(PAYLOAD) });
    const stale = await fetchGlobalModels({
      home,
      nowMs: 1000 + 2 * 60 * 60 * 1000,
      force: true,
      fetchImpl: async () => { throw new Error("offline"); },
    });
    assert.equal(stale.stale, true);
    assert.match(stale.error, /offline/);
    assert.equal(stale.items.length, 2);
  } finally {
    cleanup(home);
  }
});

test("returns an explicit error when there is no cache", async () => {
  const home = sandbox();
  try {
    const result = await fetchGlobalModels({
      home,
      fetchImpl: async () => response({ data: { items: [] } }),
    });
    assert.deepEqual(result.items, []);
    assert.match(result.error, /empty/);
    assert.equal(fs.existsSync(cachePath(home)), false);
  } finally {
    cleanup(home);
  }
});
