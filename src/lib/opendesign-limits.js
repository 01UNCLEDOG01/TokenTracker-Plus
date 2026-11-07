const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// OpenDesign subscription quota (amr-api.open-design.ai). Ported from Token
// Monitor's provider (Javis603/token-monitor #1366,
// src/shared/providers/opendesign/limits.js) onto our provider shape.
//
// Two calls: GET .../workspaces/current discovers the workspace, then
// GET .../workspaces/{id}/billing/coding-plan-usage with the
// X-Vela-Workspace-Id header returns `windows[]` keyed by durationSeconds
// (18000 = 5-hour session window, 604800 = weekly).
//
// The session is opaque: the user pastes a complete Cookie header from
// open-design.ai (DevTools → Network → any request → Cookie). It is stored in
// ~/.tokentracker/opendesign-credentials.json
// ({ "cookie": "..." }) with 0600 perms, or read from
// TOKENTRACKER_OPENDESIGN_COOKIE / OPENDESIGN_COOKIE. Never echoed back.
//
// Credits are allowance units, not money: the fetcher reports used/limit as
// amounts, and the panel renders plain 5h/weekly percent bars (no currency).

const OPENDESIGN_API = "https://amr-api.open-design.ai/api/v1/workspaces/";
const DEFAULT_TIMEOUT_MS = 12_000;
const WINDOW_SESSION_SECONDS = 5 * 60 * 60;
const WINDOW_WEEKLY_SECONDS = 7 * 24 * 60 * 60;
const CREDENTIALS_FILE = "opendesign-credentials.json";

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), CREDENTIALS_FILE);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Accept a complete opaque Cookie header. Reject anything that is not a
// well-formed cookie list: bare tokens, control characters, header tricks.
// Mirrors TM's normalizeOpendesignCookieHeader.
function normalizeOpendesignCookieHeader(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) return "";
  const raw = value.trim().replace(/^cookie\s*:\s*/iu, "");
  if (!raw) return "";
  for (const pair of raw.split(";")) {
    const match = pair.trim().match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)$/u);
    if (!match) return "";
  }
  return raw;
}

// Read the stored cookie: options > credentials file > env fallback.
// source distinguishes "nothing configured" (null) from "configured but
// unusable" (raw string that failed normalization → caller reports an error
// instead of a silent not-configured).
function readCookie(home, env = process.env) {
  const file = credentialsPath(home);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const rawFile = typeof parsed?.cookie === "string" ? parsed.cookie.trim() : "";
    if (rawFile) {
      const value = normalizeOpendesignCookieHeader(rawFile);
      if (value) return { cookie: value, source: "file" };
      return { cookie: "", source: "file-invalid" };
    }
  } catch { /* fall through to env */ }
  const rawEnv = clean(env.TOKENTRACKER_OPENDESIGN_COOKIE || env.OPENDESIGN_COOKIE || "");
  if (rawEnv) {
    const envValue = normalizeOpendesignCookieHeader(rawEnv);
    if (envValue) return { cookie: envValue, source: "env" };
    return { cookie: "", source: "env-invalid" };
  }
  return { cookie: "", source: null };
}

