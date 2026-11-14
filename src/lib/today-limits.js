const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// Today (todayai.cn 中国版) plan/usage quotas. Built from the desktop client's
// own generated API client (resources/app.asar, 2026-11-14): the shapes below
// were verified against a signed-in account live; anything unexpected is
// reported as malformed rather than rendered as invented numbers.
//
// Auth chain (all verified live, see memory tt-plus-today-lane-recon):
//   1. session cookie `__Secure-better-auth.session_token` (todayai.cn)
//   2. GET https://auth.todayai.cn/api/auth/token  (Authorization: Bearer
//      <session token>) → { token: <JWT ~530B> }
//   3. GET https://api.todayai.cn/v1/pricing/status|resets (Bearer JWT)
//
// The API exposes usage ONLY as percentages (no absolute token counts
// anywhere) — windows therefore carry a synthetic limit of 100 so the meter
// renders a true percent bar; labels say so explicitly.
//
// Credential precedence (mirrors Hark): saved cookie file wins over
// TOKENTRACKER_TODAY_COOKIE; a saved-but-invalid value never falls back to
// env (the user thinks they fixed it while nothing changed). The Windows
// desktop app keeps its session in an encrypted leveldb cookie store — no
// automatic desktop discovery; pasting the cookie is the only intake.

const TODAY_API_ORIGIN = "https://api.todayai.cn";
const TODAY_AUTH_TOKEN_URL = "https://auth.todayai.cn/api/auth/token";
const TODAY_STATUS_URL = `${TODAY_API_ORIGIN}/v1/pricing/status`;
const TODAY_RESETS_URL = `${TODAY_API_ORIGIN}/v1/pricing/resets`;
const TODAY_COOKIE_NAME = "__Secure-better-auth.session_token";
const CREDENTIALS_FILE = "today-cn-credentials.json";
const DEFAULT_TIMEOUT_MS = 12_000;
const TODAY_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

// Bare better-auth session token: one base64url-ish run (observed 32 chars,
// no dots). A pasted whole Cookie: line is also accepted.
const TODAY_BARE_SESSION = /^[A-Za-z0-9_-]{20,128}$/;

const PERCENT_LIMIT = 100;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), CREDENTIALS_FILE);
}

// Accept a bare session token or a Cookie header carrying the session token.
// Empty on anything that is not a session token (no control chars, no `;`).
function acceptTodaySessionToken(token) {
  const value = String(token || "").trim();
  if (!value || /[\u0000-\u001f\u007f;]/u.test(value)) return "";
  if (TODAY_BARE_SESSION.test(value)) return value;
  return "";
}

// Intake normalization. Accepts:
//   a) the whole Cookie: request header / one-pair-per-line block — keeps every
//      __Secure-better-auth.session_token* pair VERBATIM (URL-encoded as the
//      browser sends them) for the get-session call;
//   b) a bare session token (observed 32 base64url chars) for a direct
//      Bearer exchange.
// Anything else → empty string (rejected upstream).
const TODAY_SESSION_PAIR = new RegExp("(?:^|;\\s*)(__Secure-better-auth\\.session_token[A-Za-z0-9_.-]*)=([^;\\r\\n]+)", "i");
const TODAY_SESSION_PREFIX = "__Secure-better-auth.session_token";

function normalizeTodaySessionCookie(value) {
  let raw = String(value || "").trim().replace(/^cookie\s*:\s*/iu, "");
  if (!raw) return "";
  const pairs = [];
  for (const part of raw.split(/;\s*|\r?\n/)) {
    const m = TODAY_SESSION_PAIR.exec("; " + part.trim());
    if (m) pairs.push(m[1] + "=" + m[2]);
  }
  return pairs.length ? pairs.join("; ") : "";
}

function isBareTodaySessionToken(value) {
  return TODAY_BARE_SESSION.test(String(value || "").trim());
}

