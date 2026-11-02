// WorkBuddy subscription-plan quota.
//
// The desktop app already reads this from its billing meter. China
// (WorkBuddy, ~/.workbuddy) and international (WorkBuddy AI, ~/.workbuddy-ai)
// share the path shape and differ by host:
//
//   POST {origin}/billing/meter/get-user-resource-summary
//   POST {origin}/billing/meter/get-user-resource-paid-packages
//   POST {origin}/billing/meter/get-user-resource-free-packages
//
// Prefer each edition's wbipc/endpoint.json -> wb.request/http.fetch proxy.
// WorkBuddy adds its own credentials, including encrypted desktop sessions.
// Legacy plaintext credentials remain a fallback when no local IPC exists.
//
// Only the subscription plan package is returned — the row the app calls
// 套餐基础积分, with that package's cycle end as the reset. Reward grants
// (活动 / 成长计划 / bonus / extra / gift) are dropped. Display names are
// English regardless of the backend's localized package names.

const fs = require("node:fs");
const path = require("node:path");
const { resolveWorkbuddyHome } = require("./rollout");
const { UNAVAILABLE, readWorkbuddyIpcDiscovery, openWorkbuddyIpc } = require("./workbuddy-ipc");

const WORKBUDDY_LIMITS_CACHE_FILE = "workbuddy-usage-limits-cache.json";
// Windows without a usable reset_at — the pooled resource window by design,
// plus a plan row whose cycle end never parsed — cannot be checked against a
// quota rollover, so they are only served while the snapshot is young enough
// to trust.
const WORKBUDDY_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS = 12 * 60 * 60 * 1000;

const PLAN_PRIORITY = Object.freeze({
  TCACA_code_027_0FCGVA6vSa: 4, // flagship
  TCACA_code_026_BaESVICNoi: 3, // advanced
  TCACA_code_002_AkiJS3ZHF5: 2, // pro monthly
  TCACA_code_005_maRGyrHhw1: 2, // pro monthly plus
  TCACA_code_003_FAnt7lcmRT: 2, // pro yearly
  TCACA_code_023_4xbGhMrE6q: 1, // youth
  TCACA_code_035_ArVxJcGDsm: 0, // international monthly
  TCACA_code_039_KRcQj7wUat: 0, // trial monthly
  TCACA_code_040_mi9rCYg46x: 0, // trial yearly
  TCACA_code_008_cfWoLwvjU4: 0, // China monthly trial
});

// Verbatim English edition labels from WorkBuddy Desktop 5.8.3's
// renderer/assets/edition-config-BLwrE-d8.js (getEditionConfigMap), with the
// package -> edition mapping in common-DRZ6FwkK.js (resolveEditionFromResources).
// These are official UI fallbacks, not English names supplied by the CN API.
const PLAN_LABELS = Object.freeze({
  TCACA_code_027_0FCGVA6vSa: "Ultimate",
  TCACA_code_026_BaESVICNoi: "Advanced",
  TCACA_code_002_AkiJS3ZHF5: "STANDARD",
  TCACA_code_005_maRGyrHhw1: "STANDARD",
  TCACA_code_003_FAnt7lcmRT: "STANDARD",
  TCACA_code_023_4xbGhMrE6q: "Youth",
  TCACA_code_035_ArVxJcGDsm: "Free",
  TCACA_code_039_KRcQj7wUat: "STANDARD TRIAL",
  TCACA_code_040_mi9rCYg46x: "STANDARD TRIAL",
  TCACA_code_008_cfWoLwvjU4: "Free",
});

// Platform reward credits. Never selected, even when the summary names one
// as a subscription package.
const REWARD_CODES = new Set([
  "TCACA_code_001_PqouKr6QWV", // free, not the plan
  "TCACA_code_006_DbXS0lrypC", // gift
  "TCACA_code_007_nzdH5h4Nl0", // activity / 官方活动
  "TCACA_code_009_0XmEQc2xOf", // extra credit package
  "TCACA_code_028_NtpWi0jzXs", // bonus
  "TCACA_code_029_6wCGEWquYy",
  "TCACA_code_030_BjSt89qTvr",
  "TCACA_code_036_lupO5WgNdG", // international extra
  "TCACA_code_037_WxOD3MpI2o", // international bonus
  "TCACA_code_038_OhvqZtiPKr", // extra
]);

