const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// SenseNova (platform.sensenova.cn, 商汤日日新) token-plan credit pools.
//
// The console is the only quota source — no public balance API, and the login
// form is slider-captcha-gated, so the provider runs entirely off a
// browser-captured OIDC refresh token. Full recon, including the verified
// response shapes and how the token was obtained: docs/sensenova-api-recon.md.
//
//   POST https://signin.sensecore.cn/oauth2/token        (form-encoded)
//        grant_type=refresh_token & client_id=nova & refresh_token=...
//        → {access_token, id_token, refresh_token, expires_in}
//   GET  https://platform.sensenova.cn/lite/console/v1/tokenplan/pool-usage
//        Authorization: Bearer <access_token>
//        → {plan:{name}, pools:[{name, pool_type, window_5h, window_7d,
//                               grant_balance, nearest_grant_expiry, ...}]}
//
// Refresh tokens are SINGLE-USE: every refresh returns a replacement and the
// old one stops working (verified: the second use of an already-refreshed token
// answers 401). Each refresh therefore persists the new pair atomically — a
// dropped write costs the user a re-capture.
//
// Credentials live in ~/.tokentracker/sensenova-credentials.json (chmod 600):
//   { "refresh_token": "...", "access_token": "...", "access_exp_ms": 1792070064000 }

const SENSENOVA_API_BASE = "https://platform.sensenova.cn/lite/console/v1";
const SENSENOVA_TOKEN_URL = "https://signin.sensecore.cn/oauth2/token";
const SENSENOVA_CLIENT_ID = "nova";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const ACCESS_TOKEN_RENEW_MARGIN_MS = 10 * 60_000;
const FIVE_HOUR_WINDOW_SEC = 5 * 3600;
const WEEKLY_WINDOW_SEC = 7 * 86400;

// The API quotes granted credits in thousands (`519.696` where the console
// shows `519,696`); the window limits are already plain credits. Scale grants
// to the console's unit so the number matches what the owner sees there.
const GRANT_BALANCE_UNIT_SCALE = 1000;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), "sensenova-credentials.json");
}

function lastGoodPath(home) {
  return path.join(getTrackerRootDir({ home }), "sensenova-last-good.json");
}

// The last successful snapshot, so a provider blip serves a stale bar instead
// of blanking the section for a poll cycle.
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

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function refreshAccessToken(fetchImpl, refreshToken, timeoutMs) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: SENSENOVA_CLIENT_ID,
    refresh_token: refreshToken,
  });
  const res = await fetchImpl(SENSENOVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const parsed = await res.json();
      detail = parsed?.error || parsed?.error_description || "";
    } catch {
      // Non-JSON error body: the status is the whole story.
    }
    throw new Error(`SenseNova sign-in expired (HTTP ${res.status}${detail ? `: ${detail}` : ""})`);
  }
  const payload = await res.json();
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("SenseNova refresh returned no access token");
  // Single-use: the replacement must be adopted, never dropped, or the chain dies.
  const nextRefresh = typeof payload?.refresh_token === "string" && payload.refresh_token
    ? payload.refresh_token
    : refreshToken;
  return { access_token: accessToken, refresh_token: nextRefresh };
}

function windowFrom(raw, windowSeconds) {
  if (!raw || typeof raw !== "object") return null;
  const limit = toNumber(raw.limit);
  const used = toNumber(raw.used);
  if (!(limit > 0) || used == null) return null;
  const resetSec = toNumber(raw.reset_at);
  return {
    used_percent: Math.max(0, Math.min(100, Math.round((used / limit) * 100))),
    reset_at: resetSec > 0 ? new Date(resetSec * 1000).toISOString() : null,
    limit_window_seconds: windowSeconds,
    used,
    limit,
  };
}

function poolByType(pools, type) {
  return pools.find((p) => p && p.pool_type === type) || null;
}

// Returns the shared usage-limits shape (_flat_ — {configured, plan_name,
// primary_window, ...}), or {configured:false} when no credentials exist yet
// (the provider stays invisible rather than erroring).
async function fetchSensenovaLimits({
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
    let pair;
    try {
      pair = await refreshAccessToken(fetchImpl, creds.refresh_token, timeoutMs);
    } catch (error) {
      const lastGood = readLastGood(home);
      if (lastGood) return { configured: true, ...lastGood, stale: true };
      return { configured: true, error: error?.message || "sign-in failed" };
    }
    accessToken = pair.access_token;
    creds.access_token = accessToken;
    creds.refresh_token = pair.refresh_token;
    creds.access_exp_ms = decodeJwtExpMs(accessToken) || nowMs + 3 * 3600 * 1000;
    writeCredentials(home, creds);
  }

  let payload;
  try {
    const res = await fetchImpl(`${SENSENOVA_API_BASE}/tokenplan/pool-usage`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`SenseNova HTTP ${res.status} for pool-usage`);
    payload = await res.json();
  } catch (error) {
    const lastGood = readLastGood(home);
    if (lastGood) return { configured: true, ...lastGood, stale: true };
    return { configured: true, error: error?.message || "fetch failed" };
  }

  const pools = Array.isArray(payload?.pools) ? payload.pools : [];
  const general = poolByType(pools, "default") || pools[0] || null;
  // The Flash-Lite pool is the second one on the console page; fall back to the
  // non-default pool by name so a renamed pool_type does not drop the rows.
  const flashLite = poolByType(pools, "dedicated")
    || pools.find((p) => p && p !== general && /flash/i.test(String(p.name || "")))
    || null;

  const primaryWindow = windowFrom(general?.window_5h, FIVE_HOUR_WINDOW_SEC);
  const secondaryWindow = windowFrom(general?.window_7d, WEEKLY_WINDOW_SEC);
  if (!primaryWindow && !secondaryWindow) {
    return { configured: true, plan_name: payload?.plan?.name || null, error: "no usage window" };
  }

  // Granted credits are a balance, not a window: every pool reports one, the
  // general pool is the one that carries value.
  const grantBalance = pools.reduce((sum, pool) => {
    const amount = toNumber(pool?.grant_balance);
    return sum + (amount > 0 ? amount : 0);
  }, 0);
  const nearestExpirySec = pools.reduce((soonest, pool) => {
    const expiry = toNumber(pool?.nearest_grant_expiry);
    if (!(expiry > 0)) return soonest;
    return soonest === 0 || expiry < soonest ? expiry : soonest;
  }, 0);

  const planName = typeof payload?.plan?.name === "string" ? payload.plan.name : null;
  const result = {
    configured: true,
    plan_name: planName,
    primary_window: primaryWindow,
    secondary_window: secondaryWindow,
    tertiary_window: windowFrom(flashLite?.window_5h, FIVE_HOUR_WINDOW_SEC),
    quaternary_window: windowFrom(flashLite?.window_7d, WEEKLY_WINDOW_SEC),
    grant_credits: grantBalance > 0 ? Math.round(grantBalance * GRANT_BALANCE_UNIT_SCALE) : 0,
    grant_expires_at: nearestExpirySec > 0 ? new Date(nearestExpirySec * 1000).toISOString() : null,
  };
  writeLastGood(home, {
    plan_name: planName,
    primary_window: primaryWindow,
    secondary_window: secondaryWindow,
    tertiary_window: result.tertiary_window,
    quaternary_window: result.quaternary_window,
    grant_credits: result.grant_credits,
    grant_expires_at: result.grant_expires_at,
    captured_at: new Date(nowMs).toISOString(),
  });
  return result;
}

module.exports = { fetchSensenovaLimits };
