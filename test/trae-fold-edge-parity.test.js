"use strict";

// The TRAE cache fold now lives in five places that must agree:
//
//   - src/lib/local-api.js foldTraeRowCost        (本机数据 — the canonical one)
//   - dashboard/edge-patches/tokentracker-account-summary.ts
//   - dashboard/edge-patches/tokentracker-account-daily.ts
//   - dashboard/edge-patches/tokentracker-account-model-breakdown.ts
//   - dashboard/edge-patches/tokentracker-leaderboard-profile.ts
//
// Owner report 2026-11-15: the cloud copies priced TRAE's unreported cache at
// the list-price ceiling (trae-cn $6,003 of a $10,292 account total) while the
// local fold priced the same rows at a quarter of that. A copy drifting again
// would reopen that gap silently, so this test loads every copy and asserts
// the SAME verdict on the SAME fixture rows:
//
//   - non-TRAE rows: never folded
//   - rows without the coverage signal (leaderboard rollup family): ceiling —
//     DELIBERATELY different from the local copy, which folds pre-signal rows
//     (undefined = unmeasured): the edge's null means "this chain cannot know
//     coverage" (the rollup family), and folding there would double-discount
//     its reported rows. Asserted as an explicit divergence below so a future
//     edit to either side trips instead of passing silently.
//   - well-covered rows (coverage >= 0.5): measured truth, ceiling
//   - unmeasured rows with a pool: ceiling × ((1−h) + h×cacheRead/input)
//   - models without a fielded pool: the edition's recognized rate
//   - an edition with no evidence at all: ceiling (never borrowed, never made up)
//
// The evidence reader shared by the local fold and the cloud upload
// (src/lib/trae-fold-evidence.js) is pinned too: edition scoping, the
// recognized-rate median, and the upload rows (largest-pool upsert side).

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("esbuild");
const { test } = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");
const EDGE_DIR = path.join(ROOT, "dashboard/edge-patches");

const EDGE_COPIES = [
  "tokentracker-account-summary.ts",
  "tokentracker-account-daily.ts",
  "tokentracker-account-model-breakdown.ts",
  "tokentracker-leaderboard-profile.ts",
];

function loadFold(name) {
  const source = fs.readFileSync(path.join(EDGE_DIR, name), "utf8");
  const match = source.match(/\nfunction foldTraeRowCost\([\s\S]*?\n\}/u);
  assert.ok(match, `${name}: foldTraeRowCost not found`);
  const js = transformSync(match[0], { loader: "ts" }).code;
  const context = {
    getRowPricing: () => ({ input: 0.95, output: 4, cache_read: 0.19 }),
    computeRowCost: (row) => {
      // Linear stand-in with the same shape the edge copies call through.
      return ((Number(row.input_tokens) || 0) * 0.95 +
        (Number(row.output_tokens) || 0) * 4 +
        (Number(row.cached_input_tokens) || 0) * 0.19 +
        (Number(row.cache_creation_input_tokens) || 0) * 0) / 1_000_000;
    },
  };
  vm.runInNewContext(js, context);
  assert.equal(typeof context.foldTraeRowCost, "function", `${name}: fold did not evaluate`);
  return context.foldTraeRowCost;
}

// The local canonical copy: extract foldTraeRowCost from local-api.js the same
// way (its pricing helpers resolve through require, so inject stand-ins too).
function loadLocalFold() {
  const source = fs.readFileSync(path.join(ROOT, "src/lib/local-api.js"), "utf8");
  const match = source.match(/\nfunction foldTraeRowCost\(row, cost\) \{[\s\S]*?\n\}/u);
  assert.ok(match, "local-api.js: foldTraeRowCost not found");
  const context = {
    computeRowCost: (row) => {
      return ((Number(row.input_tokens) || 0) * 0.95 +
        (Number(row.output_tokens) || 0) * 4 +
        (Number(row.cached_input_tokens) || 0) * 0.19 +
        (Number(row.cache_creation_input_tokens) || 0) * 0) / 1_000_000;
    },
    // The local fold reads prices through getModelPricingInfo(model, { source }).
    getModelPricingInfo: () => ({ input: 0.95, output: 4, cache_read: 0.19 }),
    traeFoldMap: () => EVIDENCE,
  };
  vm.runInNewContext(match[0], context);
  assert.equal(typeof context.foldTraeRowCost, "function");
  return (row, cost) => context.foldTraeRowCost(row, cost);
}

const EVIDENCE = {
  "trae-cn": {
    byModel: { "Kimi-K2.7-Code": { hits: 84, volume: 100 } },
    recognizedRate: 0.84,
  },
  trae: { byModel: {}, recognizedRate: 0 },
};

const kimiRow = (observed) => ({
  source: "trae-cn", model: "Kimi-K2.7-Code",
  input_tokens: 1_000_000, output_tokens: 0,
  cached_input_tokens: 0, cache_creation_input_tokens: 0,
  cache_observed_input_tokens: observed,
});

