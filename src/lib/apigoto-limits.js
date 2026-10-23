const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// APIGOTO (apigoto.com) subscription quota.
//
// The panel is a custom build (not one-api/new-api): the session is a Bearer
// JWT valid for 24h, renewed by a refresh token the server does NOT rotate
// single-use — one browser-captured refresh token renews forever, because the
// password login is slider-captcha-gated (code 20201). Full recon, including
// the verified response shapes: docs/apigoto-api-recon.md.
//
//   POST /api/v1/user/user/refresh
//        {refresh_token} → data.{access_token, refresh_token}
//   GET  /api/v1/user/user/subscription/policy-limit
//        → data.usage_limits[] {dim, window_sec, used, limit, reset_at, unit}
//   GET  /api/v1/user/user/subscription/current
//        → data.{plan_name, status, started_at, expires_at}   (expiry row)
//
// Credentials live in ~/.tokentracker/apigoto-credentials.json (chmod 600):
//   { "access_token": "...", "refresh_token": "...", "access_exp_ms": 1792098331000 }
// The access token is renewed shortly before expiry, not on every poll — the
// refresh call is cheap but it is also an authenticated write on their side.

const APIGOTO_BASE_URL = "https://apigoto.com/api/v1/user";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const WEEKLY_WINDOW_SEC = 604_800;
const ACCESS_TOKEN_RENEW_MARGIN_MS = 10 * 60_000;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), "apigoto-credentials.json");
}

function lastGoodPath(home) {
  return path.join(getTrackerRootDir({ home }), "apigoto-last-good.json");
}

// The last successful weekly window, so a blip on apigoto.com serves a stale
// bar instead of blanking the row for a poll cycle.
function readLastGood(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastGoodPath(home), "utf8"));
    if (!raw || typeof raw !== "object" || !raw.primary_window) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeLastGood(home, value) {
  try {
    const file = lastGoodPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    // Best effort: a failed write just means the next blip shows an error.
  }
}

function readCredentials(home) {
  try {
    const creds = JSON.parse(fs.readFileSync(credentialsPath(home), "utf8"));
    if (!creds || typeof creds !== "object") return null;
    if (typeof creds.refresh_token !== "string" || !creds.refresh_token) return null;
    return creds;
  } catch {
    return null;
  }
}

function writeCredentials(home, creds) {
  try {
    const file = credentialsPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(creds, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // Best effort: a failed write just means the next refresh retries.
  }
}

function decodeJwtExpMs(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split(".")[1] || "", "base64url").toString("utf8"));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

async function fetchJson(fetchImpl, url, options, timeoutMs) {
  const res = await fetchImpl(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`APIGOTO HTTP ${res.status} for ${url}`);
  const body = await res.json();
  if (body?.code !== 0) {
    throw new Error(`APIGOTO ${url}: ${body?.message || `code ${body?.code}`}`);
  }
  return body;
}

