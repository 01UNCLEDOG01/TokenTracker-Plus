const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// Hark account quotas (hark.com). Ported from Token Monitor's provider
// (Javis603/token-monitor #1431, src/shared/providers/hark/) onto our
// provider shape.
//
// One call: GET https://hark.com/api/billing/summary authenticated with the
// better-auth session cookie `__Secure-hark.session_token`. The endpoint is
// undocumented; the free-plan response was verified against a signed-in
// account, while the paid-plan fields (per-feature allowances, unlimited,
// top-up) were reconstructed from the unpacked Hark client upstream — treat
// unknown shapes as unavailable rather than inventing numbers.
//
// Credential precedence (mirrors TM): a saved cookie wins over
// TOKENTRACKER_HARK_COOKIE / HARK_COOKIE, then the macOS desktop session.
// A non-empty invalid credential never falls through to the desktop file.
// Clearing the saved cookie restores env or desktop discovery.
//
// The macOS desktop session lives in Hark.app's WebKit binary cookie store
// (~/Library/HTTPStorages/com.harklabs.hark.mac.binarycookies), not Chromium
// SQLite. Reads never modify it; other platforms paste a token manually.
//
// Token spellings: WebKit percent-encodes the better-auth signature, so a
// pasted token may be encoded or decoded. Validation and identity use the
// decoded value; requests forward the accepted spelling unchanged.

const HARK_ORIGIN = "https://hark.com";
const HARK_SUMMARY_URL = `${HARK_ORIGIN}/api/billing/summary`;
const HARK_COOKIE_NAME = "__Secure-hark.session_token";
const HARK_COOKIE_HOSTS = new Set(["hark.com", ".hark.com"]);
const HARK_COOKIE_FILE = "com.harklabs.hark.mac.binarycookies";
const CREDENTIALS_FILE = "hark-credentials.json";
const DEFAULT_TIMEOUT_MS = 12_000;
const HARK_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

// Bare better-auth session token: two dot-separated base64url-ish runs.
const HARK_BARE_SESSION = /^[A-Za-z0-9]{16,128}\.[A-Za-z0-9+/_-]{16,256}={0,2}$/;

// The summary's plan.name carries a superscript the label pipeline strips,
// so the stable display names come from plan.id (upstream's mapping).
const HARK_PLAN_LABELS = {
  free: "Hark Pro",
  pro: "Hark Pro 2",
  scale: "Hark Pro 3",
  pro4: "Hark Pro 4",
};

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), CREDENTIALS_FILE);
}

// Accept a bare token or a Cookie header carrying the session token. Encoded
// and decoded spellings are one account; the accepted spelling is returned
// unchanged for the request. Empty on anything that is not a session token.
function acceptHarkSessionToken(token) {
  const value = String(token || "").trim();
  if (!value || /[\u0000-\u001f\u007f;]/u.test(value)) return "";
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "";
  }
  if (/[\u0000-\u001f\u007f;]/u.test(decoded)) return "";
  return HARK_BARE_SESSION.test(decoded) ? value : "";
}

function normalizeHarkSessionToken(value) {
  const raw = String(value || "").trim().replace(/^cookie\s*:\s*/iu, "");
  if (!raw || /[\u0000-\u001f\u007f]/u.test(raw)) return "";
  const match = /(?:^|;)\s*__Secure-hark\.session_token\s*=\s*([^;]+)/i.exec(raw);
  if (match) return acceptHarkSessionToken(match[1]);
  if (raw.includes(";")) return "";
  return acceptHarkSessionToken(raw);
}

