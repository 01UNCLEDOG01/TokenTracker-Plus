// Devin subscription usage limits.
//
// Source: the official seat-management RPC the Devin web app calls,
//   POST https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus
// authenticated by `x-auth-token` — the session token the Devin CLI stores in
// $XDG_DATA_HOME/devin/credentials.toml (~/.local/share/devin/ fallback).
//
// Two non-obvious contract points, both verified against the official
// generated descriptor (docs/devin-limits.md):
//   - the quota percent/reset fields are proto3 implicit scalars, so the
//     server omits them at 0: absent percent + live reset = exhausted
//     (100% used), both absent = no such window;
//   - a non-default api_server_url is an unsupported configuration, never a
//     different request destination — the token only ever goes to the fixed
//     host above.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomicSync } = require("./atomic-json");

const DEVIN_PLAN_STATUS_URL =
  "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus";
const DEVIN_API_ORIGIN = "https://server.codeium.com";

const DEVIN_DAILY_WINDOW_SECONDS = 24 * 60 * 60;
const DEVIN_WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;

// Last-good disk cache (upstream PR 995). Only timeouts, transport failures,
// schema-malformed responses, 429 and 5xx serve stale bars; auth/credential
// errors and persistent rejections (HTTP 400) punch through so a re-login
// prompt is never masked by the fallback.
const DEVIN_LIMITS_CACHE_FILE = "devin-usage-limits-cache.json";
const DEVIN_LIMITS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Minimal root-level TOML reader for the CLI-written credentials file: bare
// `key = value` lines before the first `[section]`, nothing else.
function parseDevinCredentialsToml(raw) {
  const fields = {};
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[")) break;
    const match = /^([A-Za-z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/.exec(
      trimmed,
    );
    if (!match) continue;
    const [, key, doubleQuoted, singleQuoted, bare] = match;
    fields[key] = doubleQuoted ?? singleQuoted ?? bare ?? "";
  }
  return fields;
}

// Credential-file location shared by the token read and the cache identity,
// so both always look at the same file the same way.
function devinCredentialsPath({ home, env = process.env } = {}) {
  const xdg = env && typeof env === "object" ? env.XDG_DATA_HOME : null;
  const dir = isNonEmptyString(xdg)
    ? xdg.trim()
    : isNonEmptyString(home)
      ? home.trim()
      : isNonEmptyString(env?.HOME)
        ? env.HOME.trim()
        : null;
  if (!dir) return null;
  return isNonEmptyString(xdg)
    ? path.join(dir, "devin", "credentials.toml")
    : path.join(dir, ".local", "share", "devin", "credentials.toml");
}

// Non-secret credential-file revision (resolved path, device, inode, size,
// nanosecond modification/change timestamps). The token itself — and no hash
// of it — is ever persisted; replacing or editing credentials, changing
// $XDG_DATA_HOME, or removing the sign-in all change the revision and refuse
// the previous snapshot (upstream PR 995).
function devinCredentialRevisionFromStat(stat, filePath) {
  if (!stat || !filePath) return null;
  return JSON.stringify([
    path.resolve(filePath),
    ...[stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String),
  ]);
}

function devinCredentialRevision(filePath) {
  if (!filePath) return null;
  try {
    return devinCredentialRevisionFromStat(fs.statSync(filePath, { bigint: true }), filePath);
  } catch (_error) {
    return null;
  }
}

// Returns { apiKey, cacheRevision } or null when no sign-in exists (no home,
// or the file is absent — ENOENT only). Any other read failure or a mangled
// file throws an owned, actionable error with no path or filesystem details,
// so a broken sign-in can never masquerade as "not configured".
function readDevinCredentials({ home, env = process.env } = {}) {
  const base = devinCredentialsPath({ home, env });
  if (!base) return null;
  let raw;
  let cacheRevision;
  try {
    // Token and revision from the same open, so an in-place credential swap
    // mid-read cannot pair a new token with a stale revision.
    const fd = fs.openSync(base, "r");
    try {
      cacheRevision = devinCredentialRevisionFromStat(fs.fstatSync(fd, { bigint: true }), base);
      raw = fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    const credentialsError = new Error(
      "Could not read the Devin CLI credentials file — check its permissions or run `devin auth login` to sign in again.",
    );
    credentialsError.code = "CREDENTIALS_INVALID";
    throw credentialsError;
  }
  const fields = parseDevinCredentialsToml(raw);
  const apiKey = isNonEmptyString(fields.windsurf_api_key)
    ? fields.windsurf_api_key.trim()
    : null;
  if (!apiKey) {
    const credentialsError = new Error(
      "Devin credentials file has no sign-in token — run `devin auth login`.",
    );
    credentialsError.code = "CREDENTIALS_INVALID";
    throw credentialsError;
  }
  const apiServerUrl = isNonEmptyString(fields.api_server_url)
    ? fields.api_server_url.trim().replace(/\/+$/, "")
    : null;
  if (apiServerUrl && apiServerUrl !== DEVIN_API_ORIGIN) {
    const credentialsError = new Error(
      "Devin credentials point at a custom api_server_url, which this quota provider does not support.",
    );
    credentialsError.code = "CREDENTIALS_INVALID";
    throw credentialsError;
  }
  return { apiKey, cacheRevision };
}

function malformed(field) {
  return new Error(`Devin quota response has a malformed ${field}.`);
}

// undefined → proto-default semantics handled by the caller; null/non-numeric
// → malformed. Percentages are clamped defensively to 0..100.
function normalizeRemainingPercent(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" && typeof value !== "string") {
    throw malformed("quota remaining percent");
  }
  if (typeof value === "string" && value.trim() === "") {
    throw malformed("quota remaining percent");
  }
  const n = Number(value);
  if (!Number.isFinite(n)) throw malformed("quota remaining percent");
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return n;
}

// int64 unix seconds (JSON string or number). undefined or proto-default 0 →
// absent; null/non-numeric/non-positive → malformed. Returns epoch ms.
function normalizeResetMs(value) {
  if (value === undefined || value === 0 || value === "0") return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw malformed("quota reset timestamp");
  }
  if (typeof value === "string" && value.trim() === "") {
    throw malformed("quota reset timestamp");
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw malformed("quota reset timestamp");
  const ms = n * 1000;
  if (!Number.isFinite(new Date(ms).getTime())) {
    throw malformed("quota reset timestamp");
  }
  return ms;
}

function normalizeWindow({ remainingPercent, resetUnix, hidden, windowSeconds }) {
  if (hidden === true) return null;
  const resetMs = normalizeResetMs(resetUnix);
  const remaining = normalizeRemainingPercent(remainingPercent);
  if (remaining === undefined && resetMs === null) return null;
  return {
    used_percent: remaining === undefined ? 100 : 100 - remaining,
    reset_at: resetMs === null ? null : new Date(resetMs).toISOString(),
    limit_window_seconds: windowSeconds,
  };
}

function normalizePlanStatus(body) {
  const planStatus =
    body && typeof body === "object" ? body.planStatus : undefined;
  if (!planStatus || typeof planStatus !== "object") {
    throw new Error("Devin quota response is missing planStatus.");
  }
  const planInfo =
    planStatus.planInfo && typeof planStatus.planInfo === "object"
      ? planStatus.planInfo
      : {};
  const planLabel = isNonEmptyString(planInfo.planName)
    ? planInfo.planName.trim()
    : null;

  // Legacy Windsurf billing fills ACU credit fields instead of the daily /
  // weekly quota; those strategies have nothing renderable here.
  const billingStrategy = planInfo.billingStrategy;
  if (
    billingStrategy !== undefined &&
    billingStrategy !== "BILLING_STRATEGY_QUOTA"
  ) {
    return { plan_label: planLabel, primary_window: null, secondary_window: null };
  }

  return {
    plan_label: planLabel,
    primary_window: normalizeWindow({
      remainingPercent: planStatus.dailyQuotaRemainingPercent,
      resetUnix: planStatus.dailyQuotaResetAtUnix,
      hidden: planInfo.hideDailyQuota === true,
      windowSeconds: DEVIN_DAILY_WINDOW_SECONDS,
    }),
    secondary_window: normalizeWindow({
      remainingPercent: planStatus.weeklyQuotaRemainingPercent,
      resetUnix: planStatus.weeklyQuotaResetAtUnix,
      hidden: planInfo.hideWeeklyQuota === true,
      windowSeconds: DEVIN_WEEKLY_WINDOW_SECONDS,
    }),
  };
}

// `{ configured: false }` when the provider is not enabled or no Devin CLI
// sign-in exists, otherwise the normalized windows. `enabled` is the user's
// explicit provider selection forwarded from the local API — without it the
// credentials file is never opened and no request is made. Throws owned
// errors only — never raw upstream bodies, filesystem paths or token values.
// `code: "AUTH_EXPIRED"` flags genuine auth failure for the aggregator's
// auth_action_required path.
async function fetchDevinLimits({ home, env = process.env, enabled = false, fetchImpl = fetch } = {}) {
  if (enabled !== true) return { configured: false };
  const credentials = readDevinCredentials({ home, env });
  if (!credentials) return { configured: false };

  let response;
  try {
    response = await fetchImpl(DEVIN_PLAN_STATUS_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "x-auth-token": credentials.apiKey,
      },
      body: "{}",
      // The session token must never reach another origin.
      redirect: "error",
    });
  } catch (error) {
    throw new Error(
      error && (error.name === "AbortError" || error.name === "TimeoutError")
        ? "Devin quota request timed out."
        : "Devin quota request failed.",
    );
  }
  if (response?.status === 401 || response?.status === 403) {
    const error = new Error(
      "Devin sign-in expired or was rejected — run `devin auth login` to sign in again.",
    );
    error.code = "AUTH_EXPIRED";
    throw error;
  }
  if (!response?.ok) {
    // statusCode lets the aggregator tell a 429/5xx blip (cache fallback is
    // fair) from an ambiguous or persistent rejection like HTTP 400 (punch
    // through — upstream PR 995).
    const rejected = new Error(
      `Devin quota request was rejected (HTTP ${response?.status ?? "?"}).`,
    );
    rejected.statusCode = response?.status ?? null;
    throw rejected;
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Devin quota response was not JSON.");
  }
  const windows = normalizePlanStatus(body);
  return {
    configured: true,
    error: null,
    plan_label: windows.plan_label,
    primary_window: windows.primary_window,
    secondary_window: windows.secondary_window,
    // Read from the same file the token came from; stripped before serving.
    cache_identity: credentials.cacheRevision,
  };
}

