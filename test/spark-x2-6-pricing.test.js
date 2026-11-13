"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("esbuild");
const pricing = require("../src/lib/pricing");
const curated = require("../src/lib/pricing/curated-overrides.json");

// iFlytek Spark-X2.6 (星火). Official launch rate read from xinghuo.xfyun.cn
// on 2026-10-27: limited-time 60% of RMB 0.9 / 3.6 / 0.08 per MTok in / out /
// cache-hit, converted at ~7.2 RMB/USD; cache_write = input. Re-checked
// 2026-11-13: the 60% rate is still current. The card was first recorded
// source-scoped to loomy (then the only source reporting the id) and was
// promoted to the global exact table on 2026-11-13 once ZCode began emitting
// spark-x2.6 too — ~99.4M tokens of zcode usage had shown no cost. Reprice
// when the launch promotion ends.
const RATES = { input: 0.13, output: 0.5, cache_read: 0.01, cache_write: 0.13 };

test("spark-x2.6 prices at the official 60% launch rate from every source", () => {
  assert.equal(curated.exact["spark-x2.6"].input, RATES.input);
  assert.ok(
    !curated.source_exact.loomy["spark-x2.6"],
    "loomy-scoped card must stay folded into the global exact one",
  );
  for (const source of ["zcode", "loomy", undefined]) {
    const rates = pricing.getModelPricing("spark-x2.6", source ? { source } : undefined);
    for (const [key, value] of Object.entries(RATES)) {
      assert.equal(rates[key], value, `${source ?? "no source"}: ${key}`);
    }
  }
});

test("a zcode spark-x2.6 row bills input, cache reads, cache writes, and output", () => {
  const cost = pricing.computeRowCost({
    source: "zcode",
    model: "spark-x2.6",
    input_tokens: 1_000_000,
    cached_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
    output_tokens: 1_000_000,
  });
  // 0.13 + 0.01 + 0.13 + 0.5 per million tokens.
  assert.ok(Math.abs(cost - 0.77) < 1e-12, `cost: ${cost} != 0.77`);
});

test("all five edge pricing blocks resolve spark-x2.6 to the same card", () => {
  const CANONICAL = "tokentracker-leaderboard-refresh.ts";
  const MIRRORS = [
    "tokentracker-account-daily.ts",
    "tokentracker-account-summary.ts",
    "tokentracker-account-model-breakdown.ts",
    "tokentracker-leaderboard-profile.ts",
  ];
  const BLOCK_RE =
    /const MODEL_PRICING[\s\S]*?\nfunction getModelPricing\(model: string(?:, source = "")?\) \{[\s\S]*?\n\}/;
  const ROOT = path.join(__dirname, "..");
  for (const name of [CANONICAL, ...MIRRORS]) {
    const block = fs
      .readFileSync(path.join(ROOT, "dashboard/edge-patches", name), "utf8")
      .match(BLOCK_RE);
    assert.ok(block, `${name}: MODEL_PRICING/getModelPricing block not found`);
    const { code } = transformSync(block[0], { loader: "ts", target: "es2020" });
    const edgePricing = vm.runInNewContext(`${code}\ngetModelPricing;`);
    for (const source of ["zcode", "loomy", ""]) {
      const edge = edgePricing("spark-x2.6", source);
      for (const [key, value] of Object.entries(RATES)) {
        assert.equal(edge[key], value, `${name} (${source || "no source"}): ${key}`);
      }
    }
  }
});