// Read the stored cookie: options > credentials file > env fallback. The
// saved-value-wins invariant mirrors Hark: a saved-but-invalid value surfaces
// as an error instead of silently falling back to env.
function readCookie(home, env = process.env) {
  const file = credentialsPath(home);
  let raw = null;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") return { cookie: "", source: "file-unreadable" };
  }
  if (raw !== null) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { cookie: "", source: "file-unreadable" };
    }
    const rawFile = typeof parsed?.cookie === "string" ? parsed.cookie.trim() : "";
    if (rawFile) {
      const cookieHeader = normalizeTodaySessionCookie(rawFile);
      if (cookieHeader) return { cookie: cookieHeader, source: "file", cookieHeader: true };
      if (isBareTodaySessionToken(rawFile)) return { cookie: rawFile, source: "file", cookieHeader: false };
      return { cookie: "", source: "file-invalid" };
    }
  }
  const rawEnv = String(env.TOKENTRACKER_TODAY_COOKIE || env.TODAY_COOKIE || "").trim();
  if (rawEnv) {
    const cookieHeader = normalizeTodaySessionCookie(rawEnv);
    if (cookieHeader) return { cookie: cookieHeader, source: "env", cookieHeader: true };
    if (isBareTodaySessionToken(rawEnv)) return { cookie: rawEnv, source: "env", cookieHeader: false };
    return { cookie: "", source: "env-invalid" };
  }
  return { cookie: "", source: null };
}

function clearCookieFile({ home }) {
  const file = credentialsPath(home);
  try {
    fs.rmSync(file, { force: true });
  } catch (error) {
    return { saved: false, error: error?.code === "EACCES" ? "forbidden" : "write_failed" };
  }
  return { saved: true, cleared: true };
}

// 0600 file write used by the local-api cookie endpoint. The value itself is
// never echoed back.
function writeCookieFile({ home, cookie }) {
  const normalized = normalizeTodaySessionCookie(cookie) || (isBareTodaySessionToken(String(cookie || "").trim()) ? String(cookie).trim() : "");
  if (!normalized) {
    return { saved: false, error: "invalid_cookie" };
  }
  const file = credentialsPath(home);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify({ cookie: normalized }, null, 2)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort on platforms that fchmod */ }
  } catch (error) {
    return { saved: false, error: error?.code === "EACCES" ? "forbidden" : "write_failed" };
  }
  return { saved: true };
}

function percentWindow(kind, label, usedPercent, resetAt) {
  const pct = Number(usedPercent);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { malformed: true };
  const rounded = Math.round(pct);
  const window = {
    kind,
    label,
    used: rounded,
    limit: PERCENT_LIMIT,
    remaining: Math.max(0, PERCENT_LIMIT - rounded),
    used_percent: rounded,
    reset_at: typeof resetAt === "string" && resetAt ? resetAt : null,
    // Tells the spec/renderer the unit is percent-of-allowance, not tokens.
    percent_only: true,
  };
  return window;
}

function resetToIso(value) {
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  return null;
}

// Strict contract on /v1/pricing/status. Anything unexpected → malformed
// (caller reports unavailable; no partial numbers from a changed shape).
function parseTodayStatus(body) {
  const status = body?.data?.status;
  const usage = status?.usage;
  if (!status || typeof status !== "object" || !usage || typeof usage !== "object") {
    return { malformed: true };
  }
  if (typeof usage.progress !== "number" || !Number.isFinite(usage.progress)) {
    return { malformed: true };
  }
  const primary = percentWindow("monthly", "Total usage", usage.progress, usage.resetAt);
  if (primary.malformed) return { malformed: true };
  const breakdown = usage.breakdown;
  const rawItems = breakdown && Array.isArray(breakdown.items) ? breakdown.items : [];
  const featureWindows = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const label = item?.display?.title;
    if (typeof label !== "string" || !label.trim()) continue;
    const feature = percentWindow("feature", label.trim(), item.usedPercent, usage.resetAt);
    if (feature.malformed) return { malformed: true };
    featureWindows.push(feature);
  }
  const planTitle = typeof status.display?.title === "string" && status.display.title.trim()
    ? status.display.title.trim()
    : "";
  return {
    planLabel: planTitle ? `Today ${planTitle}` : "Today",
    entitlementEndsAt: resetToIso(status.entitlementEndsAt),
    primary: { ...primary, kind: "billing", label: "Total usage" },
    featureWindows,
  };
}

// Strict contract on /v1/pricing/resets: a count of unused quota-reset
// credits (invite rewards). Shape changed → malformed, never a guessed count.
function parseTodayResets(body) {
  const data = body?.data;
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
    return { malformed: true };
  }
  const count = typeof data.totalCount === "number" && Number.isFinite(data.totalCount)
    ? data.totalCount
    : data.items.length;
  return { resets: Math.max(0, count) };
}

