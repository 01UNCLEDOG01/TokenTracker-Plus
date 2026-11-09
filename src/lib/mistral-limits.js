const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// Mistral subscription quota (admin.mistral.ai). Ported from Token Monitor's
// provider (Javis603/token-monitor #1387, src/shared/providers/mistral/
// limits.js; MIT) onto our provider shape.
//
// Two independent sources, fetched best-effort in parallel:
//   1. GET /subscription — a Next.js RSC *page*, not an API. The budget
//      objects (api_budget = included Platform API allowance, vibe_budget =
//      included Vibe Code allowance) hide anywhere in the Flight payload, so
//      the parser reassembles the self.__next_f.push chunks and scans the
//      JSON tree for objects carrying a `budget` key.
//   2. GET /api/billing/credits — a plain JSON wallet: wallet_amount +
//      credit_notes_amount − ongoing_usage_balance.
// A third tRPC endpoint (console.mistral.ai billing.vibeUsage) only runs as a
// percent-only fallback when the subscription page yielded no vibe_budget and
// the cookie carries a csrftoken — it never invents amounts.
//
// The session is opaque: the user pastes a complete Cookie header from
// admin.mistral.ai. Mistral sessions are Ory-issued, so a valid header must
// carry at least one ory_session_* pair — anything else is rejected before a
// request is made. Stored in ~/.tokentracker/mistral-credentials.json
// ({ "cookie": "..." }) with 0600 perms, or read from
// TOKENTRACKER_MISTRAL_COOKIE / MISTRAL_COOKIE. Never echoed back.
//
// Reset dates come from Mistral (`reset_at` per budget); no fixed monthly
// duration is assumed, so the windows carry no limit_window_seconds and the
// UI paces purely off the reset timestamp.

const MISTRAL_ADMIN_ORIGIN = "https://admin.mistral.ai";
const MISTRAL_VIBE_URL = "https://console.mistral.ai/api-ui/trpc/billing.vibeUsage?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%7D";
const DEFAULT_TIMEOUT_MS = 12_000;
const CREDENTIALS_FILE = "mistral-credentials.json";

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), CREDENTIALS_FILE);
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

// Accept a complete opaque Cookie header that carries at least one Ory
// session pair. Reject bare tokens, control characters, header tricks —
// mirrors TM's mistralCookie() normalization.
function normalizeMistralCookieHeader(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) return "";
  const raw = value.trim().replace(/^cookie\s*:\s*/iu, "");
  if (!raw) return "";
  let hasOrySession = false;
  for (const pair of raw.split(";")) {
    const match = pair.trim().match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)$/u);
    if (!match) return "";
    if (/^ory_session_.+$/iu.test(match[1])) hasOrySession = true;
  }
  return hasOrySession ? raw : "";
}

function extractCsrfToken(cookie) {
  for (const pair of cookie.split(";")) {
    const match = pair.trim().match(/^csrftoken=([\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*)$/u);
    if (match) return match[1];
  }
  return null;
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
      const value = normalizeMistralCookieHeader(rawFile);
      if (value) return { cookie: value, source: "file" };
      return { cookie: "", source: "file-invalid" };
    }
  } catch { /* fall through to env */ }
  const rawEnv = clean(env.TOKENTRACKER_MISTRAL_COOKIE || env.MISTRAL_COOKIE || "");
  if (rawEnv) {
    const envValue = normalizeMistralCookieHeader(rawEnv);
    if (envValue) return { cookie: envValue, source: "env" };
    return { cookie: "", source: "env-invalid" };
  }
  return { cookie: "", source: null };
}

