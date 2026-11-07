import { toFiniteNumber } from "./format";

type AnyRecord = Record<string, any>;

function normalizeModelId(value: any) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

function resolveModelId(model: any) {
  const id = normalizeModelId(model?.model_id);
  if (id) return id;
  return null;
}

function resolveModelName(model: any, fallback: any) {
  if (model?.model) return String(model.model);
  return fallback;
}

function buildBareModelNameIndex(models: any[]) {
  const bareNames = new Map();
  const weights = new Map();
  for (const model of models) {
    const name = typeof model?.name === "string" ? model.name.trim() : "";
    const key = normalizeModelId(name);
    if (!key || key.includes("/")) continue;
    const weight = Math.max(0, toFiniteNumber(model?.weight) ?? 0);
    if (!bareNames.has(key) || weight >= (weights.get(key) || 0)) {
      bareNames.set(key, name);
      weights.set(key, weight);
    }
  }
  return bareNames;
}

function resolveAggregateModelIdentity(name: string, bareNames: Map<string, string>) {
  const normalized = normalizeModelId(name);
  if (!normalized) return null;
  const slash = normalized.lastIndexOf("/");
  if (slash > 0) {
    const suffix = normalized.slice(slash + 1);
    if (bareNames.has(suffix)) {
      return { key: suffix, name: bareNames.get(suffix) };
    }
  }
  return { key: normalized, name };
}

export function resolveDisplayTokens(totals: any, fallback = 0) {
  const billableTokens = toFiniteNumber(totals?.billable_total_tokens);
  const totalTokens = toFiniteNumber(totals?.total_tokens);
  if (billableTokens != null && billableTokens > 0) return billableTokens;
  if (totalTokens != null && totalTokens > 0) return totalTokens;
  return billableTokens ?? totalTokens ?? fallback;
}

// Deprecated source names folded into their canonical spelling at display
// time. "deepseek" was the first dsh-integration source name; it was renamed
// to "dsh", but a cloud upload from before the rename still carries the old
// name. Folding it back keeps one "DeepSeek Harness" provider instead of two
// ("DEEPSEEK" + "DeepSeek Harness"). This only changes presentation; the
// underlying cloud rows are not rewritten.
const SOURCE_ALIASES: Record<string, string> = {
  deepseek: "dsh",
};

function canonicalSource(source: any): string {
  const raw = typeof source === "string" ? source : "";
  return SOURCE_ALIASES[raw] || raw;
}

const TOKEN_TOTAL_KEYS = [
  "total_tokens",
  "billable_total_tokens",
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "reasoning_output_tokens",
  // Not a token measure, but it rides the same totals plumbing so alias
  // merging keeps request-only providers intact (issue 948).
  "conversation_count",
  // Cache-coverage signal (TRAE CN request ledger): must survive alias
  // merging for the estimate gate — without it a hit-rate-derived ratio would
  // stand in for real coverage (owner ruling 2026-11-07).
  "cache_observed_input_tokens",
];

// Token-type split keys as carried on provider/all-model entries (`tokens`
// object). Single source of truth for aggregation and the expandable UI rows.
export const MODEL_TOKEN_SPLIT_KEYS = [
  "input",
  "output",
  "cached",
  "cacheCreate",
  "reasoning",
];

/**
 * Sum of one entry's token-type splits. Pure helper so .jsx consumers never
 * need inline comparisons (keeps the ui-hardcode scanner quiet).
 */
export function modelTokenSplitsTotal(tokens: any) {
  let total = 0;
  for (const key of MODEL_TOKEN_SPLIT_KEYS) {
    total += Math.max(0, Number(tokens?.[key]) || 0);
  }
  return total;
}

/** Whether a model entry carries backend token-type splits worth expanding. */
export function hasModelTokenSplits(model: any) {
  return modelTokenSplitsTotal(model?.tokens) > 0;
}

function addTotalsInto(target: any, add: any) {
  for (const key of TOKEN_TOTAL_KEYS) {
    target[key] = (Number(target[key]) || 0) + (Number(add?.[key]) || 0);
  }
  target.total_cost_usd = String(
    Number(target.total_cost_usd || 0) + Number(add?.total_cost_usd || 0),
  );
}

function emptyTotals() {
  return {
    total_tokens: 0,
    billable_total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    conversation_count: 0,
    total_cost_usd: "0",
  };
}

// Merge API sources whose canonical name collides after alias resolution
// (e.g. a stale "deepseek" plus the current "dsh"), summing totals and
// combining per-model rows keyed by model id.
// Merge the cache-coverage signal across contributing rows. undefined = "no
// signal" (pre-v5 buckets, other providers): as an accumulator start it
// absorbs the other side, but once a real signal exists, mixing in a
// signal-less row destroys it — a partially-unmeasured merge must not read as
// fully measured. Result: number, or null when no trustworthy signal remains.
function mergeObservedSignal(a: any, b: any): number | null {
  if (a == null) return b == null ? null : Number(b);
  if (b == null) return null;
  return Number(a) + Number(b);
}