async function refreshAccessToken(fetchImpl, refreshToken, timeoutMs) {
  const body = await fetchJson(fetchImpl, `${APIGOTO_BASE_URL}/user/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }, timeoutMs);
  const accessToken = body?.data?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("APIGOTO refresh returned no access token");
  }
  const nextRefresh = typeof body?.data?.refresh_token === "string" && body.data.refresh_token
    ? body.data.refresh_token
    : refreshToken;
  return { access_token: accessToken, refresh_token: nextRefresh };
}

// The panel's axios baseURL doubles the user segment: /api/v1/user/user/….
// Verified live (2026-10-22): returns the subscription identity with microsecond
// ISO timestamps, e.g. {plan_name:"RouterCode PLUS", status:"active",
// started_at:"2026-10-09T09:30:40.222837Z", expires_at:"2026-11-09T09:30:40.222837Z"}.
function parseApigotoTimestamp(value) {
  if (typeof value !== "string" || !value) return NaN;
  // V8 tolerates >3 fractional digits, but trim to milliseconds so the parse
  // stays valid on stricter engines.
  const normalized = value.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : NaN;
}

async function fetchApigotoSubscription(fetchImpl, accessToken, timeoutMs) {
  const body = await fetchJson(fetchImpl, `${APIGOTO_BASE_URL}/user/subscription/current`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  }, timeoutMs);
  const sub = body?.data || {};
  return {
    planName: typeof sub.plan_name === "string" && sub.plan_name.trim() ? sub.plan_name.trim() : null,
    status: typeof sub.status === "string" ? sub.status : null,
    startedMs: parseApigotoTimestamp(sub.started_at),
    expiresMs: parseApigotoTimestamp(sub.expires_at),
  };
}

// Returns {configured:true, apigoto:{configured:true, plan_name, primary_window}}
// in the shared usage-limits shape, or {configured:false} when no credentials
// exist (the provider is invisible rather than erroring).
async function fetchApigotoLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const creds = readCredentials(home);
  if (!creds) return { configured: false, error: null };

  let accessToken = typeof creds.access_token === "string" ? creds.access_token : "";
  const expMs = Number(creds.access_exp_ms) || 0;
  if (!accessToken || expMs - nowMs < ACCESS_TOKEN_RENEW_MARGIN_MS) {
    const pair = await refreshAccessToken(fetchImpl, creds.refresh_token, timeoutMs);
    accessToken = pair.access_token;
    creds.access_token = accessToken;
    creds.refresh_token = pair.refresh_token;
    creds.access_exp_ms = decodeJwtExpMs(accessToken) || nowMs + 24 * 3600 * 1000;
    writeCredentials(home, creds);
  }

  let data;
  try {
    const body = await fetchJson(fetchImpl, `${APIGOTO_BASE_URL}/user/subscription/policy-limit`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }, timeoutMs);
    data = body?.data || {};
  } catch (error) {
    // A blip must not blank the row: serve the last good window (stale) the
    // way the other providers do, or surface the error when nothing was cached.
    const lastGood = readLastGood(home);
    if (lastGood) {
      return { configured: true, ...lastGood, stale: true };
    }
    return { configured: true, error: error?.message || "fetch failed" };
  }
  const windows = Array.isArray(data.usage_limits) ? data.usage_limits : [];
  // The panel renders the same array; the weekly TCredits window (7d) is the
  // one the owner watches. Other dims (concurrency etc.) carry no percent.
  const weekly = windows.find((w) => Number(w.window_sec) === WEEKLY_WINDOW_SEC) || windows[0] || null;
  if (!weekly || !(Number(weekly.limit) > 0)) {
    return {
      configured: true,
      plan_name: data.policy_name || null,
      error: "no usage window",
    };
  }

  const usedPercent = Math.round((Number(weekly.used) / Number(weekly.limit)) * 100);
  const resetMs = Number(weekly.reset_at);
  const planName = typeof data.policy_name === "string" ? data.policy_name : null;
  const primaryWindow = {
    used_percent: Math.max(0, Math.min(100, usedPercent)),
    reset_at: Number.isFinite(resetMs) && resetMs > 0
      ? new Date(resetMs * 1000).toISOString()
      : null,
    limit_window_seconds: Number(weekly.window_sec) || null,
    used: Number(weekly.used) || 0,
    limit: Number(weekly.limit) || 0,
  };

  // The subscription's own lifetime (RouterCode PLUS, monthly): an expiry row
  // paced by elapsed period, the same timeKind contract as Qoder's Ultimate
  // row. Fail-soft — a /current blip must not blank the quota window above.
  let subscriptionWindow = null;
  try {
    const sub = await fetchApigotoSubscription(fetchImpl, accessToken, timeoutMs);
    if (sub.status === "active" && Number.isFinite(sub.expiresMs) && sub.expiresMs > nowMs) {
      const startedMs = Number.isFinite(sub.startedMs) && sub.startedMs > 0 && sub.startedMs < sub.expiresMs
        ? sub.startedMs
        : sub.expiresMs - 30 * 86400 * 1000;
      const spanMs = sub.expiresMs - startedMs;
      subscriptionWindow = {
        used_percent: Math.max(0, Math.min(100, Math.round(((nowMs - startedMs) / spanMs) * 100))),
        reset_at: new Date(sub.expiresMs).toISOString(),
        subscription_plan_name: sub.planName,
      };
    }
  } catch {
    // Garnish row only.
  }

  writeLastGood(home, {
    plan_name: planName,
    primary_window: primaryWindow,
    secondary_window: subscriptionWindow,
    captured_at: new Date(nowMs).toISOString(),
  });
  return {
    configured: true,
    plan_name: planName,
    primary_window: primaryWindow,
    ...(subscriptionWindow ? { secondary_window: subscriptionWindow } : {}),
  };
}

module.exports = { fetchApigotoLimits };
