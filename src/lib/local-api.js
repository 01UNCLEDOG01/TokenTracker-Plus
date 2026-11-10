const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { setImmediate: yieldToRequests } = require("node:timers/promises");
const { createAsyncQueueReader } = require("./async-queue-reader");
const { DEFAULT_BASE_URL, resolveRuntimeConfig, assertInsforgeRuntime, normalizeInstanceBaseUrl, clearDeviceIdentity, resetInstanceState } = require("./runtime-config");
const {
  filterRowsByUsageScope,
  getSourceScope,
  listExcludedSources,
  normalizeUsageScope,
} = require("./source-metadata");
const { accountSlugFor, fetchAccountUsage, mintAccessToken, invalidateCloudAccountPayloadCache, getCloudAccountSessionGeneration } = require("./cloud-account");
const { resetCloudDeviceUsage, readCloudUsageReset } = require("./cloud-usage-reset");
const { isTerminalSource } = require("./terminal-sources");
const { isLoopbackHostname } = require("./loopback-host");
const { getOrCreateMachineId, computeStableMachineId } = require("./machine-id");
const { functionUrlFor, fetchFunctionResponse } = require("./function-url");
const { createCloudDeviceTokenStore } = require("./cloud-device-token");
const { parseBearerToken } = require("./bearer-token");
const { writeJsonAtomicSync } = require("./atomic-json");
const { fetchProviderServiceStatus } = require("./provider-status");
const { readCursorStateSummary } = require("./cursor-store");

const SYNC_TIMEOUT_MS = 120_000;
// A failed account-view request should not stall every dashboard refresh
// while an expired session or unreachable backend keeps timing out. The first
// request still falls back normally; subsequent fan-out requests reuse that
// decision for a short cooldown and return local data immediately.
const ACCOUNT_VIEW_FAILURE_BACKOFF_MS = 2 * 60_000;
const TRACKER_BIN = path.resolve(__dirname, "../../bin/tracker.js");
const MAX_DEVICE_NAME_LENGTH = 128;

function getSystemDeviceName() {
  try {
    const hostname = os.hostname()
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, MAX_DEVICE_NAME_LENGTH);
    return hostname || null;
  } catch {
    return null;
  }
}

// Avatar proxy (see /api/avatar-proxy below). In-memory LRU; survives the
// CLI server lifetime, which is good enough — the dashboard reloads cheaply.
const AVATAR_PROXY_TTL_MS = 60 * 60 * 1000; // 1h
const AVATAR_PROXY_MAX_BYTES = 512 * 1024; // 512 KiB per image
const AVATAR_PROXY_MAX_ENTRIES = 64;
const avatarProxyCache = new Map();

// ---------------------------------------------------------------------------
// Per-model pricing — delegated to src/lib/pricing/
//   - CURATED overrides (kiro-*, hy3-*, composer-*, kimi-for-coding, etc.)
//   - LiteLLM live data (mainstream claude / gpt-5 / gemini), 24h disk-cached
//   - Bundled seed snapshot for first-install / offline fallback
// ---------------------------------------------------------------------------

const {
  MODEL_PRICING,
  getModelPricing,
  computeRowSpeedTierSplit,


  computeRowCost,
  hasAuthoritativeRowCost,
  ensurePricingLoaded,
  getPricingRevision,
  getModelPricingInfo,
} = require("./pricing");

const {
  computeClaudeCategoryBreakdown,
  unsupportedSourcePayload: unsupportedCategoryPayload,
} = require("./claude-categorizer");

const { computeCodexContextBreakdown } = require("./codex-context-breakdown");
const { computeGrokContextBreakdown } = require("./grok-context-breakdown");
const { qoderCnEstimatedRows } = require("./qoder-cn-estimate");
const { joycodeTaskRows } = require("./joycode-usage");
const { raccoonOfficeUsageRows } = require("./raccoon-office-usage");
const { qoderIntlCreditRows, qoderIntlDisplayModel } = require("./qoder-intl-credits");
const { applyAccountViewQoderMerge } = require("./qoder-cn-account-merge");
const { applyAccountViewQoderIntlMerge } = require("./qoder-intl-account-merge");
const { repriceAccountModelCosts } = require("./reprice-account-costs");

const {
  deriveProjectKeyFromRef,
  resolveQoderProjectsDir,
  resolveAgent2ApiDbPath,
  CLAUDE_MEM_OBSERVER_PROJECT_REF,
} = require("./rollout");
const { readSqliteJsonRowsAsync } = require("./sqlite-reader");

// ---------------------------------------------------------------------------
// Queue data helpers
// ---------------------------------------------------------------------------

function resolveQueuePath() {
  const home = os.homedir();
  return path.join(home, ".tokentracker", "tracker", "queue.jsonl");
}

// Pseudo-project written by the pre-fix claude-mem observer attribution;
// mirrored Claude Code sessions, not a real repository. Excluded at read
// time so historical rows never surface on the Project Usage panel. Derived
// from rollout.js's ref so a rename there cannot silently desync the filter.
const CLAUDE_MEM_OBSERVER_PROJECT_KEY = deriveProjectKeyFromRef(
  CLAUDE_MEM_OBSERVER_PROJECT_REF,
);
const PROJECT_USAGE_MAX_ENTRIES = 10;
const MAX_TIME_ZONE_CACHE_ENTRIES = 16;
const AGGREGATION_BATCH_ROWS = 256;

// One dashboard refresh fans out ~6 concurrent aggregate requests over the
// same queue generation. The queue reader already shares one parsed rows
// array per file signature, but everything DOWNSTREAM of it used to be
// recomputed per request: the derived-row merge (Qoder estimates/credits,
// JoyCode, 浣熊) and each endpoint's full O(rows) aggregation. Memoize those
// per (rows identity, params) so the fan-out shares one computation.
//
// The TTL is load-bearing for correctness, not just hygiene: the derived
// sources read their OWN files (JoyCode task history, Qoder spend/cookies,
// Raccoon) which can change while queue.jsonl stands still, so caching purely
// on queue identity could serve stale derived rows indefinitely. 10s bounds
// that staleness far below the dashboard's own 30s auto-refresh cadence, and
// any queue append changes the rows identity and invalidates immediately.
const READ_MEMO_TTL_MS = 10_000;
const READ_MEMO_MAX_KEYS = 16;

// Shared entry lifecycle for both memo flavors below. An entry is shareable
// while IN FLIGHT regardless of age (a slow machine's multi-second aggregation
// must not fork into duplicate computations), and its freshness clock starts
// when the compute SETTLES. Settled entries past the TTL are swept on the next
// insertion into the same bucket, so expired results don't pin their (large)
// row-array shells until an eviction cap happens to fire.
function memoRead(byKey, innerKey, compute) {
  const memo = byKey.get(innerKey);
  if (memo && (!memo.settled || Date.now() - memo.at < READ_MEMO_TTL_MS)) return memo.value;
  const now = Date.now();
  for (const [key, entry] of byKey) {
    if (entry.settled && now - entry.at >= READ_MEMO_TTL_MS) byKey.delete(key);
  }
  const entry = { at: now, settled: false, value: null };
  const pending = Promise.resolve()
    .then(compute)
    .then((value) => {
      entry.at = Date.now();
      entry.settled = true;
      return value;
    });
  entry.value = pending;
  byKey.set(innerKey, entry);
  // A failed computation must not poison the key for the TTL window: drop it
  // so the next request retries, while concurrent awaiters still share this
  // attempt's result (the rejected promise).
  pending.catch(() => {
    if (byKey.get(innerKey)?.value === pending) byKey.delete(innerKey);
  });
  return pending;
}

function createReadMemo() {
  const outer = new WeakMap();
  return function readMemo(outerKey, innerKey, compute) {
    let byKey = outer.get(outerKey);
    if (!byKey) {
      byKey = new Map();
      outer.set(outerKey, byKey);
    }
    return memoRead(byKey, innerKey, compute);
  };
}

// Same contract as createReadMemo, but the outer key is a queue-file signature
// STRING (dev:ino:size:mtimeNs:ctimeNs — the same fields the queue reader
// validates). Keying on the signature lets the memoized compute own the
// readQueueData call itself: a memo hit costs one lstat instead of a full
// 276MB/710MB SHA-256 re-validation, while any append/rewrite/replacement
// changes the signature and recomputes immediately.
function createSignatureReadMemo({ maxOuterKeys = 8 } = {}) {
  const outer = new Map();
  return function readMemo(outerKey, innerKey, compute) {
    let byKey = outer.get(outerKey);
    if (!byKey) {
      if (outer.size >= maxOuterKeys) outer.delete(outer.keys().next().value);
      byKey = new Map();
      outer.set(outerKey, byKey);
    }
    return memoRead(byKey, innerKey, compute);
  };
}

const scopedRowsReadMemo = createSignatureReadMemo();
const projectRowsReadMemo = createSignatureReadMemo();
const speedSessionTierReadMemo = createSignatureReadMemo();
const modelBreakdownReadMemo = createReadMemo();
const projectSummaryReadMemo = createReadMemo();