test("every fold copy reaches the same verdict on the same rows", () => {
  const localFold = loadLocalFold();
  const edgeFolds = EDGE_COPIES.map((name) => [name, loadFold(name)]);
  const foldAt = (h) => {
    // ceiling × ((1−h) + h×discount), discount = 0.19/0.95 — the fold keeps
    // the row's own effective input price (linear stand-in: the whole cost is
    // the input leg).
    const ceiling = 0.95;
    const discount = 0.19 / 0.95;
    return ceiling * ((1 - h) + h * discount);
  };

  const verdicts = [
    { name: "non-TRAE rows are never folded",
      row: { source: "codex", model: "gpt-6", input_tokens: 1_000_000, output_tokens: 0,
        cached_input_tokens: 0, cache_creation_input_tokens: 0, cache_observed_input_tokens: 0 },
      expected: 0.95 },
    { name: "well-covered rows keep their ceiling (measured truth is never re-folded)",
      row: kimiRow(1_000_000), expected: 0.95 },
    { name: "unmeasured rows fold at the model's own pool rate",
      row: kimiRow(0), expected: foldAt(0.84) },
    { name: "models without a fielded pool fold at the edition's recognized rate",
      row: { ...kimiRow(0), model: "glm-5.2" },
      // Stand-in pricing is kimi's for every model: discount = 0.19/0.95.
      expected: foldAt(0.84) },
    { name: "an edition with no evidence at all keeps the ceiling",
      row: kimiRow(0), evidence: {}, expected: 0.95 },
  ];
  for (const { name, row, expected, evidence } of verdicts) {
    // The local copy never sees rows without the coverage-signal CONCEPT (its
    // chain always carries it), so it joins every case except the null one.
    if (evidence === undefined) {
      const localVerdict = localFold({ ...row }, 0.95);
      assert.ok(Math.abs(localVerdict - expected) < 1e-9,
        `local fold drifted from the fixture math on: ${name} (${localVerdict} ≠ ${expected})`);
    }
    for (const [copy, fold] of edgeFolds) {
      const verdict = fold({ ...row }, 0.95, evidence ?? EVIDENCE);
      assert.ok(Math.abs(verdict - expected) < 1e-9,
        `${copy} drifted on: ${name} (${verdict} ≠ ${expected})`);
    }
  }

  // The DELIBERATE divergence: a null/missing coverage signal means "this
  // chain cannot know coverage" on the edge (the rollup family) → ceiling;
  // the local fold reads undefined as pre-signal = unmeasured → folds. Assert
  // both directions so a future edit to either side trips loudly.
  const ceilingRow = { ...kimiRow(null) };
  for (const [copy, fold] of edgeFolds) {
    assert.equal(fold({ ...ceilingRow }, 0.95, EVIDENCE), 0.95,
      `${copy}: a chain without the coverage signal must keep the ceiling`);
  }
  const localOnUndefined = localFold(
    { source: "trae-cn", model: "Kimi-K2.7-Code", input_tokens: 1_000_000, output_tokens: 0,
      cached_input_tokens: 0, cache_creation_input_tokens: 0 },
    0.95,
  );
  assert.ok(Math.abs(localOnUndefined - foldAt(0.84)) < 1e-9,
    "local fold must still treat pre-signal (undefined) rows as unmeasured — if this trips, the local semantics changed and the edge's null-skip rationale needs re-review");
});

test("the shared evidence reader scopes pools by edition and uploads only real pools", async () => {
  const { readTraeEvidencePools, evidenceRowsForUpload } = require("../src/lib/trae-fold-evidence.js");
  const os = require("node:os");
  const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), "trae-evidence-"));
  // Fixture root semantics: TOKENTRACKER_HOME/tracker is the tracker dir
  // (test fixture convention). The reader falls back to the legacy
  // cursors.json when no v2 generation exists — same bucket shape.
  const trackerDir = path.join(home, "tracker");
  await fs.promises.mkdir(trackerDir, { recursive: true });
  await fs.promises.writeFile(path.join(trackerDir, "cursors.json"), JSON.stringify({
    hourly: {
      buckets: {
        "trae-cn|Kimi-K2.7-Code": { totals: { cached_input_tokens: 840, cache_observed_input_tokens: 1000 } },
        "trae|gemini-x": { totals: { cached_input_tokens: 10, cache_observed_input_tokens: 1000 } },
        "codex|gpt-6": { totals: { cached_input_tokens: 500, cache_observed_input_tokens: 1000 } },
      },
    },
  }));
  process.env.TOKENTRACKER_HOME = home;
  try {
    const state = await readTraeEvidencePools();
    assert.equal(state["trae-cn"].byModel["Kimi-K2.7-Code"].volume, 1000);
    assert.equal(state["trae-cn"].byModel["Kimi-K2.7-Code"].hits, 840);
    assert.equal(state["trae"].byModel["gemini-x"].hits, 10);
    // Non-TRAE buckets never enter the pools.
    assert.equal(state["trae-cn"].byModel["gpt-6"], undefined);
    // One fielded model per edition → the median IS that model's rate.
    assert.equal(state["trae-cn"].recognizedRate, 0.84);
    assert.equal(state["trae"].recognizedRate, 0.01);
    const rows = evidenceRowsForUpload(state);
    assert.deepEqual(rows, [
      { edition: "trae-cn", model: "Kimi-K2.7-Code", hits: 840, volume: 1000 },
      { edition: "trae", model: "gemini-x", hits: 10, volume: 1000 },
    ]);
    // An empty state uploads nothing — an idle device must never clobber a
    // real pool cloud-side.
    assert.deepEqual(evidenceRowsForUpload({ "trae-cn": { byModel: {}, recognizedRate: 0 }, trae: { byModel: {}, recognizedRate: 0 } }), []);
  } finally {
    delete process.env.TOKENTRACKER_HOME;
    await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
