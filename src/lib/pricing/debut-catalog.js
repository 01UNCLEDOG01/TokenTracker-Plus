/*
 * Debut catalog for the offline trendsetter badge.
 *
 * The ledger stores whatever string a provider returned, so one model shows up
 * as `deepseek-v4-flash`, `DeepSeek-V4-Flash 正式版`, `deepseek-ai/DeepSeek-V4-Flash`
 * and `deepseek-v4-flash-正式版`. A keyed lookup on those strings never matches,
 * so both sides go through canonicalModelKey() first.
 */

const CATALOG = require("./model-debuts.json");

const WINDOW_DAYS = Number.isFinite(CATALOG.windowDays) ? CATALOG.windowDays : 7;

// `glm-5.3-flash` / `GLM5.3-Flash（估算）` / `google/gemma-4-26b-a4b-it:free` all
// reduce to one identity here. Deliberately dumb: no fuzzy matching, so a wrong
// merge has to be written down in the catalog's `also` list where a reviewer can
// see it.
function canonicalModelKey(model) {
  let s = String(model == null ? "" : model).toLowerCase().trim();
  s = s.replace(/[（(][^（）()]*[)）]/g, " ");
  s = s.replace(/^[a-z0-9._-]+\//, "");
  s = s.replace(/:free$/g, " ");
  for (let guard = 0; guard < 4; guard += 1) {
    const stripped = s.replace(/[-_ ](?:free|official)$/g, "");
    if (stripped === s) break;
    s = stripped;
  }
  s = s.replace(/[^\x20-\x7e]+/g, " ");
  s = s.replace(/([a-z])([0-9])/g, "$1-$2");
  s = s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s;
}

function buildIndex() {
  const byKey = new Map();
  const debuts = CATALOG.debuts || {};
  for (const [name, entry] of Object.entries(debuts)) {
    if (!entry || !entry.debut) continue;
    const targets = [name, ...(entry.also || [])];
    for (const alias of targets) {
      const key = canonicalModelKey(alias);
      if (key) byKey.set(key, { key: canonicalModelKey(name), debut: entry.debut, entry });
    }
  }
  return byKey;
}

const DEBUT_INDEX = buildIndex();

function codenameKeys() {
  return new Set((CATALOG.codenames || []).map((name) => canonicalModelKey(name)).filter(Boolean));
}

function notModelKeys() {
  return new Set((CATALOG.notModels || []).map((name) => canonicalModelKey(name)).filter(Boolean));
}

/**
 * One model's provenance, given the day this machine first used it.
 *   early      — used inside the debut window of a verified public release
 *   late       — verified release, adopted after the window (not a trendsetter)
 *   codename   — never publicly announced; per owner policy the debut is the
 *                first date this machine saw it, so it always counts
 *   unverified — publicly named but no catalogued date yet: no verdict either way
 *   not-a-model— router placeholder / plan name, not a model at all
 */
/**
 * The identity a ledger string belongs to. Aliases in the catalog (`ox-alpha`,
 * `x-preview-f`, `gfmodel` all resolve to GLM-5.3-Flash) fold into the entry key,
 * so one model is one trendsetter slot no matter how many routers name it.
 */
function identityKeyFor(model) {
  const key = canonicalModelKey(model);
  if (!key) return "";
  const match = DEBUT_INDEX.get(key);
  return match ? match.key : key;
}

/**
 * Inside the debut window means within `windowDays` on EITHER side of the
 * vendor's public date. The early half is not a loophole: a closed beta or a
 * staged rollout makes a model reachable before the announcement, and the ledger
 * proves this machine could call it. Use long before the window is a different
 * story — that is a router label, not early adoption — so it stays out.
 * Returns null when either date is unusable.
 */
function withinWindow(firstUseDay, debutDay, windowDays) {
  const usedMs = Date.parse(`${firstUseDay}T00:00:00Z`);
  const debutMs = Date.parse(`${debutDay}T00:00:00Z`);
  if (!Number.isFinite(usedMs) || !Number.isFinite(debutMs)) return null;
  return Math.abs(usedMs - debutMs) <= windowDays * 86400000;
}

function classifyKey(identityKey, firstUseDay) {
  if (!identityKey || NOT_MODELS.has(identityKey)) {
    return { identity: identityKey, status: "not-a-model" };
  }
  const match = DEBUT_INDEX.get(identityKey);
  if (match) {
    const within = withinWindow(firstUseDay, match.debut, WINDOW_DAYS);
    if (within === null) return { identity: identityKey, status: "unverified", debut: match.debut };
    if (!within) return { identity: identityKey, status: "late", debut: match.debut };
    const pre = firstUseDay < match.debut;
    return { identity: identityKey, status: "early", debut: match.debut, pre_beta: pre };
  }
  if (CODENAMES.has(identityKey)) return { identity: identityKey, status: "codename" };
  return { identity: identityKey, status: "unverified" };
}

const CODENAMES = codenameKeys();
const NOT_MODELS = notModelKeys();

function classifyDebut(model, firstUseDay) {
  return classifyKey(identityKeyFor(model), firstUseDay);
}

module.exports = {
  canonicalModelKey,
  identityKeyFor,
  classifyDebut,
  classifyKey,
  entryFor: (model) => DEBUT_INDEX.get(canonicalModelKey(model)) || null,
  withinWindow,
  debutWindowDays: () => WINDOW_DAYS,
  catalogSize: () => DEBUT_INDEX.size,
  isNotModel: (model) => NOT_MODELS.has(canonicalModelKey(model)),
};