// One lstat, not a read: the same signature fields createAsyncQueueReader
// validates, used purely as a memo key. "missing" for a not-yet-created queue
// (an empty read result keys identically, which is correct — no data).
function queueFileSignature(queuePath) {
  try {
    const stat = fs.statSync(queuePath, { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch {
    return "missing";
  }
}

// Sentinel thrown by the memoized aggregates when the pricing catalog reloads
// mid-computation. The read-memo drops the throwing entry, so the endpoint's
// retry (handleLocalApi re-entry) recomputes against the new revision instead
// of serving a mix of two pricing catalogs.
const PRICING_REVISION_CHANGED = Symbol("pricing_revision_changed");

function cursorsMtimeMs(qp) {
  try {
    return fs.statSync(path.join(path.dirname(qp), "cursors.json")).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Full per-row source/model aggregation behind /usage-model-breakdown.
 * Extracted verbatim from the endpoint so the read-memo can reuse its result
 * across the dashboard's request fan-out. Throws PRICING_REVISION_CHANGED
 * when the pricing catalog reloads mid-loop (the endpoint then retries).
 */
async function computeUsageModelBreakdownSources({ scopedRows, timeZoneContext, from, to, qp }) {
  const pricingRevision = getPricingRevision();
  const bySource = new Map();
  let processed = 0;
  for (const row of scopedRows) {
    if (++processed % AGGREGATION_BATCH_ROWS === 0) await yieldToRequests();
    if (!row.hour_start) continue;
    const day = rowDayKey(row, timeZoneContext);
    if (day < from || day > to) continue;
    const src = row.source || "unknown";
    // Qoder's transcripts name their router, not a model ("gfmodel" for
    // GLM-5.3-Flash). The row keeps that id so the cloud ingest key stays
    // stable; the card shows the model Qoder's own client texts name.
    const mdl = (src === "qoder" || src === "qoder-cn") ? qoderIntlDisplayModel(row.model) : (row.model || "unknown");
    if (!bySource.has(src))
      bySource.set(src, { source: src, source_scope: getSourceScope(src), totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0, total_cost_usd: "0", cache_observed_input_tokens: 0 }, models: new Map() });
    const sa = bySource.get(src);
    sa.totals.total_tokens += row.total_tokens || 0;
    sa.totals.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    sa.totals.input_tokens += row.input_tokens || 0;
    sa.totals.output_tokens += row.output_tokens || 0;
    sa.totals.cached_input_tokens += row.cached_input_tokens || 0;
    sa.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    sa.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    // Cache-coverage signal (TRAE CN request ledger only): input-side
    // volume from rows actually carrying the client's exact_* fields.
    // Undefined on every other source's rows, so the sum stays 0 there.
    if (row.cache_observed_input_tokens != null) {
      sa.totals.cache_observed_input_tokens = (sa.totals.cache_observed_input_tokens || 0) +
        (Number(row.cache_observed_input_tokens) || 0);
    }
    // Request-only sources (#948: credit-billed transcripts that report no
    // tokens) carry their activity solely as conversation_count — thread it
    // through so the dashboard can surface "0 tokens / N requests".
    sa.totals.conversation_count += row.conversation_count || 0;
    if (!sa.models.has(mdl))
      sa.models.set(mdl, { model: mdl, model_id: mdl, pricing: getModelPricingInfo(mdl, { source: src }), totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0, total_cost_usd: "0", cache_observed_input_tokens: 0 }, speed_tiers: { priority: emptySpeedTierAccumulator(), ultrafast: emptySpeedTierAccumulator() } });
    const ma = sa.models.get(mdl);
    // #975: Codex Fast/Ultrafast subsets ride queue rows only when nonzero
    // (other sources never carry them). Aggregate tokens per tier; the
    // per-tier cost comes from differencing computeRowCost on synthetic
    // rows, so the premium math stays single-sourced in the pricing module.
    accumulateSpeedTiers(ma.speed_tiers, row);
    // Same source list computeRowCost prices from, so a credits-derived
    // source (qoder) is labelled as tool-reported instead of being called
    // an estimate from model pricing it never had.
    const reportedCost = hasAuthoritativeRowCost(src) && Number(row.total_cost_usd) > 0;
    const costSource = reportedCost ? "provider_reported" : "model_pricing";
    ma.cost_source = ma.cost_source && ma.cost_source !== costSource ? "mixed" : costSource;
    ma.totals.total_tokens += row.total_tokens || 0;
    ma.totals.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    ma.totals.input_tokens += row.input_tokens || 0;
    ma.totals.output_tokens += row.output_tokens || 0;
    ma.totals.cached_input_tokens += row.cached_input_tokens || 0;
    ma.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    ma.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    ma.totals.conversation_count += row.conversation_count || 0;
    if (row.cache_observed_input_tokens != null) {
      ma.totals.cache_observed_input_tokens = (ma.totals.cache_observed_input_tokens || 0) +
        (Number(row.cache_observed_input_tokens) || 0);
    }
    // Price each row, exactly as aggregateByDay does for the hero (#653).
    // computeRowCost is not linear for models with a Fast tier or
    // long-context rates: priority_* / long_context_* mark a subset of the
    // base columns rather than adding volume, so they survive only while the
    // row is intact. Summing the base columns first and pricing once silently
    // dropped every premium — same tokens, fewer dollars than the hero.
    ma.totals.total_cost_usd = Number(ma.totals.total_cost_usd || 0) + foldTraeRowCost(row, computeRowCost(row));
  }
  if (pricingRevision !== getPricingRevision()) throw PRICING_REVISION_CHANGED;

  // All-time self-observed hit rate for the TRAE family, measured from the
  // BOOKED buckets in cursors.json (authoritative, one row per bucket, no
  // queue append duplicates). Measured buckets only: those whose totals
  // carry the client's exact_* coverage signal. A day view's own fielded
  // rows are too few to be evidence — the model's fielded history is the
  // evidence (owner ruling 2026-11-07).
  const observedHitsByModel = new Map();
  try {
    const cursorsData = JSON.parse(fs.readFileSync(path.join(path.dirname(qp), "cursors.json"), "utf8"));
    for (const [bucketKey, bucket] of Object.entries(cursorsData?.hourly?.buckets || {})) {
      if (!bucketKey.startsWith("trae-cn|")) continue;
      const bucketTotals = bucket?.totals || {};
      const observedVolume = Number(bucketTotals.cache_observed_input_tokens) || 0;
      if (!(observedVolume > 0)) continue;
      const observedModel = bucketKey.split("|")[1] || "unknown";
      const acc = observedHitsByModel.get(observedModel) || { hits: 0, volume: 0 };
      acc.hits += Number(bucketTotals.cached_input_tokens) || 0;
      acc.volume += observedVolume;
      observedHitsByModel.set(observedModel, acc);
    }
  } catch (_error) {
    // A malformed cursors file just means no self evidence — the fold keeps
    // its "nothing fabricated" fallbacks.
  }

  const sources = Array.from(bySource.values()).map((s) => {
    s.models = Array.from(s.models.values())
      .map((m) => ({
        ...m,
        speed_tiers: hasObservedSpeedTiers(m.speed_tiers) ? m.speed_tiers : null,
        cache_observed_hit_rate: (() => {
          const all = observedHitsByModel.get(m.model_id);
          return all && all.volume > 0
            ? Math.round((all.hits / all.volume) * 1000) / 10
            : null;
        })(),
        totals: { ...m.totals, total_cost_usd: Number(m.totals.total_cost_usd || 0).toFixed(6) },
      }))
      .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
    const sourceCost = s.models.reduce((sum, m) => sum + Number(m.totals.total_cost_usd), 0);
    s.totals.total_cost_usd = sourceCost.toFixed(6);
    return s;
  });
  return { sources };
}

/**
 * Per-project token aggregation behind /project-usage-summary. Extracted
 * verbatim from the endpoint so the read-memo can reuse its result across the
 * dashboard's request fan-out and repeat period switches.
 */
async function computeProjectUsageEntries({ projectRows, timeZoneContext, from, to, limit, qp }) {
  const hasRange = Boolean(from || to);
  const dayInRange = (day) => {
    if (!hasRange) return true;
    if (!day) return false;
    return (!from || day >= from) && (!to || day <= to);
  };

  const aggregateEntries = async (rows, keyOf, refOf) => {
    const byKey = new Map();
    let processed = 0;
    for (const row of rows) {
      if (++processed % AGGREGATION_BATCH_ROWS === 0) await yieldToRequests();
      if (hasRange && !dayInRange(rowDayKey(row, timeZoneContext))) continue;
      const key = keyOf(row);
      if (!byKey.has(key)) {
        byKey.set(key, {
          project_key: key,
          project_ref: refOf(row),
          total_tokens: 0,
          billable_total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          reasoning_output_tokens: 0,
          conversation_count: 0,
          sourceTotals: new Map(),
        });
      }
      const agg = byKey.get(key);
      agg.total_tokens += Number(row.total_tokens || 0);
      agg.billable_total_tokens += Number(
        row.billable_total_tokens ?? row.total_tokens ?? 0,
      );
      agg.input_tokens += Number(row.input_tokens || 0);
      agg.output_tokens += Number(row.output_tokens || 0);
      agg.cached_input_tokens += Number(row.cached_input_tokens || 0);
      agg.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
      agg.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
      agg.conversation_count += Number(row.conversation_count || 0);
      if (!agg.project_ref) agg.project_ref = refOf(row);
      const src = row.source || "unknown";
      agg.sourceTotals.set(
        src,
        (agg.sourceTotals.get(src) || 0) + Number(row.total_tokens || 0),
      );
    }
    return Array.from(byKey.values())
      .sort((a, b) => b.billable_total_tokens - a.billable_total_tokens)
      .slice(0, limit)
      .map(({ sourceTotals, ...entry }) => ({
        ...entry,
        total_tokens: String(entry.total_tokens),
        billable_total_tokens: String(entry.billable_total_tokens),
        sources: Array.from(sourceTotals.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([source, totalTokens]) => ({ source, total_tokens: totalTokens })),
      }));
  };

  let entries = await aggregateEntries(
    projectRows,
    (row) => row.project_key || "unknown",
    (row) => row.project_ref || "",
  );

  // If no project-attributed rows exist yet (user hasn't synced project
  // attribution, or never used a project-capable CLI), fall back to
  // per-source aggregation over the main queue so the panel isn't
  // totally empty. This path used to also exist for the non-empty case
  // and produce wrong numbers; keep it only as the empty fallback.
  if (entries.length === 0 && projectRows.length === 0) {
    entries = await aggregateEntries(
      await readQueueData(qp),
      (row) => row.source || "unknown",
      // Synthetic source-only row: leave project_ref empty rather than
      // fabricating `https://${src}.ai`, which resolves to unrelated
      // domains (e.g. codex.ai, cursor.ai) and was sent to the
      // dashboard as a clickable href before v0.11.1 / this commit.
      () => "",
    );
  }
  return entries;
}

/**
 * Per-model wall-clock speed rows behind /agent2api-speed's session tier.
 * Extracted so the read-memo can reuse it across mounts and period switches
 * (the scan is synchronous and costs ~2s on a large sidecar).
 *
 * A multi-model session carries ONE wall-clock measurement for the whole
 * session (the collector fills every model row with the session-level
 * performance), so its duration is counted once per model row rather than
 * summed per row — three rows each claiming the same 1.29s would triple the
 * time and read as a third of the real speed. Output splits by each row's own
 * share; requests take the model row's own event count.
 */
async function computeSpeedSessionTier({ qp, from, to, timeZoneContext }) {
  const { readSessionSidecar, listSessionsForBrowser } = require("./session-analytics");
  const sidecarPath = path.join(path.dirname(qp), "session.queue.jsonl");
  const sessions = readSessionSidecar(sidecarPath);
  const scoped = listSessionsForBrowser(sessions, { from, to, ...timeZoneContext }).sessions || [];
  const bySessionModel = new Map();
  for (const session of scoped) {
    const usage = Array.isArray(session?.model_usage) ? session.model_usage : [];
    const sessionPerf = session?.performance || null;
    const rows = [];
    for (const mu of usage) {
      const model = String(mu?.model || session?.model || "").trim();
      if (!model) continue;
      rows.push({ model, output: Number(mu?.output_tokens) || 0, requests: Math.max(0, Number(mu?.usage_events) || 0) });
    }
    if (!rows.length) continue;
    // Duration source, in priority order: the session-level measurement
    // (counted once), else the single model row's own performance when the
    // session carries only one model, else nothing.
    let durationMs = Number(sessionPerf?.estimated_duration_ms) || 0;
    if (durationMs <= 0 && rows.length === 1) {
      durationMs = Number(usage[0]?.performance?.estimated_duration_ms) || 0;
    }
    if (durationMs <= 0) continue;
    for (const { model, output, requests } of rows) {
      if (output <= 0) continue;
      let agg = bySessionModel.get(model);
      if (!agg) {
        agg = { requests: 0, output_tokens: 0, duration_ms: 0 };
        bySessionModel.set(model, agg);
      }
      agg.requests += requests || 1;
      agg.output_tokens += output;
      agg.duration_ms += durationMs;
    }
  }
  return [...bySessionModel.entries()].map(([model, agg]) => ({
    model,
    requests: agg.requests,
    output_tokens: agg.output_tokens,
    duration_ms: agg.duration_ms,
    tokens_per_second: agg.duration_ms > 0
      ? Math.round((agg.output_tokens * 1000 / agg.duration_ms) * 10) / 10
      : null,
    avg_first_response_ms: null,
    speed_source: "session",
  }));
}

// The native dashboard fans one refresh out across several local endpoints.
// Keep one immutable, deduped view of the current queue so those endpoints do
// not all read and JSON.parse the same append-only file. A file identity +
// nanosecond timestamp signature invalidates the cache immediately on append,
// in-place rewrite, or atomic replacement.
const dailyAggregationCache = new WeakMap();
const zonedPartsFormatters = new Map();

function boundedCacheSet(cache, key, value, maxEntries) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}

function timeZoneContextKey({ timeZone, offsetMinutes } = {}) {
  return `${timeZone || ""}|${Number.isFinite(offsetMinutes) ? offsetMinutes : ""}|p${getPricingRevision()}`;
}

// Shared by project-usage-summary and project-usage-detail: reads the
// deduped project bucket log, drops the claude-mem pseudo project, and
// builds the from/to day-range predicate. Callers compute each row's day
// key ONCE (rowDayKey constructs an Intl.DateTimeFormat per call — the
// dominant per-row cost) and reuse it for both the range check and any
// day bucketing.
async function readProjectUsageContext(qp, url) {
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  const timeZoneContext = getTimeZoneContext(url);
  const hasRange = Boolean(from || to);
  const dayInRange = (day) => {
    if (!hasRange) return true;
    if (!day) return false;
    return (!from || day >= from) && (!to || day <= to);
  };
  const projectQueuePath = path.join(path.dirname(qp), "project.queue.jsonl");
  // Same signature-memo pattern as scopedQueueRows: the 710MB project queue
  // read lives inside the memo, so the project fan-out pays one validation.
  const projectRows = await projectRowsReadMemo(
    queueFileSignature(projectQueuePath),
    "claude-mem-filtered",
    async () => {
      const rawProjectRows = await readProjectQueueData(projectQueuePath);
      return rawProjectRows.filter((row) => row.project_key !== CLAUDE_MEM_OBSERVER_PROJECT_KEY);
    },
  );
  return { from, to, timeZoneContext, hasRange, dayInRange, projectRows };
}

// Same signature-based caching as readQueueData: the project-usage endpoints
// all fan out from one dashboard refresh, so without this every request
// re-read and re-parsed the whole append-only project queue.
const readProjectQueueData = createAsyncQueueReader({
  label: "readProjectQueueData",
  parseRow(row) {
    return {
      key: `${row.project_key || ""}|${row.source || ""}|${row.hour_start || ""}`,
      row: normalizeQueueRow(row),
    };
  },
});

// ── TRAE cache-estimate fold (owner ruling 2026-11-07) ─────────────────────
// The client's 2026-11 regime stopped reporting cache-read fields, so rows
// priced by computeRowCost bill the whole input at the uncached rate. Every
// cost surface (hero, heatmap, trend, daily, model breakdown, floating
// island) folds TRAE-family rows with the model's own fielded-history hit
// rate (the ledger's coverage signal), halving nothing when no evidence
// exists. Dashboard-side folding is skipped via the payload flag below.
const TRAE_FOLD_REFRESH_MS = 5 * 60 * 1000;
// Evidence pools are EDITION-SCOPED (owner ruling 2026-11-10): trae-cn rows
// draw on the trae-cn fielded history, trae (intl) rows on their own. The two
// editions run different model fleets with different cache behavior, so one
// edition's measured rate must never price the other's dry spell. An edition
// with no fielded history folds nothing (rows stay at the uncached rate) —
// evidence is never borrowed across editions, never fabricated.
const TRAE_EDITIONS = ["trae-cn", "trae"];
function emptyTraeEditionState() {
  return { byModel: {}, recognizedRate: 0 };
}
let traeFoldByEdition = null;
let traeFoldLoadedAt = 0;
let traeFoldLoading = false;
async function loadTraeFoldState() {
  const state = {};
  for (const edition of TRAE_EDITIONS) state[edition] = emptyTraeEditionState();
  // Read the CURRENT cursor generation via cursor-store (AGENTS.md global
  // rule: cursors.json is a frozen legacy compat copy once cursor-store-v2 is
  // active — reading it directly prices the dry spell off stale evidence).
  const summary = await readCursorStateSummary({
    trackerDir: path.join(os.homedir(), ".tokentracker", "tracker"),
  });
  const buckets = summary?.cursors?.hourly?.buckets || {};
  for (const [bucketKey, bucket] of Object.entries(buckets)) {
    const edition = bucketKey.startsWith("trae-cn|")
      ? "trae-cn"
      : bucketKey.startsWith("trae|")
        ? "trae"
        : null;
    if (!edition) continue;
    const bucketTotals = bucket?.totals || {};
    const observedVolume = Number(bucketTotals.cache_observed_input_tokens) || 0;
    if (!(observedVolume > 0)) continue;
    const observedModel = bucketKey.split("|")[1] || "unknown";
    const acc = state[edition].byModel[observedModel] || { hits: 0, volume: 0 };
    acc.hits += Number(bucketTotals.cached_input_tokens) || 0;
    acc.volume += observedVolume;
    state[edition].byModel[observedModel] = acc;
  }
  // Recognized hit rate (owner ruling 2026-11-07): the median across the
  // edition's own fielded models' measured rates — same edition, same agent
  // workload. Applied to models the owner never used (no fielded history),
  // combined with each model's OFFICIAL cache-read price ratio from the
  // pricing tables. Nothing is fabricated: no fielded models at all, or a
  // model without official cache pricing, stays at the ceiling.
  for (const edition of TRAE_EDITIONS) {
    const rates = Object.values(state[edition].byModel)
      .filter((acc) => acc.volume > 0)
      .map((acc) => Math.min(Math.max(acc.hits / acc.volume, 0), 1))
      .sort((a, b) => a - b);
    if (rates.length) {
      const mid = Math.floor(rates.length / 2);
      state[edition].recognizedRate = rates.length % 2
        ? rates[mid]
        : (rates[mid - 1] + rates[mid]) / 2;
    }
  }
  return state;
}
function traeFoldMap() {
  const now = Date.now();
  if (traeFoldByEdition && now - traeFoldLoadedAt < TRAE_FOLD_REFRESH_MS) return traeFoldByEdition;
  // Stale-while-revalidate: readCursorStateSummary is async (v2 generation
  // read) while every fold call site is sync. Serve the previous snapshot for
  // this refresh window and replace it in the background; the first window
  // after startup folds at the ceiling, which is the honest no-evidence side.
  if (!traeFoldLoading) {
    traeFoldLoading = true;
    loadTraeFoldState()
      .then((state) => {
        traeFoldByEdition = state;
        traeFoldLoadedAt = Date.now();
        traeFoldLoading = false;
      })
      .catch(() => {
        // No cursors / malformed state: keep serving whatever we had (or
        // nothing) and throttle retries to one per refresh window.
        traeFoldLoadedAt = Date.now();
        traeFoldLoading = false;
      });
  }
  return traeFoldByEdition;
}
function foldTraeRowCost(row, cost) {
  const source = String(row?.source || "").toLowerCase();
  if (source !== "trae" && source !== "trae-cn") return cost;
  const model = String(row?.model || "");
  // Row-level measured-coverage gate (owner review 2026-11-07): computeRowCost
  // already bills the row's MEASURED cache at the cache rate, so a row whose
  // cache read was reported must never be folded again — the old whole-row
  // factor double-discounted exactly the best-covered months and folded
  // output/reasoning, which are not cacheable.
  const inputSide = (Number(row?.input_tokens) || 0) +
    (Number(row?.cached_input_tokens) || 0) +
    (Number(row?.cache_creation_input_tokens) || 0);
  if (!(inputSide > 0)) return cost;
  // undefined (pre-signal row) counts as unmeasured: its cache fields were
  // never reported, so the whole input side rides the estimate.
  const observed = row?.cache_observed_input_tokens == null
    ? 0
    : Math.max(0, Number(row.cache_observed_input_tokens) || 0);
  const coverage = Math.min(observed / inputSide, 1);
  if (coverage >= 0.5) return cost; // measured truth — priced by computeRowCost already
  // Clamp to the fresh input column: cache-creation volume (legacy/chat_turn
  // buckets) is part of the input side but not of the fresh column, and an
  // unclamped unmeasured could exceed it — the proportional fold would then
  // over-draw the input leg and go negative (owner data: deepseek-v4-flash
  // -43.22). Under-folding by the creation share is the conservative side.
  const unmeasured = Math.min(inputSide - observed, Number(row?.input_tokens) || 0);
  if (!(unmeasured > 0)) return cost;
  // Evidence priority, scoped to the row's OWN edition: the model's own
  // fielded history; without it, the edition's recognized rate (median across
  // that edition's fielded models). Never the other edition's pool.
  const editionState = traeFoldMap()?.[source];
  const acc = editionState?.byModel?.[model];
  const h = acc && acc.volume > 0
    ? Math.min(Math.max(acc.hits / acc.volume, 0), 1)
    : (editionState && editionState.recognizedRate > 0
        ? Math.min(Math.max(editionState.recognizedRate, 0), 1)
        : 0);
  if (!(h > 0)) return cost;
  const pricing = getModelPricingInfo(model, { source: row.source });
  const inputRate = Number(pricing?.input);
  const cacheRate = Number(pricing?.cache_read);
  if (!(inputRate > 0) || !(cacheRate > 0)) return cost;
  const discount = Math.min(cacheRate / inputRate, 1);
  // Fold ONLY the unmeasured input-side volume, at the row's OWN effective
  // input price: derive it from the row (cost minus the cost of everything
  // but input) so time-of-use and other row-level rate adjustments are
  // inherited — repricing at the naive list rate produced negative folds on
  // off-peak DeepSeek rows (owner-reported 2026-11-07).
  const fresh = Number(row?.input_tokens) || 0;
  if (!(fresh > 0)) return cost;
  const costWithoutInput = computeRowCost({ ...row, input_tokens: 0 });
  const inputLegCost = cost - costWithoutInput;
  if (!(inputLegCost > 0)) return cost;
  const unmeasuredCost = inputLegCost * (unmeasured / fresh);
  const foldFactor = (1 - h) + h * discount;
  return cost - unmeasuredCost + unmeasuredCost * foldFactor;
}
// ─────────────────────────────────────────────────────────────────────────────

function isLegacyInclusiveCodexRow(row) {
  if (!row || (row.source !== "codex" && row.source !== "every-code")) return false;
  const inputTokens = Number(row.input_tokens || 0);
  const cachedInputTokens = Number(row.cached_input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const totalTokens = Number(row.total_tokens || 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cachedInputTokens)) return false;
  if (cachedInputTokens <= 0 || inputTokens < cachedInputTokens) return false;
  // Legacy Codex queue rows stored input inclusive of cache reads, while
  // total_tokens remained input + output. Canonical rows keep input as pure
  // non-cached input, so cache-heavy legacy rows can be identified by this
  // exact invariant.
  return totalTokens === inputTokens + outputTokens;
}

function normalizeQueueRow(row) {
  let normalized = row;
  if (isLegacyInclusiveCodexRow(normalized)) {
    normalized = {
      ...normalized,
      input_tokens:
        Number(normalized.input_tokens || 0) - Number(normalized.cached_input_tokens || 0),
    };
  }
  // Legacy Cursor rows from versions ≤ 0.26.5 wrote billable_total_tokens = 0
  // for "Included in Pro" / "Enterprise" / "no charge" records (kind-based
  // gating in cursor-config.js#normalizeCursorUsage). The dashboard headline
  // sums billable_total_tokens across sources, so those rows silently
  // disappeared from the displayed total once any other source contributed
  // non-zero billable usage (GitHub issue #106). Treat billing and usage as
  // orthogonal: bump billable up to total_tokens at read time so historical
  // queue.jsonl entries render correctly without requiring a file rewrite.
  // Antigravity had the same symptom from e69e2746a (billable deleted during
  // the O(N) refactoring, leaving 167 local rows with billable=0 until the
  // parser fix). Apply the same read-time healing so upgraded installs show
  // correct heatmap / rolling numbers without a queue rewrite.
  const sourceName = String(normalized.source || "").toLowerCase();
  if (sourceName === "cursor" || sourceName === "antigravity") {
    const totalTokens = Number(normalized.total_tokens || 0);
    const billable = Number(normalized.billable_total_tokens || 0);
    if (totalTokens > 0 && billable < totalTokens) {
      normalized = { ...normalized, billable_total_tokens: totalTokens };
    }
  }
  return normalized;
}

// Ignore empty telemetry from estimate sources, but accept explicit native
// ledger retractions. Qoder's deliberate placeholder zeroes remain untouched.
const ESTIMATE_REPORTING_SOURCES = new Set(["cursor", "antigravity"]);

function resolveQueueRow(existing, incoming) {
  const source = String(incoming?.source || "").toLowerCase();
  if (!ESTIMATE_REPORTING_SOURCES.has(source)) return incoming;
  const retracted = source === "antigravity" && incoming.usage_retracted === true &&
    ["total_tokens", "input_tokens", "cached_input_tokens", "cache_creation_input_tokens",
      "output_tokens", "reasoning_output_tokens", "billable_total_tokens", "total_cost_usd"]
      .every((field) => (Number(incoming[field]) || 0) === 0);
  if (!retracted && existing && (Number(existing.total_tokens) || 0) > 0 && (Number(incoming.total_tokens) || 0) === 0) {
    return existing;
  }
  return incoming;
}

const readQueueData = createAsyncQueueReader({
  label: "readQueueData",
  parseRow(row) {
    if (row?.kind === "account_session_state" || row?.kind === "account_sync_watermark") return null;
    return {
      key: `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`,
      row: normalizeQueueRow(row),
    };
  },
  // A later append can carry the same hour with no token data at all (the
  // Antigravity estimate is the live case: every one of its hour keys ended on a
  // 0 row, which made 425M used tokens invisible everywhere). Superseding still
  // wins whenever the new row actually reports usage.
  resolve: resolveQueueRow,
});

function rowDayKey(row, timeZoneContext) {
  const hs = row.hour_start;
  if (!hs) return "";
  if (
    timeZoneContext &&
    (timeZoneContext.timeZone || Number.isFinite(timeZoneContext.offsetMinutes))
  ) {
    const parts = getZonedParts(new Date(hs), timeZoneContext);
    const key = formatPartsDayKey(parts);
    if (key) return key;
  }
  return hs.slice(0, 10);
}

function aggregateByDay(rows, timeZoneContext = null) {
  const normalizedRows = Array.isArray(rows) ? rows : [];
  const cacheKey = timeZoneContextKey(timeZoneContext || {});
  let cachedByTimeZone = dailyAggregationCache.get(normalizedRows);
  if (cachedByTimeZone?.has(cacheKey)) {
    const cached = cachedByTimeZone.get(cacheKey);
    // Touch the entry so the small per-queue map behaves as an LRU.
    cachedByTimeZone.delete(cacheKey);
    cachedByTimeZone.set(cacheKey, cached);
    return cached;
  }

  if (!cachedByTimeZone) {
    cachedByTimeZone = new Map();
    dailyAggregationCache.set(normalizedRows, cachedByTimeZone);
  }
  const pending = buildDailyAggregates(normalizedRows, timeZoneContext).then((daily) => {
    // Pricing can refresh while a large aggregation yields. Rebuild consistently
    // with the current catalog instead of publishing a mix of two revisions.
    if (cacheKey !== timeZoneContextKey(timeZoneContext || {})) {
      cachedByTimeZone.delete(cacheKey);
      return aggregateByDay(normalizedRows, timeZoneContext);
    }
    return daily;
  }).catch((error) => {
    if (cachedByTimeZone.get(cacheKey) === pending) cachedByTimeZone.delete(cacheKey);
    throw error;
  });
  // Share both completed and in-flight aggregates across summary/daily/heatmap.
  boundedCacheSet(cachedByTimeZone, cacheKey, pending, MAX_TIME_ZONE_CACHE_ENTRIES);
  return pending;
}

async function buildDailyAggregates(normalizedRows, timeZoneContext) {
  const byDay = new Map();
  let processed = 0;
  for (const row of normalizedRows) {
    if (++processed % AGGREGATION_BATCH_ROWS === 0) await yieldToRequests();
    if (!row.hour_start) continue;
    const day = rowDayKey(row, timeZoneContext);
    if (!day) continue;
    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        total_tokens: 0,
        billable_total_tokens: 0,
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const a = byDay.get(day);
    a.total_tokens += row.total_tokens || 0;
    a.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    a.total_cost_usd += foldTraeRowCost(row, computeRowCost(row));
    a.input_tokens += row.input_tokens || 0;
    a.output_tokens += row.output_tokens || 0;
    a.cached_input_tokens += row.cached_input_tokens || 0;
    a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    a.conversation_count += row.conversation_count || 0;

    if (!a.models) {
      a.models = {};
    }
    const model = row.model || "unknown";
    a.models[model] = (a.models[model] || 0) + (row.total_tokens || 0);
  }
  const daily = Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  return daily;
}

function buildCodexCategoryFallbackFromQueue(queueRows, { from, to, timeZoneContext }) {
  const totals = {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
  let conversationCount = 0;

  for (const row of queueRows || []) {
    if ((row?.source || "") !== "codex") continue;
    if (!row.hour_start) continue;
    const day = rowDayKey(row, timeZoneContext);
    if (from && day < from) continue;
    if (to && day > to) continue;
    totals.input_tokens += Number(row.input_tokens || 0);
    totals.cached_input_tokens += Number(row.cached_input_tokens || 0);
    totals.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
    totals.output_tokens += Number(row.output_tokens || 0);
    totals.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
    totals.total_tokens += Number(row.total_tokens || 0);
    conversationCount += Number(row.conversation_count || 0);
  }

  return {
    source: "codex",
    scope: "supported",
    breakdown_status: "queue_fallback",
    totals,
    session_count: 0,
    message_count: conversationCount,
    fallback: "queue_totals",
    message_breakdown: {
      categories: [
        {
          key: "user_input",
          name: "User input",
          totals: {
            input_tokens: totals.input_tokens,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: totals.input_tokens,
          },
        },
        {
          key: "conversation_history",
          name: "Conversation history",
          totals: {
            input_tokens: 0,
            cached_input_tokens: totals.cached_input_tokens,
            cache_creation_input_tokens: totals.cache_creation_input_tokens,
            output_tokens: 0,
            reasoning_output_tokens: 0,
            total_tokens: totals.cached_input_tokens + totals.cache_creation_input_tokens,
          },
        },
        {
          key: "assistant_response",
          name: "Assistant response",
          totals: {
            input_tokens: 0,
            cached_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: Math.max(0, totals.output_tokens - totals.reasoning_output_tokens),
            reasoning_output_tokens: 0,
            total_tokens: Math.max(0, totals.output_tokens - totals.reasoning_output_tokens),
          },
        },
      ].sort((a, b) => Number(b.totals.total_tokens || 0) - Number(a.totals.total_tokens || 0)),
      privacy: {
        includes_content: false,
        note: "Queue fallback includes aggregated token categories only; message text is never returned.",
      },
    },
    tool_calls_breakdown: {
      total_calls: 0,
      tools: [],
      categories: [],
      tools_total: 0,
      privacy: {
        includes_inputs: false,
        note: "Codex rollout sessions were unavailable; totals come from TokenTracker queue rows.",
      },
    },
    exec_command_breakdown: {
      by_type: [],
      by_exit: [],
    },
  };
}

function getRequestedUsageScope(url) {
  if (url.searchParams.get("include_account_level") === "1") return "all";
  return normalizeUsageScope(url.searchParams.get("scope"));
}

// #975: Codex Fast/Ultrafast speed-tier aggregation for the model breakdown.
// Queue rows carry priority_*/ultrafast_* subsets only when nonzero; Standard
// is derived on the client as totals minus the observed subsets, which keeps
// the three lines summing to the row the hero prices.
const SPEED_TIER_KEYS = ["priority", "ultrafast"];
const SPEED_TIER_BASE_COLUMNS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

function emptySpeedTierAccumulator() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cost_usd: 0,
  };
}

function hasObservedSpeedTiers(speedTiers) {
  if (!speedTiers) return false;
  return SPEED_TIER_KEYS.some((key) =>
    SPEED_TIER_BASE_COLUMNS.some((column) => Number(speedTiers[key]?.[column]) > 0)
      || Number(speedTiers[key]?.cost_usd) !== 0,
  );
}

function accumulateSpeedTiers(speedTiers, row) {
  if (!row) return;
  for (const key of SPEED_TIER_KEYS) {
    for (const column of SPEED_TIER_BASE_COLUMNS) {
      speedTiers[key][column] += Number(row[`${key}_${column}`]) || 0;
    }
  }
  const split = computeRowSpeedTierSplit(row);
  if (split) {
    speedTiers.priority.cost_usd += split.priority_cost_usd;
    speedTiers.ultrafast.cost_usd += split.ultrafast_cost_usd;
  }
}

async function scopedQueueRows(queuePath, url, { includeJoycode = true } = {}) {
  const scope = getRequestedUsageScope(url);
  // Memoized per (queue-file signature, scope, includeJoycode) — the READ
  // itself lives inside the memo, so a fan-out pays one queue validation
  // instead of one per endpoint. See the signature-memo note above.
  return scopedRowsReadMemo(queueFileSignature(queuePath), `${scope}|${includeJoycode}`, async () => {
    const allRows = await readQueueData(queuePath);
    // Qoder CN stopped storing token counts locally in 2026-07; its estimated
    // per-day rows (see qoder-cn-estimate.js) are merged here so every usage
    // endpoint — summary, daily, hourly, heatmap, model breakdown — counts the
    // same spend. Estimated rows only fill the shortfall against local rows,
    // so no day is ever double-counted.
    const estimatedRows = qoderCnEstimatedRows(allRows);
    // Qoder international charges in credits and writes no token counts, so its
    // usage would otherwise never appear at all. The rows carry money only.
    const intlCreditRows = qoderIntlCreditRows(allRows, {
      projectsDir: resolveQoderProjectsDir({ home: os.homedir(), env: process.env }),
    });
    // Antigravity's native generation ledger is authoritative at every time
    // granularity. External daily caches must not replace its measured buckets.
    // JoyCode keeps provider-reported task totals outside the queue; derive them
    // at read time so usage, sessions and the 京东 badge share one source.
    const joycodeRows = includeJoycode ? joycodeTaskRows() : [];
    // 商汤小浣熊's own agent trace (not gateway traffic): derived at read time so
    // its card and the queue-backed cards share one aggregation path.
    const raccoonRows = includeJoycode ? raccoonOfficeUsageRows() : [];
    const mergedRows = estimatedRows.length || intlCreditRows.length || joycodeRows.length || raccoonRows.length
      ? allRows.concat(estimatedRows, intlCreditRows, joycodeRows, raccoonRows)
      : allRows;
    return {
      scope,
      allRows: mergedRows,
      rows: filterRowsByUsageScope(mergedRows, scope),
      excludedSources: listExcludedSources(mergedRows, scope),
    };
  });
}

// A source counts toward terminal_purist only when the tokens were burned in a
// terminal window (CLI or TUI) - the badge name and its description say exactly
// that. The classification lives in ./terminal-sources with per-source evidence,
// so it can be audited instead of guessed: an IDE, a desktop app, or a product
// whose GUI writes the same log is NOT a terminal. Unknown ids are treated as
// non-terminal (under-count rather than mis-count) and logged once.
// See src/lib/terminal-sources.js for the table and the local evidence per entry.

// ── Local achievements ───────────────────────────────────────────────────────
// Thresholds are ordered bronze → silver → gold → diamond. This module is the
// single server-side home for LOCAL thresholds; the dashboard renders whatever
// the payload says and embeds none of these numbers. Every badge that can be
// judged from this machine's queue/profile is computed here, with no account
// or network call; only trendsetter and podium stay cross-user facts.
const LOCAL_BADGE_THRESHOLDS = {
  project_hopper: [3, 5, 10, 20], // distinct projects
  project_devotion: [1000000, 10000000, 100000000, 1000000000], // max tokens in one project
  night_owl: [4, 12, 36, 90], // active half-hour buckets between 00:00–03:59 local
  early_bird: [4, 12, 36, 90], // active half-hour buckets between 05:00–08:59 local
  around_the_clock: [6, 12, 18, 24], // distinct local hour-of-day buckets (0–23) with any activity
  // sprinter: fastest output rate inside ONE conversation task (session
  // sidecar), not an hour bucket — that is token_titan's job. Ladder set by the
  // owner on 2026-10-27: 100 is a quick hosted model, 150 the Flash/Hyperspeed
  // lane, 200 a small model running hot, 250 the ceiling for hosted output.
  sprinter: [100, 150, 200, 250], // output tokens per second within one task
  cache_alchemist: [50000000, 500000000, 5000000000, 50000000000], // lifetime cached-input tokens (reads + cache writes)
  deep_thinker: [1000000, 5000000, 20000000, 60000000], // lifetime reasoning output tokens
  real_money: [5, 50, 500, 5000], // lifetime tracked cost, USD
  session_marathon: [3600000, 14400000, 28800000, 43200000], // longest single-session active time, ms (1/4/8/12h)
  frugal_architect: [50000000, 500000000, 2000000000, 10000000000], // lifetime free/zero-cost tokens
  closed_source_loyalist: [10000000, 100000000, 1000000000, 10000000000], // lifetime openai/gpt tokens (hidden badge)
  offgrid_sovereign: [1000000, 10000000, 50000000, 200000000], // lifetime local/offline tokens (hidden badge)
  megacontext_voyager: [200000, 1000000, 5000000, 20000000], // peak hour input/context tokens
  cache_miser: [5, 25, 100, 300], // active hours with high cache hit ratio (>=80%)
  code_cannon: [100000, 500000, 2000000, 10000000], // peak output tokens
  buzzer_beater: [5, 20, 60, 150], // active intervals at hour/day margins
  zen_balancer: [1, 4, 12, 26], // active weeks with zero weekend tokens
  swarm_commander: [5, 20, 60, 150], // active hours with >= 2 distinct sources
  terminal_purist: [7, 30, 90, 180], // active days with >= 90% CLI tokens
  refactor_titan: [2, 6, 15, 30], // most active weeks invested in a single project
  zhipu_sage: [10000000, 100000000, 1000000000, 10000000000], // lifetime glm/zhipu/codegeex tokens
  moonshot_voyager: [10000000, 100000000, 1000000000, 10000000000], // lifetime kimi/moonshot tokens
  minimax_abyss: [10000000, 100000000, 1000000000, 10000000000], // lifetime minimax/abab/m3.1 tokens
  gemini_gemma: [10000000, 100000000, 1000000000, 10000000000], // lifetime google gemini tokens
  hyperspeed_grok: [10000000, 100000000, 1000000000, 10000000000], // lifetime xai grok tokens
  qwen_dynasty: [10000000, 100000000, 1000000000, 10000000000], // lifetime qwen/tongyi tokens
  flash_immortal: [50000000, 500000000, 2000000000, 10000000000], // lifetime flash model tokens
  seedance_master: [10000000, 100000000, 1000000000, 10000000000], // lifetime bytedance/seed/seedance/doubao tokens
  token_arbitrageur: [5, 10, 18, 26], // distinct arbitrage & free/check-in platforms used
  meituan_longcat: [10000000, 100000000, 1000000000, 10000000000], // lifetime meituan longcat tokens
  jd_joy_brother: [500000, 5000000, 50000000, 500000000], // lifetime jd yanxi/joycode/joycoder tokens (JoyCode tasks are small)
  hunyuan_master: [10000000, 100000000, 1000000000, 10000000000], // lifetime tencent hunyuan tokens (incl. HY series)
  stepfun_voyager: [10000000, 100000000, 1000000000, 10000000000], // lifetime stepfun tokens
  // Open-weight additions (2026-10-26). The three overseas families use the
  // public cadence (≈1 week / 1 month / 1 quarter / 1 year at ~300M tokens per
  // heavy developer-month) instead of the 10x ladder: no ordinary user can ever
  // touch a 10B row for one vendor. The MIT/Apache aggregate keeps the family
  // ladder because it sums every licensed vendor at once.
  mistral_westwind: [3000000, 30000000, 300000000, 3000000000], // lifetime Mistral/Devstral/Magistral/Pixtral tokens
  nemotron_spiral: [3000000, 30000000, 300000000, 3000000000], // lifetime NVIDIA Nemotron tokens
  phi_disciple: [3000000, 30000000, 300000000, 3000000000], // lifetime Microsoft Phi tokens
  spark_alpaca: [3000000, 30000000, 300000000, 3000000000], // lifetime Meta Llama / Muse Spark weights
  // Fire of the commons: tokens spent on weights that ship under MIT/Apache
  // with no revenue gate. Kimi (>$20M clause), Gemma/Llama (custom licence +
  // AUP) and the Hunyuan/Seed flagships stay in their own vendor badges.
  open_commons: [30000000, 300000000, 3000000000, 10000000000], // lifetime open-weight tokens
  // Domestic vendor families (2026-10-26) — same ladder as the other CN
  // vendors so the five slots stay comparable across families.
  iflytek_spark: [10000000, 100000000, 1000000000, 10000000000], // lifetime iFlytek Spark tokens
  sensenova_daily: [10000000, 100000000, 1000000000, 10000000000], // lifetime SenseTime SenseNova tokens
  xiaomi_mimo: [10000000, 100000000, 1000000000, 10000000000], // lifetime Xiaomi MiMo tokens
  dragon_heir: [1, 3, 5, 7], // distinct domestic model families used
  kill_line: [50, 60, 70, 80], // DeepSeek share of lifetime tokens, %
};

// The cloud nine (see scripts/ops/user-badges.sql) are normally computed
// server-side from the uploaded leaderboard rollup. That copy goes stale the
// moment uploads or the cloud cron lag behind, so the same metrics are replayed
// straight from the local queue here and the dashboard prefers the local row
// whenever both carry the same badge id. Thresholds intentionally mirror the
// SQL catalog; day grain is UTC because the SQL buckets
// (hour_start AT TIME ZONE 'UTC')::date the same way.
// trendsetter and podium use local proxies rather than staying locked:
// trendsetter counts models first used inside the debut window of their
// vendor's public release (pricing/debut-catalog.js; codenames and models the
// catalog cannot judge still count, and the split ships in `meta`), while
// podium is rank 1 on the single-profile local leaderboard — one machine has
// one profile, so "climbing the leaderboard" is not a competitive act here.
// The badge page copies must say so; both keep the cloud thresholds.
const CLOUD_PARITY_BADGE_THRESHOLDS = {
  token_titan: [100000000, 1000000000, 10000000000, 100000000000], // total tokens
  big_day: [10000000, 100000000, 500000000, 3000000000], // best UTC day
  wordsmith: [5000000, 25000000, 100000000, 300000000], // cumulative output tokens
  marathoner: [7, 30, 100, 365], // active days
  streak: [3, 7, 30, 100], // longest consecutive-day run
  weekend_warrior: [5, 20, 50, 100], // Sat/Sun active days (UTC)
  momentum: [2, 6, 15, 40], // best adjacent-week growth (prev week >= 10M floor)
  polyglot: [6, 18, 40, 80], // distinct models
  multitool: [3, 6, 12, 20], // distinct sources
  veteran: [30, 90, 180, 365], // days since the first recorded day
  phoenix: [7, 14, 30, 90], // longest return gap between two active days
  iron_month: [10, 20, 26, 29], // most active UTC days in one calendar month
  full_blast: [50000000, 500000000, 2500000000, 15000000000], // heaviest ISO week
  deep_diver: [1, 2, 3, 5], // distinct models with lifetime >= 1B tokens
  multitool_day: [2, 4, 6, 8], // most distinct sources in one active UTC day
  heart_model: [50, 70, 85, 95], // favorite model's share of lifetime tokens, % (needs >= 5 models)
  claude_survivor: [1000000, 10000000, 100000000, 1000000000], // lifetime claude-family tokens (hidden badge)
  wishing_well: [10000000, 100000000, 1000000000, 10000000000], // lifetime deepseek-family tokens (hidden badge)
  trendsetter: [2, 5, 10, 20], // models first used within 7 days of the first local record
  podium: [100, 30, 10, 3], // best local rank; lower is better
  grand_slam: [5, 12, 25, 40], // diamond-tier badges, grand_slam itself excluded
};

// deep_diver's per-model lifetime floor — same constant as the SQL CTE and
// the self-hosted writer's HAVING clause.
const DEEP_DIVER_MODEL_FLOOR = 1000000000;

const ALL_LOCAL_BADGE_THRESHOLDS = {
  ...LOCAL_BADGE_THRESHOLDS,
  ...CLOUD_PARITY_BADGE_THRESHOLDS,
};

const DAY_MS = 24 * 60 * 60 * 1000;
// Prior week must clear this before a growth ratio counts — same floor as the
// SQL momentum CTE, so a first-week spike cannot inflate the multiplier.
const MOMENTUM_PREV_WEEK_FLOOR = 10000000;

function utcDayKey(hourStart) {
  const key = String(hourStart || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function isoWeekStartMs(dayMs) {
  // ISO weeks start Monday; 1970-01-01 was a Thursday, so shift by 4 days.
  const shifted = dayMs - 4 * DAY_MS;
  return Math.floor(shifted / (7 * DAY_MS)) * (7 * DAY_MS) + 4 * DAY_MS;
}

const LOCAL_TIER_KEYS = ["bronze", "silver", "gold", "diamond"];

const { identityKeyFor, classifyKey } = require("./pricing/debut-catalog");
const LOWER_IS_BETTER_BADGES = new Set(["podium"]);

function tierForValue(value, thresholds, lowerIsBetter = false) {
  let tier = 0;
  for (let i = 0; i < thresholds.length; i += 1) {
    const met = lowerIsBetter ? value <= thresholds[i] : value >= thresholds[i];
    if (met) tier = i + 1;
  }
  return tier;
}

// One vote per Chinese model family, not per alias. A provider can expose ten
// spellings of the same model; "龙的传人" rewards breadth across families.
// MIT/Apache-licensed families with no revenue gate — the definition the
// commons badge uses. Deliberately excludes Kimi (custom licence, >$20M/read
// revenue clause), Gemma/Llama (vendor AUP), Codestral (Mistral's non-production
// licence) and the Hunyuan/Seed flagships, which stay in their own vendor
// badges. Nemotron counts: NVIDIA's own licence allows commercial use with no
// user cap, unlike the AUP families.
const OPEN_WEIGHT_LICENSE_PATTERNS = [
  /deepseek/, /qwen|tongyi|qianwen/, /glm|chatglm|codegeex|zhipu/,
  /minimax|abab|hailuo|m3\.|m3-|space-bunny/, /step-|stepfun/,
  /longcat|meituan/, /joycode|joycoder|joyai|yanxi|言犀/,
  /sensenova/, /internlm/, /mimo/, /(^|[-_/ ])yi-/,
  /mistral|devstral|magistral|pixtral/, /(^|[-_/ ])phi-\d/,
  /nemotron/, /olmo/, /gpt-oss/, /qwq/,
];

const DOMESTIC_FAMILY_MATCHERS = [
  ["deepseek", (m, s) => m.includes("deepseek") || s.includes("deepseek")],
  ["qwen", (m, s) => m.includes("qwen") || m.includes("tongyi") || m.includes("qianwen")
    || s.includes("qwen") || s.includes("bailian") || s.includes("dashscope") || s.includes("aliyun")],
  ["zhipu", (m, s) => m.includes("glm") || m.includes("chatglm") || m.includes("codegeex") || m.includes("zhipu")
    || s.includes("zhipu") || s.includes("glm")],
  ["moonshot", (m, s) => m.includes("kimi") || m.includes("moonshot") || s.includes("kimi") || s.includes("moonshot")],
  ["minimax", (m, s) => m.includes("minimax") || m.includes("abab") || m.includes("hailuo")
    || m.includes("m3.") || m.includes("m3-") || s.includes("minimax") || s.includes("hailuo")],
  ["hunyuan", (m, s) => m.includes("hunyuan") || m.includes("tencent") || m.includes("混元")
    || /(^|[-_/])hy\d/.test(m) || s.includes("hunyuan") || s.includes("tencent")],
  ["stepfun", (m, s) => m.startsWith("step-") || m.includes("stepfun") || m.includes("跃问")
    || m.includes("阶跃") || s.includes("stepfun") || s.includes("阶跃")],
  ["meituan", (m, s) => m.includes("longcat") || m.includes("meituan") || s.includes("meituan") || s.includes("longcat")],
  ["jd", (m, s) => m.includes("joycode") || m.includes("joycoder") || m.includes("chatrhino")
    || m.includes("yanxi") || m.includes("言犀") || m.startsWith("jd-") || m.includes("jd_")
    || m.includes("jingdong") || s.includes("jd") || s.includes("joycoder") || s.includes("joycode") || s.includes("yanxi")],
  ["bytedance", (m, s) => m.includes("doubao") || m.includes("seedance") || m.includes("seed-")
    || m.includes("skylark") || m.includes("volcengine") || s.includes("doubao") || s.includes("volcengine") || s.includes("bytedance")],
  ["baidu", (m) => m.includes("ernie") || m.includes("wenxin") || m.includes("文心")],
  ["iflytek", (m) => m.includes("spark") || m.includes("讯飞") || m.includes("星火")],
  ["sensetime", (m) => m.includes("sensenova") || m.includes("商量")],
  ["01ai", (m) => m.startsWith("yi-") || m.includes("零一")],
  ["internlm", (m) => m.includes("internlm") || m.includes("书生")],
  ["xiaomi", (m) => m.includes("mimo")],
];

function domesticFamilyFor(modelLower, sourceKey) {
  for (const [family, match] of DOMESTIC_FAMILY_MATCHERS) {
    if (match(modelLower, sourceKey)) return family;
  }
  return null;
}

/**
 * Compute the local badge set from deduped queue rows (plus the device's
 * session rows for the session marathon). Rows are replayed in hour_start
 * order so each tier's `achieved` timestamp is the hour at which the running
 * metric first crossed that threshold. Local time (night_owl / early_bird /
 * around_the_clock) follows the caller's tz query params like every other
 * usage endpoint.
 */
function computeLocalAchievements(queueRows, projectRows, { timeZoneContext, sessions = [] } = {}) {
  const sortByHour = (rows) =>
    rows
      .filter((row) => row && row.hour_start)
      .slice()
      .sort((a, b) => String(a.hour_start).localeCompare(String(b.hour_start)));

  const trackers = {};
  for (const badgeId of Object.keys(ALL_LOCAL_BADGE_THRESHOLDS)) {
    trackers[badgeId] = {
      value: LOWER_IS_BETTER_BADGES.has(badgeId) ? Number.POSITIVE_INFINITY : 0,
      achieved: {},
      meta: {},
    };
  }

  const bump = (badgeId, newValue, atIso, meta) => {
    const tracker = trackers[badgeId];
    if (!tracker || newValue <= tracker.value) return;
    tracker.value = newValue;
    if (meta) tracker.meta = meta;
    const thresholds = ALL_LOCAL_BADGE_THRESHOLDS[badgeId];
    for (let i = 0; i < thresholds.length; i += 1) {
      const tierKey = LOCAL_TIER_KEYS[i];
      if (newValue >= thresholds[i] && !tracker.achieved[tierKey]) {
        tracker.achieved[tierKey] = atIso || null;
      }
    }
  };

  const bumpLower = (badgeId, newValue, atIso, meta) => {
    const tracker = trackers[badgeId];
    if (!tracker || newValue >= tracker.value) return;
    tracker.value = newValue;
    if (meta) tracker.meta = meta;
    const thresholds = ALL_LOCAL_BADGE_THRESHOLDS[badgeId];
    for (let i = 0; i < thresholds.length; i += 1) {
      const tierKey = LOCAL_TIER_KEYS[i];
      if (newValue <= thresholds[i] && !tracker.achieved[tierKey]) {
        tracker.achieved[tierKey] = atIso || null;
      }
    }
  };

  const seenProjects = new Set();
  const perProjectTokens = new Map();
  const perProjectWeeks = new Map();
  let maxProjectWeeks = 0;
  for (const row of sortByHour(projectRows || [])) {
    const projectKey = row.project_key;
    const tokens = Number(row.total_tokens || 0);
    if (!projectKey || tokens <= 0) continue;
    if (!seenProjects.has(projectKey)) {
      seenProjects.add(projectKey);
      bump("project_hopper", seenProjects.size, row.hour_start);
    }
    const running = (perProjectTokens.get(projectKey) || 0) + tokens;
    perProjectTokens.set(projectKey, running);
    if (running > trackers.project_devotion.value) {
      bump("project_devotion", running, row.hour_start, { project_key: projectKey });
    }
    const pDay = utcDayKey(row.hour_start);
    if (pDay) {
      const pDayMs = Date.parse(`${pDay}T00:00:00Z`);
      const pWeekStart = isoWeekStartMs(pDayMs);
      let pWeeks = perProjectWeeks.get(projectKey);
      if (!pWeeks) {
        pWeeks = new Set();
        perProjectWeeks.set(projectKey, pWeeks);
      }
      pWeeks.add(pWeekStart);
      if (pWeeks.size > maxProjectWeeks) {
        maxProjectWeeks = pWeeks.size;
        bump("refactor_titan", maxProjectWeeks, row.hour_start, { project_key: projectKey });
      }
    }
  }

  const nightHours = new Set();
  const earlyHours = new Set();
  const dayHourBuckets = new Set();
  let cachedTotal = 0;
  let reasoningTotal = 0;
  let costTotal = 0;
  let frugalTokens = 0;
  let openaiTokens = 0;
  let offgridTokens = 0;
  let megacontextPeak = 0;
  let codeCannonPeak = 0;
  let cacheMiserCount = 0;
  let buzzerCount = 0;
  const hourSources = new Map();
  let multiSourceHours = 0;
  // Wave-2 cloud-parity accumulators (deep_diver / heart_model input,
  // claude_survivor / wishing_well). Family prefixes match the SQL
  // `model LIKE 'claude%'` / `'deepseek%'` semantics.
  let claudeTokens = 0;
  let deepseekTokens = 0;
  let localTotalTokens = 0;
  let lastLocalHour = null;
  const domesticFamilies = new Set();
  let zhipuTokens = 0;
  let moonshotTokens = 0;
  let minimaxTokens = 0;
  let geminiTokens = 0;
  let grokTokens = 0;
  let qwenTokens = 0;
  let flashTokens = 0;
  let seedanceTokens = 0;
  let meituanTokens = 0;
  let jdTokens = 0;
  let hunyuanTokens = 0;
  let stepfunTokens = 0;
  let mistralTokens = 0;
  let nemotronTokens = 0;
  let phiTokens = 0;
  let metaTokens = 0;
  let openWeightTokens = 0;
  let iflytekTokens = 0;
  let sensenovaTokens = 0;
  let xiaomiTokens = 0;
  const arbitragePlatforms = new Set();
  const modelTokens = new Map();
  const bigModels = new Set();
  for (const row of sortByHour(queueRows || [])) {
    const tokens = Number(row.total_tokens || 0);
    if (tokens <= 0) continue;
    localTotalTokens += tokens;
    lastLocalHour = row.hour_start;
    // Token-category sums accrue across every active row regardless of hour.
    cachedTotal += Number(row.cached_input_tokens || 0) + Number(row.cache_creation_input_tokens || 0);
    reasoningTotal += Number(row.reasoning_output_tokens || 0);
    // Same cost semantics as the usage summary (the corner ¥ number):
    // authoritative provider-reported cost wins, everything else prices from
    // the model tables at read time. Rows rarely carry a stored cost.
    const rowCost = foldTraeRowCost(row, computeRowCost(row));
    costTotal += rowCost;
    const modelLower = String(row.model || "").toLowerCase();
    const sourceLower = String(row.source || "").toLowerCase();
    const isFree =
      rowCost === 0 ||
      modelLower.includes("free") ||
      sourceLower.includes("free") ||
      Boolean(row.is_free) ||
      Boolean(row.is_zero_cost);
    if (isFree) {
      frugalTokens += tokens;
      bump("frugal_architect", frugalTokens, row.hour_start);
    }
    bump("cache_alchemist", cachedTotal, row.hour_start);
    bump("deep_thinker", reasoningTotal, row.hour_start);
    bump("real_money", costTotal, row.hour_start);

    const inputVolume = Number(row.input_tokens || 0) + Number(row.cached_input_tokens || 0);
    if (inputVolume > megacontextPeak) {
      megacontextPeak = inputVolume;
      bump("megacontext_voyager", megacontextPeak, row.hour_start);
    }

    const outTokens = Number(row.output_tokens || 0);
    if (outTokens > codeCannonPeak) {
      codeCannonPeak = outTokens;
      bump("code_cannon", codeCannonPeak, row.hour_start);
    }

    const cachedIn = Number(row.cached_input_tokens || 0);
    const totalIn = Number(row.input_tokens || 0) + cachedIn;
    if (totalIn >= 50000 && cachedIn / totalIn >= 0.8) {
      cacheMiserCount += 1;
      bump("cache_miser", cacheMiserCount, row.hour_start);
    }

    if (row.source && row.hour_start) {
      let srcSet = hourSources.get(row.hour_start);
      if (!srcSet) {
        srcSet = new Set();
        hourSources.set(row.hour_start, srcSet);
      }
      const beforeSize = srcSet.size;
      srcSet.add(row.source);
      if (beforeSize < 2 && srcSet.size >= 2) {
        multiSourceHours += 1;
        bump("swarm_commander", multiSourceHours, row.hour_start);
      }
    }
    if (row.model) {
      const modelKey = String(row.model);
      const rawLowerModel = modelKey.toLowerCase();
      const sourceKey = String(row.source || "").toLowerCase();
      // Family badges must read the model the user actually picked, not the
      // router id the ledger keeps. Qoder stores `kmodel_latest` for
      // Kimi-K3.1-Pro and `qfmodel` for Qwen3.8-Flash; stealth codenames such
      // as `x-preview-f-free` only resolve through the pricing catalog.
      const displayModel = (sourceKey === "qoder" || sourceKey === "qoder-cn") ? qoderIntlDisplayModel(modelKey) : modelKey;
      const aliasLowerModel = String(identityKeyFor(displayModel) || displayModel).toLowerCase();
      // Both spellings share one probe string: every family predicate below is
      // an `includes`/regex check, and a row may carry either the router id
      // (`kmodel_latest`) or the catalog-resolved model (`kimi-k-3-1-pro`).
      const lowerModel = aliasLowerModel === rawLowerModel
        ? rawLowerModel
        : `${rawLowerModel} ${aliasLowerModel}`;
      const modelRunning = (modelTokens.get(modelKey) || 0) + tokens;
      modelTokens.set(modelKey, modelRunning);
      if (modelRunning >= DEEP_DIVER_MODEL_FLOOR && !bigModels.has(modelKey)) {
        bigModels.add(modelKey);
        bump("deep_diver", bigModels.size, row.hour_start, { models: [...bigModels] });
      }
      if (lowerModel.startsWith("claude")) {
        claudeTokens += tokens;
        bump("claude_survivor", claudeTokens, row.hour_start);
      }
      if (lowerModel.includes("deepseek") || sourceKey.includes("deepseek")) {
        deepseekTokens += tokens;
        bump("wishing_well", deepseekTokens, row.hour_start);
      }
      const domesticFamily = domesticFamilyFor(lowerModel, sourceKey);
      if (domesticFamily && !domesticFamilies.has(domesticFamily)) {
        domesticFamilies.add(domesticFamily);
        bump("dragon_heir", domesticFamilies.size, row.hour_start, { families: [...domesticFamilies] });
      }
      if (
        lowerModel.startsWith("gpt") ||
        lowerModel.startsWith("o1") ||
        lowerModel.startsWith("o3") ||
        lowerModel.startsWith("o4") ||
        lowerModel.startsWith("chatgpt") ||
        lowerModel.startsWith("text-davinci") ||
        lowerModel.includes("openai")
      ) {
        openaiTokens += tokens;
        bump("closed_source_loyalist", openaiTokens, row.hour_start);
      }
      if (
        sourceKey === "ollama" ||
        sourceKey === "lmstudio" ||
        sourceKey === "vllm" ||
        sourceKey === "local" ||
        sourceKey.includes("localhost") ||
        rawLowerModel.startsWith("ollama/") ||
        rawLowerModel.includes(":local")
      ) {
        offgridTokens += tokens;
        bump("offgrid_sovereign", offgridTokens, row.hour_start);
      }
      if (
        lowerModel.includes("glm") ||
        lowerModel.includes("chatglm") ||
        lowerModel.includes("codegeex") ||
        lowerModel.includes("zhipu") ||
        sourceKey.includes("zhipu") ||
        sourceKey.includes("glm")
      ) {
        zhipuTokens += tokens;
        bump("zhipu_sage", zhipuTokens, row.hour_start);
      }
      if (
        lowerModel.includes("moonshot") ||
        lowerModel.includes("kimi") ||
        sourceKey.includes("kimi") ||
        sourceKey.includes("moonshot")
      ) {
        moonshotTokens += tokens;
        bump("moonshot_voyager", moonshotTokens, row.hour_start);
      }
      if (
        lowerModel.includes("minimax") ||
        lowerModel.includes("abab") ||
        lowerModel.includes("hailuo") ||
        lowerModel.includes("m3.") ||
        lowerModel.includes("m3-") ||
        sourceKey.includes("minimax") ||
        sourceKey.includes("hailuo")
      ) {
        minimaxTokens += tokens;
        bump("minimax_abyss", minimaxTokens, row.hour_start);
      }
      if (
        lowerModel.includes("gemini") ||
        lowerModel.includes("gemma") ||
        lowerModel.includes("google") ||
        sourceKey.includes("gemini") ||
        sourceKey.includes("google")
      ) {
        geminiTokens += tokens;
        bump("gemini_gemma", geminiTokens, row.hour_start);
      }
      if (
        lowerModel.includes("grok") ||
        lowerModel.includes("xai") ||
        sourceKey.includes("grok") ||
        sourceKey.includes("xai") ||
        (sourceKey === "cursor" && (lowerModel.includes("grok") || lowerModel === "auto"))
      ) {
        grokTokens += tokens;
        bump("hyperspeed_grok", grokTokens, row.hour_start);
      }
      if (
        lowerModel.includes("qwen") ||
        lowerModel.includes("tongyi") ||
        lowerModel.includes("qianwen") ||
        sourceKey.includes("qwen") ||
        sourceKey.includes("bailian") ||
        sourceKey.includes("aliyun") ||
        sourceKey.includes("dashscope")
      ) {
        qwenTokens += tokens;
        bump("qwen_dynasty", qwenTokens, row.hour_start);
      }
      if (lowerModel.includes("flash")) {
        flashTokens += tokens;
        bump("flash_immortal", flashTokens, row.hour_start);
      }
      if (
        lowerModel.includes("seed") ||
        lowerModel.includes("doubao") ||
        lowerModel.includes("skylark") ||
        lowerModel.startsWith("ep-") ||
        sourceKey.includes("doubao") ||
        sourceKey.includes("volcengine") ||
        sourceKey.includes("bytedance")
      ) {
        seedanceTokens += tokens;
        bump("seedance_master", seedanceTokens, row.hour_start);
      }
      if (
        lowerModel.includes("longcat") ||
        lowerModel.includes("meituan") ||
        sourceKey.includes("meituan") ||
        sourceKey.includes("longcat")
      ) {
        meituanTokens += tokens;
        bump("meituan_longcat", meituanTokens, row.hour_start);
      }
      if (
        lowerModel.includes("chatrhino") ||
        lowerModel.includes("joycoder") ||
        lowerModel.includes("joycode") ||
        lowerModel.includes("joy-code") ||
        lowerModel.includes("joy_code") ||
        lowerModel.includes("yanxi") ||
        lowerModel.includes("言犀") ||
        lowerModel.startsWith("jd-") ||
        lowerModel.includes("jd_") ||
        lowerModel.includes("jingdong") ||
        sourceKey.includes("jd") ||
        sourceKey.includes("joycoder") ||
        sourceKey.includes("joycode") ||
        sourceKey.includes("yanxi")
      ) {
        jdTokens += tokens;
        bump("jd_joy_brother", jdTokens, row.hour_start);
      }
      if (
        lowerModel.includes("hunyuan") ||
        lowerModel.includes("tencent") ||
        lowerModel.includes("混元") ||
        /(^|[-_/])hy\d/.test(lowerModel) ||
        sourceKey.includes("hunyuan") ||
        sourceKey.includes("tencent")
      ) {
        hunyuanTokens += tokens;
        bump("hunyuan_master", hunyuanTokens, row.hour_start);
      }
      if (
        lowerModel.startsWith("step-") ||
        lowerModel.includes("stepfun") ||
        lowerModel.includes("跃问") ||
        lowerModel.includes("阶跃") ||
        sourceKey.includes("stepfun") ||
        sourceKey.includes("step")
      ) {
        stepfunTokens += tokens;
        bump("stepfun_voyager", stepfunTokens, row.hour_start);
      }
      if (lowerModel.includes("mistral") || lowerModel.includes("devstral")
        || lowerModel.includes("magistral") || lowerModel.includes("pixtral")
        || lowerModel.includes("codestral")) {
        mistralTokens += tokens;
        bump("mistral_westwind", mistralTokens, row.hour_start);
      }
      if (lowerModel.includes("nemotron")) {
        nemotronTokens += tokens;
        bump("nemotron_spiral", nemotronTokens, row.hour_start);
      }
      if (/(^|[-_/ ])phi-\d/.test(lowerModel)) {
        phiTokens += tokens;
        bump("phi_disciple", phiTokens, row.hour_start);
      }
      if (lowerModel.includes("llama") || lowerModel.includes("muse-spark")) {
        metaTokens += tokens;
        bump("spark_alpaca", metaTokens, row.hour_start);
      }
      if (OPEN_WEIGHT_LICENSE_PATTERNS.some((re) => re.test(lowerModel))) {
        openWeightTokens += tokens;
        bump("open_commons", openWeightTokens, row.hour_start);
      }
      // iFlytek: Spark model ids only. "Muse Spark" is Meta's, so the bare
      // `spark` token must not swallow it.
      if (
        (!lowerModel.includes("muse-spark") && /(^|[-_/ ])spark/.test(lowerModel)) ||
        lowerModel.includes("iflytek") ||
        lowerModel.includes("iflycode") ||
        sourceKey.includes("iflytek")
      ) {
        iflytekTokens += tokens;
        bump("iflytek_spark", iflytekTokens, row.hour_start);
      }
      if (lowerModel.includes("sensenova")) {
        sensenovaTokens += tokens;
        bump("sensenova_daily", sensenovaTokens, row.hour_start);
      }
      if (lowerModel.includes("mimo")) {
        xiaomiTokens += tokens;
        bump("xiaomi_mimo", xiaomiTokens, row.hour_start);
      }
      const ARBITRAGE_PATTERNS = [
        "apigoto", "agentrouter", "opencode", "openrouter", "codearts",
        "copilot", "cloudflare", "nvidia", "kilo", "mistral",
        "groq", "sensenova", "siliconflow", "volcengine", "supercomputing",
        "bailian", "trae", "workbuddy", "qoder", "minimax",
        "tuanjie", "loomy", "agent2api", "autoclaw", "cline",
        "deepseek", "ark", "zcode", "cola", "kimi"
      ];
      for (const pattern of ARBITRAGE_PATTERNS) {
        if (sourceKey.includes(pattern) || lowerModel.includes(pattern)) {
          arbitragePlatforms.add(pattern);
        }
      }
      bump("token_arbitrageur", arbitragePlatforms.size, row.hour_start, { platforms: [...arbitragePlatforms] });
    }
    const d = new Date(row.hour_start);
    const mins = d.getUTCMinutes();
    const parts = getZonedParts(d, timeZoneContext || {});
    if (mins >= 50 || (parts && parts.hour === 23)) {
      buzzerCount += 1;
      bump("buzzer_beater", buzzerCount, row.hour_start);
    }
    if (!parts) continue;
    // Hour-of-day footprints for around_the_clock: one point per local hour
    // 0–23, across the whole history.
    if (!dayHourBuckets.has(parts.hour)) {
      dayHourBuckets.add(parts.hour);
      bump("around_the_clock", dayHourBuckets.size, row.hour_start);
    }
    // night_owl / early_bird: one point per active half-hour bucket inside
    // 00:00–03:59 / 05:00–08:59 local time.
    if (parts.hour < 4 && !nightHours.has(row.hour_start)) {
      nightHours.add(row.hour_start);
      bump("night_owl", nightHours.size, row.hour_start);
    }
    if (parts.hour >= 5 && parts.hour < 9 && !earlyHours.has(row.hour_start)) {
      earlyHours.add(row.hour_start);
      bump("early_bird", earlyHours.size, row.hour_start);
    }
  }

  // 斩杀线 is a whole-history ratio, not a per-hour peak: replay the final
  // DeepSeek share after the queue is consumed. The engine is monotonic, so
  // crossing the line once keeps the tier if later usage dilutes the share.
  if (localTotalTokens > 0) {
    bump("kill_line", (deepseekTokens * 100) / localTotalTokens, lastLocalHour);
  }

  // ── Cloud-parity replay, straight from the local queue ─────────────────────
  // day -> { tokens, output, models:Set, sources:Set } keyed by UTC day.
  const days = new Map();
  for (const row of queueRows || []) {
    if (!row || !row.hour_start) continue;
    const tokens = Number(row.total_tokens || 0);
    if (!(tokens > 0)) continue;
    const day = utcDayKey(row.hour_start);
    if (!day) continue;
    let entry = days.get(day);
    if (!entry) {
      entry = { tokens: 0, output: 0, cliTokens: 0, models: new Set(), sources: new Set() };
      days.set(day, entry);
    }
    const src = String(row.source || "").toLowerCase();
    if (isTerminalSource(src)) {
      entry.cliTokens += tokens;
    }
    entry.tokens += tokens;
    entry.output += Number(row.output_tokens || 0);
    if (row.model) entry.models.add(String(row.model));
    if (row.source) entry.sources.add(String(row.source));
  }

  const dayKeys = [...days.keys()].sort();
  const seenModels = new Set();
  const seenSources = new Set();
  const firstModelDay = new Map();
  const weekTokens = new Map();
  const monthActiveDays = new Map();
  const firstDayMs = dayKeys.length ? Date.parse(`${dayKeys[0]}T00:00:00Z`) : null;
  let totalTokens = 0;
  let totalOutput = 0;
  let bestDay = 0;
  let activeDays = 0;
  let weekendDays = 0;
  let runLength = 0;
  let longestRun = 0;
  let prevDayMs = null;
  let terminalDays = 0;
  const isoWeeksTracking = new Map();

  for (const day of dayKeys) {
    const entry = days.get(day);
    const atIso = `${day}T00:00:00.000Z`;
    const dayMs = Date.parse(`${day}T00:00:00Z`);
    totalTokens += entry.tokens;
    totalOutput += entry.output;
    if (entry.tokens > bestDay) bestDay = entry.tokens;
    activeDays += 1;
    const dow = new Date(dayMs).getUTCDay();
    if (dow === 0 || dow === 6) weekendDays += 1;
    for (const model of entry.models) {
      seenModels.add(model);
      if (!firstModelDay.has(model)) firstModelDay.set(model, day);
    }
    for (const source of entry.sources) seenSources.add(source);
    // phoenix: a skipped stretch counts on the day the user returns — the
    // gap spans both endpoints, same as the SQL CTE (Fri → Mon gaps 3).
    if (prevDayMs !== null && dayMs - prevDayMs > DAY_MS) {
      bump("phoenix", Math.round((dayMs - prevDayMs) / DAY_MS), atIso, {
        gap_start: new Date(prevDayMs).toISOString().slice(0, 10),
        return_day: day,
      });
    }
    runLength = prevDayMs !== null && dayMs - prevDayMs === DAY_MS ? runLength + 1 : 1;
    prevDayMs = dayMs;
    if (runLength > longestRun) longestRun = runLength;
    const weekStart = isoWeekStartMs(dayMs);
    weekTokens.set(weekStart, (weekTokens.get(weekStart) || 0) + entry.tokens);
    // iron_month / multitool_day / full_blast: per-month active-day count,
    // per-day tool breadth, and the running ISO-week total. bump() keeps
    // only the running maximum, so partial weeks/months never downgrade.
    const monthKey = day.slice(0, 7);
    const monthCount = (monthActiveDays.get(monthKey) || 0) + 1;
    monthActiveDays.set(monthKey, monthCount);
    bump("iron_month", monthCount, atIso, { month: monthKey });
    bump("multitool_day", entry.sources.size, atIso, { day, tools: [...entry.sources] });
    bump("full_blast", weekTokens.get(weekStart), atIso, {
      week: new Date(weekStart).toISOString().slice(0, 10),
    });

    bump("token_titan", totalTokens, atIso);
    bump("big_day", entry.tokens, atIso);
    bump("wordsmith", totalOutput, atIso);
    bump("marathoner", activeDays, atIso);
    bump("streak", runLength, atIso);
    bump("weekend_warrior", weekendDays, atIso);
    bump("polyglot", seenModels.size, atIso);
    bump("multitool", seenSources.size, atIso);
    // Veteran marches with the calendar (days since the first record), not with
    // the set of active days — same definition as the SQL base CTE.
    if (firstDayMs !== null) {
      bump("veteran", Math.max(0, Math.round((dayMs - firstDayMs) / DAY_MS)), atIso);
    }

    if (entry.tokens > 0 && entry.cliTokens / entry.tokens >= 0.9) {
      terminalDays += 1;
      bump("terminal_purist", terminalDays, atIso);
    }

    let wInfo = isoWeeksTracking.get(weekStart);
    if (!wInfo) {
      wInfo = { weekdays: 0, weekendTokens: 0 };
      isoWeeksTracking.set(weekStart, wInfo);
    }
    if (dow >= 1 && dow <= 5) wInfo.weekdays += 1;
    if (dow === 0 || dow === 6) wInfo.weekendTokens += entry.tokens;
  }

  let zenWeeksCount = 0;
  for (const [wStart, wInfo] of isoWeeksTracking) {
    if (wInfo.weekdays > 0 && wInfo.weekendTokens === 0) {
      zenWeeksCount += 1;
      bump("zen_balancer", zenWeeksCount, new Date(wStart).toISOString());
    }
  }
  void longestRun;

  // LOCAL trendsetter, original semantics: a model counts when this machine used
  // it inside the debut window of the vendor's public release. Ledger strings are
  // aliases of one model, so they collapse to the earliest day seen before the
  // catalog judges them. A model with no catalogued date gets no verdict either
  // way — an unfinished catalog must not cost a tier — so it still counts, and
  // the split ships in `meta` rather than hiding inside the total.
  if (dayKeys.length > 0) {
    const earliestUse = new Map();
    for (const [model, firstDay] of firstModelDay) {
      const identity = identityKeyFor(model);
      if (!identity) continue;
      const prior = earliestUse.get(identity);
      if (!prior || firstDay < prior) earliestUse.set(identity, firstDay);
    }
    let debutWeekModels = 0;
    let betaModels = 0;
    let lateModels = 0;
    let codenameModels = 0;
    let unjudgedModels = 0;
    for (const [identity, firstDay] of earliestUse) {
      const verdict = classifyKey(identity, firstDay);
      if (verdict.status === "early") {
        debutWeekModels += 1;
        // Used before the announcement, i.e. during a beta or staged rollout.
        // Counted, but shown separately so the split is never hidden in the total.
        if (verdict.pre_beta) betaModels += 1;
      } else if (verdict.status === "late") lateModels += 1;
      else if (verdict.status === "codename") codenameModels += 1;
      else if (verdict.status === "unverified") unjudgedModels += 1;
    }
    const earlyModels = debutWeekModels + codenameModels + unjudgedModels;
    if (earlyModels > 0) {
      bump("trendsetter", earlyModels, `${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`, {
        first_day: dayKeys[0],
        debut_week: debutWeekModels,
        beta: betaModels,
        codename: codenameModels,
        unjudged: unjudgedModels,
        late: lateModels,
      });
    }
    // LOCAL podium: one machine has one profile, so its local rank is 1.
    // Cloud mode still uses the shared leaderboard rank and thresholds.
    bumpLower("podium", 1, `${dayKeys[dayKeys.length - 1]}T00:00:00.000Z`, {
      scope: "local",
    });
  }

  // Best adjacent-week growth. The previous week must sit exactly 7 days earlier
  // and clear the floor, mirroring the SQL momentum CTE.
  let bestMomentum = 0;
  let momentumCrossedMs = null;
  for (const weekStart of [...weekTokens.keys()].sort((a, b) => a - b)) {
    const prev = weekTokens.get(weekStart - 7 * DAY_MS);
    if (!(prev >= MOMENTUM_PREV_WEEK_FLOOR)) continue;
    const ratio = weekTokens.get(weekStart) / prev;
    if (ratio > bestMomentum) {
      bestMomentum = ratio;
      momentumCrossedMs = weekStart;
    }
  }
  if (momentumCrossedMs !== null) {
    bump("momentum", bestMomentum, new Date(momentumCrossedMs + 7 * DAY_MS).toISOString());
  }

  // heart_model: the favorite model's share of lifetime tokens, in percent.
  // Needs >= 5 distinct models — a one-model history is 100% by definition,
  // not devotion. Achieved timestamp lands on the last active day (the
  // share is a whole-history ratio, replayed once the queue is consumed).
  if (seenModels.size >= 5 && totalTokens > 0) {
    let topModel = null;
    let topTokens = 0;
    for (const [model, t] of modelTokens) {
      if (t > topTokens) {
        topTokens = t;
        topModel = model;
      }
    }
    if (topModel) {
      bump(
        "heart_model",
        (topTokens * 100) / totalTokens,
        dayKeys.length ? `${dayKeys[dayKeys.length - 1]}T00:00:00.000Z` : null,
        { model: topModel },
      );
    }
  }

  // session_marathon: longest single session that actually spent tokens.
  // Session rows may arrive as fragments; taking the max row duration is
  // conservative (never overstates a session's length).
  let longestSessionMs = 0;
  let longestSession = null;
  for (const session of sessions || []) {
    if (!session || Number(session.total_tokens || 0) <= 0) continue;
    if (Number(session.duration_ms || 0) > longestSessionMs) {
      longestSessionMs = Number(session.duration_ms || 0);
      longestSession = session;
    }
  }
  if (longestSession) {
    bump(
      "session_marathon",
      longestSessionMs,
      longestSession.ended_at || longestSession.started_at || null,
      { session_hash: longestSession.session_hash || null },
    );
  }

  // sprinter: the fastest output rate ever sustained inside a SINGLE
  // conversation task. The queue has no task id (its key is
  // source|model|hour_start), so only the session sidecar can answer this.
  // Rows under five seconds are ignored — 40 tokens in 0.3s divides out to a
  // flattering 133 tok/s that no model actually held.
  let fastestRate = 0;
  let fastestSession = null;
  for (const session of sessions || []) {
    const perf = session?.performance;
    const rate = Number(perf?.estimated_tokens_per_second || 0);
    if (!Number.isFinite(rate) || rate <= fastestRate) continue;
    if (Number(perf.estimated_duration_ms || 0) < 5000) continue;
    if (Number(perf.estimated_output_tokens || 0) < 200) continue;
    fastestRate = rate;
    fastestSession = session;
  }
  if (fastestSession) {
    bump(
      "sprinter",
      fastestRate,
      fastestSession.ended_at || fastestSession.started_at || null,
      { session_hash: fastestSession.session_hash || null },
    );
  }

  // grand_slam reads the other badges' final tiers, so it is computed after
  // every tracker has consumed the queue. The badge excludes itself, exactly
  // like the SQL catalog's diamonds CTE. online-only cross-user badges are not
  // in this map, so the local count is the honest local diamond count.
  let diamondBadges = 0;
  let latestDiamondAt = null;
  for (const [badgeId, thresholds] of Object.entries(ALL_LOCAL_BADGE_THRESHOLDS)) {
    if (badgeId === "grand_slam") continue;
    const tracker = trackers[badgeId];
    if (tierForValue(tracker.value, thresholds, LOWER_IS_BETTER_BADGES.has(badgeId)) !== 4) continue;
    diamondBadges += 1;
    const at = tracker.achieved.diamond;
    if (at && (!latestDiamondAt || at > latestDiamondAt)) latestDiamondAt = at;
  }
  if (diamondBadges > 0) bump("grand_slam", diamondBadges, latestDiamondAt);

  return Object.entries(ALL_LOCAL_BADGE_THRESHOLDS).map(([badgeId, thresholds]) => {
    const tracker = trackers[badgeId];
    const lowerIsBetter = LOWER_IS_BETTER_BADGES.has(badgeId);
    const hasValue = Number.isFinite(tracker.value);
    const value = hasValue ? tracker.value : 0;
    // Infinity is the "no rank observed yet" sentinel for lower-is-better
    // badges; converting it to 0 would incorrectly look like rank #0.
    const tier = hasValue ? tierForValue(value, thresholds, lowerIsBetter) : 0;
    return {
      id: badgeId,
      tier,
      metric_value: value,
      thresholds: thresholds.slice(),
      lower_is_better: lowerIsBetter,
      next_threshold: tier >= 4 ? null : thresholds[tier],
      achieved: {
        bronze: tracker.achieved.bronze || null,
        silver: tracker.achieved.silver || null,
        gold: tracker.achieved.gold || null,
        diamond: tracker.achieved.diamond || null,
      },
      meta: tracker.meta,
    };
  });
}

// ── Local leaderboard (history on this machine) ─────────────────────────────
// The shipped leaderboard used to require the cloud/self-host account. The
// open-source default must not leave that page blank, so the local CLI serves
// a one-profile history from the same deduped queue the dashboard already
// uses. It is deliberately NOT a fake multi-user ranking: one machine is one
// row, ranked #1, with its real period totals and provider split.

const LEADERBOARD_PROVIDER_COLUMNS = [
  ["gpt_tokens", (source) => source === "codex" || source === "every-code"],
  ["claude_tokens", (source) => source.startsWith("claude")],
  ["gemini_tokens", (source) => source.startsWith("gemini") || source === "antigravity"],
  ["cursor_tokens", (source) => source === "cursor"],
  ["kiro_tokens", (source) => source.startsWith("kiro")],
  ["copilot_tokens", (source) => source === "copilot" || source === "github-copilot"],
  ["kimi_tokens", (source) => source.startsWith("kimi")],
  ["opencode_tokens", (source) => source.startsWith("opencode") || source === "loomy"],
  ["openclaw_tokens", (source) => source.startsWith("openclaw") || source === "clawd"],
  ["hermes_tokens", (source) => source.startsWith("hermes")],
];

function leaderboardProviderColumn(source) {
  const normalized = String(source || "").trim().toLowerCase();
  for (const [column, matches] of LEADERBOARD_PROVIDER_COLUMNS) {
    if (matches(normalized)) return column;
  }
  return "other_tokens";
}

function leaderboardWindow(period, nowMs) {
  const now = new Date(nowMs);
  if (period === "week") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  if (period === "month") {
    return {
      from: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`,
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
        .toISOString()
        .slice(0, 10),
    };
  }
  return { from: null, to: now.toISOString().slice(0, 10) };
}

function computeLocalLeaderboard(queueRows, projectRows, {
  period = "week",
  nowMs = Date.now(),
  displayName = null,
  machineId = null,
  timeZoneContext = null,
} = {}) {
  const window = leaderboardWindow(period, nowMs);
  const inWindow = (row) => {
    const day = String(row?.hour_start || "").slice(0, 10);
    if (!day) return false;
    if (window.from && day < window.from) return false;
    return day <= window.to;
  };
  const rows = (Array.isArray(queueRows) ? queueRows : []).filter(inWindow);

  const providerTotals = Object.fromEntries(
    LEADERBOARD_PROVIDER_COLUMNS.map(([column]) => [column, 0]).concat([["other_tokens", 0]]),
  );
  const totals = {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    conversation_count: 0,
    estimated_cost_usd: 0,
  };
  const models = {};
  for (const row of rows) {
    const tokens = Number(row.total_tokens || 0);
    totals.total_tokens += tokens;
    totals.input_tokens += Number(row.input_tokens || 0);
    totals.output_tokens += Number(row.output_tokens || 0);
    totals.cached_input_tokens += Number(row.cached_input_tokens || 0);
    totals.conversation_count += Number(row.conversation_count || 0);
    totals.estimated_cost_usd += foldTraeRowCost(row, computeRowCost(row));
    providerTotals[leaderboardProviderColumn(row.source)] += tokens;
    if (row.model) models[row.model] = (models[row.model] || 0) + tokens;
  }

  const from = window.from || String(
    (Array.isArray(queueRows) ? queueRows : [])
      .map((row) => String(row?.hour_start || "").slice(0, 10))
      .filter(Boolean)
      .sort()[0] || window.to,
  );
  const generatedAt = new Date(nowMs).toISOString();
  const earned = computeLocalAchievements(queueRows, projectRows, { timeZoneContext })
    .filter((badge) => (badge.tier || 0) >= 1)
    .sort((a, b) => (b.tier || 0) - (a.tier || 0) || String(a.id).localeCompare(String(b.id)));
  const badges = earned.slice(0, 3).map((badge) => ({ id: badge.id, tier: badge.tier }));

  if (!rows.length || totals.total_tokens <= 0) {
    return {
      entries: [],
      me: null,
      total_entries: 0,
      total_pages: 0,
      page: 1,
      from,
      to: window.to,
      generated_at: generatedAt,
      source: "local",
    };
  }

  const entry = {
    rank: 1,
    user_id: null,
    display_name: displayName || "Local device",
    avatar_url: null,
    github_url: null,
    is_public: false,
    is_me: true,
    machine_id: machineId || null,
    ...totals,
    ...providerTotals,
    total_tokens: totals.total_tokens,
    estimated_cost_usd: totals.estimated_cost_usd,
    models,
    badges,
    badge_count: earned.length,
    generated_at: generatedAt,
  };
  return {
    entries: [entry],
    me: entry,
    total_entries: 1,
    total_pages: 1,
    page: 1,
    from,
    to: window.to,
    generated_at: generatedAt,
    source: "local",
  };
}

function getTimeZoneContext(url) {
  const tz = String(url.searchParams.get("tz") || "").trim();
  const rawOffset = Number(url.searchParams.get("tz_offset_minutes"));
  return {
    timeZone: tz || null,
    offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
  };
}

function getZonedParts(date, { timeZone, offsetMinutes } = {}) {
  const dt = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(dt.getTime())) return null;

  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      let formatter;
      if (zonedPartsFormatters.has(timeZone)) {
        formatter = zonedPartsFormatters.get(timeZone);
      } else {
        try {
          formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23",
          });
        } catch {
          // Cache invalid zone ids too; otherwise a bad local query would
          // throw once per queue row before falling back to its fixed offset.
          formatter = null;
        }
        boundedCacheSet(
          zonedPartsFormatters,
          timeZone,
          formatter,
          MAX_TIME_ZONE_CACHE_ENTRIES,
        );
      }
      const parts = formatter?.formatToParts(dt) || [];
      const values = parts.reduce((acc, part) => {
        if (part.type && part.value) acc[part.type] = part.value;
        return acc;
      }, {});
      const year = Number(values.year);
      const month = Number(values.month);
      const day = Number(values.day);
      const hour = Number(values.hour);
      const minute = Number(values.minute);
      const second = Number(values.second);
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return { year, month, day, hour, minute, second };
      }
    } catch (_e) {
      // fall through
    }
  }

  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(dt.getTime() + offsetMinutes * 60 * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
  }

  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    second: dt.getSeconds(),
  };
}

function formatPartsDayKey(parts) {
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

async function aggregateHourlyByDay(rows, dayKey, timeZoneContext) {
  const byHour = new Map();
  let processed = 0;
  for (const row of rows) {
    if (++processed % AGGREGATION_BATCH_ROWS === 0) await yieldToRequests();
    if (!row.hour_start) continue;
    const parts = getZonedParts(new Date(row.hour_start), timeZoneContext);
    if (!parts) continue;
    if (formatPartsDayKey(parts) !== dayKey) continue;
    const hourKey = `${dayKey}T${String(parts.hour).padStart(2, "0")}:00:00`;
    if (!byHour.has(hourKey)) {
      byHour.set(hourKey, {
        hour: hourKey,
        total_tokens: 0,
        billable_total_tokens: 0,
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const bucket = byHour.get(hourKey);
    bucket.total_tokens += row.total_tokens || 0;
    bucket.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    bucket.input_tokens += row.input_tokens || 0;
    bucket.output_tokens += row.output_tokens || 0;
    bucket.cached_input_tokens += row.cached_input_tokens || 0;
    bucket.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    bucket.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    bucket.conversation_count += row.conversation_count || 0;
    bucket.total_cost_usd = (bucket.total_cost_usd || 0) + foldTraeRowCost(row, computeRowCost(row));

    if (!bucket.models) {
      bucket.models = {};
    }
    const model = row.model || "unknown";
    bucket.models[model] = (bucket.models[model] || 0) + (row.total_tokens || 0);
  }
  return Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

// ---------------------------------------------------------------------------
// Sync helper
// ---------------------------------------------------------------------------

function trimOutput(value, max = 4000) {
  const t = String(value || "");
  return t.length <= max ? t : t.slice(t.length - max);
}

function normalizeRemoteHttpBaseUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch (_e) {
    return null;
  }
}

function resolveAllowedInsforgeBaseUrl(value, runtime = resolveRuntimeConfig()) {
  const requested = normalizeRemoteHttpBaseUrl(value);
  if (!requested) return null;

  return requested === normalizeRemoteHttpBaseUrl(runtime.baseUrl) ? requested : null;
}

function parseCookieHeader(value) {
  const out = new Map();
  if (typeof value !== "string" || !value.trim()) return out;
  for (const part of value.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (key) out.set(key, rawValue);
  }
  return out;
}

function parseHostPort(hostHeader) {
  if (typeof hostHeader !== "string") return "";
  const raw = hostHeader.trim().toLowerCase();
  if (!raw) return "";
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    return end === -1 ? "" : raw.slice(end + 1).replace(/^:/, "");
  }
  const at = raw.lastIndexOf(":");
  return at === -1 ? "" : raw.slice(at + 1);
}

function originPortOf(url) {
  return url.port || (url.protocol === "http:" ? "80" : "443");
}

function hasAllowedLoopbackOrigin(headers = {}) {
  const candidates = [headers.origin, headers.referer];
  // 审计 2026-10-25 S2：同机异端口的本地页面（如 :5173 的 dev server）同样是跨源
  // ——origin 的端口必须与 Host 头的端口一致（主机名的 loopback 白名单维持原判）。
  // 缺失 Origin 的非浏览器调用方（C# 壳、脚本）与缺失 Host 头的夹具不受影响。
  const hostPort = parseHostPort(headers.host);
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    try {
      const url = new URL(String(raw));
      if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) return false;
      if (hostPort && originPortOf(url) !== hostPort) return false;
    } catch (_e) {
      return false;
    }
  }
  return true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) return resolve({});
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function readBodyLimited(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      total += chunk.length;
      if (total > maxBytes) {
        failed = true;
        reject(new Error(`Request body exceeds ${Math.ceil(maxBytes / 1024 / 1024)} MB`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => { if (!failed) resolve(Buffer.concat(chunks)); });
    req.on("error", (error) => { if (!failed) reject(error); });
  });
}

function runSyncCommand(extraEnv = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    const args = opts.trackerDataDir
      ? ["-e", `require(${JSON.stringify(path.resolve(__dirname, "../commands/sync.js"))}).cmdSync(process.argv.slice(1), ${JSON.stringify({ trackerDataDir: opts.trackerDataDir, home: path.dirname(opts.trackerDataDir), ...(opts.syncContext || {}) })}).catch(e => { console.error(e.message); process.exitCode = 1; })`, "--"]
      : [TRACKER_BIN, "sync"];
    if (opts.auto === true) args.push("--auto");
    if (opts.background === true) args.push("--background");
    if (opts.publishAccount === true) args.push("--publish-account");
    if (opts.allLocalSources === true) args.push("--all-local-sources");
    if (opts.drain === true) args.push("--drain");
    if (opts.waitForLock === true) args.push("--wait-for-lock");
    if (opts.signal?.aborted) { reject(Object.assign(new Error("Account session changed"), { code: "auth_session_changed", status: 409 })); return; }
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env, ...extraEnv,
        ...(extraEnv.TOKENTRACKER_DEVICE_TOKEN ? {
          TOKENTRACKER_INSFORGE_BASE_URL: extraEnv.TOKENTRACKER_INSFORGE_BASE_URL,
          TOKENTRACKER_INSFORGE_ANON_KEY: extraEnv.TOKENTRACKER_INSFORGE_ANON_KEY || "",
        } : {}),
        TOKENTRACKER_LOCAL_SYNC_DEVICE_TOKEN: extraEnv.TOKENTRACKER_DEVICE_TOKEN || "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const cancel = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", cancel, { once: true });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      opts.signal?.removeEventListener("abort", cancel);
      fn(v);
    };
    let timedOut = false;
    const tid = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, SYNC_TIMEOUT_MS);
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (e) => {
      finish(reject, Object.assign(e, { stdout: trimOutput(stdout), stderr: trimOutput(stderr) }));
    });
    child.on("close", (code) => {
      if (timedOut) { finish(reject, Object.assign(new Error("Sync timed out"), { code: "SYNC_TIMEOUT", stdout: trimOutput(stdout), stderr: trimOutput(stderr) })); return; }
      if (opts.signal?.aborted) { finish(reject, Object.assign(new Error("Account session changed"), { code: "auth_session_changed", status: 409 })); return; }
      const r = { code: code ?? 1, stdout: trimOutput(stdout), stderr: trimOutput(stderr) };
      if (code === 0) {
        finish(resolve, r);
        return;
      }
      const error = Object.assign(
        new Error(r.stderr || r.stdout || `exit ${r.code}`),
        r,
      );
      if (/\bSYNC_BUSY\b/.test(`${r.stderr}\n${r.stdout}`)) {
        error.code = "SYNC_BUSY";
      }
      finish(reject, error);
    });
  });
}

// ---------------------------------------------------------------------------
// Project detection helpers
// ---------------------------------------------------------------------------

function parseGitUrl(url) {
  if (!url) return null;
  const ssh = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const http = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (http) return { owner: http[1], repo: http[2] };
  return null;
}

function extractProjectFromCwd(cwd) {
  const home = os.homedir();
  if (!cwd || cwd === home) return null;
  const rel = cwd.replace(home + "/", "");
  const parts = rel.split("/").filter((p) => p && !p.startsWith(".") && p !== "ext-global");
  return parts.length > 0 ? parts[0] : null;
}

function scanCodexProjects(projectMap) {
  const dir = path.join(os.homedir(), ".codex", "sessions");
  try {
    for (const year of fs.readdirSync(dir)) {
      const yp = path.join(dir, year);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const month of fs.readdirSync(yp)) {
        const mp = path.join(yp, month);
        if (!fs.statSync(mp).isDirectory()) continue;
        for (const day of fs.readdirSync(mp)) {
          const dp = path.join(mp, day);
          if (!fs.statSync(dp).isDirectory()) continue;
          const files = fs.readdirSync(dp).filter((f) => f.endsWith(".jsonl"));
          for (const file of files.slice(0, 200)) {
            try {
              const first = fs.readFileSync(path.join(dp, file), "utf8").split("\n")[0];
              const d = JSON.parse(first);
              if (d.git?.repository_url) {
                const p = parseGitUrl(d.git.repository_url);
                if (p) {
                  const key = `${p.owner}/${p.repo}`;
                  if (!projectMap.has(key))
                    projectMap.set(key, {
                      project_key: key,
                      project_ref: d.git.repository_url,
                      count: 0,
                    });
                  projectMap.get(key).count++;
                }
              }
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}
}

function findSubagentsDirs(dir, depth) {
  const out = [];
  if (depth > 3) return out;
  try {
    for (const item of fs.readdirSync(dir)) {
      const fp = path.join(dir, item);
      if (!fs.statSync(fp).isDirectory()) continue;
      if (item === "subagents") out.push(fp);
      else out.push(...findSubagentsDirs(fp, depth + 1));
    }
  } catch (_e) {}
  return out;
}

function scanClaudeProjects(projectMap) {
  const dir = path.join(os.homedir(), ".claude", "projects");
  try {
    for (const subDir of findSubagentsDirs(dir, 0)) {
      const files = fs.readdirSync(subDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files.slice(0, 100)) {
        try {
          const first = fs.readFileSync(path.join(subDir, file), "utf8").split("\n")[0];
          if (!first) continue;
          const d = JSON.parse(first);
          const name = extractProjectFromCwd(d.cwd);
          if (name) {
            if (!projectMap.has(name))
              projectMap.set(name, {
                project_key: name,
                project_ref: `file://${d.cwd}`,
                count: 0,
              });
            projectMap.get(name).count++;
          }
        } catch (_e) {}
      }
    }
  } catch (_e) {}
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function json(res, data, status) {
  // Usage and cost payloads change on every sync, and cost is re-priced on
  // every read (pricing is applied per request, never stored in the queue) —
  // so a cached response can pin stale costs on screen indefinitely. WebView2
  // caches responses that carry no freshness directive, and the dashboard's
  // local fetch path omits `cache: "no-store"` (only the cloud path sets it).
  // Endpoints that care already set this header by hand; do it once here so
  // every JSON response is covered.

  res.writeHead(status || 200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// IP check API proxy: dashboard/src/pages/IpCheckPage.jsx is a native React
// page that calls ip.net.coffee's data endpoints (/api/iprisk, /api/geoip,
// /api/dns/result, /favicons, /claude/status.json). Browser-side fetch can't
// hit them cross-origin from the dashboard, so we reverse-proxy /proxy/ipcheck/*
// to https://ip.net.coffee/* and strip embedding-hostile headers.
// (Previously this proxy also served the upstream HTML page for an iframe;
// the iframe and its HTML-rewrite path have been removed.)
// ---------------------------------------------------------------------------

const IP_CHECK_PROXY_PREFIX = "/proxy/ipcheck";
const IP_CHECK_TARGET = "https://ip.net.coffee";

// HTTP hop-by-hop headers (RFC 7230 §6.1) plus headers undici/fetch manages
// internally. Forwarding any of these to `fetch(...)` either silently breaks
// the request (host being wrong) or, on stricter undici versions like the
// 6.24.1 shipped with Node 22.22.2, throws UND_ERR_INVALID_ARG and turns
// every proxied POST into a 502. Keep this set authoritative for every
// reverse-proxy site in this module.
const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "proxy-connection",
  "te",
  "trailer",
  "trailers",
]);

