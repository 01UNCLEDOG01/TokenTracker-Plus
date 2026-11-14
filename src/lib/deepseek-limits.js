const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// DeepSeek open-platform (api.deepseek.com) balance, fed by the user's own API
// key — the "商汤模式" plan from the 10-16 recon, minus the part that turned
// out not to exist: /user/balance/models (per-day per-model usage) answers 404
// for API keys on every path variant probed (2026-10-22), so this provider is
// balance-only until DeepSeek ships a usage endpoint for keys.
//
//   GET https://api.deepseek.com/user/balance
//       Authorization: Bearer <api_key>
//       → { is_available, balance_infos: [{currency, total_balance,
//            granted_balance, topped_up_balance}] }
//
// Verified live 2026-10-22 (200 with the stored key; the account was empty:
// is_available:false, CNY 0.00 — an empty wallet is a valid reading, not an
// error). API keys do not expire, so there is no refresh chain here — the
// card re-reads the key file every poll and serves the last good snapshot on
// network blips, like every other provider.
//
// Optional add-on (TM #1442, 2026-11-14): a signed-in DeepSeek *console*
// session token ("web token") unlocks the private per-month cost endpoint, so
// the card can also show this month's Search / Fetch tool fees. Strictly
// optional — a missing/failed console call leaves the balance untouched.

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DEEPSEEK_CONSOLE_COST_URL = "https://platform.deepseek.com/api/v0/usage/by_api_key/cost";
// The console bills these tools under two historical model names each.
const CONSOLE_TOOL_NAMES = {
  deepseek_search_spend: ["server-tool-search", "tool-search"],
  deepseek_fetch_spend: ["server-tool-fetch", "tool-fetch"],
};
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), "deepseek-credentials.json");
}

function lastGoodPath(home) {
  return path.join(getTrackerRootDir({ home }), "deepseek-last-good.json");
}

function readLastGood(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastGoodPath(home), "utf8"));
    if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.deepseek_total_balance))) return null;
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
    const key = typeof creds.api_key === "string" ? creds.api_key.trim() : "";
    if (!key) return null;
    const webToken = normalizeDeepseekWebToken(creds.web_token);
    return { api_key: key, web_token: webToken };
  } catch {
    return null;
  }
}

// Accept a bare or pasted Authorization token; reject anything that is not one
// (control chars, whitespace, `;` — a Cookie: line pasted by mistake is not a
// console session token).
function normalizeDeepseekWebToken(value) {
  const raw = String(value || "").trim()
    .replace(/^cookie\s*:\s*/iu, "")
    .replace(/^authorization\s*:\s*/iu, "")
    .replace(/^bearer\s+/iu, "")
    .trim();
  return /[\u0000-\u001f\u007f;\s]/u.test(raw) ? "" : raw;
}

// One console call for the current month. Both window boundaries are fixed to
// a single timezone offset (the console-local one) so a DST change cannot
// split the month. Strict contract: code/biz_code must be 0, the echoed
// start/end must match the request, and every bucket cost must be a finite
// non-negative number — otherwise null (no fees row; the balance is intact).
// TM #1442 keeps an in-process hour cache; our provider poll already sits
// behind a 30s TTL, so the extra layer is skipped on purpose.
async function fetchToolSpends(webToken, currency, { fetchImpl, timeoutMs, nowMs }) {
  if (!webToken) return null;
  const date = new Date(nowMs);
  const tz = -date.getTimezoneOffset() * 60;
  const start = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), 1) / 1000) - tz;
  const end = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1) / 1000) - tz;
  try {
    const query = new URLSearchParams({ start: String(start), end: String(end), tz: String(tz) });
    const res = await fetchImpl(`${DEEPSEEK_CONSOLE_COST_URL}?${query.toString()}`, {
      headers: { Authorization: `Bearer ${webToken}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const data = body?.data?.biz_data;
    if (body?.code !== 0 || body?.data?.biz_code !== 0) return null;
    if (data?.start !== start || data?.end !== end) return null;
    const row = (Array.isArray(data.data) ? data.data : []).find(
      (item) => String(item?.currency || "").toUpperCase() === String(currency || "").toUpperCase(),
    );
    const lists = [row?.series, row?.function_series].filter((list) => Array.isArray(list));
    if (!lists.length) return null;
    const entries = lists.flat();
    const spends = {};
    for (const [field, names] of Object.entries(CONSOLE_TOOL_NAMES)) {
      const costs = entries
        .filter((item) => names.includes(item?.model))
        .flatMap((item) => (Array.isArray(item?.buckets) ? item.buckets : []))
        .map((bucket) => Number(bucket?.cost));
      if (!costs.length || costs.some((cost) => !Number.isFinite(cost) || cost < 0)) return null;
      const total = costs.reduce((sum, cost) => sum + cost, 0);
      if (total > 0) spends[field] = total;
    }
    return spends;
  } catch {
    // Optional console failures leave the balance intact; retry next poll.
    return null;
  }
}

// Returns the shared usage-limits shape (_flat_), or {configured:false} when
// no credentials exist yet (the provider stays invisible rather than erroring).
async function fetchDeepSeekLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  deepseekWebToken = null,
} = {}) {
  const creds = readCredentials(home);
  if (!creds) return { configured: false, error: null };

  let payload;
  try {
    const res = await fetchImpl(DEEPSEEK_BALANCE_URL, {
      headers: { Authorization: `Bearer ${creds.api_key}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status} for /user/balance`);
    payload = await res.json();
  } catch (error) {
    const lastGood = readLastGood(home);
    if (lastGood) return { configured: true, ...lastGood, stale: true };
    return { configured: true, error: error?.message || "fetch failed" };
  }

  const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : [];
  // One currency per account in practice; CNY first if several ever appear.
  const primary = infos.find((info) => info && String(info.currency).toUpperCase() === "CNY") || infos[0] || null;
  const total = Number(primary?.total_balance);
  const granted = Number(primary?.granted_balance);
  if (!primary || !Number.isFinite(total)) {
    return { configured: true, error: "balance response carries no currency row" };
  }

  const toolSpends = await fetchToolSpends(
    deepseekWebToken || creds.web_token || "",
    String(primary.currency || "CNY"),
    { fetchImpl, timeoutMs, nowMs },
  );
  const result = {
    configured: true,
    plan_name: null,
    deepseek_currency: String(primary.currency || "CNY"),
    // Balances, not windows — the card reads as a status line, never a bar.
    deepseek_total_balance: total,
    deepseek_granted_balance: Number.isFinite(granted) ? granted : 0,
    deepseek_available: payload?.is_available === true,
    ...(toolSpends || {}),
    source: "provider-api",
  };
  writeLastGood(home, {
    deepseek_currency: result.deepseek_currency,
    deepseek_total_balance: result.deepseek_total_balance,
    deepseek_granted_balance: result.deepseek_granted_balance,
    deepseek_available: result.deepseek_available,
    captured_at: new Date(nowMs).toISOString(),
  });
  return result;
}

module.exports = { fetchDeepSeekLimits, normalizeDeepseekWebToken, DEEPSEEK_CONSOLE_COST_URL, CONSOLE_TOOL_NAMES };
