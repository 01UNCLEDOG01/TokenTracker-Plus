#!/usr/bin/env node
"use strict";
// KI-031 model-alias verification: for each candidate family, compare every
// variant's (source × month) effective-rate trajectory. Merge verdict = PASS
// only when two variants bill identically everywhere they coexist (站主规则:
// 使用时间 × 来源 × 当时价格, 价格一致才合并).
//
//   node scripts/audit/model-alias-verification.cjs [--family glm]
//
// Read-only: reads the queue, never writes.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const pricing = require("../../src/lib/pricing");

const FAMILIES = {
  "deepseek-v4.1": ["deepseek-v4.1-flash", "DeepSeek-V4.1-Flash", "deepseek-v4-1-flash", "deepseek/deepseek-v4.1-flash", "deepseek-v4.1-flash-free", "sn-deepseek-v4-1-flash"],
  "deepseek-v4": ["deepseek-v4-flash", "DeepSeek-V4-Flash 正式版", "deepseek-v4-flash-正式版", "deepseek-v4-flash-free", "deepseek-ai/DeepSeek-V4-Flash"],
  glm: ["glm-5.3-flash", "GLM-5.3-Flash", "GLM5.3-Flash（估算）", "GLM-5.3", "glm-5.2", "GLM-5.2", "zaicoding_glm-5.3", "z-ai/glm-5.2:free"],
  qwen: ["Qwen3.7-Plus", "qwen-3.7-plus", "qwen3.7-plus"],
  kimi: ["Kimi-K2.7-Code", "kimi-k2.7-code", "kimi-k2.7", "kimi-k2.6", "Kimi-K2.6", "kimi-k3-1"],
  gemini: ["gemini-3.8-flash-n", "gemini-3.8-flash", "gemini-3.8-flash-tiered"],
  claude: ["claude-sonnet-4-6", "claude-sonnet-4.6", "claude-opus-4-6", "claude-opus-4.6"],
  minimax: ["MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash-Preview", "minimax-m3"],
};

function rateKey(model, source) {
  const info = pricing.getModelPricingInfo ? pricing.getModelPricingInfo(model, { source }) : null;
  const rates = info?.rates || info?.pricing || info;
  if (!rates || typeof rates !== "object") return "unpriced";
  const pick = (v) => Number.isFinite(Number(v)) ? Number(v) : null;
  const r = [pick(rates.input), pick(rates.output), pick(rates.cache_read), pick(rates.cache_write)];
  if (r.every((v) => v === null)) return "unpriced";
  return r.map((v) => v === null ? "0" : String(v)).join("/");
}

async function main() {
  const only = process.argv.includes("--family") ? process.argv[process.argv.indexOf("--family") + 1] : null;
  const queuePath = path.join(os.homedir(), ".tokentracker", "tracker", "queue.jsonl");
  // { family: { variant: { "source|YYYY-MM": { tokens, stampedCost } } } }
  const data = {};
  const rl = readline.createInterface({ input: fs.createReadStream(queuePath) });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let row; try { row = JSON.parse(line); } catch { return; }
    const model = String(row.model || "").trim();
    if (!model) return;
    for (const [family, variants] of Object.entries(FAMILIES)) {
      if (only && family !== only) continue;
      if (!variants.includes(model)) continue;
      const day = String(row.hour_start || "").slice(0, 7);
      const key = `${row.source}|${day}`;
      const f = (data[family] ??= {});
      const v = (f[model] ??= {});
      const cell = (v[key] ??= { tokens: 0, stampedCost: 0 });
      cell.tokens += Number(row.total_tokens) || 0;
      cell.stampedCost += Number(row.total_cost_usd) || 0;
    }
  });
  rl.on("close", () => {
    for (const [family, variants] of Object.entries(data)) {
      console.log(`\n=== ${family} ===`);
      // Rate fingerprint per variant: the (source-agnostic) catalog rates plus
      // stamped effective $/MTok where the queue carries them.
      const profiles = new Map();
      for (const [variant, cells] of Object.entries(variants)) {
        const sources = new Set(Object.keys(cells).map((k) => k.split("|")[0]));
        const fingerprint = [...sources].map((s) => `${s}:${rateKey(variant, s)}`).join(" ");
        let tokens = 0, stamped = 0;
        for (const cell of Object.values(cells)) { tokens += cell.tokens; stamped += cell.stampedCost; }
        profiles.set(variant, { fingerprint, tokens, stamped, cells });
        console.log(`  ${variant}`);
        console.log(`    费率指纹: ${fingerprint} | ${(tokens / 1e8).toFixed(2)}亿 tok | stamp $${stamped.toFixed(4)}`);
      }
      // Verdict: group variants by identical fingerprint.
      const byFingerprint = new Map();
      for (const [variant, p] of profiles) {
        const k = p.fingerprint;
        if (!byFingerprint.has(k)) byFingerprint.set(k, []);
        byFingerprint.get(k).push(variant);
      }
      for (const [fp, group] of byFingerprint) {
        if (group.length > 1) console.log(`  ⇒ 同费率可并组: [${group.join(" + ")}] (${fp.split(" ")[0]}…)`);
      }
      const unpriced = [...byFingerprint.entries()].filter(([fp]) => fp.includes("unpriced"));
      if (unpriced.length) console.log(`  ⚠ 含 unpriced 指纹 ${unpriced.length} 组——须先补价再判`);
    }
  });
}

main().catch((error) => { console.error(error); process.exit(1); });