// Strip forbidden + hop-by-hop headers when forwarding an inbound request to
// fetch(). Honours the Connection header's named-headers list (RFC 7230 §6.1)
// so values like `Connection: keep-alive, x-custom` also drop x-custom.
function buildProxyHeaders(headers) {
  const entries =
    headers && typeof headers.entries === "function"
      ? Array.from(headers.entries())
      : Object.entries(headers || {});

  const connectionNamed = new Set();
  const normalized = [];
  for (const [rawKey, rawValue] of entries) {
    if (rawValue == null) continue;
    const key = String(rawKey).toLowerCase();
    normalized.push([key, rawValue]);
    if (key === "connection") {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const v of values) {
        String(v)
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
          .forEach((part) => connectionNamed.add(part));
      }
    }
  }

  const out = {};
  for (const [key, rawValue] of normalized) {
    if (HOP_BY_HOP_HEADERS.has(key) || connectionNamed.has(key)) continue;
    if (Array.isArray(rawValue)) {
      const joined = rawValue.filter((e) => e != null).map(String).join(", ");
      if (joined) out[key] = joined;
      continue;
    }
    out[key] = String(rawValue);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

function createLocalApiHandler({ queuePath, serverVersion = null, trackerDataDir: isolatedTrackerDataDir = null, syncContext = null }) {
  const defaultQueuePath = resolveQueuePath();
  const qp = queuePath || defaultQueuePath;
  // Isolated tests and custom queue paths must not pick up the real JoyCode
  // workspace (that turned a 120-token fixture into 681,980 tokens).
  const includeJoycodeRows = !isolatedTrackerDataDir && qp === defaultQueuePath;
  const scopedRowsForUrl = (url) => scopedQueueRows(qp, url, { includeJoycode: includeJoycodeRows });

  // Session views need the same Qoder credit estimates the usage cards use.
  // The session scanner itself only sees zero-usage transcripts; allocate the
  // queue's Qoder pool at render time so both views tell one story.
  async function loadSessionQueueRows() {
    try {
      const { allRows } = await scopedRowsForUrl(new URL("http://127.0.0.1/"));
      return allRows;
    } catch {
      return [];
    }
  }

  let _achievementsCache = null;
  const ACHIEVEMENTS_CACHE_TTL_MS = 15000;
  let _sessionsCache = null;
  const SESSIONS_CACHE_TTL_MS = 30000;
  // 会话浏览的磁盘二级缓存：buildSessionAnalytics 冷侧最坏 ~60s（1413 会话实测），
  // 热侧 ~3.3s，但 L1 只活 30s——每次进页面都可能白等。L2 落盘后任何缓存未命中
  // 都先秒回上一次的完整集合（标 stale），后台重建完成后 L1/L2 一起翻新。
  let _sessionsRebuildPromise = null;
  const sessionsDiskCachePath = () => path.join(trackerDataDir, "sessions-browser-cache.json");
  let sessionsDiskCache;
  const getSessionsDiskCache = () => sessionsDiskCache ||= require("./sessions-disk-cache").createSessionsDiskCache(sessionsDiskCachePath());
  const persistSessionsDiskCache = (sessions) => {
    void getSessionsDiskCache().save(sessions).catch(() => {
      console.warn("[local-api] sessions disk cache write failed");
    });
  };
  const normalizedServerVersion = typeof serverVersion === "string" ? serverVersion.trim() : "";

  // Server-side cookie relay: captures auth cookies from InsForge cloud responses
  // so that both browser and WKWebView share the same login session via the proxy.
  // Persisted to disk so cookies survive server restarts.
  const csrfRelayCookieName = "insforge_csrf_token";
  let relayCookies = new Map();
  const localAuthToken = crypto.randomBytes(24).toString("hex");
  const trackerDataDir = isolatedTrackerDataDir || path.dirname(qp);
  const cookiePath = path.join(trackerDataDir, "relay-cookies.json");
  const localSyncDeviceTokenStore = createCloudDeviceTokenStore(path.join(trackerDataDir, "cloud-device-token.json"));
  const localSyncDeviceTokenCache = new Map();
  const localSyncDeviceTokenInflight = new Map();
  let localSyncDeviceTokenUserId = "";
  let localCloudSession = null;
  let localCloudGeneration = 0;
  const activeCloudSyncs = new Set();
  const localSyncDeviceMetadata = new Map();
  function invalidateLocalCloudSession() {
    localCloudGeneration += 1;
    localCloudSession = null;
    for (const controller of activeCloudSyncs) controller.abort();
  }
  function clearLocalSyncDeviceTokenCache() {
    invalidateLocalCloudSession();
    localSyncDeviceMetadata.clear();
    localSyncDeviceTokenCache.clear();
    localSyncDeviceTokenInflight.clear();
    localSyncDeviceTokenStore.clear();
    localSyncDeviceTokenUserId = "";
  }
  function invalidateLocalSyncDeviceToken(token) {
    if (!token) return;
    for (const [key, value] of localSyncDeviceTokenCache) {
      if (value === token) localSyncDeviceTokenCache.delete(key);
    }
    localSyncDeviceTokenStore.invalidate(token);
  }
  function currentCloudUploadFailure(syncStartedAt, { backoff = false, deviceToken, attemptId } = {}) {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(path.dirname(qp), "upload.throttle.json"), "utf8"));
      if (attemptId && state.lastErrorAttemptId === attemptId &&
          Date.parse(state.lastErrorAt || "") >= syncStartedAt && Number(state.lastErrorStatus) > 0) {
        if (state.lastErrorCode === "CLOUD_DEVICE_TOKEN_REJECTED") invalidateLocalSyncDeviceToken(deviceToken);
        return { code: state.lastErrorCode || "CLOUD_UPLOAD_FAILED", status: Number(state.lastErrorStatus), retryAfterMs: Math.max(0, Math.max(Number(state.backoffUntilMs || 0), Number(state.nextAllowedAtMs || 0)) - Date.now()), nextAllowedAt: state.nextAllowedAtMs ? new Date(state.nextAllowedAtMs).toISOString() : null };
      }
      if (backoff && Math.max(Number(state.backoffUntilMs || 0), Number(state.nextAllowedAtMs || 0)) > syncStartedAt) {
        return { code: "SYNC_UPLOAD_BACKOFF", status: 429, retryAfterMs: Math.max(0, Math.max(Number(state.backoffUntilMs || 0), Number(state.nextAllowedAtMs || 0)) - Date.now()), nextAllowedAt: state.nextAllowedAtMs ? new Date(state.nextAllowedAtMs).toISOString() : null };
      }
    } catch { /* no upload failure was recorded */ }
    return null;
  }
  // A dashboard refresh fans out to several account-view endpoints. Keep the
  // circuit-breaker state per session instead of one global slot (a successful
  // request for one account must not clear another account's failure), and
  // suppress the duplicate fan-out while the first cloud probe is pending.
  const accountViewFailures = new Map();
  const accountViewInFlight = new Map();
  let accountUploadState = readAccountUploadState();
  const runtimeConfigPath = path.join(path.dirname(qp), "config.json");
  const instancePath = path.join(trackerDataDir, "runtime-instance.json");
  const issuedAccessTokenInstances = new Map();
  let instanceFingerprint = "";
  try { instanceFingerprint = JSON.parse(fs.readFileSync(instancePath, "utf8")).fingerprint || ""; } catch { /* first start */ }

  function fingerprintFor(runtime) {
    return crypto.createHash("sha256").update(`${runtime.baseUrl}\0${runtime.anonKey || ""}`).digest("hex");
  }

  function getRuntime() {
    let config = {};
    let invalid = false;
    try { config = JSON.parse(fs.readFileSync(runtimeConfigPath, "utf8")); }
    catch (error) { invalid = error.code !== "ENOENT"; }
    if (!config || typeof config !== "object" || Array.isArray(config)) { config = {}; invalid = true; }
    const runtime = resolveRuntimeConfig({ config: config || {}, env: process.env });
    if (invalid) runtime.configurationError = "invalid_local_config";
    if (runtime.configurationError || (!fs.existsSync(runtimeConfigPath) && !fs.existsSync(qp))) return runtime;
    const fingerprint = fingerprintFor(runtime);
    if (fingerprint !== instanceFingerprint) {
      // Local-first: clear relayed state only when a previously known instance
      // (persisted in runtime-instance.json or seen earlier in this process)
      // no longer matches. There is no bundled default instance anymore, so a
      // true first start must adopt the fingerprint WITHOUT wiping cookies —
      // the old `baseUrl !== DEFAULT_BASE_URL` arm would sign out every
      // explicitly configured instance on each fresh start.
      if (instanceFingerprint) {
        clearRelayCookies("backend instance changed");
        _nativeAuthPending = false; _nativeAuthExpiry = 0;
        resetInstanceState(path.dirname(qp));
        if (trackerDataDir !== path.dirname(qp)) resetInstanceState(trackerDataDir);
        accountViewFailures.clear(); accountViewInFlight.clear();
        if (["deviceToken", "deviceId", "user_id"].some(key => config?.[key]) &&
            normalizeInstanceBaseUrl(config.deviceTokenBaseUrl) !== runtime.baseUrl) {
          config = clearDeviceIdentity(config);
          writeJsonAtomicSync(runtimeConfigPath, config);
          runtime.deviceToken = null;
        }
      }
      fs.mkdirSync(trackerDataDir, { recursive: true });
      fs.writeFileSync(instancePath, JSON.stringify({ fingerprint }), { mode: 0o600 });
      instanceFingerprint = fingerprint;
    }
    return runtime;
  }

  function readAccountUploadState() {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(path.dirname(qp), "queue.state.json"), "utf8"));
      return JSON.stringify([Number(state.offset) || 0, state.updatedAt || ""]);
    } catch {
      return "";
    }
  }

  function invalidateAfterAccountUpload() {
    const state = readAccountUploadState();
    if (state !== accountUploadState) {
      accountUploadState = state;
      invalidateCloudAccountPayloadCache();
    }
  }

  function accountViewFailureUntil(failureKey) {
    const until = accountViewFailures.get(failureKey) || 0;
    if (until > Date.now()) return until;
    if (until) accountViewFailures.delete(failureKey);
    return 0;
  }

  function rememberAccountViewFailure(failureKey) {
    accountViewFailures.set(failureKey, Date.now() + ACCOUNT_VIEW_FAILURE_BACKOFF_MS);
    // Refresh-token rotation or account switching can produce many keys over a
    // long-lived tray session. Bound the map without affecting the active key.
    while (accountViewFailures.size > 16) {
      const oldest = accountViewFailures.keys().next().value;
      if (!oldest || oldest === failureKey) break;
      accountViewFailures.delete(oldest);
    }
  }

  // Load persisted cookies on startup
  try {
    if (!fs.existsSync(trackerDataDir)) fs.mkdirSync(trackerDataDir, { recursive: true });
    if (fs.existsSync(cookiePath)) {
      const content = fs.readFileSync(cookiePath, "utf8");
      const saved = JSON.parse(content);
      if (saved && typeof saved === "object") {
        let count = 0;
        for (const [k, v] of Object.entries(saved)) {
          relayCookies.set(k, v);
          count++;
        }
        if (count > 0) console.log(`[LocalAPI] Loaded ${count} relay cookies from ${cookiePath}`);
      }
    }
  } catch (e) {
    console.error("[LocalAPI] Failed to load relay cookies:", e.message);
  }

  function persistRelayCookies() {
    try {
      // Sticky semantics: never replace an existing on-disk session with an empty cookie map.
      if (relayCookies.size === 0) return;

      const json = JSON.stringify(Object.fromEntries(relayCookies));
      fs.writeFileSync(cookiePath, json, { encoding: "utf8", mode: 0o600 });
    } catch (e) {
      console.error("[LocalAPI] Failed to persist relay cookies:", e.message);
    }
  }

  function clearRelayCookies(reason) {
    clearLocalSyncDeviceTokenCache();
    invalidateCloudAccountPayloadCache({ sessionChanged: true });
    if (relayCookies.size === 0) return;
    relayCookies.clear();
    try {
      if (fs.existsSync(cookiePath)) fs.unlinkSync(cookiePath);
    } catch (e) {
      console.error("[LocalAPI] Failed to clear relay cookies:", e.message);
      return;
    }
    if (reason) console.warn(`[LocalAPI] Cleared relay cookies: ${reason}`);
  }

  function captureSetCookies(headerValue) {
    if (!headerValue) return;
    const parts = headerValue.split(/,(?=\s*\w+=)/);
    let changed = false;
    for (const raw of parts) {
      const eqIdx = raw.indexOf("=");
      if (eqIdx < 1) continue;
      const name = raw.substring(0, eqIdx).trim();
      if (!name) continue;

      // Basic sticky logic: if it's a deletion cookie (Max-Age=0 or past date),
      // we only remove it if we have it.
      const lower = raw.toLowerCase();
      const isDeletion = lower.includes("max-age=0") || lower.includes("expires=thu, 01 jan 1970");
      
      if (isDeletion) {
        if (relayCookies.has(name)) {
          if (name === "insforge_refresh_token") invalidateCloudAccountPayloadCache({ sessionChanged: true });
          relayCookies.delete(name);
          changed = true;
          console.log(`[LocalAPI] Cookie deleted: ${name}`);
        }
      } else {
        const oldVal = relayCookies.get(name);
        if (oldVal !== raw.trim()) {
          if (name === "insforge_refresh_token") invalidateCloudAccountPayloadCache({ sessionChanged: true });
          relayCookies.set(name, raw.trim());
          changed = true;
          console.log(`[LocalAPI] Cookie captured: ${name}`);
        }
      }
    }
    if (changed) persistRelayCookies();
  }

  function getRelayCookieValue(name, { decode = false } = {}) {
    const raw = relayCookies.get(name);
    if (!raw || typeof raw !== "string") return "";
    const pair = raw.split(";")[0] || "";
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 1) return "";
    const value = pair.substring(eqIdx + 1).trim();
    if (!decode) return value;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  function captureAuthTokensFromBody(bodyBuffer, contentType, { newLogin = false, sourceFingerprint } = {}) {
    if (!bodyBuffer || !String(contentType || "").toLowerCase().includes("application/json")) return;
    let parsed = null;
    try {
      parsed = JSON.parse(bodyBuffer.toString("utf8"));
    } catch {
      return;
    }
    if (sourceFingerprint && typeof parsed?.accessToken === "string" && parsed.accessToken.length <= 8192) {
      const hash = crypto.createHash("sha256").update(parsed.accessToken).digest("hex");
      if (!issuedAccessTokenInstances.has(hash)) issuedAccessTokenInstances.set(hash, sourceFingerprint);
      while (issuedAccessTokenInstances.size > 64) issuedAccessTokenInstances.delete(issuedAccessTokenInstances.keys().next().value);
    }
    let changed = false;
    const token = typeof parsed?.csrfToken === "string" ? parsed.csrfToken.trim() : "";
    if (token) {
      const cookie = `${csrfRelayCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
      if (relayCookies.get(csrfRelayCookieName) !== cookie) {
        relayCookies.set(csrfRelayCookieName, cookie);
        changed = true;
      }
    }
    const refreshToken = typeof parsed?.refreshToken === "string" ? parsed.refreshToken.trim() : "";
    if (refreshToken) {
      if (newLogin) clearLocalSyncDeviceTokenCache();
      const cookie = `insforge_refresh_token=${encodeURIComponent(refreshToken)}; Path=/; HttpOnly; SameSite=Lax`;
      if (relayCookies.get("insforge_refresh_token") !== cookie) {
        invalidateCloudAccountPayloadCache({ sessionChanged: true });
        relayCookies.set("insforge_refresh_token", cookie);
        changed = true;
      }
    }
    if (changed) persistRelayCookies();
  }

  // --- Account (cross-device) view for the native popover ---------------
  // The popover follows the dashboard: it shows aggregated cross-device data
  // only when the user is signed in (a relayed refresh token exists) AND cloud
  // sync is on. Cloud sync is a dashboard (WebView) preference persisted in
  // localStorage; the dashboard mirrors it here via POST
  // /functions/tokentracker-cloud-sync-pref so the auth-unaware popover can key
  // off the same flag. Defaults OFF, exactly like the dashboard toggle;
  // existing saved choices are preserved.
  const cloudSyncPrefPath = path.join(trackerDataDir, "cloud-sync-pref.json");
  let cloudSyncPrefCache;
  let cloudSyncPrefGeneration = 0;
  function getCloudSyncPref() {
    if (cloudSyncPrefCache === undefined) {
      cloudSyncPrefCache = require("./cloud-sync-prefs").readCloudSyncEnabled(trackerDataDir);
    }
    return cloudSyncPrefCache;
  }
  function setCloudSyncPref(enabled, changedAtMs = Date.now()) {
    // Multiple dashboard windows can deliver mirrors out of order. Keep the
    // newest saved choice; old files without an ordering marker remain valid.
    try {
      const saved = JSON.parse(fs.readFileSync(cloudSyncPrefPath, "utf8"));
      if (Number(saved?.changedAtMs || 0) > changedAtMs ||
          (changedAtMs > 0 && saved?.changedAtMs === changedAtMs && saved?.enabled === false && enabled)) return;
    } catch { /* first choice or an unreadable preference */ }
    if (getCloudSyncPref() !== Boolean(enabled)) {
      cloudSyncPrefGeneration += 1;
      clearLocalSyncDeviceTokenCache();
      invalidateCloudAccountPayloadCache();
    }
    cloudSyncPrefCache = Boolean(enabled);
    try {
      if (!fs.existsSync(trackerDataDir)) fs.mkdirSync(trackerDataDir, { recursive: true });
      fs.writeFileSync(
        cloudSyncPrefPath,
        JSON.stringify({ enabled: cloudSyncPrefCache, changedAtMs, updatedAt: new Date().toISOString() }),
        { encoding: "utf8", mode: 0o600 },
      );
    } catch (e) {
      console.error("[LocalAPI] Failed to persist cloud sync pref:", e.message);
    }
  }

  function getRefreshTokenForCloud() {
    return getRelayCookieValue("insforge_refresh_token", { decode: true });
  }
  function setRelayRefreshToken(token) {
    if (!token || typeof token !== "string") return;
    const cookie = `insforge_refresh_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`;
    if (relayCookies.get("insforge_refresh_token") !== cookie) {
      relayCookies.set("insforge_refresh_token", cookie);
      persistRelayCookies();
    }
  }
  function setRelayCsrfToken(token) {
    if (!token || typeof token !== "string") return;
    const cookie = `${csrfRelayCookieName}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
    if (relayCookies.get(csrfRelayCookieName) !== cookie) {
      relayCookies.set(csrfRelayCookieName, cookie);
      persistRelayCookies();
    }
  }

  function localSyncDeviceTokenCacheKey(userId, machineId, baseUrl) {
    return `${baseUrl}\0${userId}\0${machineId}`;
  }

  async function issueDeviceTokenForLocalSync(queuePathForMachineId, options = {}) {
    if (!getCloudSyncPref()) return null;
    const refreshToken = getRefreshTokenForCloud();
    if (!options.accessToken && !refreshToken) return null;
    const machineId = getOrCreateMachineId(queuePathForMachineId);
    if (!machineId) return null;
    const runtime = assertInsforgeRuntime(getRuntime());
    const baseUrl = normalizeRemoteHttpBaseUrl(options.baseUrl) ||
      normalizeRemoteHttpBaseUrl(runtime.baseUrl);
    const sessionAtStart = getCloudAccountSessionGeneration();
    const cloudPrefAtStart = cloudSyncPrefGeneration;
    const generationAtStart = localCloudGeneration;
    const minted = options.accessToken ? { accessToken: options.accessToken } : await mintAccessToken({
      baseUrl, anonKey: runtime.anonKey, refreshToken, timeoutMs: runtime.httpTimeoutMs, throwOnFailure: true,
    }).catch((error) => {
      if (error.status === 401 && sessionAtStart === getCloudAccountSessionGeneration()) clearLocalSyncDeviceTokenCache();
      throw error;
    });
    if (!minted?.accessToken || sessionAtStart !== getCloudAccountSessionGeneration()) return null;
    const rotatedRefreshToken =
      typeof minted.refreshToken === "string" && minted.refreshToken.trim()
        ? minted.refreshToken.trim()
        : "";
    if (rotatedRefreshToken) setRelayRefreshToken(rotatedRefreshToken);
    if (minted.csrfToken) setRelayCsrfToken(minted.csrfToken);
    if (!getCloudSyncPref() || cloudPrefAtStart !== cloudSyncPrefGeneration) return null;
    // Refresh validates native ownership. A browser JWT must additionally pass
    // token issuance upstream before the mirror receives an upload binding.
    let userId = "";
    try {
      const payload = JSON.parse(Buffer.from(minted.accessToken.split(".")[1], "base64url").toString("utf8"));
      userId = typeof payload.sub === "string" ? payload.sub : "";
    } catch { /* legacy opaque access tokens retain their isolated refresh key */ }
    if (options.expectedOwnerId && userId !== options.expectedOwnerId) {
      throw Object.assign(new Error("Account owner mismatch"), { status: 409, code: "auth_owner_mismatch" });
    }
    if (userId && localSyncDeviceTokenUserId && userId !== localSyncDeviceTokenUserId) {
      clearLocalSyncDeviceTokenCache();
    }
    if (userId) localSyncDeviceTokenUserId = userId;
    const identity = userId || `refresh:${rotatedRefreshToken || refreshToken}`;
    const cacheKey = localSyncDeviceTokenCacheKey(identity, machineId, baseUrl);
    const binding = { userId, baseUrl, machineId };
    const cachedToken = !options.accessToken && (localSyncDeviceTokenCache.get(cacheKey) ||
      (userId ? localSyncDeviceTokenStore.get(binding) : null));
    if (cachedToken) {
      localSyncDeviceTokenCache.set(cacheKey, cachedToken);
      if (userId) localSyncDeviceTokenStore.set(binding, cachedToken);
      return options.returnSession ? localSyncDeviceMetadata.get(cachedToken) || null : cachedToken;
    }
    const inflightToken = localSyncDeviceTokenInflight.get(cacheKey);
    if (inflightToken?.sessionGeneration === sessionAtStart && inflightToken.generation === generationAtStart) {
      const token = await inflightToken.promise;
      return options.returnSession ? localSyncDeviceMetadata.get(token) || null : token;
    }

    const issuePromise = (async () => {
      const root = String(baseUrl || "").replace(/\/$/, "");
      if (!root) {
        throw Object.assign(new Error("no InsForge instance configured"), { code: "cloud_not_configured" });
      }
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${minted.accessToken}`,
      };
      if (runtime.anonKey) headers.apikey = runtime.anonKey;

      let timeoutId;
      const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
      if (controller && runtime.httpTimeoutMs > 0) {
        timeoutId = setTimeout(() => controller.abort(), runtime.httpTimeoutMs);
      }

      const dashboardPlatform =
        process.platform === "darwin" ? "MacIntel" :
          process.platform === "win32" ? "Win32" :
            process.platform === "linux" ? "Linux x86_64" :
              "web";

      const res = await fetchFunctionResponse(functionUrlFor(root, "tokentracker-device-token-issue"), {
        method: "POST",
        headers,
        signal: controller ? controller.signal : undefined,
        body: JSON.stringify({
          // 必须和 dashboard/src/lib/cloud-sync.ts 使用同一个设备身份。
          // 旧云端设备按 (platform, device_name) 认领；如果这里发明
          // local-sync 身份，会多出一个 active device，账户视图会把历史求和两次。
          device_name: getSystemDeviceName() || `Token Tracker (dashboard) #${machineId.slice(0, 8)}`,
          platform: dashboardPlatform,
          machine_id: machineId,
        }),
      }).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
      });
      getRuntime();
      if (sessionAtStart !== getCloudAccountSessionGeneration() || !getCloudSyncPref() || cloudPrefAtStart !== cloudSyncPrefGeneration || generationAtStart !== localCloudGeneration) return null;
      if (!res.ok) {
        if (res.status === 401 && sessionAtStart === getCloudAccountSessionGeneration()) {
          localSyncDeviceTokenCache.delete(cacheKey);
          localSyncDeviceTokenStore.clear(binding);
        }
        const denied = await res.json().catch(() => ({}));
        if (typeof denied?.code === "string" && denied.code.startsWith("cloud_")) {
          throw Object.assign(new Error(denied.code), { code: denied.code, status: res.status,
            recoveryUrl: denied.recovery_url });
        }
        return null;
      }
      const data = await res.json().catch(() => null);
      const token = typeof data?.token === "string" ? data.token.trim() : "";
      if (sessionAtStart !== getCloudAccountSessionGeneration() || !getCloudSyncPref() || cloudPrefAtStart !== cloudSyncPrefGeneration || generationAtStart !== localCloudGeneration) return null;
      if (token) {
        localSyncDeviceMetadata.set(token, { token, deviceId: data.device_id, issuedAt: data.created_at || new Date().toISOString() });
        localSyncDeviceTokenCache.set(cacheKey, token);
        if (userId) localSyncDeviceTokenStore.set(binding, token);
      }
      return token || null;
    })();
    localSyncDeviceTokenInflight.set(cacheKey, { promise: issuePromise, sessionGeneration: sessionAtStart, generation: generationAtStart });
    try {
      const token = await issuePromise;
      return options.returnSession ? localSyncDeviceMetadata.get(token) || null : token;
    } finally {
      if (localSyncDeviceTokenInflight.get(cacheKey)?.promise === issuePromise) localSyncDeviceTokenInflight.delete(cacheKey);
    }
  }

  // Why a *classified* fallback: the native popover keeps the last successful
  // account (cross-device) snapshot on screen when a cloud read fails
  // transiently, but must switch to this-machine data the moment the user signs
  // out or turns cloud sync off. Both used to look identical from the outside
  // (HTTP 200 + local payload + `X-TokenTracker-Account-View: 0`), so a single
  // timed-out read silently shrank Activity to one device until the next
  // manual sync. See ACCOUNT_FALLBACK_* below for the vocabulary.
  const ACCOUNT_FALLBACK_CLOUD_SYNC_OFF = "cloud-sync-off";
  const ACCOUNT_FALLBACK_SIGNED_OUT = "signed-out";

  // Every transient reason is prefixed "transient-"; clients only need the
  // prefix, so new reasons can be added without a client change.
  function classifyAccountFallback(err) {
    if (!err) return "transient-error";
    if (err.name === "AbortError" || err.name === "TimeoutError" || err.code === "auth_timeout") {
      return "transient-timeout";
    }
    if (typeof err.code === "string" && err.code.startsWith("cloud_")) return err.code.replaceAll("_", "-");
    if (err.code === "auth_rejected" || err.code === "auth_invalid" || err.status === 401 || err.status === 403) {
      return "transient-auth";
    }
    if (err.code === "auth_network") return "transient-network";
    if (Number.isFinite(err.status) && err.status > 0) return "transient-upstream";
    return "transient-network";
  }

  // Returns "served" when the cross-device aggregate was written to `res`,
  // otherwise a fallback reason (see above) telling the caller — and, through
  // the `X-TokenTracker-Account-Fallback` header, the popover — why the local
  // single-machine data is being served instead.
  async function tryServeAccountView(usageSlug, url, res) {
    if (!getCloudSyncPref()) return ACCOUNT_FALLBACK_CLOUD_SYNC_OFF;
    const refreshToken = getRefreshTokenForCloud();
    if (!refreshToken) return ACCOUNT_FALLBACK_SIGNED_OUT;
    invalidateAfterAccountUpload();
    const runtime = getRuntime();
    if (runtime.configurationError) return ACCOUNT_FALLBACK_SIGNED_OUT;
    const failureKey = `${runtime.baseUrl}\0${refreshToken}`;
    const sessionAtStart = getCloudAccountSessionGeneration();
    const cloudPrefAtStart = cloudSyncPrefGeneration;
    const params = new URLSearchParams(url.searchParams);
    params.sort();
    const requestKey = `${failureKey}\0${sessionAtStart}\0${cloudPrefAtStart}\0${accountUploadState}\0${usageSlug}\0${params}`;
    if (url.searchParams.get("refresh") !== "1" && accountViewFailureUntil(failureKey) > Date.now()) {
      return "transient-backoff";
    }
    const envTimeout = process.env.TOKENTRACKER_HTTP_TIMEOUT_MS
      ? parseInt(process.env.TOKENTRACKER_HTTP_TIMEOUT_MS, 10)
      : 0;
    const timeoutMs = envTimeout > 0 ? envTimeout : 4000;
    try {
      // An identical overlapping read shares the entire probe, including its
      // token mint. A healthy pending read must not look like a cloud outage
      // and trigger the native client's account recovery loop.
      let pending = accountViewInFlight.get(requestKey);
      if (!pending) {
        pending = fetchAccountUsage({
          usageSlug,
          searchParams: url.searchParams,
          baseUrl: runtime.baseUrl,
          anonKey: runtime.anonKey,
          refreshToken,
          timeoutMs,
          onSessionRefreshed: (session) => {
            getRuntime();
            if (sessionAtStart !== getCloudAccountSessionGeneration()) {
              throw Object.assign(new Error("Account session changed"), { code: "auth_session_changed" });
            }
            if (session.refreshToken) setRelayRefreshToken(session.refreshToken);
            if (session.csrfToken) setRelayCsrfToken(session.csrfToken);
          },
        });
        accountViewInFlight.set(requestKey, pending);
        const cleanup = () => {
          if (accountViewInFlight.get(requestKey) === pending) accountViewInFlight.delete(requestKey);
        };
        pending.then(cleanup, cleanup);
      }
      const out = await pending;
      getRuntime();
      // `null` here means the slug has no cloud equivalent, or the session
      // vanished mid-request — a routing/session fact, not an outage.
      if (!out) return ACCOUNT_FALLBACK_SIGNED_OUT;
      if (sessionAtStart !== getCloudAccountSessionGeneration()) {
        throw Object.assign(new Error("Account session changed"), { code: "auth_session_changed" });
      }
      if (out.data == null) {
        rememberAccountViewFailure(failureKey);
        return "transient-upstream";
      }
      if (!getCloudSyncPref()) return ACCOUNT_FALLBACK_CLOUD_SYNC_OFF;
      if (cloudPrefAtStart !== cloudSyncPrefGeneration) {
        json(res, { error: "Cloud sync preference changed", code: "CLOUD_SYNC_CHANGED" }, 409);
        return "served";
      }
      accountViewFailures.delete(failureKey);
      // Read the local queue once for both merges below; neither mutates the rows.
      const accountQueueRows = await readQueueData(qp);
      // The cloud aggregate can never know about Qoder CN — that client stopped
      // writing token counts to disk, so nothing of it is synced. Fold the
      // local estimate into the response on its way out; nothing is uploaded.
      applyAccountViewQoderMerge(usageSlug, out.data, {
        queueRows: accountQueueRows,
        searchParams: url.searchParams,
        offsetMinutes: Number(url.searchParams.get("tz_offset_minutes")) || 480,
      });
      // Same argument for the other Qoder edition: the cloud aggregate can only
      // ever hold Qoder rows with zero cost, so the credit spend has to be added
      // here or the cross-device view shows no international card at all.
applyAccountViewQoderIntlMerge(usageSlug, out.data, {
        queueRows: accountQueueRows,
        projectsDir: resolveQoderProjectsDir({ home: os.homedir(), env: process.env }),
        searchParams: url.searchParams,
        offsetMinutes: Number(url.searchParams.get("tz_offset_minutes")) || 480,
      });
      // The cloud priced every row with whatever table it held at upload time
      // and returns those figures untouched, so a model this machine can price
      // arrives as zero money. Reprice per-model rows here, with the local
      // table, so the cross-device view shows the same money the local view does.
      // Provider-reported spend is skipped inside the helper.
      repriceAccountModelCosts(usageSlug, out.data);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-TokenTracker-Account-View": "1",
      });
      res.end(JSON.stringify(out.data));
      return "served";
    } catch (e) {
      const currentSession = getCloudAccountSessionGeneration();
      if (e.code === "auth_session_changed" ||
          (sessionAtStart !== currentSession && e.invalidatedSessionGeneration !== currentSession)) {
        json(res, { error: "Account session changed", code: "auth_session_changed" }, 409);
        return "served";
      }
      if (!getCloudSyncPref()) return ACCOUNT_FALLBACK_CLOUD_SYNC_OFF;
      if (cloudPrefAtStart !== cloudSyncPrefGeneration) {
        json(res, { error: "Cloud sync preference changed", code: "CLOUD_SYNC_CHANGED" }, 409);
        return "served";
      }
      // Signed in + cloud sync on, but the cloud read failed (offline, token
      // rejected, edge error, or timeout). Serve local data rather than
      // erroring, but say so: this is a *temporary* downgrade and the client
      // must not treat it as the user's real data scope.
      const reason = classifyAccountFallback(e);
      if (getRuntime().debug) {
        console.warn(`[LocalAPI] account view fallback (${reason}) for ${usageSlug}:`, e?.message || e);
      }
      rememberAccountViewFailure(failureKey);
      return reason;
    }
  }

  function normalizeCookieHeader(value) {
    if (Array.isArray(value)) return value.filter(Boolean).join("; ");
    return typeof value === "string" ? value : "";
  }

  function buildRelayCookieHeader(clientCookieHeader, { relayPrecedenceNames = [] } = {}) {
    const normalizedClientCookieHeader = normalizeCookieHeader(clientCookieHeader);
    if (relayCookies.size === 0) return normalizedClientCookieHeader;
    const relayPrecedence = new Set(relayPrecedenceNames);
    const clientPairs = new Map();
    if (normalizedClientCookieHeader) {
      for (const part of normalizedClientCookieHeader.split(";")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx < 1) continue;
        const n = part.substring(0, eqIdx).trim();
        if (n) clientPairs.set(n, part.trim());
      }
    }
    // Merge relay cookies. Normal requests keep client precedence; refresh
    // recovery can opt relay cookies into precedence over stale WebView cookies.
    for (const [name, raw] of relayCookies) {
      if (clientPairs.has(name) && !relayPrecedence.has(name)) continue;
      const scIdx = raw.indexOf(";");
      const pair = scIdx > 0 ? raw.substring(0, scIdx).trim() : raw;
      clientPairs.set(name, pair);
    }
    return [...clientPairs.values()].join("; ");
  }

  // Ephemeral auth bridge: WebView sets a "native" flag before opening system browser
  // for OAuth. The callback page (in browser) checks this flag to decide whether to
  // relay the code back to the app or handle it as a normal web flow.
  let _nativeAuthPending = false;
  let _nativeAuthExpiry = 0;

  function isAuthorizedLocalMutation(req) {
    const headerToken = req?.headers?.["x-tokentracker-local-auth"];
    const cookieToken = parseCookieHeader(req?.headers?.cookie).get("tokentracker_local_auth");
    const token = typeof headerToken === "string" && headerToken.trim()
      ? headerToken.trim()
      : cookieToken || "";
    if (!token || token !== localAuthToken) return false;
    return hasAllowedLoopbackOrigin(req?.headers || {});
  }

  return async function handleLocalApi(req, res, url) {
    const p = url.pathname;
    // status.deepseek.com has no public JSON API or CORS, so the dashboard
    // cannot probe it like the other providers. Relay it through the local app:
    // fetchProviderServiceStatus("deepseek") fetches + parses the server-rendered
    // page (with a 5-minute cache and 6s timeout in provider-status.js) and we
    // return a Statuspage.io-shaped payload the existing dashboard parser reads.
    if (p === "/api/deepseek-status") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const reading = await fetchProviderServiceStatus("deepseek");
        if (!reading) {
          json(res, { error: "DeepSeek status unavailable" }, 502);
          return true;
        }
        json(res, {
          page: { updated_at: reading.updated_at },
          status: { indicator: reading.indicator, description: reading.description || "" },
        });
      } catch (error) {
        json(res, { error: `DeepSeek status probe error: ${error?.message || error}` }, 502);
      }
      return true;
    }
    // status.opencode.ai/api/status ships no CORS headers either — same relay
    // treatment as DeepSeek (#973 absorption, upstream PR 973).
    if (p === "/api/opencode-status") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      try {
        const reading = await fetchProviderServiceStatus("opencode");
        if (!reading) {
          json(res, { error: "OpenCode status unavailable" }, 502);
          return true;
        }
        json(res, {
          page: { updated_at: reading.updated_at },
          status: { indicator: reading.indicator, description: reading.description || "" },
        });
      } catch (error) {
        json(res, { error: `OpenCode status probe error: ${error?.message || error}` }, 502);
      }
      return true;
    }
    // Session recovery and the one-time native callback marker belong to local
    // clients. Reject foreign requests before consuming either, including preflights.
    const nativeMarkerRead = p === "/api/auth-bridge/verifier" && String(req.method).toUpperCase() === "GET";
    if (p.startsWith("/api/auth/") || nativeMarkerRead) {
      if (!hasAllowedLoopbackOrigin(req.headers || {}) || req.headers?.["sec-fetch-site"] === "cross-site") {
        json(res, { code: "untrusted_auth_origin", error: "Authentication requests must come from the local dashboard." }, 403);
        return true;
      }
      if (String(req.method).toUpperCase() === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return true;
      }
    }
    const selectedRuntime = getRuntime();
    const callerInstance = req.headers?.["x-tokentracker-instance"];
    if (callerInstance && normalizeInstanceBaseUrl(callerInstance) !== selectedRuntime.baseUrl) {
      json(res, { code: "instance_changed", error: "The configured backend instance changed. Reload and sign in again." }, 409);
      return true;
    }
    const bearer = parseBearerToken(req.headers?.authorization);
    const issuedFor = bearer && issuedAccessTokenInstances.get(crypto.createHash("sha256").update(bearer).digest("hex"));
    if (issuedFor && issuedFor !== fingerprintFor(selectedRuntime)) {
      json(res, { code: "instance_changed", error: "This session belongs to another backend instance. Sign in again." }, 409);
      return true;
    }
    if (p === "/api/runtime-config.js") {
      if (String(req.method).toUpperCase() !== "GET") { json(res, { error: "Method Not Allowed" }, 405); return true; }
      const descriptor = { baseUrl: normalizeInstanceBaseUrl(selectedRuntime.baseUrl) || "",
        anonKey: selectedRuntime.configurationError ? null : selectedRuntime.anonKey,
        dashboardUrl: normalizeInstanceBaseUrl(selectedRuntime.dashboardUrl) || "", configurationError: selectedRuntime.configurationError,
        // Capability flags: this origin is the local CLI, so social surfaces
        // read local history and cloud-only chrome is hidden in this build.
        localHistory: true,
        localOnly: true };
      const value = JSON.stringify(descriptor).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(`window.__TOKENTRACKER_RUNTIME_CONFIG__=${value};`);
      return true;
    }

    if (p === "/api/local-auth") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      // 审计 2026-10-25 S1：这里发的是突变令牌，绝不能应答跨站页面。C# 壳不带
      // Origin / Sec-Fetch-Site 头调用本端点，「缺失即放行」的语义保持不变。
      if (req.headers?.["sec-fetch-site"] === "cross-site" || !hasAllowedLoopbackOrigin(req.headers || {})) {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({
        token: localAuthToken,
        ...(normalizedServerVersion ? { serverVersion: normalizedServerVersion } : {}),
      }));
      return true;
    }

    // --- local Codex-compatible pet assets and package import ---
    const localPetAssetMatch = p.match(/^\/api\/pets\/local\/([a-z0-9-]+)\/spritesheet\.webp$/);
    if (localPetAssetMatch) {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const pet = require("./pet-packages").resolvePetAsset(localPetAssetMatch[1]);
      if (!pet) {
        json(res, { error: "Pet not found" }, 404);
        return true;
      }
      const stat = fs.statSync(pet.spritesheetPath);
      res.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": stat.size,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (method === "HEAD") res.end();
      else fs.createReadStream(pet.spritesheetPath).pipe(res);
      return true;
    }

    // Preview asset for a Codex pet that hasn't been imported yet (served from
    // ~/.codex/pets or straight out of the Codex.app bundle).
    const codexPetAssetMatch = p.match(/^\/api\/pets\/codex\/([a-z0-9-]+)\/spritesheet\.webp$/);
    if (codexPetAssetMatch) {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const asset = require("./pet-packages").readCodexImportableAsset(codexPetAssetMatch[1]);
      if (!asset) {
        json(res, { error: "Pet not found" }, 404);
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "image/webp",
        "Content-Length": asset.buffer.length,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      if (method === "HEAD") res.end();
      else res.end(asset.buffer);
      return true;
    }

    if (p === "/api/pets/import") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      const pets = require("./pet-packages");
      try {
        const body = await readBodyLimited(req, pets.MAX_PACKAGE_BYTES);
        json(res, { ok: true, pet: await pets.importPetZip(body) });
      } catch (error) {
        if (!res.headersSent) json(res, { ok: false, error: error?.message || "Pet import failed" }, 400);
      }
      return true;
    }

    // --- Auth bridge: native OAuth flag (WebView ↔ system browser) ---
    if (p === "/api/auth-bridge/verifier") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "PUT" || method === "POST") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { error: "Unauthorized" }, 401);
          return true;
        }
        const body = await readJsonBody(req);
        _nativeAuthPending = Boolean(body?.native);
        _nativeAuthExpiry = Date.now() + 5 * 60 * 1000; // 5 min TTL
        json(res, { ok: true });
        return true;
      }
      if (method === "GET") {
        const isNative = _nativeAuthPending && Date.now() < _nativeAuthExpiry;
        _nativeAuthPending = false; // one-time read
        _nativeAuthExpiry = 0;
        json(res, { native: isNative });
        return true;
      }
      json(res, { error: "Method Not Allowed" }, 405);
      return true;
    }

    // --- auth proxy: forward /api/auth/* to InsForge cloud ---
    if (p.startsWith("/api/auth/")) {
      if (String(req.method).toUpperCase() === "POST" && /^\/api\/auth\/(?:logout|sessions|sign-in|oauth\/exchange)$/.test(p)) {
        clearLocalSyncDeviceTokenCache();
        invalidateCloudAccountPayloadCache({ sessionChanged: true });
      }
      const authSessionAtStart = getCloudAccountSessionGeneration();
      const runtime = getRuntime();
      try { assertInsforgeRuntime(runtime); } catch (error) { json(res, { code: error.code, error: error.message }, 503); return true; }
      // Local-first: with no cloud instance configured there is no auth
      // backend to proxy to; local sessions are handled entirely in-process.
      if (!runtime.baseUrl) {
        json(res, { code: "cloud_not_configured", error: "No cloud instance configured. Set --base-url or TOKENTRACKER_INSFORGE_BASE_URL to enable cloud features." }, 409);
        return true;
      }
      const insforgeBase = runtime.baseUrl;
      if (req.headers.apikey && req.headers.apikey !== runtime.anonKey) {
        json(res, { code: "instance_changed", error: "The public client key belongs to another backend instance." }, 409);
        return true;
      }
      try {
        const targetUrl = `${insforgeBase.replace(/\/$/, "")}${p}${url.search || ""}`;
        const proxyHeaders = buildProxyHeaders(req.headers);
        // Browser cookies survive changes to the loopback server's backend.
        // Only this instance's captured cookies can be relayed, including when
        // switching from a custom instance back to the official service.
        const hadBrowserCookies = Boolean(normalizeCookieHeader(proxyHeaders.cookie).trim());
        proxyHeaders.cookie = hadBrowserCookies ? buildRelayCookieHeader("") : "";
        if (proxyHeaders["x-csrf-token"] !== getRelayCookieValue(csrfRelayCookieName)) delete proxyHeaders["x-csrf-token"];
        if (insforgeBase !== DEFAULT_BASE_URL && proxyHeaders.authorization && !callerInstance) {
          json(res, { code: "instance_changed", error: "Reload the local dashboard before using a custom backend session." }, 409);
          return true;
        }
        proxyHeaders.apikey = runtime.anonKey;
        const hasClientCookie = normalizeCookieHeader(proxyHeaders["cookie"]).trim().length > 0;
        const hasCsrfHeader = typeof proxyHeaders["x-csrf-token"] === "string" && proxyHeaders["x-csrf-token"].trim().length > 0;
        const relayCsrfToken = getRelayCookieValue(csrfRelayCookieName);
        const relayRefreshToken = getRelayCookieValue("insforge_refresh_token", { decode: true });
        // A cookie-less client (fresh WebView after an app update/restart) has no
        // browser session to pair a CSRF token with — the persisted refresh token
        // replayed through the mobile flow is the only viable recovery. The relay
        // csrf token must NOT force the cookie/csrf path here: background mobile
        // rotations (cloud-account.js) can leave it stale, and a stale csrf turns
        // recovery into 403 Invalid CSRF and signs the user out.
        const shouldUseRelayRefreshFallback =
          p === "/api/auth/refresh" && !hasClientCookie && relayRefreshToken;
        if (p === "/api/auth/refresh" && relayCsrfToken && !shouldUseRelayRefreshFallback) {
          proxyHeaders["x-csrf-token"] = relayCsrfToken;
        }
        const hasEffectiveCsrfHeader =
          hasCsrfHeader ||
          (typeof proxyHeaders["x-csrf-token"] === "string" && proxyHeaders["x-csrf-token"].trim().length > 0);
        let shouldInjectRelayCookies =
          p !== "/api/auth/refresh" || hasClientCookie || hasEffectiveCsrfHeader;
        if (shouldUseRelayRefreshFallback) {
          shouldInjectRelayCookies = false;
        }

        // Inject relay cookies so WebView benefits from browser's login session.
        // Refresh requests need either a browser cookie or an explicit CSRF token;
        // otherwise replaying a stale persisted refresh cookie just manufactures
        // Invalid CSRF errors on startup.
        const originalCookieHeader = normalizeCookieHeader(proxyHeaders["cookie"]);
        const mergedCookie = shouldInjectRelayCookies
          ? buildRelayCookieHeader(originalCookieHeader, {
              relayPrecedenceNames: p === "/api/auth/refresh"
                ? [csrfRelayCookieName, "insforge_refresh_token"]
                : [],
            })
          : originalCookieHeader;
        const injectedRelayCookies =
          shouldInjectRelayCookies && relayCookies.size > 0 && mergedCookie !== originalCookieHeader;
        if (mergedCookie) proxyHeaders["cookie"] = mergedCookie;
        else delete proxyHeaders["cookie"];

        const bodyChunks = [];
        for await (const chunk of req) bodyChunks.push(chunk);
        let proxyBody = bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined;
        let effectiveTargetUrl = targetUrl;
        if (shouldUseRelayRefreshFallback) {
          effectiveTargetUrl = `${insforgeBase.replace(/\/$/, "")}/api/auth/refresh?client_type=mobile`;
          proxyHeaders["content-type"] = "application/json";
          delete proxyHeaders["content-length"];
          proxyBody = Buffer.from(JSON.stringify({ refresh_token: relayRefreshToken }), "utf8");
        }
        let proxyRes = await fetch(effectiveTargetUrl, {
          method: req.method || "GET",
          headers: proxyHeaders,
          body: proxyBody,
          credentials: "include",
          redirect: "manual",
        });
        let resBody = Buffer.from(await proxyRes.arrayBuffer());

        // Stale-CSRF rescue: 403 Invalid CSRF on refresh does NOT mean the
        // session is dead — background mobile rotations (cloud-account.js) can
        // desync the relayed csrf from a still-valid refresh token. Replay the
        // persisted refresh token through the csrf-free mobile flow before
        // letting the client sign out.
        const isStaleCsrf403 =
          p === "/api/auth/refresh"
          && proxyRes.status === 403
          && /invalid csrf token/i.test(resBody.toString("utf8"));
        if (isStaleCsrf403 && relayRefreshToken && !shouldUseRelayRefreshFallback) {
          const rescueHeaders = { ...proxyHeaders, "content-type": "application/json" };
          delete rescueHeaders["cookie"];
          delete rescueHeaders["x-csrf-token"];
          delete rescueHeaders["content-length"];
          const rescueRes = await fetch(
            `${insforgeBase.replace(/\/$/, "")}/api/auth/refresh?client_type=mobile`,
            {
              method: "POST",
              headers: rescueHeaders,
              body: JSON.stringify({ refresh_token: relayRefreshToken }),
              credentials: "include",
              redirect: "manual",
            },
          );
          if (rescueRes.ok) {
            proxyRes = rescueRes;
            resBody = Buffer.from(await rescueRes.arrayBuffer());
          }
        }

        const latestRuntime = getRuntime();
        if (latestRuntime.configurationError || latestRuntime.baseUrl !== runtime.baseUrl || latestRuntime.anonKey !== runtime.anonKey) {
          json(res, { code: "instance_changed", error: "The configured backend changed during authentication. Reload and sign in again." }, 409);
          return true;
        }
        // Error responses must not mutate relay state: a 403's deletion
        // set-cookie (insforge_refresh_token=; Expires=1970) would otherwise
        // destroy a still-valid persisted session.
        if ((p === "/api/auth/refresh" || p === "/api/auth/logout") &&
            authSessionAtStart !== getCloudAccountSessionGeneration()) {
          json(res, { error: "Account session changed", code: "auth_session_changed" }, 409);
          return true;
        }
        const allowRelayCapture = proxyRes.status < 400;
        const responseHeaders = [...proxyRes.headers.entries()]
          .filter(([k]) => !["transfer-encoding", "connection"].includes(k.toLowerCase()))
          .map(([k, v]) => {
            if (k.toLowerCase() === "set-cookie") {
              const rewritten = v.replace(/;\s*[Dd]omain=[^;]*/g, "; Domain=localhost");
              if (allowRelayCapture) captureSetCookies(rewritten);
              return [k, rewritten];
            }
            return [k, v];
          });
        res.writeHead(proxyRes.status, Object.fromEntries(responseHeaders));
        if (proxyRes.status >= 200 && proxyRes.status < 300) {
          if (p === "/api/auth/logout") {
            clearRelayCookies("sign out");
          } else {
            captureAuthTokensFromBody(resBody, proxyRes.headers.get("content-type"), {
              newLogin: p !== "/api/auth/refresh", sourceFingerprint: fingerprintFor(runtime),
            });
          }
        }
        if (
          isStaleCsrf403
          && proxyRes.status === 403
          && injectedRelayCookies
          && !hasClientCookie
        ) {
          clearRelayCookies("stale refresh cookie without local CSRF context");
        }
        res.end(resBody);
      } catch (e) {
        json(res, { error: `Auth proxy error: ${e?.message || e}` }, 502);
      }
      return true;
    }

    // --- ip-check proxy: reverse-proxy ip.net.coffee (issue #81) ---
    // Lock-down: GET/HEAD only, restricted path prefixes, do not forward
    // browser credentials or fingerprintable headers. Without these limits
    // /proxy/ipcheck is an open reverse-proxy any local process can abuse
    // (exfiltrate dashboard cookies, anonymously POST through user IP).
    if (p.startsWith(`${IP_CHECK_PROXY_PREFIX}/`) || p === IP_CHECK_PROXY_PREFIX) {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const targetPath = p === IP_CHECK_PROXY_PREFIX
        ? "/"
        : p.slice(IP_CHECK_PROXY_PREFIX.length) || "/";
      const ALLOWED_PREFIXES = [
        "/api/geoip/",
        "/api/geoip-batch",
        "/api/iprisk/",
        "/api/dns/result/",
        "/claude/status.json",
        "/favicons/",
        "/ip/",
      ];
      if (!ALLOWED_PREFIXES.some((prefix) => targetPath.startsWith(prefix))) {
        json(res, { error: "Path not allowed" }, 403);
        return true;
      }
      const targetUrl = `${IP_CHECK_TARGET}${targetPath}${url.search || ""}`;
      try {
        // Whitelist forwarded headers — no cookies, no auth, no fingerprintable
        // identity. Only what the upstream needs to negotiate content. Do not
        // set `host` explicitly: undici derives it from the URL, and some
        // versions reject a manual host header on fetch() (same forbidden-
        // header family that broke /api/auth/* in 5/13).
        const proxyHeaders = {
          accept: req.headers["accept"] || "*/*",
          "accept-language": req.headers["accept-language"] || "en",
          "accept-encoding": req.headers["accept-encoding"] || "gzip",
          "user-agent": "TokenTracker/IPCheck (local-first fork)",
          referer: `${IP_CHECK_TARGET}${targetPath}`,
        };

        const proxyRes = await fetch(targetUrl, {
          method,
          headers: proxyHeaders,
          redirect: "manual",
        });

        const stripped = new Set([
          "transfer-encoding",
          "connection",
          "content-length",
          "content-encoding",
          "x-frame-options",
          "content-security-policy",
          "cross-origin-opener-policy",
          "cross-origin-embedder-policy",
          "cross-origin-resource-policy",
        ]);
        const responseHeaders = [...proxyRes.headers.entries()].filter(
          ([k]) => !stripped.has(k.toLowerCase()),
        );

        const resBody = Buffer.from(await proxyRes.arrayBuffer());
        res.writeHead(proxyRes.status, Object.fromEntries(responseHeaders));
        res.end(resBody);
      } catch (e) {
        json(res, { error: `IP check proxy error: ${e?.message || e}` }, 502);
      }
      return true;
    }

    // --- avatar proxy: fetch third-party avatars server-side ---
    // Why: WKWebView in TokenTrackerBar fails to load some users' Google /
    // GitHub avatars directly (network-stack / proxy / TLS quirks vary by
    // environment), even when the same URL renders fine in Safari. Proxying
    // through Node's fetch — which honors system proxy + cookies-of-none —
    // produces a same-origin <img> the WKWebView always accepts.
    // Lock-down: GET only; host allowlist of well-known avatar CDNs (no open
    // proxy); strip cookies/auth; small in-memory cache.
    if (p === "/api/avatar-proxy") {
      const method = String(req.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const target = url.searchParams.get("url");
      if (!target) {
        json(res, { error: "Missing url" }, 400);
        return true;
      }
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        json(res, { error: "Invalid url" }, 400);
        return true;
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        json(res, { error: "Only http(s) allowed" }, 400);
        return true;
      }
      const AVATAR_HOST_ALLOWLIST = [
        "lh3.googleusercontent.com",
        "lh4.googleusercontent.com",
        "lh5.googleusercontent.com",
        "lh6.googleusercontent.com",
        "avatars.githubusercontent.com",
        "secure.gravatar.com",
        "www.gravatar.com",
        "gravatar.com",
        "cdn.discordapp.com",
        "pbs.twimg.com",
        "abs.twimg.com",
        "api.dicebear.com",
      ];
      const hostOk = AVATAR_HOST_ALLOWLIST.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`),
      );
      if (!hostOk) {
        json(res, { error: "Host not allowed" }, 403);
        return true;
      }

      const cacheKey = parsed.toString();
      const now = Date.now();
      const cached = avatarProxyCache.get(cacheKey);
      if (cached && now - cached.fetchedAt < AVATAR_PROXY_TTL_MS) {
        res.writeHead(200, {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=3600",
          "X-Avatar-Cache": "HIT",
        });
        res.end(method === "HEAD" ? undefined : cached.body);
        return true;
      }

      try {
        const upstream = await fetch(cacheKey, {
          method,
          redirect: "follow",
          headers: {
            accept: req.headers["accept"] || "image/*",
            "accept-language": req.headers["accept-language"] || "en",
            "user-agent": "TokenTracker/AvatarProxy (local-first fork)",
          },
        });
        if (!upstream.ok) {
          json(res, { error: `Upstream ${upstream.status}` }, upstream.status);
          return true;
        }
        const contentType = upstream.headers.get("content-type") || "image/png";
        if (!contentType.toLowerCase().startsWith("image/")) {
          json(res, { error: "Not an image" }, 415);
          return true;
        }
        const body = Buffer.from(await upstream.arrayBuffer());
        if (body.length <= AVATAR_PROXY_MAX_BYTES) {
          // Simple LRU: drop oldest if over capacity.
          if (avatarProxyCache.size >= AVATAR_PROXY_MAX_ENTRIES) {
            const oldestKey = avatarProxyCache.keys().next().value;
            if (oldestKey) avatarProxyCache.delete(oldestKey);
          }
          avatarProxyCache.set(cacheKey, { body, contentType, fetchedAt: now });
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
          "X-Avatar-Cache": "MISS",
        });
        res.end(method === "HEAD" ? undefined : body);
      } catch (e) {
        json(res, { error: `Avatar proxy error: ${e?.message || e}` }, 502);
      }
      return true;
    }

    // The browser supplies its current JWT only to prove ownership upstream.
    // Uploads use this server-held binding, never a caller's opaque device token.
    if (p === "/functions/tokentracker-cloud-session") {
      if (String(req.method).toUpperCase() !== "POST") { json(res, { error: "Method Not Allowed" }, 405); return true; }
      if (!isAuthorizedLocalMutation(req)) { json(res, { error: "Unauthorized" }, 401); return true; }
      try {
        const body = await readJsonBody(req);
        assertInsforgeRuntime(getRuntime());
        if (body.clear === true) {
          if (body.session_id && body.session_id === localCloudSession?.id) clearLocalSyncDeviceTokenCache();
          json(res, { ok: true }); return true;
        }
        if (!getCloudSyncPref()) { json(res, { code: "CLOUD_SYNC_DISABLED" }, 409); return true; }
        const accessToken = String(req.headers.authorization || "").replace(/^Bearer /i, "").trim();
        const ownerId = typeof body.expectedOwnerId === "string" ? body.expectedOwnerId.trim() : "";
        if (!accessToken || !ownerId) { json(res, { code: "auth_required" }, 401); return true; }
        const baseUrl = resolveAllowedInsforgeBaseUrl(body.insforgeBaseUrl || getRuntime().baseUrl, getRuntime());
        if (!baseUrl) { json(res, { error: "Unsupported insforgeBaseUrl override" }, 400); return true; }
        clearLocalSyncDeviceTokenCache();
        const generation = localCloudGeneration;
        await Promise.all([...activeCloudSyncs].map(controller => controller.done).filter(Boolean));
        const issued = await issueDeviceTokenForLocalSync(qp, { baseUrl, accessToken, expectedOwnerId: ownerId, returnSession: true });
        if (generation !== localCloudGeneration) { json(res, { code: "auth_session_changed" }, 409); return true; }
        if (!issued?.token || !issued.deviceId) { json(res, { code: "auth_rejected" }, 401); return true; }
        localCloudSession = { id: crypto.randomUUID(), ownerId, baseUrl, generation, token: issued.token };
        json(res, { session_id: localCloudSession.id, device_id: issued.deviceId, created_at: issued.issuedAt });
      } catch (error) { json(res, { error: error.message, code: error.code || null, recovery_url: error.recoveryUrl || null }, error.status || 502); }
      return true;
    }

    if (p === "/functions/tokentracker-cloud-usage-reset") {
      if (!isAuthorizedLocalMutation(req) || req.headers["sec-fetch-site"] === "cross-site") { json(res, { error: "Unauthorized" }, 401); return true; }
      try {
        if (String(req.method).toUpperCase() === "GET") {
          json(res, { pending: Boolean(readCloudUsageReset(trackerDataDir)) }); return true;
        }
        if (String(req.method).toUpperCase() !== "POST") { json(res, { error: "Method Not Allowed" }, 405); return true; }
        const body = await readJsonBody(req);
        const session = localCloudSession;
        if (!getCloudSyncPref() || !session || body.cloudSessionId !== session.id || body.expectedOwnerId !== session.ownerId) {
          json(res, { code: "auth_session_changed" }, 409); return true;
        }
        const metadata = localSyncDeviceMetadata.get(session.token);
        const accessToken = String(req.headers.authorization || "").replace(/^Bearer /i, "").trim();
        const runtime = assertInsforgeRuntime(getRuntime());
        let claims;
        try { claims = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")); } catch { /* rejected below */ }
        if (claims?.sub !== session.ownerId || !Number.isFinite(claims?.exp) || claims.exp * 1000 <= Date.now()) {
          json(res, { code: "auth_required" }, 401); return true;
        }
        const isCurrent = () => getCloudSyncPref() && localCloudSession === session && session.generation === localCloudGeneration &&
          claims.exp * 1000 > Date.now() && getRuntime().baseUrl === session.baseUrl;
        const result = await resetCloudDeviceUsage({ trackerDir: trackerDataDir, ownerId: session.ownerId,
          deviceId: metadata?.deviceId, baseUrl: session.baseUrl, anonKey: runtime.anonKey, accessToken, isCurrent });
        if (!isCurrent()) { json(res, { code: "auth_session_changed" }, 409); return true; }
        clearLocalSyncDeviceTokenCache();
        invalidateAfterAccountUpload();
        invalidateCloudAccountPayloadCache();
        json(res, { ...result, pending: true });
      } catch (error) { json(res, { error: error.code || "cloud_usage_reset_failed", code: error.code || null }, error.status || 502); }
      return true;
    }

    // --- local-sync (POST) ---
    if (p === "/functions/tokentracker-local-sync") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        const currentRuntime = getRuntime();
        if (body.drain === true || body.cloudSessionId || body.insforgeBaseUrl || body.expectedOwnerId) assertInsforgeRuntime(currentRuntime);
        const extraEnv = { TOKENTRACKER_CLOUD_RECHECK: "0", TOKENTRACKER_INSFORGE_BASE_URL: currentRuntime.baseUrl, TOKENTRACKER_INSFORGE_ANON_KEY: currentRuntime.anonKey || "" };
        const drain = body.drain === true;
        // A user action after membership/resume may probe the server again.
        // The server still enforces membership, paused slots and its deadline.
        if (drain && body.recheckCloudAccess === true && body.auto !== true) {
          extraEnv.TOKENTRACKER_CLOUD_RECHECK = "1";
        }
        // Native Sync Now combines an incremental background scan with a full
        // cloud drain. A plain {drain:true} request remains an exhaustive sync.
        const auto = body.auto === true;
        const background =
          auto && (body.background === true || body.lightweight === true);
        // The local server is the trust boundary for cloud-sync preferences.
        // A persisted device token must not let a native background request
        // upload after the user has explicitly disabled cloud sync.
        const publishAccount =
          background && body.publishAccount === true && getCloudSyncPref();
        const allLocalSources = background && body.allLocalSources === true;
        if (background && body.nativeOnlyWsl === true) {
          extraEnv.TOKENTRACKER_WSL_MODE = "native-only";
        }
        if (body.deviceToken != null && !background) {
          json(res, { ok: false, error: "Use the current cloud session", code: getCloudSyncPref() ? "auth_session_required" : "CLOUD_SYNC_DISABLED" }, 409);
          return true;
        }
        const browserSession = body.cloudSessionId ? localCloudSession : null;
        if (body.cloudSessionId === "" || (body.expectedOwnerId && !body.cloudSessionId)) { json(res, { ok: false, code: "auth_session_required" }, 409); return true; }
        if (body.cloudSessionId && (!browserSession || body.cloudSessionId !== browserSession.id ||
            body.expectedOwnerId !== browserSession.ownerId || browserSession.generation !== localCloudGeneration || !getCloudSyncPref())) {
          json(res, { ok: false, code: "auth_session_changed" }, 409); return true;
        }
        if (browserSession) extraEnv.TOKENTRACKER_DEVICE_TOKEN = browserSession.token;
        let localSyncBaseUrl = null;
        if (body.insforgeBaseUrl != null) {
          const allowedBaseUrl = resolveAllowedInsforgeBaseUrl(body.insforgeBaseUrl, getRuntime());
          if (!allowedBaseUrl) {
            json(res, { ok: false, error: "Unsupported insforgeBaseUrl override" }, 400);
            return true;
          }
          extraEnv.TOKENTRACKER_INSFORGE_BASE_URL = allowedBaseUrl;
          localSyncBaseUrl = allowedBaseUrl;
        }
        if (browserSession) {
          extraEnv.TOKENTRACKER_INSFORGE_BASE_URL = browserSession.baseUrl;
          localSyncBaseUrl = browserSession.baseUrl;
        }
        const uploadGeneration = localCloudGeneration;
        if ((!background || publishAccount) &&
            !extraEnv.TOKENTRACKER_DEVICE_TOKEN &&
            getCloudSyncPref() &&
            getRefreshTokenForCloud()) {
          let issuedToken = null;
          const issuerSessionAtStart = getCloudAccountSessionGeneration();
          const issuerCloudPrefAtStart = cloudSyncPrefGeneration;
          try {
            issuedToken = await issueDeviceTokenForLocalSync(qp, { baseUrl: localSyncBaseUrl, expectedOwnerId: localCloudSession?.ownerId });
          } catch (e) {
            if (e?.code?.startsWith("cloud_") || e?.code === "auth_owner_mismatch") throw e;
            if (getRuntime().debug) {
              console.warn("[LocalAPI] local sync device token issue failed:", e?.message || e);
            }
          }
          if (issuerSessionAtStart !== getCloudAccountSessionGeneration()) {
            json(res, { ok: false, error: "Account session changed", code: "auth_session_changed" }, 409);
            return true;
          }
          if (!getCloudSyncPref() || issuerCloudPrefAtStart !== cloudSyncPrefGeneration) {
            json(res, { ok: false, error: "Cloud sync preference changed", code: "CLOUD_SYNC_CHANGED" }, 409);
            return true;
          }
          if (!issuedToken) {
            if (drain) {
              json(res, { ok: false, error: "Unable to issue cloud device token for local sync" }, 502);
              return true;
            }
          } else {
            extraEnv.TOKENTRACKER_DEVICE_TOKEN = issuedToken;
          }
        }
        if (extraEnv.TOKENTRACKER_DEVICE_TOKEN && uploadGeneration !== localCloudGeneration) {
          json(res, { ok: false, code: "auth_session_changed" }, 409); return true;
        }
        if (extraEnv.TOKENTRACKER_DEVICE_TOKEN) {
          const metadata = localSyncDeviceMetadata.get(extraEnv.TOKENTRACKER_DEVICE_TOKEN);
          if (metadata?.deviceId) extraEnv.TOKENTRACKER_CLOUD_DEVICE_ID = metadata.deviceId;
        }
        await Promise.all([...activeCloudSyncs].filter(controller => controller.signal.aborted).map(controller => controller.done).filter(Boolean));
        if (extraEnv.TOKENTRACKER_DEVICE_TOKEN && uploadGeneration !== localCloudGeneration) throw Object.assign(new Error("Account session changed"), { code: "auth_session_changed", status: 409 });
        if (extraEnv.TOKENTRACKER_DEVICE_TOKEN && localSyncDeviceTokenUserId) {
          const uploadBaseUrl = localSyncBaseUrl || getRuntime().baseUrl;
          const reset = readCloudUsageReset(trackerDataDir);
          if (reset && (reset.ownerId !== localSyncDeviceTokenUserId || reset.baseUrl.replace(/\/$/, "") !== uploadBaseUrl.replace(/\/$/, "") ||
              (extraEnv.TOKENTRACKER_CLOUD_DEVICE_ID && reset.deviceId !== extraEnv.TOKENTRACKER_CLOUD_DEVICE_ID))) {
            json(res, { ok: false, code: "cloud_usage_reset_owner_changed" }, 409); return true;
          }
          const binding = JSON.stringify({ ownerId: localSyncDeviceTokenUserId, baseUrl: uploadBaseUrl });
          const ownerPath = path.join(path.dirname(qp), "cloud-upload-owner.json");
          let previous = "";
          try { previous = fs.readFileSync(ownerPath, "utf8"); } catch { /* an unbound legacy cursor cannot prove its previous owner */ }
          if (previous !== binding) {
            fs.writeFileSync(path.join(path.dirname(qp), "queue.state.json"), JSON.stringify({ offset: 0, updatedAt: new Date().toISOString() }), { mode: 0o600 });
            try { fs.unlinkSync(path.join(path.dirname(qp), "upload.throttle.json")); } catch { /* no cooldown yet */ }
          }
          fs.writeFileSync(ownerPath, binding, { mode: 0o600 });
        }
        const controller = new AbortController();
        if (extraEnv.TOKENTRACKER_DEVICE_TOKEN) activeCloudSyncs.add(controller);
        const syncStartedAt = Date.now();
        if (localSyncDeviceTokenUserId) extraEnv.TOKENTRACKER_CLOUD_OWNER_ID = localSyncDeviceTokenUserId;
        extraEnv.TOKENTRACKER_LOCAL_SYNC_ATTEMPT_ID = crypto.randomUUID();
        const syncPromise = runSyncCommand(extraEnv, {
          signal: controller.signal,
          trackerDataDir: isolatedTrackerDataDir,
          syncContext,
          drain,
          auto,
          background,
          publishAccount,
          allLocalSources,
          waitForLock:
            !drain && !background && Boolean(extraEnv.TOKENTRACKER_DEVICE_TOKEN),
        });
        controller.done = syncPromise.catch(() => {});
        const result = await syncPromise.catch((error) => {
          if (uploadGeneration !== localCloudGeneration) throw Object.assign(new Error("Account session changed"), { code: "auth_session_changed", status: 409 });
          const failure = currentCloudUploadFailure(syncStartedAt, { backoff: auto && drain, deviceToken: extraEnv.TOKENTRACKER_DEVICE_TOKEN, attemptId: extraEnv.TOKENTRACKER_LOCAL_SYNC_ATTEMPT_ID });
          if (failure) Object.assign(error, failure);
          throw error;
        }).finally(() => activeCloudSyncs.delete(controller));
        if (extraEnv.TOKENTRACKER_DEVICE_TOKEN && uploadGeneration !== localCloudGeneration) throw Object.assign(new Error("Account session changed"), { code: "auth_session_changed", status: 409 });
        const failure = currentCloudUploadFailure(syncStartedAt, { deviceToken: extraEnv.TOKENTRACKER_DEVICE_TOKEN, attemptId: extraEnv.TOKENTRACKER_LOCAL_SYNC_ATTEMPT_ID });
        if (failure) throw Object.assign(new Error("Cloud upload failed"), failure);
        invalidateAfterAccountUpload();
        if (drain) invalidateCloudAccountPayloadCache();
        try {
          const { resetUsageLimitsCache } = require("./usage-limits");
          resetUsageLimitsCache();
        } catch (_e) {
          // ignore if module load fails
        }
        let cloudAccess = { uploaded: false, pending: true };
        try {
          const state = JSON.parse(fs.readFileSync(path.join(path.dirname(qp), "upload.throttle.json"), "utf8"));
          if (state.nextAllowedAtMs) cloudAccess.next_allowed_at = new Date(state.nextAllowedAtMs).toISOString();
          cloudAccess.uploaded = state.lastSuccessAttemptId === extraEnv.TOKENTRACKER_LOCAL_SYNC_ATTEMPT_ID &&
            Number(state.lastSuccessMs || 0) >= syncStartedAt;
          const queueState = JSON.parse(fs.readFileSync(path.join(path.dirname(qp), "queue.state.json"), "utf8"));
          cloudAccess.pending = fs.statSync(qp).size > Number(queueState.offset || 0);
        } catch { /* no upload has been attempted yet */ }
        json(res, { ok: true, ...result, ...cloudAccess });
      } catch (e) {
        json(res, { ok: false, error: e?.message, code: e?.code ?? null, recovery_url: e?.recoveryUrl ?? null, next_allowed_at: e?.nextAllowedAt ?? null, retry_after_seconds: e?.retryAfterMs ? Math.ceil(e.retryAfterMs / 1000) : null, stdout: e?.stdout || "", stderr: e?.stderr || "" }, e?.status || 500);
      }
      return true;
    }

    // --- wrapped (year-end summary, à la Spotify Wrapped) ---
    if (p === "/functions/tokentracker-wrapped") {
      const yearParam = url.searchParams.get("year");
      const year = yearParam ? Number(yearParam) : null;
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const { aggregateWrapped } = require("./wrapped-aggregator");
      const summary = aggregateWrapped(rows, year ? { year } : {});
      json(res, { scope, excluded_sources: excludedSources, trae_estimate_applied: true, ...summary });
      return true;
    }

    // --- account (cross-device) view proxy for the native popover ---
    // When ?account=1 and the user is signed in with cloud sync on, serve the
    // same cross-device aggregate the dashboard shows; otherwise tag the
    // response (X-TokenTracker-Account-View: 0 plus an
    // X-TokenTracker-Account-Fallback reason) so the popover knows it got local
    // single-machine data and whether that is permanent (signed out / cloud
    // sync off) or transient, and fall through to the local handler below.
    if (url.searchParams.get("account") === "1") {
      const usageSlug = p.startsWith("/functions/") ? p.slice("/functions/".length) : "";
      if (accountSlugFor(usageSlug)) {
        const result = await tryServeAccountView(usageSlug, url, res);
        if (result === "served") return true;
        res.setHeader("X-TokenTracker-Account-View", "0");
        res.setHeader("X-TokenTracker-Account-Fallback", result);
      }
    }

    // --- usage-summary ---
    if (p === "/functions/tokentracker-usage-summary") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const allDaily = await aggregateByDay(rows, timeZoneContext);
      const daily = allDaily.filter((d) => d.day >= from && d.day <= to);
      const totals = daily.reduce(
        (acc, r) => {
          acc.total_tokens += r.total_tokens;
          acc.billable_total_tokens += r.billable_total_tokens;
          acc.total_cost_usd += r.total_cost_usd || 0;
          acc.input_tokens += r.input_tokens;
          acc.output_tokens += r.output_tokens;
          acc.cached_input_tokens += r.cached_input_tokens;
          acc.cache_creation_input_tokens += r.cache_creation_input_tokens;
          acc.reasoning_output_tokens += r.reasoning_output_tokens;
          acc.conversation_count += r.conversation_count;
          return acc;
        },
        { total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 },
      );
      const totalCost = totals.total_cost_usd;

      const todayParts = getZonedParts(new Date(), timeZoneContext);
      const todayStr = formatPartsDayKey(todayParts) || new Date().toISOString().slice(0, 10);

      const shiftDay = (dayStr, delta) => {
        const d = new Date(`${dayStr}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + delta);
        return d.toISOString().slice(0, 10);
      };
      const collectDays = (n) => {
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
          const ds = shiftDay(todayStr, -i);
          const dd = allDaily.find((x) => x.day === ds);
          if (dd) out.push(dd);
        }
        return out;
      };
      const sumDays = (days) =>
        days.reduce((a, r) => {
          a.billable_total_tokens += r.billable_total_tokens;
          a.conversation_count += r.conversation_count;
          return a;
        }, { billable_total_tokens: 0, conversation_count: 0 });

      const l7 = collectDays(7);
      const l30 = collectDays(30);
      const l7t = sumDays(l7);
      const l30t = sumDays(l30);
      const l7fromStr = shiftDay(todayStr, -6);
      const l30fromStr = shiftDay(todayStr, -29);

      json(res, {
        from, to, days: daily.length, scope, excluded_sources: excludedSources,
        totals: { ...totals, total_cost_usd: totalCost.toFixed(6) },
        rolling: {
          last_7d: { from: l7fromStr, to: todayStr, active_days: l7.length, totals: l7t },
          last_30d: { from: l30fromStr, to: todayStr, active_days: l30.length, totals: l30t, avg_per_active_day: l30.length > 0 ? Math.round(l30t.billable_total_tokens / l30.length) : 0 },
        },
      });
      return true;
    }

    // --- usage-daily ---
    if (p === "/functions/tokentracker-usage-daily") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const daily = (await aggregateByDay(rows, timeZoneContext)).filter((d) => d.day >= from && d.day <= to);
      json(res, { from, to, scope, excluded_sources: excludedSources, trae_estimate_applied: true, data: daily });
      return true;
    }

    // --- outcomes (opt-in quality-per-dollar / Effective Tokens; sidecar) ---
    // Reads the optional ~/.tokentracker/tracker/outcomes.jsonl sidecar and
    // joins it to the existing token/$ rows at READ time. Returns
    // available:false with empty arrays when the user hasn't opted in, so the
    // dashboard renders exactly as before. This path NEVER reads or writes
    // queue.jsonl's schema or the sync path (see GitHub #229).
    if (p === "/functions/tokentracker-outcomes") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const {
        readAllOutcomesData,
        computeQualityPerDollar,
      } = require("./outcomes-engine");
      // Refresh the independent metadata-only sidecars before joining. Any
      // scanner failure degrades to the existing manual outcomes file.
      try {
        const { buildSessionAnalytics } = require("./session-analytics");
        const { buildGitOutcomes } = require("./git-outcomes");
        const sessions = await buildSessionAnalytics();
        await buildGitOutcomes(sessions);
      } catch (error) {
        console.error("[outcomes] automatic Git attribution failed:", error?.message || error);
      }
      const outcomes = readAllOutcomesData();
      if (!outcomes.length) {
        json(res, { available: false, from, to, by_model: [], by_tool: [], totals: null });
        return true;
      }
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const result = computeQualityPerDollar(rows, outcomes, { from, to });
      json(res, { from, to, scope, excluded_sources: excludedSources, trae_estimate_applied: true, ...result });
      return true;
    }

    // --- metadata-only Claude/Codex session efficiency ---
    if (p === "/functions/tokentracker-session-insights") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const refresh = ["1", "true"].includes(url.searchParams.get("refresh"));
      try {
        const { buildSessionAnalytics, summarizeSessions, sessionsToCsv, applyQoderSessionUsageEstimates, applyWallClockSpeed } = require("./session-analytics");
        const sessions = await buildSessionAnalytics({ force: refresh });
        applyQoderSessionUsageEstimates(sessions, await loadSessionQueueRows());
        for (const session of sessions) applyWallClockSpeed(session);
        const wantsCsv = url.searchParams.get("format") === "csv";
        const includeSessions = wantsCsv || ["1", "true"].includes(url.searchParams.get("include_sessions"));
        const result = summarizeSessions(sessions, { from, to, includeSessions, ...getTimeZoneContext(url) });
        if (wantsCsv) {
          const content = sessionsToCsv(result.sessions);
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", "attachment; filename=tokentracker-sessions.csv");
          res.end(content);
          return true;
        }
        json(res, { from, to, ...result });
      } catch (error) {
        json(res, { available: false, error: error?.message || "Session analytics failed" }, 500);
      }
      return true;
    }

    // --- metadata-only session browser (LOCAL ONLY) ---
    // Unlike session-insights this returns per-session rows that retain the
    // raw session_id + local project path so the dashboard can offer one-click
    // resume. It is intentionally served only from the local API and never
    // proxied to the cloud account view.
    if (p === "/functions/tokentracker-sessions") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const refresh = ["1", "true"].includes(url.searchParams.get("refresh"));
      const limitParam = parseInt(url.searchParams.get("limit") || "0", 10);
      const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 2000) : 0;
      // This payload contains local paths and resumable session identifiers.
      // The server is loopback-only; additionally prevent browser/proxy caches
      // from retaining the response after the page is closed.
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const tzCtx = getTimeZoneContext(url);
      const cacheKey = `${from}|${to}|${limit}|${tzCtx.timeZone || ""}|${tzCtx.offsetMinutes || 0}`;
      const now = Date.now();
      if (
        !refresh &&
        _sessionsCache &&
        now - _sessionsCache.timestamp < SESSIONS_CACHE_TTL_MS &&
        _sessionsCache.key === cacheKey
      ) {
        await require("./sessions-response").writeSessionsResponse(req, res, _sessionsCache.payload);
        return true;
      }

      const buildSessions = async () => {
        const { buildSessionAnalytics, applyQoderSessionUsageEstimates, applyWallClockSpeed } = require("./session-analytics");
        const sessions = await buildSessionAnalytics({ force: refresh });
        applyQoderSessionUsageEstimates(sessions, await loadSessionQueueRows());
        for (const session of sessions) applyWallClockSpeed(session);
        return sessions;
      };
      const { listSessionsForBrowser } = require("./session-analytics");

      // Stale-while-revalidate：缓存未命中时先秒回磁盘上的上一次完整集合
      // （标 stale），后台重建完成后 L1/L2 一起翻新。冷启动（无磁盘缓存）
      // 与显式 refresh=1 保持原同步构建路径。
      const stale = !refresh ? await getSessionsDiskCache().load() : null;
      // Another request can populate L1 while this one awaits the disk read.
      if (!refresh && _sessionsCache?.key === cacheKey && Date.now() - _sessionsCache.timestamp < SESSIONS_CACHE_TTL_MS) {
        await require("./sessions-response").writeSessionsResponse(req, res, _sessionsCache.payload);
        return true;
      }
      if (stale) {
        const result = listSessionsForBrowser(stale.sessions, { from, to, limit, ...tzCtx });
        const payload = { from, to, stale: true, asOf: stale.savedAt, ...result };
        _sessionsCache = { key: cacheKey, timestamp: Date.now(), payload };
        await require("./sessions-response").writeSessionsResponse(req, res, payload);
        if (!_sessionsRebuildPromise) {
          _sessionsRebuildPromise = (async () => {
            try {
              await yieldToRequests();
              const sessions = await buildSessions();
              persistSessionsDiskCache(sessions);
              _sessionsCache = {
                key: cacheKey,
                timestamp: Date.now(),
                payload: { from, to, ...listSessionsForBrowser(sessions, { from, to, limit, ...tzCtx }) },
              };
            } catch (error) {
              console.warn("[local-api] session background rebuild failed:", error?.message || error);
            } finally {
              _sessionsRebuildPromise = null;
            }
          })();
        }
        return true;
      }

      try {
        // Explicit refresh waits for the older scan before forcing a new one.
        if (_sessionsRebuildPromise) await _sessionsRebuildPromise;
        const sessions = await buildSessions();
        persistSessionsDiskCache(sessions);
        const result = listSessionsForBrowser(sessions, { from, to, limit, ...tzCtx });
        const payload = { from, to, ...result };
        _sessionsCache = {
          key: cacheKey,
          timestamp: Date.now(),
          payload,
        };
        await require("./sessions-response").writeSessionsResponse(req, res, payload);
      } catch (error) {
        // Node fs errors embed the absolute path ("EACCES ... open '/Users/…'").
        // Keep that out of the HTTP body and log it locally instead.
        console.warn("[local-api] session browser failed:", error?.message || error);
        json(res, { available: false, error: "Session browser failed" }, 500);
      }
      return true;
    }

    // --- local usage snapshot transfer (single-machine export/import) ---
    if (p === "/functions/tokentracker-local-usage") {
      // 审计 2026-10-25 P0-2：export 搬运整份队列快照、import 直写队列，是 13 个
      // 写端点里唯一没设防的——补齐与其他突变端点同门槛（令牌 + loopback origin，
      // 跨站一律拒）。dashboard 的备份 UI 本就随请求带令牌，不受影响。
      if (!isAuthorizedLocalMutation(req) || req.headers["sec-fetch-site"] === "cross-site") {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      const transfer = require("./local-usage-transfer");
      res.setHeader("Cache-Control", "no-store");
      try {
        // All transfer calls stream the queue — it outgrew one-shot reads
        // (540MB > Node max string length); see local-usage-transfer.js.
        if (req.method === "GET") {
          json(res, await transfer.describeLocalUsage());
          return true;
        }
        if (req.method !== "POST") {
          json(res, { code: "method_not_allowed", error: "POST required" }, 405);
          return true;
        }
        const raw = await readBodyLimited(req, 6 * 1024 * 1024);
        let body = {};
        try {
          body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        } catch {
          json(res, { code: "invalid_snapshot", error: "Malformed JSON body" }, 400);
          return true;
        }
        const action = body?.action;
        if (action === "export") {
          const before = typeof body.before === "string" && body.before ? body.before : undefined;
          json(res, await transfer.buildSnapshot({ before }));
          return true;
        }
        if (action === "preview") {
          json(res, await transfer.previewSnapshot(body.snapshot));
          return true;
        }
        if (action === "import") {
          json(res, await transfer.importSnapshot(body.snapshot, body.token));
          return true;
        }
        json(res, { code: "unknown_action", error: "Unknown action" }, 400);
      } catch (error) {
        json(res, { code: error?.code || "transfer_failed", error: error?.message || "transfer failed" }, 400);
      }
      return true;
    }

    // --- fixed context overhead audit (counts and estimates only) ---
    if (p === "/functions/tokentracker-context-health") {
      const { computeContextHealth } = require("./context-health");
      json(res, computeContextHealth({ home: os.homedir(), cwd: process.cwd(), env: process.env }));
      return true;
    }

    // --- usage-heatmap ---
    if (p === "/functions/tokentracker-usage-heatmap") {
      const weeks = parseInt(url.searchParams.get("weeks") || "52", 10);
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const daily = await aggregateByDay(rows, timeZoneContext);
      const todayParts = getZonedParts(new Date(), timeZoneContext);
      const todayStr = formatPartsDayKey(todayParts) || new Date().toISOString().slice(0, 10);
      const end = new Date(`${todayStr}T00:00:00Z`);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - weeks * 7 + 1);
      const from = start.toISOString().slice(0, 10);
      const to = end.toISOString().slice(0, 10);
      const byDay = new Map(daily.map((d) => [d.day, d]));

      const allValues = daily.map((d) => d.billable_total_tokens).filter((v) => v > 0);
      const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
      const calcLevel = (v) => {
        if (v <= 0) return 0;
        if (v >= 3_000_000_000) return 7; // Lv7 宇宙奇点 · Singularity
        if (maxValue === 0) return 1;
        const r = v / maxValue;
        if (r <= 0.15) return 1;
        if (r <= 0.35) return 2;
        if (r <= 0.55) return 3;
        if (r <= 0.75) return 4;
        if (r <= 0.90) return 5;
        if (r <= 0.98) return 6;
        return 7;
      };

      // Build cells and group into weeks (array of 7-cell arrays) for the dashboard
      const cells = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const data = byDay.get(day);
        const billable = data?.billable_total_tokens || 0;
        cells.push({ day, total_tokens: data?.total_tokens || 0, billable_total_tokens: billable,
          // Per-day spend rides along so the heatmap tooltip can show it without
          // a second round trip; the day rows already priced this bucket.
          total_cost_usd: data?.total_cost_usd || 0,
          level: calcLevel(billable), models: data?.models || null });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const weeksArr = [];
      for (let i = 0; i < cells.length; i += 7) {
        weeksArr.push(cells.slice(i, i + 7));
      }

      let totalCostUsd = 0;
      for (const d of daily) {
        if (d.day >= from && d.day <= to) {
          totalCostUsd += d.total_cost_usd || 0;
        }
      }

      json(res, { 
        from, 
        to, 
        scope, 
        excluded_sources: excludedSources, 
        week_starts_on: "sun", 
        active_days: cells.filter((c) => c.billable_total_tokens > 0).length, 
        streak_days: 0, 
        weeks: weeksArr,
        total_cost_usd: totalCostUsd
      });
      return true;
    }

    // --- usage-model-breakdown ---
    if (p === "/functions/tokentracker-usage-model-breakdown") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: scopedRows, scope, excludedSources } = await scopedRowsForUrl(url);
      // The full O(rows) re-price is the heaviest aggregate on the dashboard
      // (measured 2.4s+ even for a 7-day window, because the loop walks every
      // row regardless of from/to). Memoized per (queue generation, params) —
      // see the read-memo note near AGGREGATION_BATCH_ROWS. cursors.json's
      // mtime joins the key: the TRAE self-evidence below is read from it, not
      // from the queue.
      let result;
      try {
        result = await modelBreakdownReadMemo(
          scopedRows,
          `${timeZoneContextKey(timeZoneContext)}|${from}|${to}|${cursorsMtimeMs(qp)}`,
          () => computeUsageModelBreakdownSources({ scopedRows, timeZoneContext, from, to, qp }),
        );
      } catch (error) {
        if (error === PRICING_REVISION_CHANGED) return handleLocalApi(req, res, url);
        throw error;
      }
      json(res, {
        from, to, days: 0, scope, excluded_sources: excludedSources, sources: result.sources, trae_estimate_applied: true,
        pricing: { model: "per-model", pricing_mode: "per_token_type", source: "litellm", effective_from: new Date().toISOString().slice(0, 10) },
      });
      return true;
    }

    // --- usage-category-breakdown (Claude + Codex + Grok) ---
    // Claude: splits historical Claude usage into seven semantic categories
    // mirroring Claude Code's /context view (approx).
    // Codex/Grok: tool-oriented breakdown, attributing per-turn token
    // totals to observed tool calls (heuristic).
    if (p === "/functions/tokentracker-usage-category-breakdown") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const requestedSource = (url.searchParams.get("source") || "claude").trim().toLowerCase();
      if (requestedSource === "claude") {
        try {
          const result = await computeClaudeCategoryBreakdown({ from, to, projectDir: process.cwd() });
          json(res, { from, to, ...result });
        } catch (e) {
          console.error("[LocalAPI] usage-category-breakdown:", e?.message || e);
          json(res, { from, to, ...unsupportedCategoryPayload("claude"), error: "compute_failed" }, 500);
        }
        return true;
      }

      if (requestedSource === "codex") {
        try {
          const timeZoneContext = getTimeZoneContext(url);
          const result = await computeCodexContextBreakdown({
            from,
            to,
            top: 50,
            timeZoneContext,
          });
          if (!Number(result?.totals?.total_tokens || 0)) {
            const fallback = buildCodexCategoryFallbackFromQueue(await readQueueData(qp), {
              from,
              to,
              timeZoneContext,
            });
            json(res, { from, to, ...fallback });
            return true;
          }
          json(res, { from, to, ...result });
        } catch (e) {
          console.error("[LocalAPI] usage-category-breakdown(codex):", e?.message || e);
          json(res, { from, to, ...unsupportedCategoryPayload("codex"), error: "compute_failed" }, 500);
        }
        return true;
      }

      if (requestedSource === "grok") {
        try {
          const timeZoneContext = getTimeZoneContext(url);
          const result = await computeGrokContextBreakdown({
            from,
            to,
            top: 50,
            timeZoneContext,
          });
          json(res, { from, to, ...result });
        } catch (e) {
          console.error("[LocalAPI] usage-category-breakdown(grok):", e?.message || e);
          json(res, { from, to, ...unsupportedCategoryPayload("grok"), error: "compute_failed" }, 500);
        }
        return true;
      }

      json(res, { from, to, ...unsupportedCategoryPayload(requestedSource) });
      return true;
    }

    // --- agent2api-speed ---
    // Per-model token speed from the gateway's own request ledger. Every 200
    // request carries duration_ms and (for streamed replies) first_response_ms
    // natively, so these are measured values — not timestamp-delta estimates.
    // The gateway only sees requests routed through Agent2API, so models used
    // directly by other CLIs never appear here; the session sidecar's
    // wall-clock performance (the same numbers the sessions page shows) is
    // folded in as a second evidence tier, clearly labelled. Gateway rows win
    // for a model they both cover: gateway duration is a per-request measured
    // value, the sidecar's is an active-time estimate.
    // Local-only by nature: both databases live on this machine.
    if (p === "/functions/tokentracker-agent2api-speed") {
      const timeZoneContext = getTimeZoneContext(url);
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const hasRange = Boolean(from || to);
      const dayInRange = (day) => {
        if (!hasRange) return true;
        if (!day) return false;
        return (!from || day >= from) && (!to || day <= to);
      };
      // The session tier is computed FIRST so it can also answer when the
      // gateway database is missing or locked — a user with no Agent2API
      // gateway at all still gets the sessions page's numbers here instead of
      // a bare "unavailable". Gateway rows keep priority in the merge below.
      //
      // The aggregation runs inside a memo keyed on (sidecar file signature,
      // range+timezone): readSessionSidecar parses ~1,500 session rows and
      // listSessionsForBrowser re-derives day keys for all of them, ~2s of
      // SYNCHRONOUS work on this machine (measured), and the endpoint refetches
      // on every mount and every period switch — uncached that would stall the
      // HTTP event loop for its full cost on each navigation. A sidecar append
      // changes the signature and recomputes immediately; the 10s TTL bounds
      // staleness for in-place rewrites that somehow keep the signature.
      let sessionModels = [];
      try {
        const sidecarPath = path.join(path.dirname(qp), "session.queue.jsonl");
        sessionModels = await speedSessionTierReadMemo(
          queueFileSignature(sidecarPath),
          `${timeZoneContextKey(timeZoneContext)}|${from}|${to}`,
          () => computeSpeedSessionTier({ qp, from, to, timeZoneContext }),
        );
      } catch (error) {
        // A malformed sidecar only shrinks the payload back to gateway rows.
        console.warn("[local-api] agent2api-speed session tier unavailable:", error?.message || error);
      }

      const dbPath = resolveAgent2ApiDbPath(process.env);
      if (!dbPath || !fs.existsSync(dbPath)) {
        json(res, {
          generated_at: new Date().toISOString(),
          available: sessionModels.length > 0,
          models: sessionModels,
        });
        return true;
      }
      let rows = [];
      try {
        rows = await readSqliteJsonRowsAsync(
          dbPath,
          "SELECT model, ts, duration_ms, first_response_ms, completion_tokens FROM requests "
            + "WHERE status = 200 AND duration_ms > 0 AND completion_tokens > 0",
          { label: "Agent2API speed", maxBuffer: 32 * 1024 * 1024, timeout: 30_000, readOnly: true },
        );
      } catch (err) {
        // A writer lock on the gateway database must not 500 the dashboard;
        // the session tier still answers.
        json(res, {
          generated_at: new Date().toISOString(),
          available: sessionModels.length > 0,
          models: sessionModels,
          error: String(err?.message || err),
        });
        return true;
      }
      const byModel = new Map();
      let matched = 0;
      for (const raw of rows) {
        const row = { hour_start: new Date(Number(raw.ts)).toISOString() };
        if (hasRange && !dayInRange(rowDayKey(row, timeZoneContext))) continue;
        matched += 1;
        const model = String(raw.model || "").trim() || "unknown";
        let entry = byModel.get(model);
        if (!entry) {
          entry = { model, requests: 0, output_tokens: 0, duration_ms: 0, first_response_total_ms: 0, first_response_samples: 0 };
          byModel.set(model, entry);
        }
        entry.requests += 1;
        entry.output_tokens += Number(raw.completion_tokens) || 0;
        entry.duration_ms += Number(raw.duration_ms) || 0;
        const ttft = Number(raw.first_response_ms) || 0;
        if (ttft > 0) {
          entry.first_response_total_ms += ttft;
          entry.first_response_samples += 1;
        }
      }
      // Gateway rows keep priority over the pre-computed session tier: a
      // model the gateway measured shows per-request numbers, and the
      // session tier only fills the models the gateway never saw.
      const models = [...byModel.values()].map((entry) => ({
        model: entry.model,
        requests: entry.requests,
        output_tokens: entry.output_tokens,
        duration_ms: entry.duration_ms,
        tokens_per_second: entry.duration_ms > 0
          ? Math.round((entry.output_tokens * 1000 / entry.duration_ms) * 10) / 10
          : null,
        avg_first_response_ms: entry.first_response_samples > 0
          ? Math.round(entry.first_response_total_ms / entry.first_response_samples)
          : null,
        speed_source: "gateway",
      // Gateway rows keep priority: the session tier only fills models the
      // gateway never saw, so a model measured by both keeps its measured
      // per-request numbers instead of a wall-clock estimate.
      })).concat(sessionModels.filter((m) => !byModel.has(m.model))).sort((a, b) => b.output_tokens - a.output_tokens);
      json(res, {
        generated_at: new Date().toISOString(),
        available: true,
        from,
        to,
        matched_requests: matched,
        models,
      });
      return true;
    }

    // --- project-usage-summary ---
    if (p === "/functions/tokentracker-project-usage-summary") {
      // Use the per-project bucket log that rollout.js emits — it already
      // carries the actual tokens attributed to each (project_key, source,
      // hour_start). Falling back to "session-file count × total tokens"
      // (the old behavior) produced pure fiction: every short-and-hot
      // project got the same weight as every long-and-cold one.
      const limitParam = Number(url.searchParams.get("limit"));
      const limit = Number.isFinite(limitParam) && limitParam > 0
        ? Math.min(Math.floor(limitParam), PROJECT_USAGE_MAX_ENTRIES)
        : PROJECT_USAGE_MAX_ENTRIES;
      const { timeZoneContext, from, to, projectRows } =
        await readProjectUsageContext(qp, url);
      // The 707MB project queue makes this the heaviest single request in the
      // dashboard's fan-out (measured 3.6s all-time). Memoized per (queue
      // generation, params) — see the read-memo note near AGGREGATION_BATCH_ROWS.
      const entries = await projectSummaryReadMemo(
        projectRows,
        `${timeZoneContextKey(timeZoneContext)}|${from}|${to}|${limit}`,
        () => computeProjectUsageEntries({ projectRows, timeZoneContext, from, to, limit, qp }),
      );

      json(res, { generated_at: new Date().toISOString(), entries });
      return true;
    }

    // --- project-usage-detail ---
    // Per-project drill-down for the Project Usage modal: daily series,
    // per-source breakdown, and aggregate stats. Everything comes from the
    // local project bucket log — no external requests, no git access.
    if (p === "/functions/tokentracker-project-usage-detail") {
      const projectKey = url.searchParams.get("project_key") || "";
      if (!projectKey) {
        json(res, { error: "missing_project_key" }, 400);
        return true;
      }
      const { from, to, timeZoneContext, dayInRange, projectRows } =
        await readProjectUsageContext(qp, url);

      const emptyMeasures = () => ({
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
      const addMeasures = (acc, row) => {
        acc.total_tokens += Number(row.total_tokens || 0);
        acc.billable_total_tokens += Number(
          row.billable_total_tokens ?? row.total_tokens ?? 0,
        );
        acc.input_tokens += Number(row.input_tokens || 0);
        acc.output_tokens += Number(row.output_tokens || 0);
        acc.cached_input_tokens += Number(row.cached_input_tokens || 0);
        acc.cache_creation_input_tokens += Number(row.cache_creation_input_tokens || 0);
        acc.reasoning_output_tokens += Number(row.reasoning_output_tokens || 0);
        acc.conversation_count += Number(row.conversation_count || 0);
      };

      let projectRef = "";
      const totals = emptyMeasures();
      const byDay = new Map();
      const bySource = new Map();
      let rangeTotalTokens = 0;
      let processed = 0;
      for (const row of projectRows) {
        if (++processed % AGGREGATION_BATCH_ROWS === 0) await yieldToRequests();
        const day = rowDayKey(row, timeZoneContext);
        if (!dayInRange(day)) continue;
        rangeTotalTokens += Number(row.total_tokens || 0);
        if (row.project_key !== projectKey) continue;
        if (!projectRef && row.project_ref) projectRef = row.project_ref;
        addMeasures(totals, row);

        const src = row.source || "unknown";
        if (day) {
          // `models` keyed by source (project rows carry no model column) —
          // it feeds TrendMonitor's stacked-segment slot so the modal chart
          // colors by provider exactly like the dashboard's Usage Trend.
          if (!byDay.has(day)) byDay.set(day, { day, ...emptyMeasures(), models: {} });
          const dayAgg = byDay.get(day);
          addMeasures(dayAgg, row);
          dayAgg.models[src] = (dayAgg.models[src] || 0) + Number(row.total_tokens || 0);
        }

        if (!bySource.has(src)) {
          bySource.set(src, {
            source: src,
            total_tokens: 0,
            conversation_count: 0,
            dayKeys: new Set(),
          });
        }
        const srcAgg = bySource.get(src);
        srcAgg.total_tokens += Number(row.total_tokens || 0);
        srcAgg.conversation_count += Number(row.conversation_count || 0);
        if (day) srcAgg.dayKeys.add(day);
      }

      json(res, {
        generated_at: new Date().toISOString(),
        from,
        to,
        project_key: projectKey,
        project_ref: projectRef,
        totals,
        days_active: byDay.size,
        // All-project total over the same range so the client can render
        // "share of everything you tracked" without a second request.
        range_total_tokens: rangeTotalTokens,
        daily: Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day)),
        sources: Array.from(bySource.values())
          .sort((a, b) => b.total_tokens - a.total_tokens)
          .map(({ dayKeys, ...src }) => ({ ...src, days_active: dayKeys.size })),
      });
      return true;
    }

    // --- user-status (stub) ---
    if (p === "/functions/tokentracker-user-status") {
      json(res, {
        user_id: "local-user", email: "local@localhost", name: "Local User", is_public: false,
        created_at: new Date().toISOString(),
        pro: { active: true, sources: ["local"], expires_at: null, partial: false, as_of: new Date().toISOString() },
        // Cross-device popover state: whether account aggregation can be served
        // (signed in) and whether the dashboard's cloud-sync toggle is on.
        account: {
          available: Boolean(getRefreshTokenForCloud()),
          cloud_sync_enabled: getCloudSyncPref(),
          account_view: Boolean(getRefreshTokenForCloud()) && getCloudSyncPref(),
        },
      });
      return true;
    }

    // --- cloud-sync preference mirror ---
    // The dashboard's Settings → Account → Cloud sync toggle (a WebView
    // localStorage flag) is mirrored here so the auth-unaware native popover can
    // gate its account (cross-device) view on the same preference.
    if (p === "/functions/tokentracker-cloud-sync-pref") {
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, {
          enabled: getCloudSyncPref(),
          account_available: Boolean(getRefreshTokenForCloud()),
        });
        return true;
      }
      if (method === "POST" || method === "PUT") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          body = {};
        }
        // Reject malformed payloads rather than silently coercing them to a
        // persisted `false` — this file is the shared cloud-sync preference, so
        // a bad write would desync the popover from the dashboard.
        if (typeof body?.enabled !== "boolean") {
          json(res, { ok: false, error: "enabled must be a boolean" }, 400);
          return true;
        }
        if (body.changedAtMs != null && (!Number.isSafeInteger(body.changedAtMs) || body.changedAtMs < 0)) {
          json(res, { ok: false, error: "changedAtMs must be a nonnegative safe integer" }, 400);
          return true;
        }
        setCloudSyncPref(body.enabled, body.changedAtMs ?? Date.now());
        json(res, { ok: true, enabled: getCloudSyncPref() });
        return true;
      }
      json(res, { error: "Method Not Allowed" }, 405);
      return true;
    }

    // --- outbound proxy preference (manual / system / off) ---
    // Persisted on config.json next to the queue. GET is unauthenticated so the
    // settings page can probe availability; POST requires local-auth.
    if (p === "/functions/tokentracker-proxy-config") {
      const {
        normalizeProxyConfig,
        parseProxyPayload,
      } = require("./proxy-settings");
      const {
        applyUndiciProxyIfNeeded,
        getLastProxyApplyError,
        resolveEffectiveProxySource,
        invalidateSystemProxyCache,
      } = require("./proxy-env");
      const { writeFileAtomic, chmod600IfPossible } = require("./fs");
      const configPath = path.join(path.dirname(qp), "config.json");
      const readConfig = () => {
        try {
          const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
          return parsed && typeof parsed === "object" ? parsed : {};
        } catch {
          return {};
        }
      };
      const writeConfig = async (next) => {
        await writeFileAtomic(configPath, JSON.stringify(next, null, 2));
        await chmod600IfPossible(configPath);
      };
      const toResponse = (configObj) => {
        const normalized = normalizeProxyConfig(configObj?.proxy);
        const effective = resolveEffectiveProxySource({
          env: process.env,
          proxyConfig: configObj?.proxy,
        });
        return {
          mode: normalized.mode,
          protocol: normalized.protocol,
          host: normalized.host,
          port: normalized.port,
          effective: effective.source,
          applyError: getLastProxyApplyError(),
        };
      };
      const method = String(req.method || "GET").toUpperCase();
      if (method === "GET") {
        json(res, toResponse(readConfig()));
        return true;
      }
      if (method === "POST" || method === "PUT") {
        if (!isAuthorizedLocalMutation(req)) {
          json(res, { ok: false, error: "Unauthorized" }, 401);
          return true;
        }
        let body = {};
        try {
          body = await readJsonBody(req);
        } catch {
          json(res, { ok: false, error: "invalid JSON" }, 400);
          return true;
        }
        const parsed = parseProxyPayload(body);
        if (!parsed.ok) {
          json(res, { ok: false, error: parsed.error }, 400);
          return true;
        }
        const current = readConfig();
        const prevProxy = current.proxy && typeof current.proxy === "object" && !Array.isArray(current.proxy)
          ? current.proxy
          : {};
        current.proxy = {
          ...prevProxy,
          mode: parsed.value.mode,
          protocol: parsed.value.protocol,
          host: parsed.value.host,
          port: parsed.value.port,
        };
        try {
          await writeConfig(current);
        } catch (error) {
          json(res, { ok: false, error: error?.message || "failed to save proxy config" }, 500);
          return true;
        }
        invalidateSystemProxyCache();
        const applyResult = applyUndiciProxyIfNeeded({ proxyConfig: current.proxy });
        json(res, {
          ok: applyResult?.ok !== false,
          unprotected: applyResult?.unprotected === true,
          ...toResponse(current),
        });
        return true;
      }
      json(res, { error: "Method Not Allowed" }, 405);
      return true;
    }

    if (p === "/functions/tokentracker-proxy-test") {
      const { parseProxyPayload, buildProxyUrl } = require("./proxy-settings");
      const { runProxyConnectivityTest } = require("./proxy-env");
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { ok: false, error: "invalid JSON" }, 400);
        return true;
      }
      const parsed = parseProxyPayload({ ...body, mode: "manual" });
      if (!parsed.ok) {
        json(res, { ok: false, error: parsed.error }, 400);
        return true;
      }
      const proxyUrl = buildProxyUrl({ ...parsed.value, mode: "manual" });
      const configPath = path.join(path.dirname(qp), "config.json");
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(configPath, "utf8")) || {};
      } catch {
        config = {};
      }
      const runtime = resolveRuntimeConfig({ config, env: process.env });
      const targetUrl = runtime.dashboardUrl || runtime.baseUrl;
      const result = await runProxyConnectivityTest({
        proxyUrl,
        targetUrl,
        timeoutMs: 5000,
      });
      json(res, result);
      return true;
    }

    // --- telemetry preference (anonymous analytics opt-out mirror) ---
    // The dashboard's analytics init on localhost / native-app surfaces asks
    // this before sending anything, so TOKENTRACKER_NO_TELEMETRY /
    // DO_NOT_TRACK / config.json `"telemetry": false` turn off dashboard
    // analytics together with the daily heartbeat (src/lib/telemetry.js).
    if (p === "/functions/tokentracker-telemetry-pref") {
      const { isTelemetryDisabled } = require("./telemetry");
      let config = {};
      try {
        config = JSON.parse(fs.readFileSync(path.join(path.dirname(qp), "config.json"), "utf8")) || {};
      } catch {
        config = {};
      }
      json(res, { disabled: isTelemetryDisabled({ env: process.env, config }) });
      return true;
    }

    // --- machine-id (stable per-machine device identity for cloud sync) ---
    // The dashboard reads this before issuing a cloud device token so the
    // device_name keys on the MACHINE, not the browser — see
    // getOrCreateMachineId above and dashboard/src/lib/cloud-sync.ts.
    if (p === "/functions/tokentracker-machine-id") {
      json(res, {
        machineId: getOrCreateMachineId(qp),
        deviceName: getSystemDeviceName(),
      });
      return true;
    }

    // --- usage-hourly (stub for day-view) ---
    if (p === "/functions/tokentracker-usage-hourly") {
      const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const data = await aggregateHourlyByDay(rows, day, timeZoneContext);
      json(res, { day, scope, excluded_sources: excludedSources, data });
      return true;
    }

    // --- usage-monthly (stub for trend view) ---
    if (p === "/functions/tokentracker-usage-monthly") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = await scopedRowsForUrl(url);
      const byMonth = new Map();
      let processed = 0;
      for (const row of rows) {
        if (++processed % AGGREGATION_BATCH_ROWS === 0) await yieldToRequests();
        if (!row.hour_start) continue;
        const day = rowDayKey(row, timeZoneContext);
        if (!day || day < from || day > to) continue;
        const month = day.slice(0, 7);
        if (!byMonth.has(month))
          byMonth.set(month, { month, total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0, total_cost_usd: 0 });
        const monthAcc = byMonth.get(month);
        monthAcc.total_cost_usd = (monthAcc.total_cost_usd || 0) + foldTraeRowCost(row, computeRowCost(row));
        const a = byMonth.get(month);
        a.total_tokens += row.total_tokens || 0;
        a.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
        a.input_tokens += row.input_tokens || 0;
        a.output_tokens += row.output_tokens || 0;
        a.cached_input_tokens += row.cached_input_tokens || 0;
        a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        a.conversation_count += row.conversation_count || 0;

        if (!a.models) {
          a.models = {};
        }
        const model = row.model || "unknown";
        a.models[model] = (a.models[model] || 0) + (row.total_tokens || 0);
      }
      json(res, { from, to, scope, excluded_sources: excludedSources, data: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)) });
      return true;
    }

    // --- Codex-compatible pet manager ---
    if (p === "/functions/tokentracker-pets") {
      const method = String(req.method || "GET").toUpperCase();
      const pets = require("./pet-packages");
      try {
        if (method === "GET") {
          if (url.searchParams.get("scope") === "codex") {
            const importable = pets.listCodexImportablePets();
            json(res, { importable, codexDetected: importable.length > 0 });
            return true;
          }
          json(res, {
            pets: pets.listInstalledPets(),
            hiddenBuiltinIds: pets.readHiddenBuiltinIds(),
          });
          return true;
        }
        if (method === "POST") {
          if (!isAuthorizedLocalMutation(req)) {
            json(res, { ok: false, error: "Unauthorized" }, 401);
            return true;
          }
          const body = await readJsonBody(req);
          if (body?.action === "install_url") {
            json(res, { ok: true, pet: await pets.installFromCodexPets(body.url || body.id) });
            return true;
          }
          if (body?.action === "remove") {
            json(res, { ok: true, ...pets.removeInstalledPet(body.id) });
            return true;
          }
          if (body?.action === "import_codex") {
            json(res, { ok: true, ...pets.importFromCodex(body.ids) });
            return true;
          }
          json(res, { ok: false, error: "Unknown pets action" }, 400);
          return true;
        }
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
      } catch (error) {
        json(res, { ok: false, error: error?.message || "Pet operation failed" }, 400);
      }
      return true;
    }

    // --- skills manager ---
    if (p === "/functions/tokentracker-skills") {
      const method = String(req.method || "GET").toUpperCase();
      const skills = require("./skills-manager");
      try {
        if (method === "GET") {
          const mode = url.searchParams.get("mode") || "installed";
          if (mode === "installed") {
            json(res, { targets: skills.targetList(), skills: skills.listInstalledSkills() });
            return true;
          }
          if (mode === "repos") {
            json(res, { repos: skills.listRepos() });
            return true;
          }
          if (mode === "discover") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.discoverSkills({ force }));
            return true;
          }
          if (mode === "search") {
            const data = await skills.searchSkillsSh(
              url.searchParams.get("q") || "",
              Number(url.searchParams.get("limit") || 20),
              Number(url.searchParams.get("offset") || 0),
            );
            json(res, data);
            return true;
          }
          if (mode === "popular") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.fetchPopularSkillsSh({ force }));
            return true;
          }
          if (mode === "updates") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.checkUpdates({ force }));
            return true;
          }
          if (mode === "activity") {
            const limit = Number(url.searchParams.get("limit") || 50);
            json(res, { activity: skills.readActivity(limit) });
            return true;
          }
          if (mode === "skill_usage") {
            const force = url.searchParams.get("force") === "1";
            const usage = await require("./skill-usage").scanSkillUsage({ force });
            await ensurePricingLoaded();
            // Join raw per-skill aggregates against installed skills so we can
            // separate user-installed skills (where "dead weight" = unused) from
            // Claude Code built-in tools (bash/agent/…), which dominate the logs
            // and are NOT uninstallable. Cost is priced per-model (source=claude).
            const installed = skills.listInstalledSkills();
            const skillDirectoryLeaf = (value) =>
              String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop()?.trim().toLowerCase() || "";
            const leafCounts = new Map();
            for (const s of installed) {
              const leaf = skillDirectoryLeaf(s.directory);
              if (leaf) leafCounts.set(leaf, (leafCounts.get(leaf) || 0) + 1);
            }
            const installedByDirectory = new Map();
            const installedByLeaf = new Map();
            const nameCounts = new Map();
            const installedByName = new Map();
            for (const s of installed) {
              const dir = String(s.directory || "").trim().toLowerCase();
              if (dir) installedByDirectory.set(dir, s);
              const leaf = skillDirectoryLeaf(s.directory);
              if (leaf && leafCounts.get(leaf) === 1) installedByLeaf.set(leaf, s);
              const name = String(s.name || "").trim().toLowerCase();
              if (name) {
                nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
                if (!installedByName.has(name)) installedByName.set(name, s);
              }
            }
            const findInstalledSkill = (value) => {
              const norm = String(value || "").trim().toLowerCase();
              if (!norm) return null;
              if (installedByDirectory.has(norm)) return installedByDirectory.get(norm);
              if (installedByLeaf.has(norm)) return installedByLeaf.get(norm);
              if (nameCounts.get(norm) === 1) return installedByName.get(norm);
              if (leafCounts.get(norm) > 1) return null;
              return null;
            };
            const usedSkillIds = new Set();
            const priced = usage.skills.map((entry) => {
              let cost = 0;
              for (const [model, tokens] of Object.entries(entry.models || {})) {
                cost += computeRowCost({ ...tokens, model, source: "claude" });
              }
              const match = findInstalledSkill(entry.skill);
              if (match?.id) usedSkillIds.add(match.id);
              return {
                skill: entry.skill,
                invocations: entry.invocations,
                lastUsedAt: entry.lastUsedAt,
                tokens: entry.tokens,
                cost,
                installed: Boolean(match),
                skillId: match?.id || null,
                directory: match?.directory || null,
              };
            });
            // Installed skills with zero invocations = dead-weight candidates.
            const unusedInstalled = installed
              .filter((s) => !s.readOnly && !usedSkillIds.has(s.id))
              .map((s) => ({ skillId: s.id, directory: s.directory, name: s.name }));
            json(res, {
              generatedAt: usage.generatedAt,
              scannedFiles: usage.scannedFiles,
              totalInvocations: usage.totalInvocations,
              cached: usage.cached,
              skills: priced,
              unusedInstalled,
            });
            return true;
          }
          json(res, { error: "Unknown skills mode" }, 400);
          return true;
        }

        if (method === "POST") {
          if (!isAuthorizedLocalMutation(req)) {
            json(res, { ok: false, error: "Unauthorized" }, 401);
            return true;
          }
          const body = await readJsonBody(req);
          const action = String(body?.action || "");
          if (action === "install") {
            json(res, { ok: true, skill: await skills.installSkill(body.skill, body.targets || ["claude", "codex"]) });
            return true;
          }
          if (action === "update_all") {
            // Partial success is normal, so this reports per-skill rather than failing.
            json(res, { ok: true, ...(await skills.updateSkills(Array.isArray(body.ids) ? body.ids : [])) });
            return true;
          }
          if (action === "uninstall") {
            json(res, { ok: true, ...(skills.uninstallSkill(body.id) || {}) });
            return true;
          }
          if (action === "restore") {
            json(res, { ok: true, skill: skills.restoreSkill(body.id) });
            return true;
          }
          if (action === "set_targets") {
            json(res, { ok: true, skill: skills.setSkillTargets(body.id, body.targets || []) });
            return true;
          }
          if (action === "import_local") {
            json(res, { ok: true, skill: skills.importLocalSkill(body.directory, body.targets || []) });
            return true;
          }
          if (action === "delete_local") {
            json(res, { ok: true, ...(skills.deleteLocalSkill(body.directory, body.targets || []) || {}) });
            return true;
          }
          if (action === "add_repo") {
            json(res, { ok: true, repo: skills.addRepo(body.repo) });
            return true;
          }
          if (action === "remove_repo") {
            json(res, { ok: true, ...(skills.removeRepo(body.owner, body.name) || {}) });
            return true;
          }
          json(res, { ok: false, error: "Unknown skills action" }, 400);
          return true;
        }

        json(res, { ok: false, error: "Method Not Allowed" }, 405);
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unknown skills error" }, 500);
      }
      return true;
    }

