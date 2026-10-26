#!/usr/bin/env node
/**
 * scripts/validate-doc-facts.cjs
 *
 * 文档真值门禁：把「文档里的声明」和「代码里的真值」逐条对齐，专治 AI 改完代码
 * 忘了改文档。四项检查的真值全部从代码解析，本脚本不写死任何数字：
 *
 *   A. docs/achievements-guide.md 的表格名称/描述 == zh copy 注册表（逐行）
 *   B. docs/getting-started.zh-CN.{md,html} 的成就/称号计数 == 代码计数
 *   C. README/docs 里的热力图分位声明 == activity-heatmap.ts 的 quantile 列表
 *   D. scripts/retired-badge-names.json 里的退役名不得再出现在交付文档中，
 *      也不得仍然是活的 copy 名（清单本身也会腐化，所以两头都查）
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const errors = [];
const fail = (msg) => errors.push(msg);

// ── code truth ──────────────────────────────────────────────────────────────
const zh = JSON.parse(read("dashboard/src/content/i18n/zh/dashboard.json"));
const badgeCatalog = read("dashboard/src/ui/achievements/badge-catalog.js");
const badgeIds = [...badgeCatalog.matchAll(/\{\s*id:\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
const registry = read("dashboard/src/ui/achievements/title-registry.js");
const titleIds = [...registry.matchAll(/\{\s*id:\s*"([a-z0-9_]+)",\s*difficulty:/g)].map((m) => m[1]);
const shortNameToId = new Map();
for (const block of registry.match(/\{\s*id:\s*"[a-z0-9_]+",[\s\S]*?\n {2}\}/g) || []) {
  const id = (block.match(/^\{\s*id:\s*"([a-z0-9_]+)"/) || [])[1];
  if (!id) continue;
  const short = (block.match(/shortName:\s*"([^"]+)"/) || [])[1];
  const name = (block.match(/name:\s*"([^"]+)"/) || [])[1];
  if (short) shortNameToId.set(short, id);
  if (name) shortNameToId.set(name, id);
}

// ── A. guide table vs copy ──────────────────────────────────────────────────
const guide = read("docs/achievements-guide.md");
let guideRows = 0;
for (const line of guide.split(/\r?\n/)) {
  if (!line.startsWith("|")) continue;
  const cells = line.split("|").map((c) => c.trim());
  if (cells.length < 5) continue;
  const idMatch = cells[2].match(/^`([a-z0-9_]+)`$/);
  if (idMatch) {
    const id = idMatch[1];
    const wantName = zh[`achievements.badge.${id}.name`];
    const wantDesc = zh[`achievements.badge.${id}.desc`];
    if (wantName === undefined) continue; // not a badge row we own
    guideRows++;
    const gotName = (cells[1].match(/^\*\*(.+)\*\*$/) || [])[1];
    if (gotName !== wantName) fail(`guide 行 \`${id}\` 的名字是「${gotName}」，copy 注册表是「${wantName}」`);
    if (cells[3] !== wantDesc) fail(`guide 行 \`${id}\` 的描述与 copy 注册表不一致（guide: ${cells[3].slice(0, 24)}…）`);
    continue;
  }
  const titleMatch = cells[2].match(/^`(.+)`$/);
  if (titleMatch) {
    const id = shortNameToId.get(titleMatch[1]);
    if (!id) continue;
    const wantTag = zh[`achievements.title.${id}.tag`];
    const wantDesc = zh[`achievements.title.${id}.desc`];
    if (wantTag === undefined || cells.length < 6) continue;
    guideRows++;
    if (cells[3] !== wantTag) fail(`guide 称号行 \`${id}\` 的 tag 是「${cells[3]}」，copy 是「${wantTag}」`);
    if (cells[5] !== wantDesc) fail(`guide 称号行 \`${id}\` 的描述与 copy 注册表不一致（guide: ${cells[5].slice(0, 24)}…）`);
  }
}
if (guideRows < badgeIds.length) {
  fail(`guide 只核对了 ${guideRows} 行，少于代码里的 ${badgeIds.length} 枚徽章 —— 表格结构变了，门禁得跟着改`);
}

// ── B. offline guide counts ─────────────────────────────────────────────────
for (const rel of ["docs/getting-started.zh-CN.md", "docs/getting-started.zh-CN.html"]) {
  const text = read(rel);
  const m = text.match(/(\d+)\s*枚成就\s*\+\s*(\d+)\s*个称号/);
  if (!m) { fail(`${rel} 里找不到「N 枚成就 + M 个称号」这句，计数无法核对`); continue; }
  if (Number(m[1]) !== badgeIds.length) fail(`${rel} 写 ${m[1]} 枚成就，代码是 ${badgeIds.length} 枚`);
  if (Number(m[2]) !== titleIds.length) fail(`${rel} 写 ${m[2]} 个称号，代码是 ${titleIds.length} 个`);
}

// ── C. heatmap quantile claims ──────────────────────────────────────────────
const heat = read("dashboard/src/lib/activity-heatmap.ts");
const codeQuantiles = [...heat.matchAll(/quantile\(\s*allValues\s*,\s*([\d.]+)\s*\)/g)]
  .map((m) => Number(m[1]) * 100)
  .filter((n) => Number.isFinite(n));
const label = (n) => `P${String(Number(n.toFixed(1)))}`;
const codeSet = new Set(codeQuantiles.map(label));
if (!codeSet.has("P98.5")) fail("activity-heatmap.ts 里没解析出预期的 6 个分位点，门禁判据失效");
const docFiles = [...fs.readdirSync(ROOT).filter((f) => /^README.*\.md$/.test(f)), "docs/achievements-guide.md"];
for (const rel of docFiles) {
  const text = read(rel);
  const claimed = new Set([...text.matchAll(/\bP(\d+(?:\.\d+)?)\b/g)].map((m) => `P${m[1]}`));
  if (!claimed.size) continue;
  for (const c of claimed) if (!codeSet.has(c)) fail(`${rel} 声明了 ${c}，但 activity-heatmap.ts 的分位点是 ${[...codeSet].join("/")}`);
}

// ── D. retired names ────────────────────────────────────────────────────────
const retired = JSON.parse(read("scripts/retired-badge-names.json"));
const liveNames = new Set(Object.entries(zh).filter(([k]) => /\.name$/.test(k) && k.startsWith("achievements.")).map(([, v]) => v));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A retired name is only a violation where the docs use it AS A NAME: bolded
// table cells, backticked ids, 「」quotes, or synergy member lists ("A + B(黄金)").
// Prose that happens to contain the same word ("三条血脉与火种同燃") is not drift.
const nameUsePatterns = (name) => {
  const n = escapeRe(name);
  return new RegExp(`\\*\\*${n}\\*\\*|\`${n}\`|「${n}」|\\s\\+\\s${n}(?=[\\s(（]|$)|${n}\\s*\\+|${n}\\s*[（(]`);
};
for (const entry of retired.names) {
  if (liveNames.has(entry.name)) fail(`退役清单里的「${entry.name}」又成了活的成就名——清单该删这条，或改名回退了`);
  const re = nameUsePatterns(entry.name);
  for (const rel of [...docFiles, "docs/getting-started.zh-CN.md", "docs/getting-started.zh-CN.html"]) {
    const hit = read(rel).split(/\r?\n/).find((line) => re.test(line));
    if (hit) fail(`${rel} 还在把退役名「${entry.name}」当名字用（${entry.reason}）：${hit.slice(0, 60)}`);
  }
}

if (errors.length) {
  console.error("Doc facts gate failed:");
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(
  `Doc facts ok: ${guideRows} guide rows, ${badgeIds.length} badges / ${titleIds.length} titles, ` +
  `quantiles ${[...codeSet].join("/")}, ${retired.names.length} retired names checked.`,
);
