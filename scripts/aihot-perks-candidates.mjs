#!/usr/bin/env node
// AIHOT「Token 羊毛」× 福利指南覆盖对照（站主维护工具，纯只读）。
//
// 输出两个方向：
//   1) AIHOT 有、我们没有 → 补卡候选（按 AIHOT 最新核对时间排序）
//   2) 我们有、AIHOT 没标 → 本仓独有覆盖（邀请返利/官方直达等，属正常差异）
//
// 数据取优先级：~/.tokentracker 里的 6h 缓存 → 现抓一次（带浏览器 UA）。
// 用法：node scripts/aihot-perks-candidates.mjs [--refresh]
import { PERK_PROVIDERS } from "../dashboard/src/data/perksData.js";
import { PERKS_AIHOT_PROVIDERS } from "../dashboard/src/data/perks-aihot-map.js";
import { fetchAihotFreeTokens } from "../src/lib/aihot-free-tokens.js";

const force = process.argv.includes("--refresh");
const snapshot = await fetchAihotFreeTokens({ home: process.env.HOME, force });

if (snapshot.error && !snapshot.items.length) {
  console.error(`AIHOT 快照不可用：${snapshot.error}`);
  process.exit(1);
}
console.log(`AIHOT 快照：${snapshot.deal_count} 条羊毛 / 更新 ${snapshot.updated_at || "无"}${snapshot.stale ? "（stale：拉取失败，用了缓存）" : ""}`);

const coveredProviders = new Set(Object.values(PERKS_AIHOT_PROVIDERS).flat());
const latestByProvider = new Map();
for (const item of snapshot.items) {
  const prev = latestByProvider.get(item.provider);
  if (!prev || (item.verified_at || "") > (prev.verified_at || "")) latestByProvider.set(item.provider, item);
}

const candidates = [...latestByProvider.values()]
  .filter((item) => !coveredProviders.has(item.provider))
  .sort((a, b) => (b.verified_at || "").localeCompare(a.verified_at || ""));

console.log(`\n== 补卡候选：AIHOT 有、福利指南没有（${candidates.length} 家） ==`);
for (const item of candidates) {
  const when = item.verified_at ? item.verified_at.slice(0, 10) : "?";
  console.log(`- [${when}] ${item.provider} — ${item.title}`);
}

const oursUncovered = PERK_PROVIDERS.filter((card) => !PERKS_AIHOT_PROVIDERS[card.id]);
console.log(`\n== 本仓独有：AIHOT 未覆盖我们这些卡（${oursUncovered.length} 家，多为邀请返利/中转/海外，正常差异） ==`);
console.log(oursUncovered.map((card) => card.id).join(" "));

const staleDropped = snapshot.dropped_providers || [];
if (staleDropped.length) {
  console.log(`\n== AIHOT 本轮下架（上一轮还在）==\n${staleDropped.join(" | ")}`);
}
