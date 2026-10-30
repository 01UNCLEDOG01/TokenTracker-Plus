"use strict";

// Global model leaderboard. The OrcaRouter public board is a read-only
// aggregator that labels its sources explicitly (LMArena, OpenRouter,
// SWE-bench, Artificial Analysis) and needs no API key. TT-plus proxies it
// through the local API and keeps a last-good cache so the page still renders
// when the source is unreachable.

const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

const SOURCE_URL = "https://api.orcarouter.ai/api/public/composite-board";
const CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15_000;

function cachePath(home) {
  return path.join(getTrackerRootDir({ home }), "global-models-cache.json");
}

function readCache(home) {
  try {
    const value = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
    return value && typeof value === "object" && Array.isArray(value.items) ? value : null;
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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") return null;
  const rank = finite(item.rank);
  if (!rank || !item.model) return null;
  return {
    rank,
    model: String(item.model),
    display_name: typeof item.display_name === "string" ? item.display_name : String(item.model),
    provider: typeof item.provider === "string" ? item.provider : "",
    composite: finite(item.composite),
    input_per_million_usd: finite(item.input_per_million_usd),
    output_per_million_usd: finite(item.output_per_million_usd),
    source_count: finite(item.source_count),
    provisional: item.provisional === true,
    signals: item.signals && typeof item.signals === "object"
      ? {
          aa_intelligence: finite(item.signals.aa_intelligence),
          openrouter_share_pct: finite(item.signals.openrouter_share_pct),
          orca_win_rate: finite(item.signals.orca_win_rate),
        }
      : {},
  };
}

async function fetchGlobalModels({ home, fetchImpl = fetch, nowMs = Date.now(), timeoutMs = DEFAULT_TIMEOUT_MS, force = false } = {}) {
  const cached = readCache(home);
  if (!force && cached && Number.isFinite(Number(cached.fetched_at_ms)) && nowMs - Number(cached.fetched_at_ms) < CACHE_TTL_MS) {
    return { ...cached, stale: false };
  }
  try {
    const res = await fetchImpl(SOURCE_URL, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Global models HTTP ${res.status}`);
    const body = await res.json();
    const data = body?.data;
    if (!data || !Array.isArray(data.items)) throw new Error("Global models response has no items");
    const items = data.items.map(normalizeItem).filter(Boolean);
    if (!items.length) throw new Error("Global models response is empty");
    const snapshot = {
      fetched_at_ms: nowMs,
      updated_at: typeof data.updated_at === "string" ? data.updated_at : new Date(nowMs).toISOString(),
      attribution: Array.isArray(data.attribution) ? data.attribution.filter((x) => typeof x === "string") : [],
      weights: data.weights && typeof data.weights === "object" ? data.weights : null,
      items,
    };
    writeCache(home, snapshot);
    return { ...snapshot, stale: false };
  } catch (error) {
    if (cached) return { ...cached, stale: true, error: error?.message || "fetch failed" };
    return { fetched_at_ms: null, updated_at: null, attribution: [], items: [], stale: false, error: error?.message || "fetch failed" };
  }
}

module.exports = {
  fetchGlobalModels,
  normalizeItem,
  cachePath,
  CACHE_TTL_MS,
};