// --- achievements (local badges) ---
    if (p === "/functions/tokentracker-achievements") {
      const timeZoneContext = getTimeZoneContext(url);
      const tzKey = `${timeZoneContext?.timeZone || ""}:${timeZoneContext?.tzOffsetMinutes || 0}`;
      const now = Date.now();
      const forceRefresh = url.searchParams?.get("force") === "1" || url.searchParams?.get("refresh") === "1";

      // A cold compute replays the whole queue (~3s), so once a payload exists
      // it is served immediately even when stale, and the recompute runs in the
      // background (stale-while-revalidate). Blocking every 60s poll on a 3s
      // replay is what made the achievements page feel slow to load.
      //
      // session_marathon and sprinter are the only badges that read the session
      // sidecar, and building it can mean a full multi-source rescan (30s+ on a
      // cold or degraded cache — KI-033). A cold first request used to hold its
      // response open for that whole scan.
      //
      // It now answers from the sidecar already on disk (a plain file read, no
      // CPU-heavy rescan) and kicks the build off in the background. That keeps
      // the values stable — the stored snapshot is the same data a rebuild would
      // start from — so no badge flickers down while the refresh runs.
      const readStoredSessions = () => {
        try {
          const { readSessionSidecar } = require("./session-analytics");
          // The sidecar sits beside the queue this handler serves, so an
          // isolated home or a test fixture never reads the machine's real
          // session snapshot (resolveSessionSidecarPath takes the home dir,
          // not the tracker dir, so it cannot be reused here).
          return readSessionSidecar(path.join(path.dirname(qp), "session.queue.jsonl"));
        } catch (error) {
          console.warn("[local-api] stored session rows unavailable:", error?.message || error);
          return [];
        }
      };

      const recomputeAchievements = async ({ sessionsPending = false } = {}) => {
        const { allRows } = await scopedRowsForUrl(url);
        const queueRows = allRows;
        const { projectRows } = await readProjectUsageContext(qp, url);
        // Always fold in the stored snapshot: it is a file read, so it costs
        // nothing like a rescan, and it keeps session_marathon/sprinter at their
        // real values instead of dropping them to zero while a rebuild runs.
        const sessions = readStoredSessions();
        const achievements = computeLocalAchievements(queueRows, projectRows, { timeZoneContext, sessions });
        const payload = {
          generated_at: new Date().toISOString(),
          achievements,
          // True while the sidecar is being rebuilt in the background; the
          // values above are already the stored ones, so nothing is withheld.
          sessions_pending: sessionsPending,
        };
        _achievementsCache = {
          timestamp: Date.now(),
          tzKey,
          payload,
          // Kept so the background session refresh can re-derive the badges
          // without replaying the queue a second time.
          queueRows,
          projectRows,
          recomputing: false,
        };
        return payload;
      };

      // Rebuild the session sidecar off the response path, then fold the fresh
      // rows into the cached payload once it lands.
      const refreshSessionsInBackground = () => {
        if (!_achievementsCache || _achievementsCache.recomputing) return;
        _achievementsCache.recomputing = true;
        const cache = _achievementsCache;
        const { buildSessionAnalytics } = require("./session-analytics");
        buildSessionAnalytics({ force: false })
          .then((sessions) => {
            if (_achievementsCache !== cache) return;
            const achievements = computeLocalAchievements(cache.queueRows, cache.projectRows, { timeZoneContext, sessions });
            cache.payload = {
              generated_at: new Date().toISOString(),
              achievements,
              sessions_pending: false,
            };
            cache.recomputing = false;
          })
          .catch((error) => {
            console.warn("[local-api] achievements session refresh failed:", error?.message || error);
            if (_achievementsCache === cache) cache.recomputing = false;
          });
      };

      if (
        !forceRefresh &&
        _achievementsCache &&
        _achievementsCache.tzKey === tzKey
      ) {
        if (now - _achievementsCache.timestamp < ACHIEVEMENTS_CACHE_TTL_MS) {
          json(res, _achievementsCache.payload);
          return true;
        }
        if (!_achievementsCache.recomputing) {
          _achievementsCache.recomputing = true;
          recomputeAchievements().catch((error) => {
            console.warn("[local-api] achievements background refresh failed:", error?.message || error);
            if (_achievementsCache) _achievementsCache.recomputing = false;
          });
        }
        json(res, _achievementsCache.payload);
        return true;
      }

      // Cold cache. `?refresh=1` is an explicit user action on the page: it may
      // wait for a fresh sidecar build, since the user asked for fresh data.
      if (forceRefresh) {
        try {
          const { buildSessionAnalytics } = require("./session-analytics");
          await buildSessionAnalytics({ force: false });
        } catch (error) {
          console.warn("[local-api] achievements refresh session build failed:", error?.message || error);
        }
        const payload = await recomputeAchievements();
        json(res, payload);
        return true;
      }

      // Implicit first paint: answer from the stored sidecar (a file read) and
      // rebuild behind the response, so a cold or degraded session cache no
      // longer holds the first request open for the whole rescan (KI-033).
      const payload = await recomputeAchievements({ sessionsPending: true });
      json(res, payload);
      refreshSessionsInBackground();
      return true;
    }

    // --- leaderboard (local history) ---
    if (p === "/functions/tokentracker-leaderboard") {
      await ensurePricingLoaded();
      const { rows } = await scopedRowsForUrl(url);
      const { projectRows } = await readProjectUsageContext(qp, url);
      json(res, computeLocalLeaderboard(rows, projectRows, {
        period: url.searchParams.get("period") || "week",
        nowMs: Date.now(),
        displayName: getSystemDeviceName(),
        machineId: getOrCreateMachineId(qp),
        timeZoneContext: getTimeZoneContext(url),
      }));
      return true;
    }

    // --- global model leaderboard (Artificial Analysis page, cached locally) ---
    if (p === "/functions/tokentracker-global-models") {
      const { fetchGlobalModels } = require("./global-models");
      json(res, await fetchGlobalModels({
        home: os.homedir(),
        fetchImpl: fetch,
        force: url.searchParams.get("refresh") === "1",
      }));
      return true;
    }

    // --- global model leaderboard, second board (AIHOT page, cached locally) ---
    if (p === "/functions/tokentracker-global-models-aihot") {
      const { fetchAihotModels } = require("./aihot-models");
      json(res, await fetchAihotModels({
        home: os.homedir(),
        category: url.searchParams.get("category") || "overall",
        fetchImpl: fetch,
        force: url.searchParams.get("refresh") === "1",
      }));
      return true;
    }

    // --- desktop-pet shared preferences ---
    // The pet window runs in its own WebView2 profile, so localStorage (and the
    // storage event) never cross between it and the dashboard; this endpoint is
    // the meeting point that keeps the floating quota card in sync with the
    // rows picked on the limits page.
    if (p === "/functions/tokentracker-pet-prefs") {
      const prefsFile = path.join(os.homedir(), ".tokentracker", "tracker", "pet-prefs.json");
      if (String(req.method || "GET").toUpperCase() === "POST") {
        // A cross-site page can POST here as a simple request (no preflight),
        // so gate on the loopback-origin rule instead of the local auth token:
        // the dashboard's plain fetch() does not carry the token, and the only
        // clients that should ever write pet prefs are the two local windows.
        if (!hasAllowedLoopbackOrigin(req?.headers || {}) || req?.headers?.["sec-fetch-site"] === "cross-site") {
          json(res, { error: "Forbidden" }, 403);
          return true;
        }
        try {
          const raw = (await readBodyLimited(req, 64 * 1024)).toString("utf8");
          const body = raw.trim() ? JSON.parse(raw) : {};
          const rows = Array.isArray(body?.limitRows) ? body.limitRows : [];
          const clean = [];
          for (const item of rows) {
            if (typeof item === "string" && item.includes("::") && item.length <= 120 && !clean.includes(item)) {
              clean.push(item);
            }
            if (clean.length >= 6) break;
          }
          fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
          const tmpFile = `${prefsFile}.tmp`;
          fs.writeFileSync(tmpFile, JSON.stringify({ limitRows: clean, updated_at: new Date().toISOString() }));
          fs.renameSync(tmpFile, prefsFile);
          json(res, { ok: true, limitRows: clean });
        } catch (error) {
          json(res, { error: error?.message || "invalid pet prefs body" }, 400);
        }
        return true;
      }
      // Missing file = the user never picked anything (pet falls back to its
      // default rows). An existing file with an empty array = the user
      // unchecked everything — that must read back as [] so the pet drops the
      // stale rows instead of keeping them forever.
      let limitRows = null;
      let prefsExists = false;
      try {
        const parsed = JSON.parse(fs.readFileSync(prefsFile, "utf8"));
        prefsExists = true;
        if (Array.isArray(parsed?.limitRows)) limitRows = parsed.limitRows;
      } catch {
        // Never written yet (or mid-rename, which the atomic write prevents).
      }
      json(res, { limitRows: prefsExists && limitRows === null ? [] : limitRows });
      return true;
    }

    // --- usage-limits ---
    if (p === "/functions/tokentracker-usage-limits") {
      const { getUsageLimits, resetUsageLimitsCache, normalizeHiddenProviders } = require("./usage-limits");
      try {
        // Devin quota is opt-in (Settings > Usage & Limits > Providers). An
        // explicit devin=1 without local authentication is rejected before any
        // cache reset or provider work — silently downgrading it to a disabled
        // response would misreport an enabled client as a disabled provider.
        // Authorization is evaluated unconditionally so the check never depends
        // on the user-controlled opt-in flag itself.
        const localAuthorized = isAuthorizedLocalMutation(req);
        const devinParam = url.searchParams.get("devin");
        const devinEnabled = devinParam === "1" || devinParam === "true";
        // Provider visibility gate (#956): hidden=<csv> names provider rows to
        // skip entirely — no upstream call, no credential read. Like devin=1,
        // an explicit list is honored only together with the loopback auth
        // header (letting an unauthenticated caller scope the fetch would let
        // it pick exactly which credentials to leave alone). Unknown ids are
        // dropped by the normalizer, so the gate only ever narrows.
        const hiddenProviders = normalizeHiddenProviders(url.searchParams.get("hidden"));
        if ((devinEnabled || hiddenProviders) && !localAuthorized) {
          json(res, { error: "Unauthorized" }, 401);
          return true;
        }
        const refreshParam = url.searchParams.get("refresh");
        const forceRefresh = refreshParam === "1" || refreshParam === "true";
        if (forceRefresh) {
          resetUsageLimitsCache();
        }
        const data = await getUsageLimits({
          home: os.homedir(),
          env: process.env,
          platform: process.platform,
          // Punches through the Claude disk fresh-cache (but not the 429
          // cooldown) — an explicit user refresh should hit upstream.
          forceRefresh,
          devinEnabled,
          hiddenProviders,
        });
        json(res, data);
      } catch (e) {
        json(res, { error: e?.message || "Unknown error" }, 500);
      }
      return true;
    }

    // --- opendesign-cookie (POST) ---
    // Persist a hand-copied open-design.ai Cookie header from the limits
    // page paste box. Same contract as qoder-cookie: loopback auth required,
    // POST only, the value is never echoed back.
    if (p === "/functions/tokentracker-opendesign-cookie") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const raw = (await readBodyLimited(req, 64 * 1024)).toString("utf8");
        const body = raw.trim() ? JSON.parse(raw) : {};
        const cookie = typeof body?.cookie === "string" ? body.cookie : "";
        const { writeCookieFile } = require("./opendesign-limits");
        const result = writeCookieFile({ home: os.homedir(), cookie });
        // A normalized-but-rejected cookie must not masquerade as success:
        // the paste box keys its "Saved" state off HTTP status, so an
        // invalid cookie answers 400 like qoder-cookie does.
        if (result.saved === false) {
          json(res, { error: "invalid_cookie" }, 400);
          return true;
        }
        json(res, result);
      } catch (e) {
        json(res, { error: e?.message || "Failed to save cookie" }, 400);
      }
      return true;
    }

    // --- mistral-cookie (POST) ---
    // Persist a hand-copied Mistral Admin Cookie header. Same contract as
    // opendesign-cookie: loopback auth, POST only, never echoed back, and a
    // normalized-but-rejected value answers 400 instead of a fake 200.
    if (p === "/functions/tokentracker-mistral-cookie") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const raw = (await readBodyLimited(req, 64 * 1024)).toString("utf8");
        const body = raw.trim() ? JSON.parse(raw) : {};
        const cookie = typeof body?.cookie === "string" ? body.cookie : "";
        const { writeCookieFile } = require("./mistral-limits");
        const result = writeCookieFile({ home: os.homedir(), cookie });
        if (result.saved === false) {
          json(res, { error: "invalid_cookie" }, 400);
          return true;
        }
        json(res, result);
      } catch (e) {
        json(res, { error: e?.message || "Failed to save cookie" }, 400);
      }
      return true;
    }

    // --- openai-credits-credentials (POST) ---
    // Persist the OpenAI Platform session bearer and organization id copied
    // from the billing page's credit_grants request. Both fields are session
    // credentials: loopback auth, POST only, never echoed back.
    if (p === "/functions/tokentracker-openai-credits-credentials") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const raw = (await readBodyLimited(req, 64 * 1024)).toString("utf8");
        const body = raw.trim() ? JSON.parse(raw) : {};
        const sessionBearer = typeof body?.sessionBearer === "string" ? body.sessionBearer : "";
        const organization = typeof body?.organization === "string" ? body.organization : "";
        const { writeCredentialsFile } = require("./openai-credits-limits");
        const result = writeCredentialsFile({ home: os.homedir(), sessionBearer, organization });
        if (result.saved === false) {
          json(res, { error: result.error || "invalid_credentials" }, 400);
          return true;
        }
        json(res, result);
      } catch (e) {
        json(res, { error: e?.message || "Failed to save credentials" }, 400);
      }
      return true;
    }

    // --- opencode-go-key (POST) ---
    // Persist the OpenCode Go credential pasted into the limits page card.
    // Same contract as the cookie paste boxes: loopback auth required, POST
    // only, never echoed back. Two shapes are accepted and share one file
    // (~/.tokentracker/opencode-go-credentials.json):
    //   { apiKey }  — the official usage API key (authoritative)
    //   { cookie }  — the signed-in opencode.ai `auth` cookie (legacy scrape)
    // so a user without an API key can still get the three windows, and saving
    // either one keeps the other. The previous macOS-only `launchctl setenv`
    // hint was unusable on Windows, which is why this route exists.
    if (p === "/functions/tokentracker-opencode-go-key") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const raw = (await readBodyLimited(req, 64 * 1024)).toString("utf8");
        const body = raw.trim() ? JSON.parse(raw) : {};
        const {
          writeCredentialsFile,
          clearCredentials,
        } = require("./opencode-go-limits");
        if (body?.clear === true) {
          json(res, clearCredentials({ home: os.homedir() }));
          return true;
        }
        const result = writeCredentialsFile({
          home: os.homedir(),
          apiKey: typeof body?.apiKey === "string" ? body.apiKey : undefined,
          authCookie: typeof body?.cookie === "string" ? body.cookie : undefined,
          workspaceId: typeof body?.workspaceId === "string" ? body.workspaceId : undefined,
        });
        // The paste box keys its "Saved" state off the HTTP status, so a
        // rejected value must answer 400 rather than a fake-success 200.
        if (result.saved === false) {
          json(res, { error: result.error || "invalid_credentials" }, 400);
          return true;
        }
        json(res, result);
      } catch (e) {
        json(res, { error: e?.message || "Failed to save credential" }, 400);
      }
      return true;
    }

    // --- qoder-cookie (POST) ---
    // Persist a hand-copied Qoder website cookie from the limits page paste
    // box. The cookie is a session credential, so this is a local mutation:
    // loopback auth required, POST only, and the value is never echoed back.
    if (p === "/functions/tokentracker-qoder-cookie") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const raw = (await readBodyLimited(req, 64 * 1024)).toString("utf8");
        const body = raw.trim() ? JSON.parse(raw) : {};
        const namespace = body?.namespace === "intl" ? undefined : "cn";
        const cookie = typeof body?.cookie === "string" ? body.cookie : "";
        const { writeQoderCookieFile } = require("./qoder-limits");
        const result = writeQoderCookieFile({ home: os.homedir(), namespace, cookie });
        json(res, result);
      } catch (e) {
        json(res, { error: e?.message || "Failed to save cookie" }, 400);
      }
      return true;
    }

    return false;
  };
}