async function fetchTodayLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const { cookie, source, cookieHeader } = readCookie(home, env);

  if (!cookie) {
    if (source === "file-unreadable") {
      return { configured: true, error: "Today credentials file could not be read" };
    }
    if (source === "file-invalid" || source === "env-invalid") {
      return {
        configured: true,
        error: "Today cookie is not a valid session token (paste the bare token or the whole Cookie: line containing __Secure-better-auth.session_token)",
      };
    }
    return { configured: false, error: null };
  }

  return await fetchWithToken(cookie, source === "env" ? "env-cookie" : "cookie-file", cookieHeader);

  async function fetchJson(url, headers, what) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
        credentials: "omit",
      });
    } catch (error) {
      return { error: error?.name === "TimeoutError" || /abort/i.test(error?.message || "")
        ? `Today quota fetch timed out`
        : `Today quota fetch failed: ${error?.message || "network error"}` };
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { error: "Today session expired or unauthorized (paste a fresh cookie)" };
      }
      if (response.status === 429) {
        return { error: "Today quota fetch rate limited" };
      }
      return { error: `Today HTTP ${response.status} for ${what}` };
    }
    try {
      return { body: await response.json() };
    } catch (_error) {
      return { error: `Today ${what} returned malformed JSON` };
    }
  }

  async function fetchWithToken(sessionCredential, tokenSource, cookieHeader) {
    let sessionToken = sessionCredential;
    if (cookieHeader) {
      // Cookie intake: the pasted value is a signed/URL-encoded envelope, not
      // the bare token — read the canonical session token from get-session.
      const sessionRes = await fetchJson("https://auth.todayai.cn/api/auth/get-session", {
        Accept: "application/json",
        Cookie: sessionCredential,
        "User-Agent": TODAY_USER_AGENT,
      }, "get-session");
      if (sessionRes.error) return { configured: true, error: sessionRes.error };
      sessionToken = sessionRes.body?.session?.token;
      if (typeof sessionToken !== "string" || !sessionToken) {
        return { configured: true, error: "Today get-session returned no session token (signed out?)" };
      }
    }
    // Step 2: exchange the session token for a short-lived API JWT.
    const exchange = await fetchJson(TODAY_AUTH_TOKEN_URL, {
      Accept: "application/json",
      Authorization: `Bearer ${sessionToken}`,
      "User-Agent": TODAY_USER_AGENT,
    }, "token exchange");
    if (exchange.error) return { configured: true, error: exchange.error };
    const accessToken = exchange.body && typeof exchange.body.token === "string" ? exchange.body.token : "";
    if (!accessToken) {
      return { configured: true, error: "Today token exchange returned no token (shape changed)" };
    }

    const authHeaders = {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": TODAY_USER_AGENT,
    };

    // Step 2: plan + percent usage.
    const statusRes = await fetchJson(TODAY_STATUS_URL, authHeaders, "pricing status");
    if (statusRes.error) return { configured: true, error: statusRes.error };
    const parsed = parseTodayStatus(statusRes.body);
    if (parsed.malformed) {
      return { configured: true, error: "Today pricing status is malformed or lacks quota windows" };
    }

    // Step 3: unused quota-reset credits (invite rewards). A malformed resets
    // payload must not sink the whole provider — report it as unavailable.
    let resets = null;
    const resetsRes = await fetchJson(TODAY_RESETS_URL, authHeaders, "pricing resets");
    if (resetsRes.error) {
      return { configured: true, error: resetsRes.error };
    }
    const parsedResets = parseTodayResets(resetsRes.body);
    if (parsedResets.malformed) {
      return { configured: true, error: "Today pricing resets is malformed" };
    }
    resets = parsedResets.resets;

    return {
      configured: true,
      error: null,
      plan_name: parsed.planLabel,
      source: tokenSource,
      captured_at: new Date(nowMs).toISOString(),
      ...(parsed.entitlementEndsAt ? { today_entitlement_ends_at: parsed.entitlementEndsAt } : {}),
      primary_window: parsed.primary,
      feature_windows: parsed.featureWindows,
      ...(resets !== null ? { today_resets: resets } : {}),
    };
  }
}

module.exports = {
  TODAY_API_ORIGIN,
  TODAY_AUTH_TOKEN_URL,
  TODAY_STATUS_URL,
  TODAY_RESETS_URL,
  TODAY_COOKIE_NAME,
  CREDENTIALS_FILE,
  credentialsPath,
  normalizeTodaySessionCookie,
  isBareTodaySessionToken,
  readCookie,
  writeCookieFile,
  clearCookieFile,
  parseTodayStatus,
  parseTodayResets,
  fetchTodayLimits,
};