const VARIANTS = Object.freeze({
  workbuddy: {
    id: "workbuddy",
    source: "workbuddy",
    envToken: "WORKBUDDY_ACCESS_TOKEN",
    defaultOrigin: "https://www.workbuddy.cn",
    allowedHostSuffixes: ["workbuddy.cn", "copilot.tencent.com", "wb.tencentbuddy.com"],
    authFileNames: ["workbuddy-desktop.info"],
    brand: "WorkBuddy",
  },
  workbuddyAi: {
    id: "workbuddyAi",
    source: "workbuddy-ai",
    envToken: "WORKBUDDY_AI_ACCESS_TOKEN",
    defaultOrigin: "https://www.workbuddy.ai",
    // The international desktop app itself bills through the CN proxy on
    // this install (wb-product-config.json records www.workbuddy.cn), so the
    // official-product allowlist carries both domains.
    allowedHostSuffixes: ["workbuddy.ai", "workbuddy.cn"],
    authFileNames: ["workbuddy-ai.info", "workbuddy-desktop.info"],
    brand: "WorkBuddy AI",
  },
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hostOf(value) {
  if (!isNonEmptyString(value)) return "";
  const trimmed = value.trim();
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function hostAllowed(hostname, suffixes) {
  if (!hostname) return false;
  return suffixes.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
}

function originAllowed(origin, variant) {
  return hostAllowed(hostOf(origin), variant.allowedHostSuffixes);
}

function toCount(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    const n = Number(value);
    return n >= 0 ? n : null;
  }
  return null;
}

function firstCount(row, keys) {
  for (const key of keys) {
    const n = toCount(row?.[key]);
    if (n !== null) return n;
  }
  return null;
}

function firstString(row, keys) {
  for (const key of keys) {
    if (isNonEmptyString(row?.[key])) return row[key].trim();
  }
  return "";
}

function normalizeResetAt(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const text = String(value).trim();
  if (!text) return null;
  // "2026-10-31 23:59:59" is the cycle boundary the app shows. Without a
  // zone, Date parses the T form as local time, matching the desktop app.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? text.replace(" ", "T")
    : text;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function normalizePackageRow(row) {
  if (!row || typeof row !== "object") return null;
  const code = firstString(row, ["PackageCode", "packageCode", "package_code"]);
  if (!code) return null;
  const total = firstCount(row, [
    "CycleTotalCapacity",
    "cycleTotal",
    "CycleCapacitySizePrecise",
    "total",
  ]);
  const remain = firstCount(row, [
    "CycleRemainCapacity",
    "cycleRemain",
    "CycleCapacityRemainPrecise",
    "left",
  ]);
  const used = firstCount(row, ["CycleUsedCapacity", "cycleUsed", "used"]);
  return {
    code,
    name: firstString(row, ["PackageName", "packageName", "name"]),
    total,
    remain,
    used,
    cycleEnd: firstString(row, ["CycleEndTime", "cycleEnd", "cycle_end"])
      || firstString(row, ["DeductionEndTime", "expireAt"]),
  };
}

function unwrapBillingBody(payload) {
  if (!payload || typeof payload !== "object") return null;
  const code = payload.code ?? payload.Code;
  if (code !== undefined && code !== 0 && code !== "0") return null;
  const data = payload.data ?? payload.Data;
  if (data && typeof data === "object") return data;
  return payload;
}

function collectPackageRows(payload) {
  const data = unwrapBillingBody(payload);
  if (!data) return [];
  const lists = [];
  for (const key of ["Packages", "packages", "Accounts", "accounts", "Resources", "resources"]) {
    if (Array.isArray(data[key])) lists.push(data[key]);
  }
  if (Array.isArray(data)) lists.push(data);
  const rows = [];
  for (const list of lists) {
    for (const item of list) {
      const row = normalizePackageRow(item);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function readSubscriptionIdentity(payload) {
  const data = unwrapBillingBody(payload);
  if (!data) return { code: "", name: "" };
  return {
    code: firstString(data, ["SubscriptionPackageCode", "subscriptionPackageCode"]),
    name: firstString(data, ["SubscriptionPackageName", "subscriptionPackageName"]),
  };
}

function mergePackageRows(rows) {
  const byCode = new Map();
  for (const row of rows) {
    const prev = byCode.get(row.code);
    if (!prev) {
      byCode.set(row.code, { ...row });
      continue;
    }
    byCode.set(row.code, {
      code: row.code,
      name: row.name || prev.name,
      total: row.total ?? prev.total,
      remain: row.remain ?? prev.remain,
      used: row.used ?? prev.used,
      cycleEnd: row.cycleEnd || prev.cycleEnd,
    });
  }
  return [...byCode.values()];
}

function isRewardCode(code) {
  return REWARD_CODES.has(code);
}

function isSelectablePlan(row, subscriptionPackageCode) {
  if (!row || isRewardCode(row.code)) return false;
  if (Object.prototype.hasOwnProperty.call(PLAN_PRIORITY, row.code)) return true;
  return Boolean(subscriptionPackageCode) && row.code === subscriptionPackageCode;
}

function planScore(row) {
  const priority = PLAN_PRIORITY[row.code] ?? 0;
  const live = row.total > 0 && row.remain > 0 ? 1 : 0;
  const total = Number.isFinite(row.total) ? row.total : 0;
  return priority * 1_000_000_000 + live * 1_000_000 + total;
}

function planWindow(row) {
  const total = row.total;
  const remain = row.remain;
  const used = row.used ?? (total !== null && remain !== null ? Math.max(0, total - remain) : null);
  if (total === null || total <= 0 || used === null) return null;
  const usedPercent = clampPercent((used / total) * 100);
  if (usedPercent === null) return null;
  return {
    used_percent: usedPercent,
    reset_at: normalizeResetAt(row.cycleEnd),
    used_credits: used,
    limit_credits: total,
    remaining_credits: remain ?? Math.max(0, total - used),
  };
}

// The daily/free grant pool (活动 / gift / bonus / extra). Upstream dropped
// these rows; the owner wants them visible. Aggregate the pool: remaining and
// total summed, reset = the soonest expiry among grants that carry one. No
// grants -> null so the UI renders no row instead of a fake zero.
//
// #976 (upstream PR 976 absorption): the pool has no shared cycle, so the card
// also advertises the lapse — expiring_credits is the amount dying with the
// earliest local (Beijing) calendar day, expiring_at the moment that day's
// LAST grant dies (the display anchor) and expiring_first_at the moment its
// FIRST grant does, i.e. when the pool's numbers start to drift. Grants
// without an expiry never contribute to the lapse.
const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

function beijingDayKey(iso) {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + BEIJING_OFFSET_MS).toISOString().slice(0, 10) : null;
}

function selectWorkbuddyRewardWindow(rows, { nowMs = Date.now() } = {}) {
  const rewards = mergePackageRows(rows.filter(Boolean)).filter((row) => REWARD_CODES.has(row.code));
  if (rewards.length === 0) return null;
  let total = 0, used = 0, hasTotal = false, soonest = null;
  const expiringGrants = [];
  for (const row of rewards) {
    if (row.total !== null && row.total > 0) { total += row.total; hasTotal = true; }
    const rowUsed = row.used ?? (row.total !== null && row.remain !== null ? Math.max(0, row.total - row.remain) : 0);
    used += rowUsed;
    const end = normalizeResetAt(row.cycleEnd);
    if (end && (!soonest || end < soonest)) soonest = end;
    if (end && Date.parse(end) > nowMs) {
      // An already-expired grant is gone — it must not advertise a past-day
      // lapse (upstream PR 976 skips expired rows).
      const remaining = row.remain ?? Math.max(0, (row.total ?? 0) - (rowUsed || 0));
      expiringGrants.push({ end, remaining: Number.isFinite(remaining) ? remaining : 0 });
    }
  }
  if (!hasTotal || total <= 0) return null;
  const usedPercent = clampPercent((used / total) * 100);
  if (usedPercent === null) return null;

  // Earliest expiry's Beijing calendar day anchors the lapse. The anchor day's
  // last grant timestamp is what the UI shows ("by <day>"), the first is when
  // the numbers start drifting, and the day's remaining sum is the amount.
  let expiring = null;
  if (expiringGrants.length > 0) {
    const firstMs = Math.min(...expiringGrants.map((g) => Date.parse(g.end)));
    const anchorDay = beijingDayKey(new Date(firstMs).toISOString());
    const sameDay = expiringGrants.filter((g) => beijingDayKey(g.end) === anchorDay);
    const lastMs = Math.max(...sameDay.map((g) => Date.parse(g.end)));
    expiring = {
      expiring_at: new Date(lastMs).toISOString(),
      expiring_first_at: new Date(firstMs).toISOString(),
      // Beijing calendar day of the anchor — the UI prints this date directly,
      // so hand it over precomputed instead of slicing the UTC ISO string.
      expiring_day: anchorDay,
      expiring_credits: Number(sameDay.reduce((sum, g) => sum + g.remaining, 0).toFixed(2)),
    };
  }

  return {
    used_percent: usedPercent,
    reset_at: soonest,
    used_credits: used,
    limit_credits: total,
    remaining_credits: Math.max(0, total - used),
    ...expiring,
  };
}

// One product row, one account's balance. Prefer a usable quota; when both
// editions are connected China wins deterministically. Never add their pools.
function selectWorkbuddyLimits(china, international) {
  const editions = [china, international].filter(Boolean);
  const usable = (value) => value.configured === true && !value.error;
  return editions.find((value) => usable(value) && value.primary_window)
    || editions.find(usable)
    || editions.find((value) => value.configured === true)
    || { configured: false };
}

// Pick the one subscription-plan package. Reward rows are ignored. When
// several plan packages exist, the highest tier that still has credit wins,
// matching the desktop app's pickActivePlanBase.
function selectWorkbuddyPlanQuota(rows, identity = {}, variantId = "workbuddy") {
  const merged = mergePackageRows(rows.filter(Boolean));
  const subscriptionPackageCode = identity.code || "";
  const candidates = merged.filter((row) => isSelectablePlan(row, subscriptionPackageCode));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => planScore(b) - planScore(a));
  const chosen = candidates[0];
  const window = planWindow(chosen);
  if (!window) return null;
  const planLabel = englishPlanLabel(chosen, identity, variantId);
  return {
    plan_label: planLabel || null,
    primary_window: window,
    package_code: chosen.code,
  };
}

function englishPlanLabel(row, identity, variantId) {
  // An actual English subscription/package name takes precedence over the
  // client's edition fallback. Unknown localized tiers stay unnamed.
  for (const name of [identity.name, row.name]) {
    if (typeof name === "string" && /^[\x20-\x7e]+$/.test(name.trim())
      && /[a-z]/i.test(name) && !/^TCACA_code_/i.test(name.trim())) return name.trim();
  }
  const known = PLAN_LABELS[row.code];
  if (variantId === "workbuddyAi") {
    if (known === "STANDARD") return "Pro";
    if (known === "STANDARD TRIAL") return "Pro-Trial";
  }
  return known || null;
}

function variantById(id) {
  return VARIANTS[id] || null;
}

function directoryExists(dir) {
  if (!dir) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function authSearchDirs(env, workbuddyHome) {
  const home = isNonEmptyString(env?.HOME) ? env.HOME.trim() : "";
  const dirs = [];
  if (home && process.platform === "darwin") {
    dirs.push(path.join(home, "Library", "Application Support", "CodeBuddyExtension", "Data", "Public", "auth"));
  } else if (process.platform === "win32") {
    const appData = isNonEmptyString(env?.APPDATA) ? env.APPDATA.trim() : (home ? path.join(home, "AppData", "Roaming") : "");
    if (appData) dirs.push(path.join(appData, "CodeBuddyExtension", "Data", "Public", "auth"));
  } else if (home) {
    dirs.push(path.join(home, ".config", "CodeBuddyExtension", "Data", "Public", "auth"));
  }
  if (workbuddyHome) dirs.push(path.join(workbuddyHome, "auth"));
  return dirs;
}

function readAuthFile(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  const auth = parsed?.auth;
  if (!auth || typeof auth !== "object") return null;
  const domain = isNonEmptyString(auth.domain) ? auth.domain.trim() : "";
  // The app records the signed-in account next to its (often encrypted)
  // session. The uid stays readable while the app is closed, so it is the
  // one account signal that survives into the UNAVAILABLE state.
  const uid = isNonEmptyString(parsed.account?.uid) ? parsed.account.uid.trim() : "";
  const token = auth.accessToken;
  if (isNonEmptyString(token)) return { token: token.trim(), domain, encrypted: false, uid };
  if (token && typeof token === "object" && token.$wbEncrypted === 1) {
    return { token: null, domain, encrypted: true, uid };
  }
  return { token: null, domain, encrypted: false, uid };
}

function resolveSession(variant, { env, authFiles, workbuddyHome }) {
  const files = Array.isArray(authFiles)
    ? authFiles
    : authSearchDirs(env, workbuddyHome).flatMap((dir) => variant.authFileNames.map((name) => path.join(dir, name)));
  let encryptedForVariant = false;
  let encryptedUid = "";
  for (const filePath of files) {
    if (!filePath) continue;
    const session = readAuthFile(filePath);
    if (!session) continue;
    if (!hostAllowed(hostOf(session.domain), variant.allowedHostSuffixes)) continue;
    if (session.token) return { token: session.token, encrypted: false, matched: true, uid: session.uid };
    if (session.encrypted) {
      encryptedForVariant = true;
      // First encrypted candidate wins: when the app is closed this record is
      // what a live read would authenticate with, so its account is the one
      // the cached windows must match.
      encryptedUid = encryptedUid || session.uid;
    }
  }
  return { token: null, encrypted: encryptedForVariant, matched: encryptedForVariant, uid: encryptedUid };
}

// — the live read. It is the app's own account uid, readable after the app
// closes when the encrypted session token is not, and it is an account id,
// not a credential: nothing secret is persisted or hashed. An account the
// records do not name ("unknown") matches only its own entries.
//
// Editions never borrow each other's data: workbuddy CN and workbuddyAi are
// separate partitions of one file, matching the edition-local socket
// discipline. Partitions are also scoped to the login that produced the
// windows, so an account switch followed by a live failure cannot serve the
// previous account's bars.

function workbuddyLimitsCachePath({ home } = {}) {
  return path.join(home || os.homedir(), ".tokentracker", "tracker", WORKBUDDY_LIMITS_CACHE_FILE);
}

// A window whose reset_at has already passed is stale data, not a usable
// fallback — the quota has rolled over, so drop it. Undated windows (the
// resource pool, or a plan row without a readable cycle end) cannot be
// checked against a reset and are bounded by the snapshot-age TTL instead.
function workbuddyCachedWindow(window, { cachedAtMs, nowMs } = {}) {
  if (!window || typeof window !== "object") return null;
  const resetAtMs = Date.parse(window.reset_at || "");
  if (Number.isFinite(resetAtMs)) return resetAtMs > nowMs ? window : null;
  return nowMs - cachedAtMs <= WORKBUDDY_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS ? window : null;
}

/** Read the last-good windows for one edition, scoped to the login that wrote them. */
function readWorkbuddyLimitsCache({ home, nowMs = Date.now(), variantId, identity } = {}) {
  // An explicit home keeps the cache hermetic: callers that never said where
  // the user's tracker state lives (tests, odd embedders) must not touch the
  // developer's real cache file.
  if (!home || !variantId || !identity) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(workbuddyLimitsCachePath({ home }), "utf8"));
  } catch (_error) {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed[variantId];
  if (!raw || typeof raw !== "object") return null;
  if (raw.identity !== identity) return null;
  const cachedAtMs = Date.parse(raw.cached_at || "");
  if (!Number.isFinite(cachedAtMs) || cachedAtMs > nowMs + 60_000) return null;
  const context = { cachedAtMs, nowMs };
  const primaryWindow = workbuddyCachedWindow(raw.primary_window, context);
  const secondaryWindow = workbuddyCachedWindow(raw.secondary_window, context);
  // A partition whose windows all rolled or expired no longer describes the
  // account's quota — withholding it lets the live error stay visible.
  if (!primaryWindow && !secondaryWindow) return null;
  return {
    configured: true,
    error: null,
    plan_label: typeof raw.plan_label === "string" ? raw.plan_label : null,
    primary_window: primaryWindow,
    secondary_window: secondaryWindow,
    cached: true,
    stale: true,
    cached_at: raw.cached_at,
    source: "disk-cache",
  };
}

/** Merge one edition's partition into the disk cache; best-effort, never throws. */
function writeWorkbuddyLimitsCache(limits, { home, nowMs = Date.now(), variantId, identity } = {}) {
  if (!home || !variantId || !identity || !limits?.configured || limits.error) return;
  if (!limits.primary_window && !limits.secondary_window) return;
  const cachePath = workbuddyLimitsCachePath({ home });
  let payload = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8"));
    if (parsed && typeof parsed === "object") payload = parsed;
  } catch (_error) {}
  payload[variantId] = {
    identity,
    plan_label: typeof limits.plan_label === "string" ? limits.plan_label : null,
    primary_window: limits.primary_window || null,
    secondary_window: limits.secondary_window || null,
    cached_at: new Date(nowMs).toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

function readProductEndpoint(workbuddyHome) {
  if (!workbuddyHome) return "";
  const storage = path.join(workbuddyHome, "storage");
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 5 || found.length > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length > 4) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === "wb-product-config.json") found.push(full);
    }
  };
  walk(storage, 0);
  for (const filePath of found) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const data = parsed?.["product-config-snapshot"]?.data;
      if (isNonEmptyString(data?.endpoint)) return data.endpoint.trim();
    } catch {
      // The next snapshot may still be readable.
    }
  }
  return "";
}

