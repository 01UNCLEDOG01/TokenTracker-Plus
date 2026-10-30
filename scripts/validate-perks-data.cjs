#!/usr/bin/env node
/**
 * scripts/validate-perks-data.cjs
 *
 * 福利指南数据门禁：`dashboard/src/data/perksData.js` 是给学员看的「白嫖清单」，
 * 一旦某行额度是编造的，用户会照着去注册、发现对不上——这比没有条目更糟。
 * 本门禁拦的是结构性的编造信号，不联网（离线可跑）：
 *
 *   1. 每行必须有 checkedAt（核对日期）+ sourceUrl（该轮核对依据的页面），缺一即红；
 *   2. id / officialUrl 主机不得重复（同一官网出现两次通常是复制或编造）；
 *   3. hasInvite 与 inviteUrl 必须一致；inviteCode 不得脱离 inviteUrl 存在；
 *      inviteUrl 与 officialUrl 必须同主域（防止把 A 站的邀请链挂到 B 站卡片上）；
 *   4. category 必须是 PERK_CATEGORIES 里的 id，badgeType 必须在允许集合内；
 *   5. 禁止「今晚 / 明天 / 昨天 / 本周 / 下周 / 本月」这类会自己过期的相对时间措辞；
 *   6. 中文日期（X月Y日）出现在截止/结束/活动语境时必须带年份，否则三个月后就失真；
 *   7. provider 解析不到品牌图标时只警告（卡片会退回首字母占位，不算红）。
 *
 * 过期提醒：checkedAt 距运行日超过 PERK_STALE_DAYS（默认 45）天只打 WARN，
 * 不让门禁随日历变红，但每次跑 validate:fast 都会把该重核的条目点名。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// 默认校验线上数据；传第一个参数可指向 fixture，供 test/perks-data.test.js 反证门禁真的会红。
const DATA_PATH = process.argv[2]
  ? path.resolve(ROOT, process.argv[2])
  : path.join(ROOT, "dashboard/src/data/perksData.js");
const DATA_REL = path.relative(ROOT, DATA_PATH).replace(/\\/g, "/");
const STALE_DAYS = Number(process.env.PERK_STALE_DAYS || 45);

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

const source = fs.readFileSync(DATA_PATH, "utf8");

function parseArray(literalName) {
  const start = source.indexOf(`export const ${literalName} = [`);
  if (start < 0) throw new Error(`${literalName} not found in ${DATA_REL}`);
  const body = source.slice(start + `export const ${literalName} = `.length);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "[") depth += 1;
    else if (body[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error(`${literalName} is not balanced in ${DATA_REL}`);
  return JSON.parse(body.slice(0, end + 1));
}

const categories = parseArray("PERK_CATEGORIES");
const rows = parseArray("PERK_PROVIDERS");

const CATEGORY_IDS = new Set(categories.map((c) => c.id));
const BADGE_TYPES = new Set(["success", "amber", "purple", "blue", "rose", "neutral"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RELATIVE_TIME_RE = /今晚|今晨|明天|明日|昨天|昨日|本周|下周|本月|上个月/;
const DATE_WITHOUT_YEAR_RE = /(?<!\d{4}\s*年\s*)(?<!\d{4}-)\b\d{1,2}\s*月\s*\d{1,2}\s*日/;
const DEADLINE_CONTEXT_RE = /截止|结束|到期|最后|活动期|限免|有效/;

function registrable(host) {
  const parts = String(host).toLowerCase().split(".").filter(Boolean);
  return parts.slice(-2).join(".");
}

function hostOf(value) {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return "";
  }
}

if (!rows.length) fail("PERK_PROVIDERS 为空");

const seenIds = new Map();
const seenHosts = new Map();

for (const [index, row] of rows.entries()) {
  const id = row.id || `#${index}`;

  for (const key of ["id", "name", "provider", "badge", "description", "officialUrl", "checkedAt", "sourceUrl"]) {
    if (typeof row[key] !== "string" || !row[key].trim()) fail(`${id}: 缺少 ${key}`);
  }
  if (!Array.isArray(row.tags) || !row.tags.length) fail(`${id}: tags 必须是非空数组`);
  if (!Array.isArray(row.category) || !row.category.length) fail(`${id}: category 必须是非空数组`);
  else {
    for (const c of row.category) {
      if (!CATEGORY_IDS.has(c)) fail(`${id}: category "${c}" 不在 PERK_CATEGORIES 中`);
    }
  }
  if (!BADGE_TYPES.has(row.badgeType)) fail(`${id}: badgeType "${row.badgeType}" 不在允许集合`);

  if (seenIds.has(row.id)) fail(`${id}: id 与第 ${seenIds.get(row.id) + 1} 行重复`);
  seenIds.set(row.id, index);

  for (const key of ["officialUrl", "sourceUrl"]) {
    if (typeof row[key] !== "string" || !row[key]) continue;
    let url;
    try {
      url = new URL(row[key]);
    } catch {
      fail(`${id}: ${key} 不是合法绝对 URL：${row[key]}`);
      continue;
    }
    if (url.protocol !== "https:") fail(`${id}: ${key} 必须走 https`);
    if (key === "officialUrl") {
      const host = url.host.toLowerCase();
      if (seenHosts.has(host)) fail(`${id}: officialUrl 主机 ${host} 与「${seenHosts.get(host)}」重复`);
      else seenHosts.set(host, row.name);
    }
  }

  if (typeof row.checkedAt === "string" && row.checkedAt && !DATE_RE.test(row.checkedAt)) {
    fail(`${id}: checkedAt 必须是 YYYY-MM-DD（当前 ${row.checkedAt}）`);
  } else if (DATE_RE.test(row.checkedAt || "")) {
    const ageDays = (Date.now() - Date.parse(`${row.checkedAt}T00:00:00Z`)) / 86400000;
    if (ageDays > STALE_DAYS) warn(`${id}: checkedAt ${row.checkedAt} 已超过 ${STALE_DAYS} 天，需重新核对`);
    if (ageDays < -1) fail(`${id}: checkedAt ${row.checkedAt} 在未来`);
  }

  if (row.hasInvite !== Boolean(row.inviteUrl)) {
    fail(`${id}: hasInvite=${row.hasInvite} 与 inviteUrl 是否存在不一致`);
  }
  if (row.inviteCode && !row.inviteUrl) fail(`${id}: 有 inviteCode 但没有 inviteUrl`);
  if (row.inviteUrl) {
    let inviteHost;
    try {
      inviteHost = new URL(row.inviteUrl).host;
    } catch {
      fail(`${id}: inviteUrl 不是合法 URL：${row.inviteUrl}`);
      inviteHost = null;
    }
    if (inviteHost) {
      if (registrable(inviteHost) !== registrable(hostOf(row.officialUrl))) {
        fail(`${id}: inviteUrl 主机 ${inviteHost} 与 officialUrl 不同主域（疑似串台）`);
      }
    }
  }

  for (const key of ["badge", "description", "tips"]) {
    const text = typeof row[key] === "string" ? row[key] : "";
    if (!text) continue;
    const rel = text.match(RELATIVE_TIME_RE);
    if (rel) fail(`${id}: ${key} 用了会自己过期的相对时间「${rel[0]}」，请写成绝对日期`);
    const dayMonth = text.match(DATE_WITHOUT_YEAR_RE);
    if (dayMonth && DEADLINE_CONTEXT_RE.test(text)) {
      fail(`${id}: ${key} 的「${dayMonth[0]}」带截止/活动语境却没写年份，改为 2026-10-30 这类绝对日期`);
    }
  }
}

// ── 图标可解析性（软检查）───────────────────────────────────────────────
try {
  const iconSrc = fs.readFileSync(
    path.join(ROOT, "dashboard/src/ui/dashboard/components/ProviderIcon.jsx"),
    "utf8"
  );
  const mapKeys = new Set();
  for (const name of ["PROVIDER_LOGO_MAP", "PROVIDER_ICON_MAP"]) {
    const at = iconSrc.indexOf(`const ${name} = {`);
    if (at < 0) continue;
    const seg = iconSrc.slice(at, iconSrc.indexOf("\n};", at));
    for (const m of seg.matchAll(/^\s{2}([A-Za-z0-9_'"-]+)\s*:/gm)) {
      mapKeys.add(m[1].replace(/['"]/g, "").toUpperCase());
    }
  }
  if (mapKeys.size) {
    for (const row of rows) {
      if (!mapKeys.has(String(row.provider || "").toUpperCase())) {
        warn(`${row.id}: provider "${row.provider}" 无品牌图标，卡片退回首字母占位`);
      }
    }
  }
} catch {
  warn("ProviderIcon.jsx 读不到，跳过图标可解析性检查");
}

if (warnings.length) {
  console.log(`validate-perks: ${warnings.length} 条提醒（不判红）`);
  for (const w of warnings) console.log(`  WARN ${w}`);
}

if (errors.length) {
  console.error(`validate-perks: ${errors.length} 项不通过`);
  for (const e of errors) console.error(`  FAIL ${e}`);
  process.exit(1);
}

console.log(`validate-perks: ${rows.length} 行福利条目全部带核对时间与来源，结构与措辞合格`);
