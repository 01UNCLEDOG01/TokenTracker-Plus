const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// OpenAI Platform API credits (api.openai.com/v1/dashboard/billing/
// credit_grants). Ported from Token Monitor's opt-in plugin (Javis603/
// token-monitor #1407/#1409, plugins/openai-api-credit; MIT) onto our
// provider shape.
//
// ⚠️ UNDOCUMENTED ENDPOINT: credit_grants is not part of the published API.
// The endpoint and its credentials may change or stop working at any time —
// the provider degrades to an error row rather than guessing numbers.
//
// Auth is NOT an API key: the user copies two request headers from the
// platform.openai.com billing page's credit_grants request in DevTools —
//   - sessionBearer: the Authorization header value (a web session token;
//     a leading "Bearer " prefix is stripped and re-added by the fetcher)
//   - organization: the OpenAI-Organization header value
// Stored in ~/.tokentracker/openai-credits-credentials.json with 0600 perms,
// or read from TOKENTRACKER_OPENAI_CREDITS_SESSION /
// TOKENTRACKER_OPENAI_ORGANIZATION. Never echoed back.
//
// The meter total is deliberately conservative: it is only shown when the
// active grants reconcile with total_available (see meterTotal below), so a
// stale grant list can never invent a fake progress-bar limit.

const OPENAI_CREDITS_URL = "https://api.openai.com/v1/dashboard/billing/credit_grants";
const DEFAULT_TIMEOUT_MS = 15_000;
const CREDENTIALS_FILE = "openai-credits-credentials.json";
// Rounding tolerance when reconciling Σ active grants against total_available.
const RECONCILE_TOLERANCE = 1e-6;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), CREDENTIALS_FILE);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

// A web session token must not contain whitespace or control characters (it
// is sent as a single Authorization header value). The Bearer prefix is
// normalized away here so both pasted shapes store identically.
function normalizeSessionBearer(value) {
  if (typeof value !== "string") return "";
  const stripped = value.trim().replace(/^Bearer\s+/i, "").trim();
  if (!stripped || /[\s\u0000-\u001f\u007f]/u.test(stripped)) return "";
  return stripped;
}

function normalizeOrganization(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  // Header-value safety: whitespace and control characters are rejected the
  // same way the bearer token is (a real org id is a single token).
  if (!trimmed || /[\s\u0000-\u001f\u007f]/u.test(trimmed)) return "";
  return trimmed;
}

// Read the stored credentials: options > credentials file > env fallback.
// source distinguishes "nothing configured" (null) from "configured but
// unusable" (values that failed normalization → caller reports an error
// instead of a silent not-configured).
function readCredentials(home, env = process.env) {
  const file = credentialsPath(home);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const fileBearer = typeof parsed?.sessionBearer === "string" ? parsed.sessionBearer : "";
    const fileOrg = typeof parsed?.organization === "string" ? parsed.organization : "";
    if (fileBearer || fileOrg) {
      const bearer = normalizeSessionBearer(fileBearer);
      const organization = normalizeOrganization(fileOrg);
      if (bearer && organization) return { sessionBearer: bearer, organization, source: "file" };
      return { sessionBearer: "", organization: "", source: "file-invalid" };
    }
  } catch { /* fall through to env */ }
  const envBearer = clean(env.TOKENTRACKER_OPENAI_CREDITS_SESSION || "");
  const envOrg = clean(env.TOKENTRACKER_OPENAI_ORGANIZATION || "");
  if (envBearer || envOrg) {
    const bearer = normalizeSessionBearer(envBearer);
    const organization = normalizeOrganization(envOrg);
    if (bearer && organization) return { sessionBearer: bearer, organization, source: "env" };
    return { sessionBearer: "", organization: "", source: "env-invalid" };
  }
  return { sessionBearer: "", organization: "", source: null };
}

// 0600 file write used by the local-api credentials endpoint. Returns the
// result object the paste box renders; the values themselves are never
// echoed back.
function writeCredentialsFile({ home, sessionBearer, organization }) {
  const bearer = normalizeSessionBearer(sessionBearer);
  const org = normalizeOrganization(organization);
  if (!bearer || !org) {
    return { saved: false, error: "invalid_credentials" };
  }
  const file = credentialsPath(home);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, `${JSON.stringify({ sessionBearer: bearer, organization: org }, null, 2)}\n`, { mode: 0o600 });
    try { fs.chmodSync(file, 0o600); } catch { /* best effort on platforms that fchmod */ }
  } catch (error) {
    return { saved: false, error: error?.code === "EACCES" ? "forbidden" : "write_failed" };
  }
  return { saved: true };
}

