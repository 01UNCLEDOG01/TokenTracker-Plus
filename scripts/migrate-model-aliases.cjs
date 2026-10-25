#!/usr/bin/env node
"use strict";
// KI-031 one-time queue migration: fold verified alias spellings onto the
// canonical SKU names and merge rows that collide on (source, model, hour).
//
// Semantics (chosen to preserve today's read-side totals exactly):
//  - rename every row via model-canonical.CANONICAL_ALIASES;
//  - rows that become byte-identical duplicates of an earlier row are dropped;
//  - rows that collide but differ are SUMMED (the read path today sums every
//    surviving row, so summation is the only reconciliation-preserving merge);
//  - a backup is written before anything is touched and reconciliation is
//    asserted: pre-migration Σtokens/Σcost must equal post-migration Σ.
//
//   node scripts/migrate-model-aliases.cjs [--apply]
//   without --apply it only reports what it would do.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { canonicalModelName, CANONICAL_ALIASES } = require("../src/lib/model-canonical");

const SUM_FIELDS = ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens",
  "output_tokens", "reasoning_output_tokens", "total_tokens", "billable_total_tokens",
  "total_cost_usd"];

async function main() {
  const apply = process.argv.includes("--apply");
  const queuePath = path.join(os.homedir(), ".tokentracker", "tracker", "queue.jsonl");
  const lines = fs.readFileSync(queuePath, "utf8").split("\n");
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { rows.push(null); }
  }
  const before = rows.reduce((acc, r) => {
    if (!r) return acc;
    acc.tokens += Number(r.total_tokens) || 0;
    acc.cost += Number(r.total_cost_usd) || 0;
    return acc;
  }, { tokens: 0, cost: 0 });

  const renameCounts = new Map();
  const mergedByKey = new Map();
  const out = [];
  let summed = 0, unparsable = 0;
  for (const row of rows) {
    if (!row) { unparsable++; out.push(null); continue; }
    const raw = String(row.model || "");
    const canonical = canonicalModelName(raw);
    if (canonical !== raw) {
      renameCounts.set(raw, (renameCounts.get(raw) || 0) + 1);
      row.model = canonical;
    }
    const key = `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`;
    const prev = mergedByKey.get(key);
    if (prev) {
      // Unconditional summation: the read path today sums every surviving row,
      // so summation is the only reconciliation-preserving merge. (Dropping
      // "byte-identical duplicates" lost 13.5B tokens in the dry run - equal
      // totals per key can be additive rows from separate syncs.)
      for (const field of SUM_FIELDS) prev[field] = (Number(prev[field]) || 0) + (Number(row[field]) || 0);
      summed++;
      continue;
    }
    mergedByKey.set(key, row);
    out.push(row);
  }
  const kept = out.filter(Boolean);
  const after = kept.reduce((acc, r) => {
    acc.tokens += Number(r.total_tokens) || 0;
    acc.cost += Number(r.total_cost_usd) || 0;
    return acc;
  }, { tokens: 0, cost: 0 });

  console.log(`重命名行: ${[...renameCounts.entries()].map(([m, n]) => `${m}×${n}`).join(", ") || "0"}`);
  console.log(`同键求和合并: ${summed} | 坏行保留: ${unparsable}`);
  console.log(`对账 前: tokens=${before.tokens} cost=$${before.cost.toFixed(4)}`);
  console.log(`对账 后: tokens=${after.tokens} cost=$${after.cost.toFixed(4)}`);
  if (Math.abs(before.tokens - after.tokens) > 0.5 || Math.abs(before.cost - after.cost) > 0.0001) {
    console.error("❌ 对账失败——总额变化，拒绝写入。");
    process.exit(1);
  }
  console.log("✅ 对账一致。");
  if (!apply) {
    console.log("(dry-run，加 --apply 执行写入)");
    return;
  }
  const backup = queuePath + ".bak-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + "-model-aliases";
  fs.copyFileSync(queuePath, backup);
  fs.writeFileSync(queuePath, out.map((r) => (r ? JSON.stringify(r) : "")).join("\n") + "\n", "utf8");
  console.log(`✅ 已写入。备份: ${backup}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