function mergeSourcesByAlias(sources: any[]) {
  const bySource = new Map();
  for (const entry of sources || []) {
    const source = canonicalSource(entry?.source);
    if (!source) continue;
    let merged = bySource.get(source);
    if (!merged) {
      merged = { source, source_scope: entry?.source_scope, totals: emptyTotals(), models: new Map() };
      bySource.set(source, merged);
    }
    addTotalsInto(merged.totals, entry?.totals);
    merged.totals.cache_observed_input_tokens = mergeObservedSignal(
      merged.totals.cache_observed_input_tokens,
      entry?.totals?.cache_observed_input_tokens,
    );
    for (const model of Array.isArray(entry?.models) ? entry.models : []) {
      const id = model?.model_id || model?.model || "";
      if (!id) continue;
      let modelRow = merged.models.get(id);
      if (!modelRow) {
        modelRow = { ...model, model: model?.model || id, model_id: id, totals: emptyTotals() };
        merged.models.set(id, modelRow);
      }
      addTotalsInto(modelRow.totals, model?.totals);
      modelRow.totals.cache_observed_input_tokens = mergeObservedSignal(
        modelRow.totals.cache_observed_input_tokens,
        model?.totals?.cache_observed_input_tokens,
      );
    }
  }
  return Array.from(bySource.values()).map((s) => ({
    ...s,
    models: Array.from(s.models.values()),
  }));
}

/**
 * Normalize the API model breakdown into provider-oriented fleet rows: one
 * entry per source with totals, cache stats and its per-model ranking. Each
 * model row carries the token-type splits (`tokens`) that feed the expandable
 * detail rows in the All-models and per-provider lists.
 */
