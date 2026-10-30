"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  fetchGlobalModels,
  buildBoard,
  extractFlightPayload,
  extractInitialModels,
  cachePath,
  CACHE_TTL_MS,
  SCHEMA,
} = require("../src/lib/global-models");

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-global-models-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

// AA server-renders the same array its charts use; the page ships it inside a
// React flight chunk, so the fixture has to reproduce that chunked encoding.
function aaHtml(models) {
  const flight = `22:["$","div",null,{"initialModelCount":3,"initialModels":${JSON.stringify(models)}}]`;
  return [
    "<html><body><script>",
    "self.__next_f.push([0])",
    "</script><script>",
    `self.__next_f.push([1,${JSON.stringify(flight)}])`,
    "</script></body></html>",
  ].join("");
}

const MODELS = [
  {
    slug: "gemini-4-carbon",
    name: "Gemini 4 Carbon (High)",
    deprecated: false,
    isOpenWeights: false,
    modelCreatorName: "Google",
    modelCreatorLogo: "/img/logos/google.svg",
    contextWindowTokens: 1000000,
    intelligenceIndex: 59.4257,
    intelligenceIndexIsEstimated: false,
    price1mInputTokens: 4,
    price1mOutputTokens: 20,
    cacheHitPrice: 0.2,
    medianOutputTokensPerSecond: 82.5,
  },
  {
    slug: "claude-opus-5.5",
    name: "Claude Opus 5.5 (Max, Default Fallback)",
    deprecated: false,
    modelCreatorName: "Anthropic",
    contextWindowTokens: 1000000,
    intelligenceIndex: 58.406,
    intelligenceIndexIsEstimated: false,
    price1mInputTokens: 4,
    price1mOutputTokens: 20,
  },
  {
    slug: "unmeasured-model",
    name: "Unmeasured Model",
    deprecated: false,
    modelCreatorName: "Some Lab",
    intelligenceIndex: null,
    price1mInputTokens: null,
    price1mOutputTokens: null,
  },
  {
    slug: "retired-model",
    name: "Retired Model",
    deprecated: true,
    modelCreatorName: "Some Lab",
    intelligenceIndex: 99,
  },
  {
    slug: "grok-5",
    name: "Grok 5 (High)",
    deprecated: false,
    modelCreatorName: "SpaceXAI",
    intelligenceIndex: 41.2,
    intelligenceIndexIsEstimated: true,
  },
];

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

test("extracts, ranks and caches the Artificial Analysis board", async () => {
  const home = sandbox();
  try {
    let calls = 0;
    const first = await fetchGlobalModels({
      home,
      nowMs: 1000,
      fetchImpl: async () => { calls += 1; return response(aaHtml(MODELS)); },
    });
    assert.equal(calls, 1);
    assert.equal(first.stale, false);
    assert.equal(first.error, undefined);
    assert.equal(first.schema, SCHEMA);
    assert.equal(first.model_count, 5);
    // Unmeasured (null index) and deprecated rows are dropped, not ranked as 0.
    assert.deepEqual(first.items.map((row) => row.model), ["gemini-4-carbon", "claude-opus-5.5", "grok-5"]);
    assert.equal(first.items[0].rank, 1);
    assert.equal(first.items[0].intelligence, 59.4257);
    assert.equal(first.items[0].provider, "Google");
    assert.equal(first.items[0].provider_icon, "gemini");
    assert.equal(first.items[0].cache_hit_per_million_usd, 0.2);
    assert.equal(first.items[0].median_output_tokens_per_second, 82.5);
    // Anthropic has no bundled brand mark here: text label only, no placeholder.
    assert.equal(first.items[1].provider_icon, null);
    assert.equal(first.items[2].intelligence_is_estimated, true);
    // A model without published prices must not collapse to $0.
    assert.equal(first.items[2].input_per_million_usd, null);

    const second = await fetchGlobalModels({
      home,
      nowMs: 2000,
      fetchImpl: async () => { calls += 1; return response(aaHtml(MODELS)); },
    });
    assert.equal(calls, 1, "fresh cache must not refetch");
    assert.equal(second.items[0].display_name, "Gemini 4 Carbon (High)");
    assert.equal(fs.existsSync(cachePath(home)), true);
  } finally {
    cleanup(home);
  }
});

test("force refresh bypasses the cache window", async () => {
  const home = sandbox();
  try {
    let calls = 0;
    const fetchImpl = async () => { calls += 1; return response(aaHtml(MODELS)); };
    await fetchGlobalModels({ home, nowMs: 1000, fetchImpl });
    await fetchGlobalModels({ home, nowMs: 1000 + CACHE_TTL_MS - 1, fetchImpl });
    assert.equal(calls, 1);
    await fetchGlobalModels({ home, nowMs: 1000 + CACHE_TTL_MS - 1, force: true, fetchImpl });
    assert.equal(calls, 2);
  } finally {
    cleanup(home);
  }
});

test("serves the last good cache when the source fails", async () => {
  const home = sandbox();
  try {
    await fetchGlobalModels({ home, nowMs: 1000, fetchImpl: async () => response(aaHtml(MODELS)) });
    const stale = await fetchGlobalModels({
      home,
      nowMs: 1000 + 2 * CACHE_TTL_MS,
      force: true,
      fetchImpl: async () => { throw new Error("offline"); },
    });
    assert.equal(stale.stale, true);
    assert.match(stale.error, /offline/);
    assert.equal(stale.items.length, 3);
  } finally {
    cleanup(home);
  }
});

test("ignores a stale-schema cache instead of serving the old board", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(
      cachePath(home),
      JSON.stringify({
        schema: 1,
        fetched_at_ms: 1,
        items: [{ rank: 1, model: "gpt-5.4-pro", composite: 81.9, provisional: true }],
      }),
    );
    const result = await fetchGlobalModels({
      home,
      nowMs: 2 * CACHE_TTL_MS,
      fetchImpl: async () => { throw new Error("offline"); },
    });
    assert.equal(result.stale, false);
    assert.match(result.error, /offline/);
    assert.deepEqual(result.items, [], "the composite board rows must not survive");
  } finally {
    cleanup(home);
  }
});

test("reports an explicit error when the page format changed", async () => {
  const home = sandbox();
  try {
    const result = await fetchGlobalModels({
      home,
      fetchImpl: async () => response("<html><body>redesigned</body></html>"),
    });
    assert.deepEqual(result.items, []);
    assert.match(result.error, /payload not found/);
    assert.equal(fs.existsSync(cachePath(home)), false);
  } finally {
    cleanup(home);
  }
});

test("flight decoding concatenates chunks before the array is read", () => {
  const models = [MODELS[0], MODELS[1]];
  const flight = `23:["$","div",null,{"initialModels":${JSON.stringify(models)}}]`;
  // React can split the payload across several push() literals, so the array is
  // only findable after every chunk is decoded and joined in document order.
  const cut = flight.indexOf('"initialModels"') + 1;
  const html = [
    `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(0, cut))}])</script>`,
    `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(cut))}])</script>`,
  ].join("");
  const parsed = extractInitialModels(extractFlightPayload(html));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].slug, "gemini-4-carbon");
  assert.equal(buildBoard(parsed)[0].rank, 1);
});
