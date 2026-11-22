"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("esbuild");
const pricing = require("../src/lib/pricing");

// 2026-11-16 edge-pricing drift sweep. The owner's Windows dashboard (本机数据)
// and the cloud account view disagreed by ~¥1,400 on the same account: the edge
// pricing copies had drifted from the local chain. Root causes, per row:
//
//   - antigravity gemini-3.8-flash (4.4B tokens): LiteLLM repriced the 3.8
//     family onto its own card ($0.75/$3.75/$0.075) after the 2026-10-13 edge
//     snapshot froze the 2.5-flash card (0.3/2.5/0.03); the bare id fell
//     through the includes chain to gemini-3-flash-preview and the -n/-tiered
//     ids hit the stale card → $174 under-billed.
//   - codex gpt-6.1-terra (192M tokens): no edge entry at all → $0.
//   - codex google/gemma-4-26b-a4b-it:free: the local matcher routes it to the
//     curated gemma-4-26b card; the edge had no :free key → $0.
//   - minimax-code MiniMax-M3.1-Flash (811M tokens, 97% cached): the edge fuzzy
//     chain captured the generic minimax-m3 entry (cache read 0.06) instead of
//     the 3.1 SKU (0.03) → $24 OVER-billed — the trap the curated note warns
//     about verbatim, for both the bare and the -preview SKU.
//   - workbuddy mimo-v2.6-pro / minimax-code agnes-2.5-flash: no edge entries.
//
// Rates are whatever the local chain resolves TODAY (the account view must
// price exactly like 本机数据); each entry notes its provenance. The review
// also moved the Cline zero-billing guards above the exact table (the local
// matcher applies them at step 0 — without the move, pinning a :free-suffixed
// id would have started billing Cline's free routes).

// Curated-resolved: bundled JSON, verifiable on every machine regardless of
// LiteLLM fetch state.
const CURATED_RATES = {
  "google/gemma-4-26b-a4b-it:free": { input: 0.09, output: 0.34, cache_read: 0.009, cache_write: 0.09 },
  "minimax-m3.1-flash": { input: 0.3, output: 1.2, cache_read: 0.03, cache_write: 0.3 },
  "minimax-m3.1-flash-preview": { input: 0.3, output: 1.2, cache_read: 0.03, cache_write: 0.3 },
  "agnes-3.0-flash": { input: 0.05, output: 0.15, cache_read: 0.005, cache_write: 0 },
};
// LiteLLM-resolved: only verifiable when the fetcher actually loaded live/disk
// data (the seed snapshot predates these SKUs).
const LITELLM_RATES = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cache_read: 0.075, cache_write: 0 },
  "gemini-3.8-flash-n": { input: 0.75, output: 3.75, cache_read: 0.075, cache_write: 0 },
  "gemini-3.8-flash-tiered": { input: 0.75, output: 3.75, cache_read: 0.075, cache_write: 0 },
  "gpt-6.1-terra": { input: 1, output: 5, cache_read: 0.05, cache_write: 1.25 },
  "agnes-2.5-flash": { input: 0.03, output: 0.15, cache_read: 0, cache_write: 0 },
  "mimo-v2.6-pro": { input: 0.348, output: 0.696, cache_read: 0.00288, cache_write: 0 },
};

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

function loadEdgePricing(name) {
  const block = fs
    .readFileSync(path.join(ROOT, "dashboard/edge-patches", name), "utf8")
    .match(BLOCK_RE);
  assert.ok(block, `${name}: MODEL_PRICING/getModelPricing block not found`);
  const { code } = transformSync(block[0], { loader: "ts", target: "es2020" });
  return vm.runInNewContext(`${code}\ngetModelPricing;`);
}