export function buildFleetData(modelBreakdown: any, { copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const sources: any[] = mergeSourcesByAlias(
    Array.isArray(modelBreakdown?.sources) ? modelBreakdown.sources : [],
  );
  const normalizedSources = sources
    .map((entry: any) => {
      const totalTokens = resolveDisplayTokens(entry?.totals);
      const totalCost = toFiniteNumber(entry?.totals?.total_cost_usd) ?? 0;
      // Request-only providers (issue 948: credit-billed transcripts that
      // report no tokens) carry their activity as conversation_count.
      const totalRequests = Math.max(0, toFiniteNumber(entry?.totals?.conversation_count) ?? 0);
      return {
        source: entry?.source,
        totalTokens: Number.isFinite(totalTokens) ? totalTokens : 0,
        totalRequests,
        totalCost: Number.isFinite(totalCost) ? totalCost : 0,
        inputTokens: Math.max(0, toFiniteNumber(entry?.totals?.input_tokens) ?? 0),
        cacheRead: Math.max(0, toFiniteNumber(entry?.totals?.cached_input_tokens) ?? 0),
        cacheCreate: Math.max(0, toFiniteNumber(entry?.totals?.cache_creation_input_tokens) ?? 0),
        models: Array.isArray(entry?.models) ? entry.models : [],
      };
    })
    // A source can carry real spend with no token counts at all (Qoder
    // international bills credits), and a request-only source carries
    // conversation_count with no tokens (issue 948). Ranking is by tokens, but
    // dropping either here made the card disappear rather than show its cost or
    // its request count.
    .filter((entry) => entry.totalTokens > 0 || entry.totalCost > 0 || entry.totalRequests > 0);

  if (!normalizedSources.length) return [];

  const grandTotal = normalizedSources.reduce((acc, entry) => acc + entry.totalTokens, 0);
  const pricingMode =
    typeof modelBreakdown?.pricing?.pricing_mode === "string"
      ? modelBreakdown.pricing.pricing_mode.toUpperCase()
      : null;

  return normalizedSources
    .slice()
    // Token-backed providers keep today's order; request-only providers sink
    // to the bottom, ordered among themselves by request count (issue 948).
    .sort((a: any, b: any) => (b.totalTokens - a.totalTokens) || (b.totalRequests - a.totalRequests))
    .map((entry: any) => {
      const label = entry.source
        ? String(entry.source).toUpperCase()
        : safeCopy("shared.placeholder.short");
      const totalPercentRaw = grandTotal > 0 ? (entry.totalTokens / grandTotal) * 100 : 0;
      const totalPercent = Number.isFinite(totalPercentRaw) ? totalPercentRaw.toFixed(2) : "0.00";
      const models = entry.models
        .map((model: any) => {
          const rawTokens = resolveDisplayTokens(model?.totals);
          const modelTokens = Number.isFinite(rawTokens) ? Math.max(0, rawTokens) : 0;
          const modelRequests = Math.max(0, toFiniteNumber(model?.totals?.conversation_count) ?? 0);
          const name = resolveModelName(model, safeCopy("shared.placeholder.short"));
          const id = resolveModelId(model);
          const explicitModelCost = toFiniteNumber(model?.totals?.total_cost_usd);
          // Request-only models book no cost — the endpoint total is a literal
          // 0 and there is no token base to prorate entry cost from, so keep
          // null and let the UI show "—" instead of a fabricated "$0.00". A
          // cost-only model (Qoder international credits, no tokens) keeps its
          // real explicit cost.
          const modelCost =
            modelTokens > 0
              ? explicitModelCost != null
                ? explicitModelCost
                : entry.totalCost > 0 && entry.totalTokens > 0
                  ? (modelTokens / entry.totalTokens) * entry.totalCost
                  : null
              : explicitModelCost != null && explicitModelCost > 0
                ? explicitModelCost
                : null;
          // Same rule as the source list above: a model row stays when it
          // carries money or request activity even though it reports no tokens.
          if (modelTokens <= 0 && !(Number(modelCost) > 0) && modelRequests <= 0) return null;
          const share =
            entry.totalTokens > 0 ? Math.round((modelTokens / entry.totalTokens) * 1000) / 10 : 0;
          // Per-model token-type splits feed the expandable detail rows in
          // the All-models and per-provider model lists. The API already
          // returns them; previously they were dropped here.
          const rawTotals = model?.totals || {};
          const tokens = {
            input: Math.max(0, toFiniteNumber(rawTotals?.input_tokens) ?? 0),
            output: Math.max(0, toFiniteNumber(rawTotals?.output_tokens) ?? 0),
            cached: Math.max(0, toFiniteNumber(rawTotals?.cached_input_tokens) ?? 0),
            cacheCreate: Math.max(0, toFiniteNumber(rawTotals?.cache_creation_input_tokens) ?? 0),
            reasoning: Math.max(0, toFiniteNumber(rawTotals?.reasoning_output_tokens) ?? 0),
            // True measured-coverage signal (TRAE CN request ledger only):
            // input-side volume from rows actually carrying the client's
            // exact_* fields. undefined when the ledger didn't report it —
            // the estimate gate then keeps the conservative "measured wins"
            // behavior instead of guessing a coverage ratio from a hit rate.
            cacheObservedInput: toFiniteNumber(rawTotals?.cache_observed_input_tokens),
            // The model's own measured hit rate over its fielded history
            // (server-side: measured rows only). Estimate evidence when the
            // current period has no same-model peer — same tool, same model,
            // real measurements.
            cacheObservedHitRate: toFiniteNumber(model?.cache_observed_hit_rate),
          };
          // Per-model input-side cache hit rate, same semantics as the
          // source-level figure: cache reads / all input-side tokens. null when
          // the model does no caching at all (e.g. a provider that reports
          // neither read nor create), so TRAE-interval peer evidence ignores it
          // instead of treating "no cache reporting" as a 0% hit rate.
          //
          // A peer is only valid hit-rate evidence when it actually reported
          // uncached input (input > 0): a model that reports cached>0 with
          // input=cacheCreate=0 would otherwise read as a degenerate 100% hit
          // rate, and if that was really a "input_tokens not reported" data gap
          // it would pull the TRAE lower bound down (exaggerated savings).
          // Requiring input>0 keeps such rows out of the peer evidence.
          const modelCacheInputTokens = tokens.input + tokens.cached + tokens.cacheCreate;
          const hasModelCacheActivity = tokens.cached + tokens.cacheCreate > 0;
          const modelCacheHitRate =
            tokens.input > 0 && hasModelCacheActivity && modelCacheInputTokens > 0
              ? Math.round((tokens.cached / modelCacheInputTokens) * 100)
              : null;
          return {
            id,
            name,
            share,
            usage: modelTokens,
            requests: modelRequests,
            cost: modelCost,
            tokens,
            cacheHitRate: modelCacheHitRate,
            pricing: model?.pricing || null,
            costSource: model?.cost_source || null,
            // upstream PR 975: Codex Fast/Ultrafast observed subsets (null on other
            // sources), consumed by the expanded row's tier block.
            ...(model?.speed_tiers ? { speedTiers: model.speed_tiers } : {}),
          };
        })
        .filter(Boolean);
      // Input-side cache hit rate = cache reads / all input-side tokens
      // (non-cached input + cache reads + cache writes). cached_input_tokens are
      // reads, cache_creation_input_tokens are writes. null when the source does
      // no caching at all (e.g. Gemini/Antigravity report neither) so the UI omits
      // the line instead of showing a meaningless 0%.
      const cacheInputTokens = entry.inputTokens + entry.cacheRead + entry.cacheCreate;
      const hasCacheActivity = entry.cacheRead + entry.cacheCreate > 0;
      const cacheHitRate =
        hasCacheActivity && cacheInputTokens > 0
          ? Math.round((entry.cacheRead / cacheInputTokens) * 100)
          : null;
      return {
        source: entry.source,
        trae_estimate_applied: modelBreakdown?.trae_estimate_applied === true,
        label,
        totalPercent: String(totalPercent),
        totalPercentValue: totalPercentRaw,
        usd: entry.totalCost,
        usage: entry.totalTokens,
        requests: entry.totalRequests,
        cacheHitRate,
        cacheReusedTokens: entry.cacheRead,
        cacheInputTokens,
        models,
      };
    });
}

// Cache-read pricing as a fraction of uncached input, for models whose
// provider does not report cache fields at all (TRAE international does not
// for DeepSeek). Used only to derive the LOWER bound of an honest cost
// interval; the upper bound stays the reported figure. Values are per-model
// so a non-DeepSeek unknown-cache model is skipped rather than mis-discounted.
const UNKNOWN_CACHE_DISCOUNT: Record<string, number> = {
  "deepseek-v4.1-flash": 0.006 / 0.3, // $0.006 cache read / $0.30 input per MTok
};

// Measured-cache coverage gate (owner ruling 2026-11-07): measured rows must
// cover at least half of a model's input-side volume for the model to count as
// "measured". Below that the volume is in the client's stopped-reporting
// regime (TRAE CN now writes the fields only on rare small requests — a
// sprinkle of measured rows must not switch the whole model to "measured"
// while 99%+ of its input rides the uncached rate), and the peer-median fold
// takes over with its estimate absorbing the sprinkle.
const TRAE_MEASURED_COVERAGE_MIN = 0.5;

function normalizeIntervalModelName(name: any) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Rewrite the TRAE-family cache statistics for a server-folded payload so the
 * card's hit rate and cached-token columns reflect the estimate, not TRAE's
 * dry-spell blend (owner ruling: the cached quantity must be estimated).
 * Evidence per model — the model's own fielded rate (cacheObservedHitRate),
 * else the recognized median via the peer pool, else left as measured; costs
 * are NEVER touched here (the server already folded them).
 */
function applyTraeEstimatedCacheStats(providers: any[]) {
  const peers: any[] = Array.isArray(providers) ? providers : [];
  const hitRatesByModel = new Map();
  for (const peer of peers) {
    const peerSource = String(peer?.source || peer?.label || "").trim().toLowerCase();
    if (peerSource === "trae" || peerSource === "trae-cn") continue;
    for (const model of Array.isArray(peer?.models) ? peer.models : []) {
      if (model?.cacheHitRate == null) continue;
      const name = normalizeIntervalModelName(model.name || model.id);
      if (!name) continue;
      if (!hitRatesByModel.has(name)) hitRatesByModel.set(name, []);
      hitRatesByModel.get(name).push(Number(model.cacheHitRate));
    }
  }
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  for (const provider of providers) {
    const source = String(provider?.source || provider?.label || "").trim().toLowerCase();
    if (source !== "trae" && source !== "trae-cn") continue;
    let estReused = 0;
    let estFresh = 0;
    let estCC = 0;
    let estimated = false;
    for (const model of Array.isArray(provider?.models) ? provider.models : []) {
      const t = model?.tokens || {};
      const input = Math.max(0, Number(t.input) || 0);
      const cached = Math.max(0, Number(t.cached) || 0);
      const cc = Math.max(0, Number(t.cacheCreate) || 0);
      const inputSide = input + cached;
      // Same gate as the server fold: below 50% measured coverage the blend is
      // estimate territory; at/above it the measured figures are truth.
      const observed = t.cacheObservedInput == null ? null : Number(t.cacheObservedInput);
      const coverage = observed != null && inputSide > 0 ? Math.min(observed / inputSide, 1) : null;
      const selfRate = Number(t.cacheObservedHitRate);
      const rates = hitRatesByModel.get(normalizeIntervalModelName(model.name || model.id));
      const h = coverage != null && coverage < 0.5
        ? (Number.isFinite(selfRate) && selfRate > 0
            ? Math.min(Math.max(selfRate / 100, 0), 1)
            : rates && rates.length
              ? Math.min(Math.max(median(rates) / 100, 0), 1)
              : null)
        : null;
      if (h == null) {
        estReused += cached;
        estFresh += input;
        estCC += cc;
        continue;
      }
      const volume = input + cached;
      estReused += volume * h;
      estFresh += volume * (1 - h);
      estCC += cc;
      model.tokens = { ...t, input: volume * (1 - h), cached: volume * h };
      model.cacheHitRate = Math.round(h * 100);
      model.cacheEstimated = true;
      estimated = true;
    }
    const estInputSide = estFresh + estReused + estCC;
    if (!estimated || estInputSide <= 0) continue;
    provider.cacheReusedTokens = estReused;
    provider.cacheInputTokens = estInputSide;
    provider.cacheHitRate =
      estReused > 0 ? Math.round((estReused / estInputSide) * 100) : null;
  }
}

// Cache-read price as a fraction of the uncached input price. Prefer the
// per-model pricing payload (the API already returns input/output/cache_read
// rates), so every model with published cache pricing can be folded; fall
// back to the curated DeepSeek ratio for payloads that omit pricing.
function cacheDiscountFor(model: any): number | null {
  const pricing = model?.pricing;
  const input = Number(pricing?.input);
  const cacheRead = Number(pricing?.cache_read);
  if (Number.isFinite(input) && input > 0 && Number.isFinite(cacheRead) && cacheRead > 0) {
    return Math.min(cacheRead / input, 1);
  }
  return UNKNOWN_CACHE_DISCOUNT[normalizeIntervalModelName(model?.name || model?.id)] ?? null;
}

/**
 * Core TRAE cache fold. TRAE international reports no cache fields for some
 * models (DeepSeek), so every input token is billed at the uncached rate and
 * the API cost is a ceiling. For each such model this folds its cost with the
 * hit rate observed for the SAME model at OTHER sources (median):
 *   folded = ceiling * ((1-H) + H * cacheReadDiscount)
 * Models without peer evidence (or without a known discount) keep their
 * ceiling — nothing is fabricated. Returns per-model results so callers can
 * either build an aggregate interval or rewrite displayed costs.
 */
function computeTraeFold(provider: any, fleetData: any) {
  const models: any[] = Array.isArray(provider?.models) ? provider.models : [];
  const peers: any[] = Array.isArray(fleetData) ? fleetData : [];
  const hitRatesByModel = new Map();
  for (const peer of peers) {
    const peerSource = String(peer?.source || peer?.label || "").trim().toLowerCase();
    // Both TRAE editions are excluded from their own peer pool: a provider's
    // own near-zero cache figure (the sprinkle the coverage gate is folding)
    // must not drag the median it is being folded with.
    if (peerSource === "trae" || peerSource === "trae-cn") continue;
    for (const model of Array.isArray(peer?.models) ? peer.models : []) {
      if (model?.cacheHitRate == null) continue;
      const name = normalizeIntervalModelName(model.name || model.id);
      if (!name) continue;
      if (!hitRatesByModel.has(name)) hitRatesByModel.set(name, []);
      hitRatesByModel.get(name).push(Number(model.cacheHitRate));
    }
  }

  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const perModel: { model: any; originalCost: number; foldedCost: number; hitRate: number | null }[] = [];
  let estimatedCost = 0;
  let ceilingCost = 0;
  let covered = 0;
  const coveredRates: number[] = [];
  for (const model of models) {
    const modelCost = Number(model?.cost);
    if (!Number.isFinite(modelCost) || modelCost < 0) continue;
    ceilingCost += modelCost;
    // Measured-cache coverage gate: see TRAE_MEASURED_COVERAGE_MIN above.
    const t = model?.tokens || {};
    const reportedCache = (Number(t.cached) || 0) + (Number(t.cacheCreate) || 0);
    const inputSide = (Number(t.input) || 0) + reportedCache;
    // True coverage: measured-cache-carrying input volume over the whole
    // input side, reported by the ledger itself (cacheObservedInput). A ratio
    // derived from the hit rate cannot tell "fully measured, low hit rate"
    // from "mostly unmeasured" — folding the former would overwrite real
    // measurements with someone else's median. When the ledger supplies no
    // signal (other providers, pre-v5 buckets), keep the conservative stance:
    // any measured cache wins and nothing is folded.
    // Number(null) === 0 in JS: the null sentinel must be checked before
    // coercion, or "no signal" would read as "zero coverage" and fold.
    const observed = t.cacheObservedInput == null ? null : Number(t.cacheObservedInput);
    const hasObservedSignal = observed != null && Number.isFinite(observed) && inputSide > 0;
    const measuredCoverage = hasObservedSignal ? Math.min(observed / inputSide, 1) : null;
    const discount =
      measuredCoverage != null
        ? measuredCoverage >= TRAE_MEASURED_COVERAGE_MIN ? null : cacheDiscountFor(model)
        : reportedCache > 0 ? null : cacheDiscountFor(model);
    const rates =
      discount == null
        ? null
        : hitRatesByModel.get(normalizeIntervalModelName(model.name || model.id));
    // Other TRAE-card models also observe the model (TRAE CN): they count as
    // peer evidence even though the card itself reports no cache fields.
    // Owner ruling 2026-11-07, evidence priority: the model's OWN fielded
    // history (same tool, same model, measured — Sep/Oct 95-97%) outranks
    // current-period peers, whose small samples (another tool's odd 0.1%
    // DeepSeek day) say nothing about TRAE's cache behavior. Peers fill in
    // only when the model has no fielded history.
    const selfRate = Number(t.cacheObservedHitRate);
    const hitRate = Number.isFinite(selfRate) && selfRate > 0
      ? selfRate
      : rates && rates.length ? median(rates) : null;
    if (hitRate == null || !Number.isFinite(hitRate) || hitRate <= 0) {
      estimatedCost += modelCost;
      perModel.push({ model, originalCost: modelCost, foldedCost: modelCost, hitRate: null });
      continue;
    }
    const h = Math.min(Math.max(hitRate / 100, 0), 1);
    const foldedCost = modelCost * ((1 - h) + h * (discount as number));
    estimatedCost += foldedCost;
    covered += 1;
    coveredRates.push(hitRate);
    perModel.push({ model, originalCost: modelCost, foldedCost, hitRate });
  }

  return {
    perModel,
    estimatedCost,
    ceilingCost,
    covered,
    // Median cache hit rate (across covered models' peer medians) that produced
    // the estimate — shown so the reader sees the rate the price is folded
    // with. This is a simple (not cost-weighted) median: fine while only one
    // model carries a cache-read discount, advisory if that ever grows.
    medianHitRate: coveredRates.length
      ? Math.min(Math.max(median(coveredRates), 0), 100)
      : null,
  };
}

/**
 * Aggregate interval view over the fold (lower = estimated, upper = ceiling).
 * Kept for callers/tests that want the interval shape; the UI now prices via
 * applyTraeEstimatedCosts instead. Safe to call on already-estimated fleet
 * data: a mutated provider short-circuits to its stored estimate.
 */
export function buildTraeCostInterval(provider: any, fleetData: any) {
  const isTrae = String(provider?.source || provider?.label || "").trim().toLowerCase() === "trae";
  if (!isTrae) return null;
  if (provider?.traeEstimate) {
    const e = provider.traeEstimate;
    return {
      low: e.estimatedCost,
      high: e.ceilingCost,
      peerSources: e.covered,
      medianHitRate: e.medianHitRate,
    };
  }
  if (!Array.isArray(provider?.models) || !provider.models.length) return null;
  const fold = computeTraeFold(provider, fleetData);
  if (fold.ceilingCost <= 0 || fold.estimatedCost >= fold.ceilingCost || fold.covered === 0) {
    return null;
  }
  return {
    low: fold.estimatedCost,
    high: fold.ceilingCost,
    peerSources: fold.covered,
    medianHitRate: fold.medianHitRate,
  };
}

/**
 * Owner ruling 2026-11-03: price TRAE's unknown-cache models at the hit rate
 * the owner actually achieves on the same model at OTHER sources, instead of
 * showing a wide "estimated ~ ceiling" interval. Rewrites the TRAE provider in
 * place so every cost surface (rows, card totals, All-models) shows the same
 * estimate:
 *   - model.cost -> folded estimate, model.ceilingCost -> original (row marker);
 *   - provider.usd -> estimated total, provider.ceilingUsd -> original total;
 *   - provider.traeEstimate -> {estimatedCost, ceilingCost, medianHitRate,
 *     covered} for the expanded notice.
 * Models without peer evidence keep their ceiling (nothing fabricated), and an
 * already-estimated provider is left untouched (idempotent).
 */
export function applyTraeEstimatedCosts(fleetData: any) {
  const providers: any[] = Array.isArray(fleetData) ? fleetData : [];
  // The server now folds TRAE-family costs before the payload leaves
  // (trae_estimate_applied): client-side COST folding would double-discount,
  // so the raw measured cache stats below keep their ceiling-shaped blend —
  // but the OWNER RULING stands: the card's cached-token quantity and hit
  // rate must be ESTIMATED, not the ~0 figure TRAE's dry-spell blend reports.
  // Rewrite the cache stats with the same evidence chain the server fold
  // used (self fielded rate, recognized median for unused models, official
  // discount per model) without touching the already-folded costs.
  const serverFolded = providers.some(
    (p) => p?.trae_estimate_applied === true || p?.__trae_estimate_applied,
  );
  if (serverFolded) {
    applyTraeEstimatedCacheStats(providers);
    return providers;
  }
  for (const provider of providers) {
    const source = String(provider?.source || provider?.label || "").trim().toLowerCase();
    // TRAE international and TRAE CN both report no cache fields for recent
    // models (CN stopped writing them after the 2026-09 client update), so
    // both need the same measured-elsewhere estimate.
    const isTrae = source === "trae" || source === "trae-cn";
    if (!isTrae || provider?.traeEstimate) continue;
    const fold = computeTraeFold(provider, fleetData);
    if (fold.covered === 0 || fold.ceilingCost <= 0 || fold.estimatedCost >= fold.ceilingCost) {
      continue;
    }
    for (const entry of fold.perModel) {
      if (entry.hitRate == null) continue;
      entry.model.cost = entry.foldedCost;
      entry.model.ceilingCost = entry.originalCost;
    }
    // Source-line cache stats get the same treatment (owner ruling: the cached
    // token quantity must be estimated, not the ~0 figure TRAE's blend reports).
    // Covered models treat their whole input-side volume (fresh + measured
    // cache + cache-write) as T: cache reads = T*H, fresh = T*(1-H). Folding a
    // below-gate model absorbs its sprinkle of measured rows into the estimate
    // (the rewrite below does the same), keeping card totals and model rows on
    // one consistent, volume-conserving denominator. Uncovered models keep
    // their real reported cache fields.
    let estReused = 0;
    let estFresh = 0;
    let estCC = 0;
    for (const entry of fold.perModel) {
      const t = entry.model?.tokens || {};
      const input = Math.max(0, Number(t.input) || 0);
      const cached = Math.max(0, Number(t.cached) || 0);
      const cc = Math.max(0, Number(t.cacheCreate) || 0);
      if (entry.hitRate != null) {
        const volume = input + cached;
        const h = Math.min(Math.max(entry.hitRate / 100, 0), 1);
        estReused += volume * h;
        estFresh += volume * (1 - h);
      } else {
        estReused += cached;
        estFresh += input;
      }
      estCC += cc;
    }
    const estInputSide = estFresh + estReused + estCC;
    provider.cacheReusedTokens = estReused;
    provider.cacheInputTokens = estInputSide;
    provider.cacheHitRate =
      estReused > 0 && estInputSide > 0 ? Math.round((estReused / estInputSide) * 100) : null;
    // The card's expanded model row shows token columns, so the estimate must
    // rewrite them too — otherwise the cache column would stay 0 next to an
    // estimated cost. Run after the provider stats above so their calculation
    // still sees the measured totals.
    for (const entry of fold.perModel) {
      if (entry.hitRate == null) continue;
      const t = entry.model.tokens || {};
      const volume = Math.max(0, Number(t.input) || 0) +
        Math.max(0, Number(t.cached) || 0) + Math.max(0, Number(t.cacheCreate) || 0);
      const h = Math.min(Math.max(entry.hitRate / 100, 0), 1);
      entry.model.tokens = { ...t, input: volume * (1 - h), cached: volume * h };
      entry.model.cacheHitRate = Math.round(h * 100);
      entry.model.cacheEstimated = true;
    }
    provider.ceilingUsd = fold.ceilingCost;
    provider.usd = fold.estimatedCost;
    provider.traeEstimate = {
      estimatedCost: fold.estimatedCost,
      ceilingCost: fold.ceilingCost,
      medianHitRate: fold.medianHitRate,
      covered: fold.covered,
    };
  }
  return fleetData;
}

/**
 * Flatten the provider-oriented fleet data into one personal model ranking.
 * The same model name can be emitted by several tools, so names are matched
 * case-insensitively and their token/cost totals are combined before ranking.
 */
function emptySpeedTierAggregate() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cost_usd: 0,
  };
}