function __setTraeFoldStateForTest({ byModel = null, recognizedRate = 0, edition = "trae-cn" } = {}) {
  traeFoldByEdition = traeFoldByEdition || {
    "trae-cn": emptyTraeEditionState(),
    trae: emptyTraeEditionState(),
  };
  if (!traeFoldByEdition[edition]) traeFoldByEdition[edition] = emptyTraeEditionState();
  traeFoldByEdition[edition] = { byModel: byModel || {}, recognizedRate: Number(recognizedRate) || 0 };
  traeFoldLoadedAt = Date.now();
}

module.exports = {
  createLocalApiHandler,
  __setTraeFoldStateForTest,
  foldTraeRowCost,
  resolveAllowedInsforgeBaseUrl,
  resolveQueuePath,
  // Exported for cross-consumer tests (pricing + native contract lock).
  MODEL_PRICING,
  getModelPricing,
  computeRowCost,
  ensurePricingLoaded,
  // Shared legacy-row correction so every queue reader (main queue, project
  // queue, wrapped aggregator) reports the same numbers for the same data.
  normalizeQueueRow,
  // Machine-stable identity (config.json machineId) — shared with
  // `tracker device-login`; the hostname is only a human-readable label.
  getOrCreateMachineId,
  computeStableMachineId,
  getSystemDeviceName,
  // Local achievement compute — exported for test/local-achievements.test.js.
  computeLocalAchievements,
  resolveQueueRow,
  computeLocalLeaderboard,
  LOCAL_BADGE_THRESHOLDS,
  CLOUD_PARITY_BADGE_THRESHOLDS,
  ALL_LOCAL_BADGE_THRESHOLDS,
};