test("the local chain resolves the drifted models at the recorded rates", async () => {
  // The LiteLLM merge is async-loaded; without it litellm:exact models
  // resolve to $0 (the exact drift this batch fixes on the edge side).
  await pricing.ensurePricingLoaded();
  const state = pricing.__getStateForTests();
  const litellmLive = typeof state?.source === "string" &&
    (state.source.startsWith("disk-cache") || state.source === "upstream");
  for (const [model, rates] of Object.entries(CURATED_RATES)) {
    const resolved = pricing.getModelPricingInfo(model, { source: undefined });
    for (const [key, value] of Object.entries(rates)) {
      assert.equal(resolved[key], value, `${model}: ${key} (local chain moved — re-check the curated source and re-sync the edge copies)`);
    }
  }
  if (!litellmLive) {
    // Seed/stale-cache fallback: the LiteLLM-derived pins cannot be verified
    // here. Say so loudly instead of failing with a misleading "local chain
    // moved" (the release gate must not send anyone chasing a phantom drift).
    assert.ok(state && typeof state.source === "string",
      `LiteLLM data unavailable (source: ${state?.source}) — cannot verify the LiteLLM-derived rate pins; re-run on a machine with a live/disk-cache LiteLLM snapshot`);
    return;
  }
  for (const [model, rates] of Object.entries(LITELLM_RATES)) {
    const resolved = pricing.getModelPricingInfo(model, { source: undefined });
    for (const [key, value] of Object.entries(rates)) {
      assert.equal(resolved[key], value, `${model}: ${key} (local chain moved — re-check the LiteLLM source and re-sync the edge copies)`);
    }
  }
});

test("a cache-heavy row bills identically on the local chain and the edge copies", () => {
  const localCost = pricing.computeRowCost({
    source: "minimax-code",
    model: "MiniMax-M3.1-Flash",
    input_tokens: 19_000_000,
    cached_input_tokens: 790_000_000,
    cache_creation_input_tokens: 0,
    output_tokens: 1_800_000,
    reasoning_output_tokens: 0,
  });
  // 19×0.3 + 790×0.03 + 1.8×1.2 = 5.7 + 23.7 + 2.16 = 31.56
  assert.ok(Math.abs(localCost - 31.56) < 1e-9, `local M3.1 cost: ${localCost} != 31.56`);

  for (const name of [CANONICAL, ...MIRRORS]) {
    const edgePricing = loadEdgePricing(name);
    // Every pinned model resolves at the recorded rates on this copy.
    for (const [model, rates] of Object.entries({ ...CURATED_RATES, ...LITELLM_RATES })) {
      const source = model.startsWith("minimax-m3.1") || model === "agnes-2.5-flash"
        ? "minimax-code"
        : model === "mimo-v2.6-pro" ? "workbuddy" : undefined;
      const edge = edgePricing(model, source || "");
      for (const [key, value] of Object.entries(rates)) {
        assert.equal(edge[key], value, `${name}: ${model} ${key} — the edge copy drifted from the local chain`);
      }
    }
    // The M3.1 SKU regression probes: the generic minimax-m3 entry (cache
    // 0.06) must not capture either SKU, bare or -preview.
    for (const sku of ["MiniMax-M3.1-Flash", "minimax-m3.1-flash-preview"]) {
      const m31 = edgePricing(sku, "minimax-code");
      assert.equal(m31.cache_read, 0.03, `${name}: ${sku} captured by the generic minimax-m3 card`);
      assert.equal(m31.cache_write, 0.3, `${name}: ${sku} cache_write from the wrong card`);
    }
    // Effort-suffixed and prefixed spellings ride the same cards (the exact
    // key alone would bill them at $0).
    for (const [id, rates] of [
      ["gpt-6.1-terra-high", LITELLM_RATES["gpt-6.1-terra"]],
      ["openrouter/google/gemma-4-26b-a4b-it:free", CURATED_RATES["google/gemma-4-26b-a4b-it:free"]],
    ]) {
      const edge = edgePricing(id, undefined);
      for (const [key, value] of Object.entries(rates)) {
        assert.equal(edge[key], value, `${name}: ${id} ${key} — matcher variant not covered`);
      }
    }
    // Cline zero-billing guards run BEFORE the exact table: a Cline row
    // reporting the pinned :free id must bill $0, matching the local step-0
    // semantics (this ordering was itself a review fix on 2026-11-16).
    const clineGemma = edgePricing("google/gemma-4-26b-a4b-it:free", "cline");
    for (const key of ["input", "output", "cache_read", "cache_write"]) {
      assert.equal(clineGemma[key] || 0, 0, `${name}: cline :free row must stay at $0`);
    }
    const clineGateway = edgePricing("cline-pass/glm-5.3", "cline");
    assert.equal(clineGateway.input || 0, 0, `${name}: cline-pass namespace must stay at $0`);
  }
});