function resolveOrigin(variant, { origin, workbuddyHome }) {
  if (isNonEmptyString(origin) && originAllowed(origin, variant)) {
    return origin.trim().replace(/\/+$/, "");
  }
  const configured = readProductEndpoint(workbuddyHome);
  if (configured && originAllowed(configured, variant)) return configured.replace(/\/+$/, "");
  return variant.defaultOrigin;
}

function resolveToken(variant, env) {
  const fromEnv = env && typeof env === "object" ? env[variant.envToken] : null;
  return isNonEmptyString(fromEnv) ? fromEnv.trim() : "";
}

async function postBilling(fetchImpl, url, token, body = {}, signal) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  if (response.status === 401 || response.status === 403) {
    const error = new Error(`${VARIANTS.workbuddy.brand} sign-in expired.`);
    error.code = "AUTH_EXPIRED";
    throw error;
  }
  if (!response.ok) {
    throw new Error(`WorkBuddy quota request failed (${response.status}).`);
  }
  return response.json();
}

async function fetchPlanQuota(post, variantId) {
  const prefix = "/billing/meter/";
  const summary = await post(`${prefix}get-user-resource-summary`, {});
  if (!unwrapBillingBody(summary)) throw new Error("WorkBuddy quota request was rejected.");
  const identity = readSubscriptionIdentity(summary);
  const planCodes = [...new Set([...Object.keys(PLAN_PRIORITY),
    ...(identity.code && !isRewardCode(identity.code) ? [identity.code] : [])])];
  const packageRows = await Promise.all(["paid", "free"].map(async (kind) => {
    const rows = [];
    for (let page = 1; page <= 10; page++) {
      const payload = await post(`${prefix}get-user-resource-${kind}-packages`, {
        PageNumber: page, PageSize: 100, PackageCodes: planCodes,
        Status: [0, 3], ...(kind === "paid" ? { NeedRenewInfo: true } : {}),
      });
      const data = unwrapBillingBody(payload);
      if (!data) throw new Error("WorkBuddy quota request was rejected.");
      rows.push(...collectPackageRows(payload));
      const count = Array.isArray(data.Accounts) ? data.Accounts.length : 0;
      if (count < 100 || (Number(data.TotalCount) > 0 && page * 100 >= Number(data.TotalCount))) return rows;
    }
    throw new Error("WorkBuddy quota package list was incomplete.");
  }));
  const allRows = [...collectPackageRows(summary), ...packageRows.flat()];
  const quota = selectWorkbuddyPlanQuota(allRows, identity, variantId);
  return {
    configured: true, error: null,
    plan_label: quota?.plan_label || englishPlanLabel({ code: identity.code }, identity, variantId),
    primary_window: quota?.primary_window || null,
    reward_window: selectWorkbuddyRewardWindow(allRows, { nowMs: nowMs() }),
  };
}

