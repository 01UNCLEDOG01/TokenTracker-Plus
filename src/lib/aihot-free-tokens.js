"use strict";

// AIHOT 「Token 羊毛」快照源 (https://aihot.news/free-tokens).
//
// 站主指令 2026-11-10：AIHOT 每天更新、数据靠谱，作为福利指南的时效参考信源
// （核对角标 / 下架提示 / 补卡候选），但**只做参考不接管**——卡片正文仍以本仓
// 人工核对为准，AIHOT 明确不收邀请返利类，两站口径不同，不能照抄他们的折算值。
// 致谢：数字生命卡兹克（Kazik）的开源项目 AIHOT，THIRD_PARTY_NOTICES.md 已登记。
//
// 实现与 aihot-models.js 同款：SSR 页面没有公开 JSON API，读整页 HTML；数据
// 在 React Router 的 turbo-stream loader 里（window.__reactRouterContext.
// streamController.enqueue("...") 片段，双层 JSON.parse 后是扁平数组，对象键
// "_N" 引用数组下标）。6 小时 TTL 缓存，抓取/解析失败回退上次快照并标 stale，
// 绝不编造。AIHOT 改版导致解析失败时抛错由 stale 分支兜底。

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SOURCE_URL = "https://aihot.news/free-tokens";
const SOURCE_NAME = "AIHOT Token 羊毛";
const SCHEMA = 1;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 25_000;

function cachePath(home) {
  const override = process.env.TOKENTRACKER_HOME;
  const root = override
    ? path.join(path.resolve(override), "tracker")
    : path.join(home || os.homedir(), ".tokentracker", "tracker");
  return path.join(root, "aihot-free-tokens-cache.json");
}

function readCache(home) {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
    const ok = value && typeof value === "object" && value.schema === SCHEMA && Array.isArray(value.items);
    return ok ? value : null;
  } catch {
    return null;
  }
}

function writeCache(home, snapshot) {
  try {
    const file = cachePath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot));
  } catch { /* read-only home: cache stays in memory only */ }
}

/** Pull every streamController.enqueue("...") fragment, in order. */
function extractEnqueueFragments(html) {
  const re = /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;
  const fragments = [];
  let match;
  while ((match = re.exec(String(html || ""))) !== null) {
    fragments.push(JSON.parse(match[1]));
  }
  return fragments;
}

// turbo-stream specials (v2 encoding): negative indices stand for values that
// don't survive JSON (undefined/null/NaN/±Infinity/-0). Verified against the
// live page on 2026-11-10: -5 = undefined fields, -2 = null.
const STREAM_SPECIALS = new Map([
  [-1, undefined],
  [-2, null],
  [-3, NaN],
  [-4, Infinity],
  [-5, undefined],
  [-6, -0],
  [-7, undefined],
]);

function decodeStreamValue(index, flat, seen) {
  if (typeof index !== "number") return index;
  if (index < 0) return STREAM_SPECIALS.has(index) ? STREAM_SPECIALS.get(index) : undefined;
  if (index >= flat.length) return undefined;
  const raw = flat[index];
  if (raw === null || typeof raw !== "object") return raw;
  if (seen.has(index)) return null; // shared/circular reference: shallow copy guard
  seen.add(index);
  if (Array.isArray(raw)) return raw.map((entry) => decodeStreamValue(entry, flat, seen));
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = /^_\d+$/.test(key) ? decodeStreamValue(Number(key.slice(1)), flat, seen) : key;
    if (typeof name !== "string" && typeof name !== "number") continue;
    out[String(name)] = decodeStreamValue(value, flat, seen);
  }
  return out;
}

/** Parse the SSR page into the loader payload { deals, ended, basis, ... }. */
function parseFreeTokensPage(html) {
  const fragments = extractEnqueueFragments(html);
  if (!fragments.length) throw new Error("AIHOT free-tokens stream payload not found");
  let flat;
  try {
    flat = JSON.parse(fragments.join(""));
  } catch {
    // Some releases may ship each chunk as its own JSON array; try the last
    // complete one before giving up.
    for (let i = fragments.length - 1; i >= 0; i -= 1) {
      try {
        flat = JSON.parse(fragments[i]);
        break;
      } catch { /* keep trying */ }
    }
  }
  if (!Array.isArray(flat)) throw new Error("AIHOT free-tokens stream payload malformed");
  const root = decodeStreamValue(0, flat, new Set());
  const loader = root?.loaderData?.["free-tokens"];
  if (!loader || !Array.isArray(loader.deals)) throw new Error("AIHOT free-tokens loader data missing");
  return loader;
}

