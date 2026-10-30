"use strict";

// Global model leaderboard, sourced from Artificial Analysis.
//
// AA publishes its Intelligence Index only through an API that requires a key
// (api/v2, x-api-key), but the public leaderboard page server-renders the same
// dataset into its React flight payload as `initialModels`. TT-plus reads that
// page, extracts the array, and caches the last good snapshot, so the board
// stays useful offline and costs one request per TTL window. No key, no
// maintenance. If AA changes its page format the fetch throws and the cached
// snapshot is served with `stale: true` instead of an empty page.

const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

const SOURCE_URL = "https://artificialanalysis.ai/leaderboards/models";
const SOURCE_NAME = "Artificial Analysis Intelligence Index";
const SCHEMA = 2;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 25_000;

// Only labs TT-plus has a real brand mark for get an icon; everything else is
// labelled by text alone rather than a dashed placeholder circle.
const CREATOR_ICON_KEYS = {
  Google: "gemini",
  DeepSeek: "deepseek",
  Kimi: "kimi",
  MiniMax: "minimax",
};

function cachePath(home) {
  return path.join(getTrackerRootDir({ home }), "global-models-cache.json");
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
  // Number(null) is 0, and AA leaves unmeasured fields null: without this
  // guard every unpriced model would rank as intelligence 0 and bill as $0.
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// The page streams its payload as a sequence of `self.__next_f.push([1,"…"])`
// string literals that React decodes and concatenates at runtime; the model
// array can span chunk boundaries, so nothing is searched for until every
// literal has been joined back together.
function extractFlightPayload(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[\d+,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g;
  let match = null;
  while ((match = re.exec(html)) !== null) {
    try {
      chunks.push(JSON.parse(match[1]));
    } catch {
      // A literal we cannot decode carries no model data; skip it.
    }
  }
  return chunks.join("");
}

function matchBalanced(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[" || c === "{") depth += 1;
    else if (c === "]" || c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

function extractInitialModels(flight) {
  const marker = '"initialModels":[';
  const at = flight.indexOf(marker);
  if (at < 0) return null;
  const raw = matchBalanced(flight, at + marker.length - 1);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeModel(model) {
  if (!model || typeof model !== "object") return null;
  const intelligence = finite(model.intelligenceIndex);
  if (intelligence === null) return null;
  if (model.deprecated === true) return null;
  const name = typeof model.name === "string" && model.name.trim() ? model.name.trim() : String(model.slug || "");
  if (!name) return null;
  const creator = typeof model.modelCreatorName === "string" ? model.modelCreatorName : "";
  let icon = CREATOR_ICON_KEYS[creator] || null;
  if (!icon && /grok/i.test(name)) icon = "grok";
  return {
    model: String(model.slug || name),
    display_name: name,
    provider: creator,
    provider_icon: icon,
    intelligence,
    intelligence_is_estimated: model.intelligenceIndexIsEstimated === true,
    omniscience: finite(model.omniscience),
    is_open_weights: model.isOpenWeights === true,
    is_reasoning: model.isReasoning === true,
    context_window_tokens: finite(model.contextWindowTokens),
    input_per_million_usd: finite(model.price1mInputTokens),
    output_per_million_usd: finite(model.price1mOutputTokens),
    cache_hit_per_million_usd: finite(model.cacheHitPrice),
    cache_write_per_million_usd: finite(model.cacheWritePrice),
    median_output_tokens_per_second: finite(model.medianOutputTokensPerSecond),
  };
}

function buildBoard(models) {
  if (!Array.isArray(models)) return [];
  return models
    .map(normalizeModel)
    .filter(Boolean)
    .sort((a, b) => b.intelligence - a.intelligence || a.display_name.localeCompare(b.display_name))
    .map((row, index) => ({ rank: index + 1, ...row }));
}

async function fetchGlobalModels({
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
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Global models HTTP ${res.status}`);
    const html = await res.text();
    const models = extractInitialModels(extractFlightPayload(html));
    if (!Array.isArray(models)) throw new Error("Global models payload not found");
    const items = buildBoard(models);
    if (!items.length) throw new Error("Global models response is empty");
    const snapshot = {
      schema: SCHEMA,
      fetched_at_ms: nowMs,
      updated_at: new Date(nowMs).toISOString(),
      source: SOURCE_NAME,
      source_url: SOURCE_URL,
      model_count: models.length,
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
  fetchGlobalModels,
  buildBoard,
  normalizeModel,
  extractFlightPayload,
  extractInitialModels,
  cachePath,
  CACHE_TTL_MS,
  SCHEMA,
  SOURCE_URL,
  SOURCE_NAME,
};