function scopedEnv(env, home) {
  const next = { ...(env || {}) };
  // An explicit home is the whole lookup root. Tests pass a temp directory
  // while process.env.HOME still points at the developer, and a China
  // session must not leak into that lookup.
  if (isNonEmptyString(home)) {
    next.HOME = home.trim();
    if (next.USERPROFILE) next.USERPROFILE = home.trim();
  }
  return next;
}

async function fetchVariant(variantId, opts = {}) {
  const variant = variantById(variantId);
  if (!variant) return { configured: false };
  const env = scopedEnv(opts.env || process.env, opts.home);
  const workbuddyHome = opts.workbuddyHome || resolveWorkbuddyHome(env, variant.source);
  const installed = directoryExists(workbuddyHome);
  // Sampled when used, not when the fetch starts: the live attempt can spend
  // the whole provider budget before a cache read or write happens, and a
  // window whose reset rolled in that span must not be served. An injected
  // clock (tests) keeps every use on the same instant.
  const nowMs = () => (Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now());
  const discovery = readWorkbuddyIpcDiscovery(workbuddyHome);
  if (discovery) {
    // Discovery is edition-local. Never fall back to the other edition's
    // socket or allow an explicitly redirected product to be mislabelled.
    const productEndpoint = readProductEndpoint(workbuddyHome);
    if (productEndpoint && !originAllowed(productEndpoint, variant)) {
      throw new Error("WorkBuddy quota host does not match this edition.");
    }
    // One identity source for both the IPC live read and the disk cache: the
    // auth record that supplies — or, while the app is closed, would supply —
    // the session token (PR 954). An env-token session names no record.
    const explicitToken = resolveToken(variant, env);
    const identitySession = explicitToken
      ? { uid: "" }
      : resolveSession(variant, { env, authFiles: opts.authFiles, workbuddyHome });
    const identity = identitySession?.uid || "unknown";
    let client;
    try {
      client = await openWorkbuddyIpc({
        discovery, signal: opts.signal, timeoutMs: opts.timeoutMs, connectImpl: opts.connectImpl,
      });
    } catch (error) {
      if (error && error.message === UNAVAILABLE) {
        // Daemon not running: last-good windows keep the card alive instead of
        // a vanished row (PR 954); without them keep the idle shape so the
        // dashboard renders 未连接 instead of a red failure.
        const cached = readWorkbuddyLimitsCache({ home: opts.home, nowMs: nowMs(), variantId, identity });
        if (cached) return cached;
        return { configured: true, error: UNAVAILABLE, reason: "client_not_running" };
      }
      throw error;
    }
    try {
      let live;
      try {
        live = { ...await fetchPlanQuota((apiPath, body) => client.postBilling(apiPath, body), variantId), source: "ipc" };
      } catch (error) {
        // A mid-read IPC failure falls back to the last-good snapshot; with no
        // usable snapshot the original error keeps its shape.
        const cached = readWorkbuddyLimitsCache({ home: opts.home, nowMs: nowMs(), variantId, identity });
        if (cached) return cached;
        throw error;
      }
      if (live.configured === true && !live.error) {
        // Live read is current as of now: persist it so a later failure serves
        // stale bars instead of a vanished card.
        writeWorkbuddyLimitsCache(live, { home: opts.home, nowMs: nowMs(), variantId, identity });
        return live;
      }
      if (live.configured === true && live.error) {
        const cached = readWorkbuddyLimitsCache({ home: opts.home, nowMs: nowMs(), variantId, identity });
        if (cached) return cached;
      }
      return live;
    } finally {
      client.close();
    }
  }
  const explicitToken = resolveToken(variant, env);
  const session = explicitToken
    ? { token: explicitToken, encrypted: false, matched: true, uid: "" }
    : resolveSession(variant, { env, authFiles: opts.authFiles, workbuddyHome });
  const identity = session.uid || "unknown";
  if (!session.token) {
    // `reason` lets the dashboard show this as an idle state (client closed)
    // rather than a red failure; the message stays for CLI/log consumers.
    if (session.encrypted || installed) {
      const cached = readWorkbuddyLimitsCache({ home: opts.home, nowMs: nowMs(), variantId, identity });
      if (cached) return cached;
      return { configured: true, error: UNAVAILABLE, reason: "client_not_running" };
    }
    if (!installed) return { configured: false };
    return { configured: false };
  }

  const fetchImpl = opts.fetchImpl || fetch;
  // An explicit origin is the caller's host. Otherwise use this edition's
  // own product-config endpoint, and never the other edition's default.
  const origin = resolveOrigin(variant, {
    origin: opts.origin,
    workbuddyHome: opts.origin ? null : workbuddyHome,
  });
  if (!originAllowed(origin, variant)) {
    throw new Error("WorkBuddy quota host does not match this edition.");
  }
  let live;
  try {
    live = { ...await fetchPlanQuota((apiPath, body) => postBilling(fetchImpl,
      `${origin}${apiPath}`, session.token, body, opts.signal), variantId), source: "api" };
  } catch (error) {
    // Re-login stays actionable (auth expiry is a configuration fault, not
    // transient data loss): it may not be masked by stale bars (PR 954).
    if (error?.code === "AUTH_EXPIRED") throw error;
    const cached = readWorkbuddyLimitsCache({ home: opts.home, nowMs: nowMs(), variantId, identity });
    if (cached) return cached;
    throw error;
  }
  if (live.configured === true && !live.error) {
    writeWorkbuddyLimitsCache(live, { home: opts.home, nowMs: nowMs(), variantId, identity });
  } else if (live.configured === true && live.error) {
    const cached = readWorkbuddyLimitsCache({ home: opts.home, nowMs: nowMs(), variantId, identity });
    if (cached) return cached;
  }
  return live;
}

function fetchWorkbuddyLimits(opts) {
  return fetchVariant("workbuddy", opts);
}

function fetchWorkbuddyAiLimits(opts) {
  return fetchVariant("workbuddyAi", opts);
}

module.exports = {
  PLAN_PRIORITY,
  REWARD_CODES,
  VARIANTS,
  selectWorkbuddyPlanQuota,
  selectWorkbuddyLimits,
  selectWorkbuddyRewardWindow,
  collectPackageRows,
  readSubscriptionIdentity,
  originAllowed,
  hostAllowed,
  readWorkbuddyLimitsCache,
  writeWorkbuddyLimitsCache,
  workbuddyLimitsCachePath,
  fetchWorkbuddyLimits,
  fetchWorkbuddyAiLimits,
};