// 折算/期限以外的字段不下发前端：角标只吃 核对日期/截止/标签/估值 信号。
function normalizeDeal(deal) {
  return {
    id: typeof deal.id === "string" ? deal.id : "",
    kind: typeof deal.kind === "string" ? deal.kind : "",
    provider: typeof deal.provider === "string" ? deal.provider : "",
    title: typeof deal.title === "string" ? deal.title : "",
    label: typeof deal.label === "string" ? deal.label : "",
    yuan: typeof deal.yuan === "number" && Number.isFinite(deal.yuan) ? deal.yuan : null,
    ends_at: typeof deal.endsAt === "string" ? deal.endsAt : null,
    verified_at: typeof deal.verifiedAt === "string" ? deal.verifiedAt : null,
    validity: typeof deal.validity === "string" ? deal.validity : "",
    evidence: typeof deal.evidence === "string" ? deal.evidence : "",
    counted: deal.counted === true,
    url: typeof deal.url === "string" ? deal.url : "",
  };
}

function buildSnapshot(loader, previous, nowMs) {
  const items = loader.deals.map(normalizeDeal).filter((item) => item.id && item.provider);
  const liveProviders = new Set(items.map((item) => item.provider));
  const previousProviders = new Set((previous?.items || []).map((item) => item.provider));
  const droppedProviders = [...previousProviders].filter((provider) => !liveProviders.has(provider));
  const basis = loader.basis || {};
  return {
    schema: SCHEMA,
    fetched_at_ms: nowMs,
    updated_at: new Date(nowMs).toISOString(),
    source: SOURCE_NAME,
    source_url: SOURCE_URL,
    server_now: typeof loader.serverNow === "number" ? loader.serverNow : null,
    usd_cny: typeof basis.usdCny === "number" ? basis.usdCny : null,
    // AIHOT 折算口径（basis 的并列键，非嵌套）：mix=「一般用量」、ratio="7 : 2 : 1"
    mix_ratio: typeof basis.ratio === "string" ? basis.ratio : null,
    deal_count: items.length,
    ended_count: Array.isArray(loader.ended) ? loader.ended.length : null,
    dropped_providers: droppedProviders,
    items,
  };
}

function emptySnapshot() {
  return {
    schema: SCHEMA,
    fetched_at_ms: null,
    updated_at: null,
    source: SOURCE_NAME,
    source_url: SOURCE_URL,
    server_now: null,
    usd_cny: null,
    mix_ratio: null,
    deal_count: 0,
    ended_count: null,
    dropped_providers: [],
    items: [],
  };
}

async function fetchAihotFreeTokens({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  force = false,
} = {}) {
  const cached = readCache(home);
  if (!force && cached && Number.isFinite(Number(cached.fetched_at_ms)) && nowMs - Number(cached.fetched_at_ms) < CACHE_TTL_MS) {
    return { ...cached, stale: false };
  }
  try {
    const res = await fetchImpl(SOURCE_URL, {
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`AIHOT free-tokens HTTP ${res.status}`);
    const html = await res.text();
    const loader = parseFreeTokensPage(html);
    const snapshot = buildSnapshot(loader, cached, nowMs);
    writeCache(home, snapshot);
    return { ...snapshot, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error?.message || "fetch failed" };
    return { ...emptySnapshot(), stale: false, error: error?.message || "fetch failed" };
  }
}

module.exports = {
  CACHE_TTL_MS,
  SCHEMA,
  SOURCE_NAME,
  SOURCE_URL,
  cachePath,
  decodeStreamValue,
  emptySnapshot,
  extractEnqueueFragments,
  fetchAihotFreeTokens,
  normalizeDeal,
  parseFreeTokensPage,
};