// 0600 file write used by the local-api cookie endpoint. Returns the result
// object the paste box renders; the cookie value itself is never echoed back.
function writeCookieFile({ home, cookie }) {
  const normalized = normalizeOpendesignCookieHeader(cookie);
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

function credits(value) {
  if (typeof value === "string" && /^\d+(\.\d+)?$/u.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return value;
}

// Strict contract: workspaceId must match, eligible must be true, exactly one
// window per known duration, numeric credits. Anything else → null (caller
// reports unavailable; no partial numbers from a malformed payload).
function parseOpendesignUsage(usage, workspaceId) {
  if (usage?.workspaceId !== workspaceId || usage.eligible !== true || !Array.isArray(usage.windows)) {
    return null;
  }
  const windows = [];
  for (const [seconds, kind] of [[WINDOW_SESSION_SECONDS, "primary"], [WINDOW_WEEKLY_SECONDS, "secondary"]]) {
    const matches = usage.windows.filter((w) => w?.durationSeconds === seconds);
    if (!matches.length) continue;
    if (matches.length !== 1) return null;
    const raw = matches[0];
    const used = credits(raw.usedCredits);
    const limit = credits(raw.limitCredits);
    if (used === null || limit === null || limit <= 0) return null;
    const usedPercent = Math.max(0, Math.min(100, (used / limit) * 100));
    const resetMs = typeof raw.resetsAt === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(raw.resetsAt)
      ? Date.parse(raw.resetsAt)
      : NaN;
    windows.push({
      kind,
      used,
      limit,
      remaining: Math.max(0, limit - used),
      used_percent: usedPercent,
      reset_at: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
      limit_window_seconds: seconds,
    });
  }
  return windows.length ? { windows } : null;
}

function planLabel(tier, membershipTier) {
  const parts = [clean(tier), clean(membershipTier)].filter(Boolean);
  if (!parts.length) return null;
  const label = [...new Set(parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)))].join(" ");
  return label || null;
}

async function fetchOpendesignLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const { cookie, source } = readCookie(home, env);
  if (!cookie) {
    if (source === "file-invalid" || source === "env-invalid") {
      return { configured: true, error: "OpenDesign cookie is not a valid Cookie header (paste the whole Cookie: line from open-design.ai)" };
    }
    return { configured: false, error: null };
  }

  let lastError = null;
  const get = async (urlPath, workspaceId) => {
    const response = await fetchImpl(OPENDESIGN_API + urlPath, {
      headers: {
        Accept: "application/json",
        Cookie: cookie,
        ...(workspaceId ? { "X-Vela-Workspace-Id": workspaceId } : {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (!response.ok) {
      const error = new Error(`OpenDesign HTTP ${response.status} for ${urlPath}`);
      error.statusCode = response.status;
      throw error;
    }
    return response.json();
  };

  try {
    const workspace = await get("current");
    const id = typeof workspace?.workspaceId === "string" ? workspace.workspaceId : "";
    if (!id || !/^[A-Za-z0-9_-]{1,128}$/u.test(id)) {
      return { configured: true, error: "OpenDesign quota response has no valid workspace id" };
    }
    const usage = await get(`${id}/billing/coding-plan-usage`, id);
    const parsed = parseOpendesignUsage(usage, id);
    if (!parsed) {
      return { configured: true, error: "OpenDesign usage response is malformed or lacks quota windows" };
    }
    const [primary] = parsed.windows.filter((w) => w.kind === "primary");
    const [secondary] = parsed.windows.filter((w) => w.kind === "secondary");
    return {
      configured: true,
      plan_name: planLabel(usage.tier, workspace.personalMembershipTier) || "Subscription",
      primary_window: primary || null,
      secondary_window: secondary || null,
      opendesign_session_window: primary
        ? { used: primary.used, limit: primary.limit, remaining: primary.remaining }
        : null,
      opendesign_weekly_window: secondary
        ? { used: secondary.used, limit: secondary.limit, remaining: secondary.remaining }
        : null,
      source: source === "env" ? "env-cookie" : "cookie-file",
      workspace_id: id,
      captured_at: new Date(nowMs).toISOString(),
    };
  } catch (error) {
    // A denied billing permission does not prove the session expired.
    if (error?.statusCode === 401 || error?.name === "TimeoutError" || /abort/i.test(error?.message || "")) {
      lastError = error?.statusCode === 401
        ? "OpenDesign session expired or unauthorized"
        : "OpenDesign quota fetch timed out";
    } else {
      lastError = error?.message || "OpenDesign quota fetch failed";
    }
    return { configured: true, error: lastError };
  }
}

module.exports = {
  OPENDESIGN_API,
  CREDENTIALS_FILE,
  credentialsPath,
  normalizeOpendesignCookieHeader,
  readCookie,
  writeCookieFile,
  parseOpendesignUsage,
  planLabel,
  fetchOpendesignLimits,
};
