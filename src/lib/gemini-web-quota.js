const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const GEMINI_WEB_COOKIE_FILE = "gemini-web-cookie.txt";
const GEMINI_WEB_COOKIE_ENV = "TOKENTRACKER_GEMINI_WEB_COOKIE";
const MAX_COOKIE_LENGTH = 64 * 1024;
const USAGE_QUERY_SIGNATURE = "2/dWbCvkVB0X16r9NPnxifeOAAqdCqMf0xeWvau9yPy7g=";

function normalizeGeminiWebCookie(value) {
  const raw = typeof value === "string" ? value.trim().replace(/^cookie\s*:\s*/i, "") : "";
  if (!raw || raw.length > MAX_COOKIE_LENGTH || /[\r\n\0]/.test(raw)) return null;
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || parts.some((part) => !/^[^=;\s]+=/.test(part))) return null;
  return parts.join("; ");
}

function geminiWebCookiePath({ home = os.homedir() } = {}) {
  return path.join(home, ".tokentracker", "tracker", GEMINI_WEB_COOKIE_FILE);
}

function readGeminiWebCookie({ home = os.homedir(), env = process.env } = {}) {
  const fromEnv = typeof env?.[GEMINI_WEB_COOKIE_ENV] === "string"
    ? env[GEMINI_WEB_COOKIE_ENV].trim()
    : "";
  if (fromEnv) {
    const cookie = normalizeGeminiWebCookie(fromEnv);
    return { cookie, source: "env", error: cookie ? null : "invalid_cookie" };
  }

  try {
    const cookie = normalizeGeminiWebCookie(fs.readFileSync(geminiWebCookiePath({ home }), "utf8"));
    return { cookie, source: "file", error: cookie ? null : "invalid_cookie" };
  } catch (error) {
    if (error?.code === "ENOENT") return { cookie: null, source: null, error: null };
    return { cookie: null, source: null, error: "cookie_read_failed" };
  }
}

function writeGeminiWebCookie({ home = os.homedir(), cookie } = {}) {
  const normalized = normalizeGeminiWebCookie(cookie);
  if (!normalized) return { saved: false, error: "invalid_cookie" };
  const target = geminiWebCookiePath({ home });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, normalized, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, target);
    return { saved: true, source: "file" };
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
    return { saved: false, error: "cookie_write_failed" };
  }
}

function clearGeminiWebCookie({ home = os.homedir(), env = process.env } = {}) {
  try {
    fs.unlinkSync(geminiWebCookiePath({ home }));
  } catch (error) {
    if (error?.code !== "ENOENT") return { saved: false, error: "cookie_clear_failed" };
  }
  return {
    saved: true,
    env_active: Boolean(typeof env?.[GEMINI_WEB_COOKIE_ENV] === "string" && env[GEMINI_WEB_COOKIE_ENV].trim()),
  };
}

function normalizeUsageWindow(pool, windowSeconds) {
  const percent = pool?.percentageUsed;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0) return null;
  const rawReset = pool?.gxu?.windowRefreshesAt;
  const resetMs = typeof rawReset === "string" ? Date.parse(rawReset) : NaN;
  return {
    used_percent: Math.min(100, percent * 100),
    reset_at: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
    limit_window_seconds: windowSeconds,
  };
}

async function fetchGeminiWebQuota({
  cookie,
  fetchImpl = fetch,
  timeoutMs = 10000,
  nowMs = Date.now(),
} = {}) {
  const normalizedCookie = normalizeGeminiWebCookie(cookie);
  if (!normalizedCookie) {
    throw Object.assign(new Error("Gemini web cookie is missing or invalid."), { code: "AUTH_EXPIRED" });
  }

  const variables = JSON.stringify({
    g1Request: { entrypoints: ["GEMINI_USAGE_SETTINGS_UPGRADE_BANNER"] },
    workspaceRequest: { recommendationsForSurfaceRequests: [] },
  });
  const url = "https://gemini.google.com/_/BardChatUi/graphql/schemas/GEMINI_WEB_GRAPHQL/executeQuery"
    + `?query_signature=${encodeURIComponent(USAGE_QUERY_SIGNATURE)}&variables=${encodeURIComponent(variables)}`;

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Referer: "https://gemini.google.com/usage",
      Cookie: normalizedCookie,
      "User-Agent": "Mozilla/5.0",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error("Gemini web session expired. Update the cookie in Limits settings."), { code: "AUTH_EXPIRED" });
  }
  if (response.status === 429) {
    throw Object.assign(new Error("Gemini usage is rate limited. Try again later."), { code: "RATE_LIMITED" });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Gemini usage returned HTTP ${response.status}.`), { code: "PROVIDER_UNAVAILABLE" });
  }

  let parsed;
  try {
    const raw = await response.text();
    parsed = JSON.parse(raw.trim().replace(/^\)\]\}'\s*/, ""));
  } catch {
    throw Object.assign(new Error("Gemini usage response changed. Update TokenTracker Plus."), { code: "PARSE_FAILED" });
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const data = entries.map((entry) => entry?.data).find(Boolean);
  const usage = data?.viewer?.rpcs?.getUsageInfo;
  if (!usage || !Array.isArray(usage.pools)) {
    throw Object.assign(new Error("Gemini usage response did not contain quota pools."), { code: "PARSE_FAILED" });
  }

  const pools = usage.pools;
  const primary = normalizeUsageWindow(
    pools.find((pool) => pool?.poolType === "GXU_FIVE_HOURLY"),
    5 * 3600,
  );
  const secondary = normalizeUsageWindow(
    pools.find((pool) => pool?.poolType === "GXU_WEEKLY"),
    7 * 86400,
  );
  if (!primary && !secondary) {
    throw Object.assign(new Error("This Google account reports no Gemini app usage windows."), { code: "PARSE_FAILED" });
  }

  return {
    configured: true,
    error: null,
    source: "gemini-web-graphql",
    account_email: null,
    account_plan: null,
    primary_window: primary,
    secondary_window: secondary,
    tertiary_window: null,
    stale: false,
    cached_at: new Date(nowMs).toISOString(),
    cache_identity: "gemini-web",
  };
}

module.exports = {
  GEMINI_WEB_COOKIE_ENV,
  normalizeGeminiWebCookie,
  readGeminiWebCookie,
  writeGeminiWebCookie,
  clearGeminiWebCookie,
  fetchGeminiWebQuota,
};