// Read the stored cookie: options > credentials file > env fallback. The
// desktop session is only consulted when nothing is saved anywhere; a saved
// but invalid value must surface as an error instead of silently falling
// back (the user thinks they fixed it while the desktop session is stale).
function readCookie(home, env = process.env) {
  const file = credentialsPath(home);
  let raw = null;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    // ENOENT = nothing saved yet (fall through); other read failures mean the
    // file exists but cannot be read — report that instead of silently
    // falling back to the desktop session.
    if (error?.code !== "ENOENT") return { cookie: "", source: "file-unreadable" };
  }
  if (raw !== null) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A truncated/hand-edited file is unreadable, not "no cookie": falling
      // back would contradict the saved-value-wins invariant.
      return { cookie: "", source: "file-unreadable" };
    }
    const rawFile = typeof parsed?.cookie === "string" ? parsed.cookie.trim() : "";
    if (rawFile) {
      const value = normalizeHarkSessionToken(rawFile);
      if (value) return { cookie: value, source: "file" };
      return { cookie: "", source: "file-invalid" };
    }
  }
  const rawEnv = String(env.TOKENTRACKER_HARK_COOKIE || env.HARK_COOKIE || "").trim();
  if (rawEnv) {
    const envValue = normalizeHarkSessionToken(rawEnv);
    if (envValue) return { cookie: envValue, source: "env" };
    return { cookie: "", source: "env-invalid" };
  }
  return { cookie: "", source: null };
}

// Clear the saved cookie so discovery falls back to env or the desktop
// session again. A saved-but-invalid value deliberately never falls through,
// so without this a bad paste would lock out automatic discovery forever.
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
  const normalized = normalizeHarkSessionToken(cookie);
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

function harkDesktopCookieCandidates({ home = os.homedir(), platform = process.platform } = {}) {
  if (platform !== "darwin") return [];
  return [path.join(home, "Library", "HTTPStorages", HARK_COOKIE_FILE)];
}

function cString(buffer, offset) {
  if (offset < 32 || offset >= buffer.length) throw new Error("bad cookie record");
  const end = buffer.indexOf(0, offset);
  if (end < 0) throw new Error("bad cookie record");
  return buffer.toString("utf8", offset, end);
}

// WebKit binarycookies: 'cook' magic, a page-size table, then per-page cookie
// records (32-byte fixed header + 4 C strings at offsets 16/20/24/28).
function readBinaryCookies(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || buffer.toString("ascii", 0, 4) !== "cook") {
    throw new Error("bad cookie store");
  }
  const pageCount = buffer.readUInt32BE(4);
  const headerBytes = 8 + pageCount * 4;
  if (!pageCount || headerBytes > buffer.length) {
    throw new Error("bad cookie store");
  }
  const cookies = [];
  let pageOffset = headerBytes;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageSize = buffer.readUInt32BE(8 + pageIndex * 4);
    if (pageSize < 8 || pageOffset + pageSize > buffer.length) {
      throw new Error("bad cookie store");
    }
    const page = buffer.subarray(pageOffset, pageOffset + pageSize);
    pageOffset += pageSize;
    const count = page.readUInt32LE(4);
    if (8 + count * 4 > page.length) {
      throw new Error("bad cookie store");
    }
    for (let cookieIndex = 0; cookieIndex < count; cookieIndex += 1) {
      const recordOffset = page.readUInt32LE(8 + cookieIndex * 4);
      if (recordOffset < 8 + count * 4 || recordOffset + 32 > page.length) {
        throw new Error("bad cookie record");
      }
      const recordSize = page.readUInt32LE(recordOffset);
      if (recordSize < 32 || recordOffset + recordSize > page.length) {
        throw new Error("bad cookie record");
      }
      const record = page.subarray(recordOffset, recordOffset + recordSize);
      cookies.push({
        domain: cString(record, record.readUInt32LE(16)),
        name: cString(record, record.readUInt32LE(20)),
        path: cString(record, record.readUInt32LE(24)),
        value: cString(record, record.readUInt32LE(28)),
      });
    }
  }
  return cookies;
}

// Read the desktop session. Status semantics (mirrors upstream):
// "missing"  — no store or no session cookie in it → signed out (not an error)
// "unsupported" — this platform has no desktop discovery
// "unreadable" — store exists but cannot be parsed → report an error
function readHarkDesktopSession(options = {}) {
  const candidates = options.candidates || harkDesktopCookieCandidates(options);
  if (!candidates.length) return { status: "unsupported", value: "" };

  let statFailure = false;
  const filePath = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch (error) {
      if (error?.code !== "ENOENT") statFailure = true;
      return false;
    }
  });
  if (!filePath) {
    return { status: statFailure ? "unreadable" : "missing", value: "" };
  }

  let cookies;
  try {
    cookies = readBinaryCookies(fs.readFileSync(filePath));
  } catch (_error) {
    return { status: "unreadable", value: "" };
  }
  const row = cookies.find(
    (cookie) => cookie.name === HARK_COOKIE_NAME && HARK_COOKIE_HOSTS.has(cookie.domain),
  );
  if (typeof row?.value !== "string" || !row.value) return { status: "missing", value: "" };
  return { status: "ok", value: row.value };
}

