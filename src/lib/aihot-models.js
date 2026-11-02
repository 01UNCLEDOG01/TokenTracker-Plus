"use strict";

// Global model leaderboard, second source: AIHOT (aihot.news).
//
// Owner ruling 2026-11-03: the Global Models page keeps BOTH boards — the
// Artificial Analysis intelligence index and AIHOT's 综合榜 — as switchable
// tabs. AIHOT server-renders its whole table into plain HTML (no JSON API, no
// CORS headers), so this module reads the page once per TTL window, parses the
// rows, and caches the last good snapshot exactly like global-models.js. If
// AIHOT changes its markup the parse throws and the cached snapshot is served
// with `stale: true` instead of an empty board.
//
// Row shape (one <tr data-slug=...>): rank / model+provider / release date /
// eval count+coverage / cache price ¥ / input price ¥ / output price ¥ /
// AIHOT score. Prices are CNY per million tokens as published.

const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

const SOURCE_URL = "https://aihot.news/leaderboard";
const SOURCE_NAME = "AIHOT Leaderboard";
const SCHEMA = 1;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 25_000;

function cachePath(home) {
  return path.join(getTrackerRootDir({ home }), "aihot-models-cache.json");
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

function writeCache(home, value) {
  try {
    const file = cachePath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  } catch {
    // Cache is best effort; a failed write only costs the next network call.
  }
}

function finite(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(String(value).replace(/[,，\s¥￥]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// One row's cells: [0] rank, [1] model+provider, [2] release date,
// [3] eval count + coverage %, [4..6] cache/input/output prices (CNY),
// [7] AIHOT score (plus a duplicate coverage label from the score bar).
function parseRow(trHtml) {
  const slugMatch = trHtml.match(/data-slug="([^"]*)"/);
  const slug = slugMatch ? slugMatch[1].trim() : "";
  const cells = [];
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
  let cell = null;
  while ((cell = cellRe.exec(trHtml)) !== null) cells.push(cell[1]);
  if (cells.length < 8) return null;

  const rank = finite(stripTags(cells[0]));
  if (rank === null) return null;

  const strong = cells[1].match(/<strong[^>]*>([\s\S]*?)<\/strong>/);
  const displayName = strong ? stripTags(strong[1]) : "";
  const model = slug || displayName;
  if (!model) return null;
  // The provider appears in two <small> tags (visible + hidden variants); the
  // first one is the clean lab name, the second appends the release date.
  const providerMatch = cells[1].match(/<small[^>]*>([\s\S]*?)<\/small>/);
  const provider = providerMatch ? stripTags(providerMatch[1]) : "";

  const releaseDateMatch = (cells[2] || "").match(/datetime="([0-9]{4}-[0-9]{2}-[0-9]{2})"/);
  const releaseDate = releaseDateMatch ? releaseDateMatch[1] : stripTags(cells[2]) || null;

  const evalText = stripTags(cells[3]);
  const evalCount = finite((evalText.match(/(\d+)\s*项评测/) || [])[1]);
  const coverage = finite((evalText.match(/覆盖\s*([0-9.]+)\s*%/) || [])[1]);

  const cachePerMillionCny = finite(stripTags(cells[4]));
  const inputPerMillionCny = finite(stripTags(cells[5]));
  const outputPerMillionCny = finite(stripTags(cells[6]));

  // The score cell carries the number plus the coverage label of the score
  // bar; the first float is the score itself.
  const score = finite((stripTags(cells[7]).match(/-?[0-9]+(?:\.[0-9]+)?/) || [])[0]);
  if (score === null) return null;

  return {
    model,
    display_name: displayName || model,
    provider,
    provider_color: null,
    score,
    release_date: releaseDate,
    eval_count: evalCount,
    eval_coverage_percent: coverage,
    cache_per_million_cny: cachePerMillionCny,
    input_per_million_cny: inputPerMillionCny,
    output_per_million_cny: outputPerMillionCny,
  };
}

function parseAihotBoard(html) {
  const rows = [];
  const rowRe = /<tr[^>]*\bdata-slug="[^"]*"[^>]*>([\s\S]*?)<\/tr>/g;
  let row = null;
  while ((row = rowRe.exec(String(html || ""))) !== null) {
    const parsed = parseRow(row[0]);
    if (parsed) rows.push(parsed);
  }
  if (!rows.length) throw new Error("AIHOT leaderboard rows not found");
  return rows
    .sort((a, b) => b.score - a.score || a.display_name.localeCompare(b.display_name))
    .map((item, index) => ({ rank: index + 1, ...item }));
}

async function fetchAihotModels({
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
    if (!res.ok) throw new Error(`AIHOT models HTTP ${res.status}`);
    const html = await res.text();
    const items = parseAihotBoard(html);
    const snapshot = {
      schema: SCHEMA,
      fetched_at_ms: nowMs,
      updated_at: new Date(nowMs).toISOString(),
      source: SOURCE_NAME,
      source_url: SOURCE_URL,
      model_count: items.length,
      items,
    };
    writeCache(home, snapshot);
    return { ...snapshot, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error?.message || "fetch failed" };
    return {
      schema: SCHEMA,
      fetched_at_ms: null,
      updated_at: null,
      source: SOURCE_NAME,
      source_url: SOURCE_URL,
      items: [],
      stale: false,
      error: error?.message || "fetch failed",
    };
  }
}

module.exports = {
  fetchAihotModels,
  parseAihotBoard,
  parseRow,
  stripTags,
  cachePath,
  CACHE_TTL_MS,
  SCHEMA,
  SOURCE_URL,
  SOURCE_NAME,
};