// Strict contract: object must be "credit_summary", total_available must be a
// finite non-negative number. Grants contribute to the meter only when they
// are active (not scheduled/held), unexpired (expires_at null = never), and
// have amount left.
function parseBalance(data, nowMs) {
  if (!data || typeof data !== "object" || data.object !== "credit_summary") {
    return { error: "invalid-credit-response" };
  }
  const available = Number(data.total_available);
  // Strictly a number: a string total means the payload shape changed, and
  // guessing would put a wrong balance on the card.
  if (typeof data.total_available !== "number" || !Number.isFinite(available) || available < 0) {
    return { error: "invalid-credit-response" };
  }
  const granted = Number(data.total_granted);
  const used = Number(data.total_used);
  const paidRaw = data.total_paid_available;
  const paidAvailable = paidRaw === undefined || paidRaw === null
    ? null
    : (Number.isFinite(Number(paidRaw)) ? Number(paidRaw) : null);

  const grants = Array.isArray(data.grants?.data) ? data.grants.data : [];
  const usable = [];
  for (const grant of grants) {
    if (!grant || typeof grant !== "object") continue;
    if (grant.is_scheduled === true || grant.is_held_for_prepaid_transition === true) continue;
    const amount = Number(grant.grant_amount);
    const grantUsed = Number(grant.used_amount);
    if (!Number.isFinite(amount) || !Number.isFinite(grantUsed)) continue;
    const remaining = amount - grantUsed;
    if (remaining <= 0) continue;
    const expiresAtSec = grant.expires_at;
    const expiresMs = expiresAtSec === null || expiresAtSec === undefined
      ? null
      : (Number.isFinite(Number(expiresAtSec)) ? Number(expiresAtSec) * 1000 : NaN);
    if (Number.isNaN(expiresMs)) continue;
    if (expiresMs !== null && expiresMs <= nowMs) continue;
    usable.push({ remaining, expiresMs });
  }

  // Meter total only when the grant list reconciles with the authoritative
  // total_available; otherwise null (balance-only display, no invented limit).
  const activeTotal = usable.reduce((sum, grant) => sum + grant.remaining, 0);
  let meterTotal = null;
  if (paidAvailable === 0
    && Math.abs(activeTotal - available) <= RECONCILE_TOLERANCE
    && available <= activeTotal + RECONCILE_TOLERANCE) {
    meterTotal = activeTotal;
  }

  const expiring = usable.filter((grant) => grant.expiresMs !== null);
  const expiresAt = expiring.length
    ? new Date(Math.min(...expiring.map((grant) => grant.expiresMs))).toISOString()
    : null;

  return {
    available,
    granted: Number.isFinite(granted) ? granted : null,
    used: Number.isFinite(used) ? used : null,
    meterTotal,
    expiresAt,
    usableGrants: usable.sort((a, b) => (a.expiresMs ?? Infinity) - (b.expiresMs ?? Infinity)),
  };
}

async function fetchOpenaiCreditsLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const { sessionBearer, organization, source } = readCredentials(home, env);
  if (!sessionBearer || !organization) {
    if (source === "file-invalid" || source === "env-invalid") {
      return { configured: true, error: "OpenAI Platform credentials are incomplete (paste both the Authorization header value and the OpenAI-Organization id from the credit_grants request)" };
    }
    return { configured: false, error: null };
  }

  try {
    const response = await fetchImpl(OPENAI_CREDITS_URL, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${sessionBearer}`,
        "OpenAI-Organization": organization,
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
    if (response.status === 401 || response.status === 403) {
      return { configured: true, error: "OpenAI Platform session expired or unauthorized" };
    }
    if (response.status === 429) {
      return { configured: true, error: "OpenAI Platform rate limited" };
    }
    if (!response.ok) {
      return { configured: true, error: `OpenAI Platform HTTP ${response.status} for credit_grants` };
    }
    const parsed = parseBalance(await response.json(), nowMs);
    if (parsed.error) {
      return { configured: true, error: "OpenAI credit response is not a credit_summary payload" };
    }

    const primary = parsed.meterTotal !== null
      ? {
        kind: "primary",
        used: parsed.meterTotal - parsed.available,
        limit: parsed.meterTotal,
        remaining: parsed.available,
        used_percent: parsed.meterTotal > 0
          ? ((parsed.meterTotal - parsed.available) / parsed.meterTotal) * 100
          : 0,
        reset_at: parsed.expiresAt,
      }
      : null;

    return {
      configured: true,
      plan_name: "API Credits",
      primary_window: primary,
      openai_credits_available: parsed.available,
      openai_credits_currency: "USD",
      openai_credits_expires_at: parsed.expiresAt,
      source: source === "env" ? "env-credentials" : "credentials-file",
      captured_at: new Date(nowMs).toISOString(),
    };
  } catch (error) {
    if (error?.name === "TimeoutError" || /abort/i.test(error?.message || "")) {
      return { configured: true, error: "OpenAI Platform credits fetch timed out" };
    }
    return { configured: true, error: error?.message || "OpenAI Platform credits fetch failed" };
  }
}

module.exports = {
  OPENAI_CREDITS_URL,
  CREDENTIALS_FILE,
  credentialsPath,
  normalizeSessionBearer,
  normalizeOrganization,
  readCredentials,
  writeCredentialsFile,
  parseBalance,
  fetchOpenaiCreditsLimits,
};