function numberOrNull(value) {
  if (typeof value === "string" && /^\d+(\.\d+)?$/u.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return value;
}

function resetToIso(value) {
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  }
  return null;
}

// One used/limit meter → a window. A missing or non-positive ceiling drops
// the meter (an unlimited meter is not a quota); a negative used value with a
// real ceiling means the summary shape changed — refuse rather than render.
function harkWindow(kind, label, used, limit, resetsAt, windowSeconds) {
  const ceiling = numberOrNull(limit);
  const spent = numberOrNull(used);
  if (ceiling === null || ceiling <= 0) return null;
  if (spent === null) return { malformed: true };
  const window = {
    kind,
    label,
    used: spent,
    limit: ceiling,
    remaining: Math.max(0, ceiling - spent),
    used_percent: Math.max(0, Math.min(100, (spent / ceiling) * 100)),
    reset_at: resetToIso(resetsAt),
  };
  if (windowSeconds) window.limit_window_seconds = windowSeconds;
  return window;
}

function featureLabel(feature, period, suffix) {
  const name = feature === "message" ? "Messages" : String(feature || "").trim();
  const when = period === "day" ? "Daily" : period === "month" ? "Monthly" : "";
  return [when, name, suffix].filter(Boolean).join(" ");
}

// Strict contract on the billing summary. Anything unexpected → malformed
// (caller reports unavailable; no partial numbers from a changed shape).
function parseHarkSummary(body) {
  const plan = body?.plan;
  const meters = body?.meters;
  if (!plan || typeof plan !== "object" || !meters || typeof meters !== "object") {
    return { malformed: true };
  }
  const windows = [];
  const tokens = meters.harkTokens;
  if (plan.unlimited !== true) {
    if (!tokens || numberOrNull(tokens.dailyLimit) === null || numberOrNull(tokens.poolLimit) === null) {
      return { malformed: true };
    }
    const daily = harkWindow("daily", "Daily", tokens.dailyUsed, tokens.dailyLimit, tokens.dailyResetsAt, 86400);
    const pool = harkWindow("billing", "Monthly", tokens.poolUsed, tokens.poolLimit, tokens.poolResetsAt);
    if (daily?.malformed || pool?.malformed) return { malformed: true };
    if (daily) windows.push(daily);
    if (pool) windows.push(pool);
  }
  if (plan.unlimited !== true && Array.isArray(meters.perFeature)) {
    for (const row of meters.perFeature) {
      // Hark's own client never treats instance meters as allowances.
      if (!row || typeof row !== "object" || row.meter === "instances") continue;
      // The client only walks period day/month; anything else is not an
      // allowance either.
      if (row.period !== "day" && row.period !== "month") continue;
      const kind = row.period === "day" ? "daily" : "billing";
      const seconds = row.period === "day" ? 86400 : undefined;
      const count = harkWindow(kind, featureLabel(row.feature, row.period), row.countUsed, row.countLimit, row.resetsAt, seconds);
      const featureTokens = harkWindow(kind, featureLabel(row.feature, row.period, "tokens"), row.harkUsed, row.harkLimit, row.resetsAt, seconds);
      if (count?.malformed || featureTokens?.malformed) return { malformed: true };
      if (count) windows.push(count);
      if (featureTokens) windows.push(featureTokens);
    }
  }
  // Enabled automatic top-up with positive spend adds an unmetered USD line.
  const topup = body.autoTopup;
  const spentMinor = numberOrNull(topup?.spentThisPeriodMinor);
  const hasTopup = topup?.enabled === true && spentMinor !== null && spentMinor > 0;

  // Unknown plan.id falls back to plan.name; strip superscripts (⁰¹²³⁴⁵⁶⁷⁸⁹)
  // the label pipeline does not remove, so a new tier never renders "Pro⁵".
  const named = typeof plan.name === "string"
    ? plan.name.replace(/[\u2070\u00b9\u00b2\u00b3\u2074-\u2079]/gu, "").trim()
    : "";
  const primary = windows.find((w) => w.kind === "daily" && w.label === "Daily") || null;
  const secondary = windows.find((w) => w.kind === "billing" && w.label === "Monthly") || null;
  const featureWindows = windows.filter((w) => w !== primary && w !== secondary);
  return {
    planLabel: HARK_PLAN_LABELS[plan.id] || named || "Hark",
    primary_window: primary,
    secondary_window: secondary,
    feature_windows: featureWindows,
    hark_topup: hasTopup ? spentMinor / 100 : null,
  };
}