// 0600 file write used by the local-api cookie endpoint. Returns the result
// object the paste box renders; the cookie value itself is never echoed back.
function writeCookieFile({ home, cookie }) {
  const normalized = normalizeMistralCookieHeader(cookie);
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

function httpErrorStatus(error) {
  const status = Number(error?.statusCode);
  return Number.isFinite(status) ? status : null;
}

// Reassemble the Next.js Flight chunks (`self.__next_f.push([1,"..."])`) and
// scan the resulting JSON tree for objects carrying a `budget` key. The
// subscription page embeds its data as flight records; binary payloads
// (`1:T<hex>,`) are skipped because their bytes are not part of the JSON
// tree. Conflicting budget objects (different values for the same field) mean
// the parse is ambiguous → null rather than a guess.
function parseMistralSubscription(html) {
  if (typeof html !== "string" || !html) return null;
  const chunks = [];
  // Each push ends right before </script>. Anchoring the tail there (instead
  // of stopping at the first "])" anywhere) keeps chunks intact when the
  // embedded JSON itself contains "])" — Next escapes "</script>" inside
  // inline JSON as <\/script>, so the anchor cannot appear mid-string.
  const pushPattern = /self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g;
  for (const match of html.matchAll(pushPattern)) {
    let payload;
    try { payload = JSON.parse(match[1]); } catch { continue; }
    if (!Array.isArray(payload) || payload.length < 2) continue;
    const [tag, chunk] = payload;
    if (tag !== 1 || typeof chunk !== "string") continue;
    // `1:T<hex>,` prefixes a byte-length binary segment, not JSON text.
    if (/^1:T[0-9a-f]+,/i.test(chunk)) continue;
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  const text = chunks.join("");
  const budgets = [];
  // Find every `"budget":{...}` and take the balanced object that follows.
  const keyPattern = /"budget"\s*:\s*\{/g;
  for (const match of text.matchAll(keyPattern)) {
    const start = text.indexOf("{", match.index + match[0].length - 1);
    if (start === -1) continue;
    let depth = 0;
    let end = -1;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;
    try {
      const candidate = JSON.parse(text.slice(start, end + 1));
      if (candidate && typeof candidate === "object") budgets.push(candidate);
    } catch { continue; }
  }
  const usable = budgets.filter((b) => b && typeof b === "object" && (b.api_budget || b.vibe_budget));
  if (!usable.length) return null;
  const first = usable[0];
  for (const other of usable.slice(1)) {
    if (JSON.stringify(other) !== JSON.stringify(first)) return null;
  }
  return first;
}

// A budget entry: { usage_percentage, initial_budget, currency, reset_at }.
// usage_percentage may exceed 100 (overage is real usage). initial_budget
// must be a positive finite amount; currency is a 3-letter code uppercased.
function parseMistralBudget(budget) {
  if (!budget || typeof budget !== "object") return null;
  const pct = Number(budget.usage_percentage);
  const limit = Number(budget.initial_budget);
  const currency = clean(budget.currency).toUpperCase();
  if (!Number.isFinite(pct) || pct < 0) return null;
  if (!Number.isFinite(limit) || limit <= 0) return null;
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  const resetMs = typeof budget.reset_at === "string" ? Date.parse(budget.reset_at) : NaN;
  const used = (limit * pct) / 100;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    used_percent: pct,
    currency,
    reset_at: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
  };
}

// Wallet credits: { wallet_amount, credit_notes_amount?, ongoing_usage_balance?,
// currency }. wallet_amount is required and may be 0 or negative; the sum is
// the usable balance.
function parseMistralCredits(data) {
  if (!data || typeof data !== "object") return null;
  const wallet = Number(data.wallet_amount);
  if (!Number.isFinite(wallet)) return null;
  const notes = Number.isFinite(Number(data.credit_notes_amount)) ? Number(data.credit_notes_amount) : 0;
  const ongoing = Number.isFinite(Number(data.ongoing_usage_balance)) ? Number(data.ongoing_usage_balance) : 0;
  const currency = clean(data.currency).toUpperCase();
  return {
    remaining: wallet + notes - ongoing,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : null,
  };
}

// Percent-only tRPC fallback: data[0].result.data.json { usage_percentage,
// reset_at }. Amounts are never invented.
function parseMistralVibe(data) {
  const json = data?.[0]?.result?.data?.json;
  if (!json || typeof json !== "object") return null;
  const pct = Number(json.usage_percentage);
  if (!Number.isFinite(pct) || pct < 0) return null;
  const resetMs = typeof json.reset_at === "string" ? Date.parse(json.reset_at) : NaN;
  return {
    used_percent: pct,
    reset_at: Number.isFinite(resetMs) ? new Date(resetMs).toISOString() : null,
  };
}

function windowFromBudget(budget) {
  const parsed = parseMistralBudget(budget);
  if (!parsed) return null;
  return {
    kind: "primary",
    used: parsed.used,
    limit: parsed.limit,
    remaining: parsed.remaining,
    used_percent: parsed.used_percent,
    reset_at: parsed.reset_at,
  };
}

async function fetchMistralLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const { cookie, source } = readCookie(home, env);
  if (!cookie) {
    if (source === "file-invalid" || source === "env-invalid") {
      return { configured: true, error: "Mistral cookie is not a valid Cookie header with an ory_session_* pair (paste the whole Cookie: line from admin.mistral.ai)" };
    }
    return { configured: false, error: null };
  }

  const rank = { unauthorized: 0, rate_limited: 1 };
  let worst = null;
  const noteFailure = (kind, message) => {
    const candidate = { kind, message, rank: rank[kind] ?? 2 };
    if (!worst || candidate.rank < worst.rank) worst = candidate;
  };

  let subscription = null;
  let credits = null;
  let sawUnavailable = false;

  const results = await Promise.allSettled([
    (async () => {
      const response = await fetchImpl(`${MISTRAL_ADMIN_ORIGIN}/subscription`, {
        headers: { Accept: "text/html", Cookie: cookie },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
      if (response.headers.get("cf-mitigated") === "challenge") {
        sawUnavailable = true;
        throw new Error("Mistral subscription is behind a Cloudflare challenge");
      }
      // redirect:"manual" surfaces an expired session as an opaque 3xx to the
      // login page — that is an authorization failure, not a transport one.
      if (response.status >= 300 && response.status < 400) {
        const error = new Error("Mistral session expired (redirected to login)");
        error.statusCode = 401;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`Mistral HTTP ${response.status} for /subscription`);
        error.statusCode = response.status;
        throw error;
      }
      return parseMistralSubscription(await response.text());
    })(),
    (async () => {
      const response = await fetchImpl(`${MISTRAL_ADMIN_ORIGIN}/api/billing/credits`, {
        headers: { Accept: "application/json", Cookie: cookie },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400) {
        const error = new Error("Mistral session expired (redirected to login)");
        error.statusCode = 401;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`Mistral HTTP ${response.status} for /api/billing/credits`);
        error.statusCode = response.status;
        throw error;
      }
      return parseMistralCredits(await response.json());
    })(),
  ]);

  if (results[0].status === "fulfilled") {
    subscription = results[0].value;
  } else {
    const status = httpErrorStatus(results[0].reason);
    if (status === 401 || status === 403) noteFailure("unauthorized", results[0].reason?.message);
    else if (status === 429) noteFailure("rate_limited", results[0].reason?.message);
    else sawUnavailable = true;
  }
  if (results[1].status === "fulfilled") {
    credits = results[1].value;
  } else {
    const status = httpErrorStatus(results[1].reason);
    if (status === 401 || status === 403) noteFailure("unauthorized", results[1].reason?.message);
    else if (status === 429) noteFailure("rate_limited", results[1].reason?.message);
    else sawUnavailable = true;
  }

  if (worst?.kind === "unauthorized") {
    return { configured: true, error: "Mistral session expired or unauthorized" };
  }
  if (worst?.kind === "rate_limited") {
    return { configured: true, error: "Mistral rate limited" };
  }

  const apiBudget = subscription?.api_budget ? windowFromBudget(subscription.api_budget) : null;
  let vibeBudget = subscription?.vibe_budget ? windowFromBudget(subscription.vibe_budget) : null;

  // Percent-only vibe fallback: only when the subscription page had no usable
  // vibe_budget and the cookie carries the CSRF token the console requires.
  if (!vibeBudget && !subscription?.vibe_budget) {
    const csrfToken = extractCsrfToken(cookie);
    if (csrfToken) {
      try {
        const sessionCookies = cookie
          .split(";")
          .map((pair) => pair.trim())
          .filter((pair) => /^(csrftoken|ory_session_)/i.test(pair))
          .join("; ");
        const response = await fetchImpl(MISTRAL_VIBE_URL, {
          headers: {
            Accept: "application/json",
            Cookie: sessionCookies,
            "X-CSRFTOKEN": csrfToken,
          },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "manual",
        });
        if (response.ok) {
          const vibe = parseMistralVibe(await response.json());
          if (vibe) {
            vibeBudget = {
              kind: "primary",
              used: null,
              limit: null,
              remaining: null,
              used_percent: vibe.used_percent,
              reset_at: vibe.reset_at,
            };
          }
        }
      } catch { /* fallback is best-effort; the balance row still renders */ }
    }
  }

  if (!apiBudget && !vibeBudget && !(credits && Number.isFinite(credits.remaining))) {
    if (sawUnavailable) {
      return { configured: true, error: "Mistral quota sources are unavailable (challenge or parse failure)" };
    }
    return { configured: true, error: "Mistral quota response is malformed or lacks budgets" };
  }

  return {
    configured: true,
    plan_name: "Subscription",
    primary_window: apiBudget,
    secondary_window: vibeBudget,
    mistral_balance: credits && Number.isFinite(credits.remaining) ? credits.remaining : null,
    mistral_currency: credits?.currency || null,
    source: source === "env" ? "env-cookie" : "cookie-file",
    captured_at: new Date(nowMs).toISOString(),
  };
}

module.exports = {
  MISTRAL_ADMIN_ORIGIN,
  MISTRAL_VIBE_URL,
  CREDENTIALS_FILE,
  credentialsPath,
  normalizeMistralCookieHeader,
  extractCsrfToken,
  readCookie,
  writeCookieFile,
  parseMistralSubscription,
  parseMistralBudget,
  parseMistralCredits,
  parseMistralVibe,
  fetchMistralLimits,
};
