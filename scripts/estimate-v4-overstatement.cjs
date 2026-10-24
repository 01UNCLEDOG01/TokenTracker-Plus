// 估算 DeepSeek 2026-08 涨价导致的面板虚高。
//
// 背景: TT-plus 的价格表是单版本"当前价",面板读时用 computeRowCost 现算,
// 涨价前的 V4 用量现在全部按涨价后的价格显示。本脚本扫本地 queue.jsonl,
// 找出涨价前 (hour_start < 2026-08-16T16:00:00Z) 的 V4 行,按新旧两套价格
// 各算一遍,差值即面板虚高(官方价口径 USD,不含中转实际扣费)。
//
// 用法 (在站主 Windows 机器上, dsh 或直接 node):
//   node estimate-v4-overstatement.cjs [queue.jsonl 路径]
//   默认读 %USERPROFILE%\.tokentracker\queue.jsonl (Linux/macOS 下为 ~/.tokentracker/queue.jsonl)
//
// 价格依据:
//  - 涨价生效: 2026-08-16 16:00 UTC (多家媒体 + DeepSeek 公告一致)
//  - 旧价 (flat, 全天): V4-Pro hit 0.003625 / miss 0.435 / out 0.87;
//    V4-Flash hit 0.0028 / miss 0.14 / out 0.28  (USD/百万 tokens)
//  - 新价 (当前 curated 表): v4-pro 1.32/3.96/0.044, v4-flash(legacy id) 0.3/1.2/0.006,
//    峰谷: UTC 01-04 / 06-10 为 peak,其余 off-peak 半价 (涨价前行不会触发周末规则,
//    规则 2026-08-23 才生效,此处仍按完整逻辑实现以防万一)
//  - 假设: 旧价 cache_write 按旧 miss 价计 (旧价目表未单独公布 creation 价);
//    reasoning 按 output 价计 (旧价目表注明的口径)

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const HIKE_CUTOFF_MS = Date.parse("2026-08-16T16:00:00Z");
const WEEKEND_RULE_FROM_MS = Date.parse("2026-08-22T16:00:00Z"); // 2026-08-23 00:00 Beijing

const OLD = {
  "deepseek-v4-pro":   { hit: 0.003625, miss: 0.435, out: 0.87 },
  "deepseek-v4-flash": { hit: 0.0028,   miss: 0.14,  out: 0.28 },
};
// 新价: 与 src/lib/pricing/curated-overrides.json 当前值一致 (peak)
const NEW = {
  "deepseek-v4-pro":   { hit: 0.044, miss: 1.32, out: 3.96, write: 1.32 },
  "deepseek-v4-flash": { hit: 0.006, miss: 0.3,  out: 1.2,  write: 0.3 },
};

function bucketOf(model) {
  const m = String(model || "").toLowerCase();
  if (m.includes("deepseek-v4-pro")) return "deepseek-v4-pro";
  if (m.includes("deepseek-v4-flash")) return "deepseek-v4-flash";
  return null; // v4.1-flash / deepseek-flash 涨价时不存在,出现则单独报告
}

function isPeak(ms) {
  const d = new Date(ms);
  const h = d.getUTCHours();
  const peak = (h >= 1 && h < 4) || (h >= 6 && h < 10);
  if (!peak) return false;
  if (ms < WEEKEND_RULE_FROM_MS) return true;
  const bj = new Date(ms + 8 * 3600 * 1000);
  const dow = bj.getUTCDay(); // 0=Sun 6=Sat
  return dow !== 0 && dow !== 6;
}

function costOld(b, r) {
  const p = OLD[b];
  return (
    (r.cached_input_tokens || 0) * p.hit +
    (r.input_tokens || 0) * p.miss +
    (r.cache_creation_input_tokens || 0) * p.miss + // 假设,见头注
    ((r.output_tokens || 0) + (r.reasoning_output_tokens || 0)) * p.out
  ) / 1e6;
}

function costNew(b, r, ms) {
  const p = NEW[b];
  const k = isPeak(ms) ? 1 : 0.5;
  return (
    k * (
      (r.cached_input_tokens || 0) * p.hit +
      (r.input_tokens || 0) * p.miss +
      (r.cache_creation_input_tokens || 0) * p.write +
      ((r.output_tokens || 0) + (r.reasoning_output_tokens || 0)) * p.out
    )
  ) / 1e6;
}

async function main() {
  const def = path.join(os.homedir(), ".tokentracker", "queue.jsonl");
  const file = process.argv[2] || def;
  if (!fs.existsSync(file)) {
    console.error(`找不到 ${file},请传 queue.jsonl 路径作参数`);
    process.exit(1);
  }
  const agg = {};
  let lines = 0, preHike = 0, otherV4 = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    lines++;
    let r;
    try { r = JSON.parse(t); } catch { continue; }
    if (typeof r.hour_start !== "string") continue;
    const ms = Date.parse(r.hour_start);
    if (!Number.isFinite(ms) || ms >= HIKE_CUTOFF_MS) continue;
    const b = bucketOf(r.model);
    if (!b) {
      if (String(r.model || "").toLowerCase().includes("deepseek")) otherV4++;
      continue;
    }
    preHike++;
    const a = (agg[b] ||= { tokens: 0, old: 0, now: 0 });
    a.tokens += Number(r.total_tokens) || 0;
    a.old += costOld(b, r);
    a.now += costNew(b, r, ms);
  }
  console.log(`扫描行数: ${lines}, 涨价前 V4 行: ${preHike}` +
    (otherV4 ? ` (另有 ${otherV4} 行 deepseek 非 V4 flash/pro,未计入)` : ""));
  console.log("模型               | tokens(亿) | 旧价成本(USD) | 现价显示(USD) | 虚高(USD)");
  let tOld = 0, tNow = 0;
  for (const [b, a] of Object.entries(agg)) {
    tOld += a.old; tNow += a.now;
    console.log(
      `${b.padEnd(18)} | ${(a.tokens / 1e8).toFixed(2).padStart(9)} | ` +
      `${a.old.toFixed(2).padStart(12)} | ${a.now.toFixed(2).padStart(12)} | ${(a.now - a.old).toFixed(2).padStart(9)}`,
    );
  }
  console.log(`合计虚高: USD ${(tNow - tOld).toFixed(2)} (旧价口径 USD ${tOld.toFixed(2)} → 现价口径 USD ${tNow.toFixed(2)})`);
  console.log("注: 官方价口径;中转实际扣费另算;cache_write 旧价按 miss 价假设。");
}

main().catch((e) => { console.error(e); process.exit(1); });
