"use strict";

/**
 * TRAE cache-fold evidence pools — the single reader both consumers share:
 *
 *   - src/lib/local-api.js folds TRAE-family rows with these pools when the
 *     dashboard prices unmeasured cache (foldTraeRowCost);
 *   - src/commands/sync.js uploads the same pools to the self-host backend
 *     (tokentracker_account_trae_evidence) so the account edge functions can
 *     price the uploaded TRAE rows with the SAME semantics instead of the
 *     list-price ceiling.
 *
 * One reader, two consumers: the upload must never drift from what the local
 * fold actually used, or the account view would price TRAE differently from
 * 本机数据 — the exact drift this batch fixes (owner report 2026-11-15).
 *
 * A pool is EDITION-SCOPED (owner ruling 2026-11-10): trae-cn rows draw on the
 * trae-cn fielded history, trae (intl) rows on their own. The two editions run
 * different model fleets with different cache behavior, so one edition's
 * measured rate must never price the other's dry spell. An edition with no
 * fielded history folds nothing (rows stay at the uncached rate) — evidence is
 * never borrowed across editions, never fabricated.
 */

const { readCursorStateSummary } = require("./cursor-store");
const { resolveTrackerPathsSync } = require("./tracker-paths");

const TRAE_EDITIONS = ["trae-cn", "trae"];

function emptyEditionState() {
  return { byModel: {}, recognizedRate: 0 };
}

function emptyEvidenceState() {
  const state = {};
  for (const edition of TRAE_EDITIONS) state[edition] = emptyEditionState();
  return state;
}

/**
 * Read the per-edition fold evidence from the CURRENT cursor generation.
 * Returns `{ "trae-cn": { byModel, recognizedRate }, trae: { ... } }` where
 * `byModel[model] = { hits, volume }` (cache-observed volume) and
 * `recognizedRate` is the median measured rate across the edition's own
 * fielded models — applied only to models the owner never used, per the
 * 2026-11-07 owner ruling. AGENTS.md global rule: read the active generation
 * through cursor-store, never the frozen cursors.json compat copy.
 */
async function readTraeEvidencePools({ trackerDir } = {}) {
  const state = emptyEvidenceState();
  const summary = await readCursorStateSummary({
    // Resolve via tracker-paths so TOKENTRACKER_HOME (tests, probes, alternate
    // installs) points the fold evidence at the same root every other
    // consumer reads — a raw homedir join reads the wrong root when the env
    // override is set.
    trackerDir: trackerDir ?? resolveTrackerPathsSync().trackerDir,
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
  // workload. Combined with each model's OFFICIAL cache-read price ratio from
  // the pricing tables. Nothing is fabricated: no fielded models at all, or a
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

/**
 * Flatten the pools into the wire rows the ingest edge accepts (and
 * tokentracker_account_trae_evidence stores): one row per (edition, model)
 * with a positive measured volume. Devices with no TRAE history upload
 * nothing — an empty pool must never clobber a real one cloud-side.
 */
function evidenceRowsForUpload(state) {
  const rows = [];
  for (const edition of TRAE_EDITIONS) {
    const pools = state?.[edition]?.byModel || {};
    for (const [model, acc] of Object.entries(pools)) {
      const volume = Math.max(0, Math.round(Number(acc?.volume) || 0));
      const hits = Math.max(0, Math.round(Number(acc?.hits) || 0));
      if (!(volume > 0)) continue;
      rows.push({
        edition,
        model,
        hits: Math.min(hits, volume),
        volume,
      });
    }
  }
  return rows;
}

module.exports = {
  TRAE_EDITIONS,
  emptyEditionState,
  readTraeEvidencePools,
  evidenceRowsForUpload,
};