async function fetchHarkLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
  desktopSession = null,
} = {}) {
  const { cookie, source } = readCookie(home, env);

  if (!cookie) {
    if (source === "file-unreadable") {
      return { configured: true, error: "Hark credentials file could not be read" };
    }
    if (source === "file-invalid" || source === "env-invalid") {
      return {
        configured: true,
        error: "Hark cookie is not a valid session token (paste the bare token or the whole Cookie: line containing __Secure-hark.session_token)",
      };
    }
    // Only consult another app's cookie store when nothing is saved anywhere.
    const desktop = desktopSession === null ? readHarkDesktopSession({ home }) : desktopSession;
    if (desktop.status === "unreadable") {
      return { configured: true, error: "Hark cookie store could not be read" };
    }
    if (desktop.status === "ok") {
      const value = normalizeHarkSessionToken(desktop.value);
      if (!value) return { configured: true, error: "Hark cookie store holds an unusable session token" };
      return await fetchWithToken(value, "desktop-session");
    }
    return { configured: false, error: null };
  }
  return await fetchWithToken(cookie, source === "env" ? "env-cookie" : "cookie-file");

  async function fetchWithToken(token, tokenSource) {
    let response;
    try {
      response = await fetchImpl(HARK_SUMMARY_URL, {
        headers: {
          Accept: "application/json",
          Cookie: `${HARK_COOKIE_NAME}=${token}`,
          "User-Agent": HARK_USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
        credentials: "omit",
      });
    } catch (error) {
      return {
        configured: true,
        error: error?.name === "TimeoutError" || /abort/i.test(error?.message || "")
          ? "Hark quota fetch timed out"
          : `Hark quota fetch failed: ${error?.message || "network error"}`,
      };
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { configured: true, error: "Hark session expired or unauthorized" };
      }
      if (response.status === 429) {
        return { configured: true, error: "Hark quota fetch rate limited" };
      }
      return { configured: true, error: `Hark HTTP ${response.status} for billing summary` };
    }
    let body;
    try {
      body = await response.json();
    } catch (_error) {
      return { configured: true, error: "Hark billing summary returned malformed JSON" };
    }
    const parsed = parseHarkSummary(body);
    if (parsed.malformed) {
      return { configured: true, error: "Hark billing summary is malformed or lacks quota windows" };
    }
    return {
      configured: true,
      error: null,
      plan_name: parsed.planLabel,
      source: tokenSource,
      captured_at: new Date(nowMs).toISOString(),
      primary_window: parsed.primary_window,
      secondary_window: parsed.secondary_window,
      feature_windows: parsed.feature_windows,
      ...(parsed.hark_topup !== null ? { hark_topup: parsed.hark_topup } : {}),
    };
  }
}

module.exports = {
  HARK_COOKIE_NAME,
  HARK_COOKIE_FILE,
  HARK_SUMMARY_URL,
  HARK_ORIGIN,
  CREDENTIALS_FILE,
  credentialsPath,
  normalizeHarkSessionToken,
  readCookie,
  writeCookieFile,
  clearCookieFile,
  harkDesktopCookieCandidates,
  readBinaryCookies,
  readHarkDesktopSession,
  parseHarkSummary,
  fetchHarkLimits,
};
