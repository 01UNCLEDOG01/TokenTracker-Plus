const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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

const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function credentialsPath(home) {
  return path.join(home || os.homedir(), ".tokentracker", "deepseek-credentials.json");
}

function lastGoodPath(home) {
  return path.join(home || os.homedir(), ".tokentracker", "deepseek-last-good.json");
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
    return key ? { api_key: key } : null;
  } catch {
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

  const result = {
    configured: true,
    plan_name: null,
    deepseek_currency: String(primary.currency || "CNY"),
    // Balances, not windows — the card reads as a status line, never a bar.
    deepseek_total_balance: total,
    deepseek_granted_balance: Number.isFinite(granted) ? granted : 0,
    deepseek_available: payload?.is_available === true,
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

module.exports = { fetchDeepSeekLimits };
