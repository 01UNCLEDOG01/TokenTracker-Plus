"use strict";

// Tests for the AIHOT 「Token 羊毛」 snapshot source. The fixture encodes a
// loader payload into the same turbo-stream wire format the live page ships
// (flat array + "_<index>" reference keys) so the decoder is exercised against
// real-shape data, not a hand-mocked shortcut.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, afterEach } = require("node:test");

const aihot = require("../src/lib/aihot-free-tokens");

const originalHome = process.env.TOKENTRACKER_HOME;
const dirs = [];

afterEach(() => {
  if (originalHome === undefined) delete process.env.TOKENTRACKER_HOME;
  else process.env.TOKENTRACKER_HOME = originalHome;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-aihot-ft-"));
  dirs.push(dir);
  process.env.TOKENTRACKER_HOME = dir;
  return dir;
}

// --- turbo-stream encoder (mirror of the decoder under test) ---

function enc(value, flat) {
  const idx = flat.length;
  flat.push(null);
  if (value === null || typeof value !== "object") {
    flat[idx] = value;
    return idx;
  }
  if (Array.isArray(value)) {
    flat[idx] = value.map((entry) => enc(entry, flat));
    return idx;
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    const keyIdx = enc(key, flat);
    out[`_${keyIdx}`] = enc(entry, flat);
  }
  flat[idx] = out;
  return idx;
}

function toStreamRoot(loader) {
  // Slot 0 is reserved for the root object; everything else encodes after it
  // so the root reference never collides with the payload's own slot 0.
  const flat = [null];
  const loaderIdx = enc(loader, flat);
  const freeTokensKeyIdx = enc("free-tokens", flat);
  const loaderDataKeyIdx = enc("loaderData", flat);
  const innerIdx = flat.length;
  flat.push({ [`_${freeTokensKeyIdx}`]: loaderIdx });
  flat[0] = { [`_${loaderDataKeyIdx}`]: innerIdx };
  return flat;
}

function fixturePage(loader) {
  const payload = JSON.stringify(toStreamRoot(loader));
  return `<!doctype html><html><head><title>Token 羊毛 · AIHOT</title></head><body>
<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(payload)});</script>
</body></html>`;
}

const SAMPLE_LOADER = {
  deals: [
    {
      id: "doubao-daily-200",
      kind: "daily",
      provider: "豆包",
      title: "豆包电脑版每天签到领 200 额度",
      label: "200 额度",
      yuan: null,
      endsAt: null,
      verifiedAt: "2026-11-08T10:02:34.025Z",
      validity: "发放后 30 天",
      evidence: "official",
      counted: true,
      url: "https://example.com/doubao",
      appliesTo: "非 Pro 模型",
      tags: ["不含 Pro"],
    },
    {
      id: "zed-student",
      kind: "monthly",
      provider: "Zed",
      title: "Zed 在读大学生每月 10 美元 AI 额度",
      label: "≈¥67",
      yuan: 66.7,
      endsAt: null,
      verifiedAt: "2026-11-09T08:00:00.000Z",
      validity: "每月到账，持续 12 个月",
      evidence: "official",
      counted: true,
      url: "https://example.com/zed",
    },
  ],
  ended: [{ id: "old-one", provider: "Ghost" }],
  basis: { mix: "一般用量", ratio: "7 : 2 : 1", usdCny: 6.6728 },
  serverNow: 1794320070258,
};

test("fetch parses the turbo-stream payload into a normalized snapshot", async () => {
  sandbox();
  let calls = 0;
  const reading = await aihot.fetchAihotFreeTokens({
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, text: async () => fixturePage(SAMPLE_LOADER) };
    },
  });
  assert.equal(reading.stale, false);
  assert.equal(reading.error, undefined);
  assert.equal(reading.deal_count, 2);
  assert.equal(reading.ended_count, 1);
  assert.equal(reading.usd_cny, 6.6728);
  assert.equal(reading.mix_ratio, "7 : 2 : 1");
  assert.equal(reading.server_now, 1794320070258);
  assert.equal(reading.items.length, 2);
  const first = reading.items[0];
  assert.equal(first.provider, "豆包");
  assert.equal(first.verified_at, "2026-11-08T10:02:34.025Z");
  assert.equal(first.yuan, null);
  assert.equal(first.ends_at, null);
  const second = reading.items[1];
  assert.equal(second.yuan, 66.7);
  assert.equal(second.kind, "monthly");

  // TTL cache: a second call must not refetch.
  await aihot.fetchAihotFreeTokens({ fetchImpl: async () => { calls += 1; throw new Error("should not refetch"); } });
  assert.equal(calls, 1);

  // Force refresh drops the provider → dropped_providers gains it.
  const next = await aihot.fetchAihotFreeTokens({
    force: true,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixturePage({ ...SAMPLE_LOADER, deals: SAMPLE_LOADER.deals.filter((d) => d.provider !== "豆包") }) }),
  });
  assert.equal(next.deal_count, 1);
  assert.deepEqual(next.dropped_providers, ["豆包"]);
});

test("fetch failure falls back to the cached snapshot marked stale", async () => {
  sandbox();
  const good = await aihot.fetchAihotFreeTokens({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => fixturePage(SAMPLE_LOADER) }),
  });
  assert.equal(good.stale, false);

  const stale = await aihot.fetchAihotFreeTokens({
    force: true,
    fetchImpl: async () => ({ ok: false, status: 503, text: async () => "" }),
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.deal_count, 2, "cached deals survive");
  assert.match(stale.error, /503/);
});

test("a page without the stream payload errors, and an empty store stays empty", async () => {
  sandbox();
  const empty = await aihot.fetchAihotFreeTokens({
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "<html><body>nothing here</body></html>" }),
  });
  assert.equal(empty.deal_count, 0);
  assert.equal(empty.stale, false);
  assert.match(empty.error, /payload not found/);

  assert.throws(() => aihot.parseFreeTokensPage("<html></html>"), /payload not found/);
  assert.throws(() => aihot.parseFreeTokensPage('<script>window.__reactRouterContext.streamController.enqueue("[1,2]");</script>'), /malformed|missing/);
});

test("multi-fragment streams are concatenated before decode", async () => {
  const flat = toStreamRoot(SAMPLE_LOADER);
  const payload = JSON.stringify(flat);
  // Split the serialized array in half across two enqueue fragments — the
  // decoder must join them (stream semantics) instead of parsing each alone.
  const half = Math.floor(payload.length / 2);
  const page = `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(payload.slice(0, half))});</script>
<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(payload.slice(half))});</script>`;
  const loader = aihot.parseFreeTokensPage(page);
  assert.equal(loader.deals.length, 2);
});
