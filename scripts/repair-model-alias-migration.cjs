#!/usr/bin/env node
"use strict";
// KI-031 migration repair (2026-10-25). The first migration summed rows the
// queue reader DEDUPES (same source|model|hour resolves to one row, last
// wins), over-counting ~+40B tokens / +$4.08 stamped. Repair:
//
//  1. correct per-RAW-key values = reader semantics over the untouched
//     pre-migration backup, overridden by rows appended to the live queue
//     AFTER the bad migration (the tail: fresher totals for existing keys and
//     genuinely new keys);
//  2. fold to canonical keys (sum across surviving variant keys);
//  3. rewrite every alias-affected key in the live queue with that value,
//     leave everything else untouched;
//  4. assert the repaired read-total equals the simulated truth.
//
//   node scripts/repair-model-alias-migration.cjs --apply

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CANONICAL_ALIASES } = require("../src/lib/model-canonical");

const ESTIMATE_SOURCES = new Set(["cursor", "antigravity"]);
const SUM_FIELDS = ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens",
  "output_tokens", "reasoning_output_tokens", "total_tokens", "billable_total_tokens",
  "total_cost_usd"];

function canonicalOf(model) {
  const raw = String(model || "");
  return CANONICAL_ALIASES[raw] || raw;
}
function keyOf(source, model, hour) {
  return `${source || ""}|${model || ""}|${hour || ""}`;
}
function parseLines(lines) {
  const rows = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* keep going */ }
  }
  return rows;
}
// Reader semantics per RAW key: last wins; cursor/antigravity all-zero rows
// never clobber a positive row.
function lastWinsByRawKey(rows) {
  const byKey = new Map();
  for (const row of rows) {
    if (row?.kind === "account_session_state" || row?.kind === "account_sync_watermark") continue;
    const key = keyOf(row.source, String(row.model || ""), row.hour_start);
    const prev = byKey.get(key);
    const source = String(row.source || "").toLowerCase();
    // Exact resolveQueueRow semantics: only a row explicitly flagged
    // usage_retracted (all listed fields zero) defers to an earlier positive.
    const retracted = row.usage_retracted === true &&
      SUM_FIELDS.every((f) => (Number(row[f]) || 0) === 0);
    if (prev && ESTIMATE_SOURCES.has(source) && retracted && (Number(prev.total_tokens) || 0) > 0) continue;
    byKey.set(key, row);
  }
  return byKey;
}
function foldCanonical(byRawKey) {
  const byCanonical = new Map();
  for (const row of byRawKey.values()) {
    const cKey = keyOf(row.source, canonicalOf(String(row.model || "")), row.hour_start);
    const acc = byCanonical.get(cKey);
    if (!acc) { byCanonical.set(cKey, row); continue; }
    for (const f of SUM_FIELDS) acc[f] = (Number(acc[f]) || 0) + (Number(row[f]) || 0);
  }
  return byCanonical;
}
function totals(byCanonical) {
  let tokens = 0, cost = 0;
  for (const row of byCanonical.values()) {
    tokens += Number(row.total_tokens) || 0;
    cost += Number(row.total_cost_usd) || 0;
  }
  return { tokens, cost };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const trackerDir = path.join(os.homedir(), ".tokentracker", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const backupPath = path.join(trackerDir, "queue.jsonl.bak-2026-10-25T13-43-20-model-aliases");

  const backupRows = parseLines(fs.readFileSync(backupPath, "utf8").split("\n"));
  const currentRows = parseLines(fs.readFileSync(queuePath, "utf8").split("\n"));

  // 1. Truth from the backup, then override with the live tail — but the tail
  //    must exclude the POISONED rows the bad migration itself wrote (it
  //    summed same-key duplicates into single rows). Reproduce that migration
  //    output from the second backup and treat only the remaining live lines
  //    (genuine appends after 13:44) as tail.
  const secondBackupPath = path.join(trackerDir, "queue.jsonl.bak-2026-10-25T13-44-16-model-aliases");
  const secondBackupRows = parseLines(fs.readFileSync(secondBackupPath, "utf8").split("\n"));
  const badOutput = new Set();
  {
    const merged = new Map();
    for (const row of secondBackupRows) {
      if (row?.kind === "account_session_state" || row?.kind === "account_sync_watermark") continue;
      const model = canonicalOf(String(row.model || ""));
      const key = keyOf(row.source, model, row.hour_start);
      const prev = merged.get(key);
      if (prev) {
        for (const f of SUM_FIELDS) prev[f] = (Number(prev[f]) || 0) + (Number(row[f]) || 0);
        continue;
      }
      merged.set(key, { ...row, model });
    }
    for (const row of merged.values()) badOutput.add(JSON.stringify(row));
  }
  const tailRows = currentRows.filter((row) => {
    if (row?.kind === "account_session_state" || row?.kind === "account_sync_watermark") return false;
    return !badOutput.has(JSON.stringify(row));
  });
  const backupByKey = lastWinsByRawKey(backupRows);
  const tailByKey = lastWinsByRawKey(tailRows);
  const truthByRaw = new Map(backupByKey);
  let tailApplied = 0;
  for (const [key, row] of tailByKey) {
    if (backupByKey.has(key)) tailApplied++;
    truthByRaw.set(key, row);
  }
  const correct = foldCanonical(truthByRaw);
  const before = totals(foldCanonical(backupByKey));
  console.log(`备份读取端真值: tokens=${before.tokens} cost=$${before.cost.toFixed(4)}`);
  console.log(`尾部追加覆盖: ${tailApplied} 个既有键 + ${tailByKey.size - tailApplied} 个新键（中毒行已排除）`);

  // 2. Rewrite the live queue: alias-affected canonical keys take the correct
  //    folded row; everything else passes through untouched.
  const correctKeySet = new Set(correct.keys());
  const outLines = [];
  const written = new Set();
  for (const line of fs.readFileSync(queuePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { outLines.push(line); continue; }
    if (row?.kind === "account_session_state" || row?.kind === "account_sync_watermark") { outLines.push(line); continue; }
    const cKey = keyOf(row.source, canonicalOf(String(row.model || "")), row.hour_start);
    if (correctKeySet.has(cKey)) {
      if (written.has(cKey)) continue; // collapse leftovers of the bad merge
      written.add(cKey);
      const fixed = { ...correct.get(cKey) };
      fixed.model = canonicalOf(String(fixed.model || ""));
      outLines.push(JSON.stringify(fixed));
    } else {
      outLines.push(line);
    }
  }
  for (const [cKey, row] of correct) {
    if (written.has(cKey)) continue;
    const fixed = { ...row };
    fixed.model = canonicalOf(String(fixed.model || ""));
    outLines.push(JSON.stringify(fixed));
  }

  // 3. Assert: repaired read-total == simulated truth.
  const repairedSim = foldCanonical(lastWinsByRawKey(parseLines(outLines)));
  const after = totals(repairedSim);
  const expected = totals(correct);
  console.log(`修复后读取端: tokens=${after.tokens} cost=$${after.cost.toFixed(4)}`);
  console.log(`模拟真值:     tokens=${expected.tokens} cost=$${expected.cost.toFixed(4)}`);
  if (Math.abs(after.tokens - expected.tokens) > 0.5 || Math.abs(after.cost - expected.cost) > 0.0001) {
    console.error("❌ 断言失败——拒绝写入。");
    process.exit(1);
  }
  console.log("✅ 断言通过。");
  if (!apply) { console.log("(dry-run，加 --apply 执行写入)"); return; }
  const snapshot = queuePath + ".bak-pre-repair-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  fs.copyFileSync(queuePath, snapshot);
  fs.writeFileSync(queuePath, outLines.join("\n") + "\n", "utf8");
  console.log(`✅ 已写入。修复前快照: ${snapshot}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