// Failure-only identity re-derivation: a thrown Error carries no revision, so
// re-stat the (still-local) credentials file. Same file → same revision → the
// fallback read hits; edited/replaced/removed credentials → new revision or
// null → the previous snapshot is refused.
function resolveDevinCacheIdentity({ home, env } = {}) {
  return devinCredentialRevision(devinCredentialsPath({ home, env }));
}

function resolveDevinLimitsCachePath({ home } = {}) {
  return path.join(home || os.homedir(), ".tokentracker", "tracker", DEVIN_LIMITS_CACHE_FILE);
}

function parseTimeMs(value) {
  if (typeof value !== "string" || !value) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

function hasDevinWindow(limits) {
  return Boolean(limits?.primary_window || limits?.secondary_window);
}

function isDevinCacheWindowUsable(window, { nowMs } = {}) {
  if (!window || typeof window !== "object") return false;
  const resetAtMs = parseTimeMs(window.reset_at);
  if (resetAtMs === null) return true;
  return resetAtMs > nowMs;
}

function normalizeDevinCachedLimits(
  raw,
  { nowMs = Date.now(), maxAgeMs = DEVIN_LIMITS_CACHE_MAX_AGE_MS } = {},
) {
  const cachedAtMs = parseTimeMs(raw?.cached_at);
  if (!Number.isFinite(cachedAtMs)) return null;
  if (cachedAtMs > nowMs + 60_000) return null;
  if (nowMs - cachedAtMs > maxAgeMs) return null;

  const cached = {
    configured: true,
    error: null,
    plan_label: typeof raw?.plan_label === "string" ? raw.plan_label : null,
    primary_window: isDevinCacheWindowUsable(raw?.primary_window, { nowMs }) ? raw.primary_window : null,
    secondary_window: isDevinCacheWindowUsable(raw?.secondary_window, { nowMs }) ? raw.secondary_window : null,
    stale: true,
    cached_at: raw.cached_at,
  };
  return hasDevinWindow(cached) ? cached : null;
}

function readDevinLimitsCache({ home, nowMs = Date.now(), identity } = {}) {
  if (!identity) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveDevinLimitsCachePath({ home }), "utf8"));
    const entry = parsed?.devin;
    if (entry?.identity !== identity) return null;
    return normalizeDevinCachedLimits(entry, { nowMs });
  } catch (_error) {
    return null;
  }
}

// Windowless plans never write: a card with nothing to show is not a fallback.
function writeDevinLimitsCache(limits, { home, nowMs = Date.now(), identity } = {}) {
  if (!identity) return;
  if (!limits?.configured || limits.error || !hasDevinWindow(limits)) return;
  const cachePath = resolveDevinLimitsCachePath({ home });
  const payload = {
    devin: {
      identity,
      plan_label: limits.plan_label || null,
      primary_window: limits.primary_window || null,
      secondary_window: limits.secondary_window || null,
      cached_at: new Date(nowMs).toISOString(),
    },
  };
  try {
    writeJsonAtomicSync(cachePath, payload);
  } catch (_error) {}
}

module.exports = {
  fetchDevinLimits,
  resolveDevinCacheIdentity,
  readDevinLimitsCache,
  writeDevinLimitsCache,
  normalizeDevinCachedLimits,
  resolveDevinLimitsCachePath,
  DEVIN_LIMITS_CACHE_FILE,
};