export function buildAllModels(fleetData: any) {
  const providers: any[] = Array.isArray(fleetData) ? fleetData : [];
  const byModel = new Map();
  const modelRows = [];

  for (const provider of providers) {
    const models: any[] = Array.isArray(provider?.models) ? provider.models : [];
    for (const model of models) {
      const usage = toFiniteNumber(model?.usage);
      // Request-only rows (issue 948) carry no usage but do carry a request count.
      const requests = Math.max(0, toFiniteNumber(model?.requests) ?? 0);
      if ((usage == null || usage <= 0) && requests <= 0) continue;
      // usage stays 0 for request-only rows; normalize once so the aggregation
      // loop below never sees a possibly-null number.
      const usageValue = usage ?? 0;
      const name = typeof model?.name === "string" && model.name.trim()
        ? model.name.trim()
        : typeof model?.id === "string" && model.id.trim()
          ? model.id.trim()
          : null;
      if (!name) continue;
      modelRows.push({ model, name, usage: usageValue, requests });
    }
  }

  const bareNames = buildBareModelNameIndex(
    modelRows.map((row) => ({ name: row.name, weight: row.usage })),
  );

  for (const { model, name, usage, requests } of modelRows) {
    const identity = resolveAggregateModelIdentity(name, bareNames);
    if (!identity) continue;
    const { key } = identity;
    const current = byModel.get(key) || {
      id: key,
      name: identity.name,
      usage: 0,
      requests: 0,
      cost: 0,
      hasCost: false,
      nameWeight: 0,
      tokens: { input: 0, output: 0, cached: 0, cacheCreate: 0, reasoning: 0 },
      speedTiers: null,
      pricing: null,
    };
    current.usage += usage;
    current.requests += requests;
    // Combine token-type splits across tools alongside the usage total.
    const splits = model?.tokens || {};
    for (const splitKey of MODEL_TOKEN_SPLIT_KEYS) {
      current.tokens[splitKey] += Math.max(0, Number(splits[splitKey]) || 0);
    }
    const cost = toFiniteNumber(model?.cost);
    if (cost != null) {
      current.cost += cost;
      current.hasCost = true;
    }
    if (!current.pricing && model?.pricing) current.pricing = model.pricing;
    // upstream PR 975: tier subsets sum across tools the same way the token splits do,
    // so the All-models view shows the same tier block as the source cards.
    const tiers = model?.speedTiers;
    if (tiers) {
      current.speedTiers = current.speedTiers || {
        priority: emptySpeedTierAggregate(),
        ultrafast: emptySpeedTierAggregate(),
      };
      for (const tierKey of ["priority", "ultrafast"] as const) {
        for (const column of ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens"] as const) {
          current.speedTiers[tierKey][column] =
            (current.speedTiers[tierKey][column] || 0) + (Number(tiers[tierKey]?.[column]) || 0);
        }
        current.speedTiers[tierKey].cost_usd =
          (current.speedTiers[tierKey].cost_usd || 0) + (Number(tiers[tierKey]?.cost_usd) || 0);
      }
    }
    // Preserve the spelling from the source that contributes the most.
    if (bareNames.has(key)) {
      current.name = bareNames.get(key);
    } else if (usage >= current.nameWeight) {
      current.name = name;
      current.nameWeight = usage;
    }
    byModel.set(key, current);
  }

  const totalUsage = Array.from(byModel.values())
    .reduce((sum, model) => sum + model.usage, 0);

  return Array.from(byModel.values())
    .map((model) => ({
      id: model.id,
      name: model.name,
      usage: model.usage,
      requests: model.requests,
      cost: model.hasCost ? model.cost : null,
      tokens: { ...model.tokens },
      ...(model.pricing ? { pricing: model.pricing } : {}),
      ...(model.speedTiers ? { speedTiers: model.speedTiers } : {}),
      share: totalUsage > 0
        ? Math.round((model.usage / totalUsage) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => {
      if (b.usage !== a.usage) return b.usage - a.usage;
      return String(a.name).localeCompare(String(b.name));
    });
}

export function buildTopModels(modelBreakdown: any, { limit = 3, copyFn }: AnyRecord = {}) {
  const safeCopy = typeof copyFn === "function" ? copyFn : (key: string) => key;
  const sources: any[] = Array.isArray(modelBreakdown?.sources) ? modelBreakdown.sources : [];
  if (!sources.length) return [];

  const totalsByKey = new Map();
  const nameByKey = new Map();
  const nameWeight = new Map();
  const modelRows = [];
  let totalTokensAll = 0;

  for (const source of sources) {
    const models: any[] = Array.isArray(source?.models) ? source.models : [];
    for (const model of models) {
      const tokens = resolveDisplayTokens(model?.totals);
      // Request-only models (issue 948) stay out on purpose: this is a token
      // ranking for the hero, and a zero-token model has no share to show.
      if (!Number.isFinite(tokens) || tokens <= 0) continue;
      totalTokensAll += tokens;
      const name = resolveModelName(model, safeCopy("shared.placeholder.short"));
      modelRows.push({ name, tokens });
    }
  }

  const bareNames = buildBareModelNameIndex(
    modelRows.map((row) => ({ name: row.name, weight: row.tokens })),
  );
  for (const { name, tokens } of modelRows) {
      const identity = resolveAggregateModelIdentity(name, bareNames);
      if (!identity) continue;
      const { key } = identity;
      totalsByKey.set(key, (totalsByKey.get(key) || 0) + tokens);
      if (bareNames.has(key)) {
        nameByKey.set(key, bareNames.get(key));
      } else if (tokens >= (nameWeight.get(key) || 0)) {
        nameWeight.set(key, tokens);
        nameByKey.set(key, name);
      }
  }

  if (!totalsByKey.size) return [];

  const knownTotal = Array.from(totalsByKey.values()).reduce((acc, value) => acc + value, 0);
  const totalTokens = totalTokensAll > 0 ? totalTokensAll : knownTotal;

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return Array.from(totalsByKey.entries())
    .map(([key, tokens]) => {
      const percent = totalTokens > 0 ? ((tokens / totalTokens) * 100).toFixed(1) : "0.0";
      return {
        id: key,
        name: nameByKey.get(key) || safeCopy("shared.placeholder.short"),
        tokens,
        percent: String(percent),
      };
    })
    .sort((a, b) => {
      if (b.tokens !== a.tokens) return b.tokens - a.tokens;
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, normalizedLimit);
}
