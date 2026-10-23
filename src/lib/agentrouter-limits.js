const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// AgentRouter.org (a New API deployment) panel balance, read with the user's
// own access token. Recon verified live 2026-10-22:
//
//   GET https://agentrouter.org/api/user/self
//       Authorization: Bearer <access_token>
//       New-Api-User: <user_id>
//       → { success, data: { quota, used_quota, request_count, status, … } }
//
// Both headers are mandatory: without New-Api-User the panel answers
// "未提供 New-Api-User" (the id is the panel's local user id — for GitHub
// OAuth accounts it happens to equal the GitHub numeric id), and the /v1 API
// paths additionally gate on a coding-agent User-Agent, which the panel API
// does not. The billing endpoints under /v1/dashboard/billing/* return
// placeholder zeros, so /api/user/self is the only real data source.
//
// quota is expressed in new-api's internal units; AgentRouter keeps the
// default QuotaPerUnit (500000 = $1), verified against the owner's known
// lifetime total ($923.97 → 461,984,239 units). If the deployment ever
// customizes that constant the numbers here drift — the raw units are also
// kept in last-good for exactly that diagnosis.
//
// The Aliyun WAF fronts the HTML pages only; JSON API paths answer directly
// (verified with a header-less curl), so no challenge handling is needed.

const AGENTROUTER_SELF_URL = "https://agentrouter.org/api/user/self";
const NEW_API_QUOTA_PER_UNIT = 500_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), "agentrouter-credentials.json");
}

function lastGoodPath(home) {
  return path.join(getTrackerRootDir({ home }), "agentrouter-last-good.json");
}

function readLastGood(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastGoodPath(home), "utf8"));
    if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.agentrouter_balance_usd))) return null;
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
    const accessToken = typeof creds.access_token === "string" ? creds.access_token.trim() : "";
    const userId = typeof creds.user_id === "string" ? creds.user_id.trim() : String(creds.user_id || "").trim();
    return accessToken && userId ? { access_token: accessToken, user_id: userId } : null;
  } catch {
    return null;
  }
}

// Returns the shared usage-limits shape (_flat_), or {configured:false} when
// no credentials exist yet (the provider stays invisible rather than erroring).
async function fetchAgentRouterLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const creds = readCredentials(home);
  if (!creds) return { configured: false, error: null };

  let payload;
  try {
    const res = await fetchImpl(AGENTROUTER_SELF_URL, {
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        "New-Api-User": creds.user_id,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`AgentRouter HTTP ${res.status} for /api/user/self`);
    payload = await res.json();
  } catch (error) {
    const lastGood = readLastGood(home);
    if (lastGood) return { configured: true, ...lastGood, stale: true };
    return { configured: true, error: error?.message || "fetch failed" };
  }

  const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
  const quota = Number(data?.quota);
  if (!data || !Number.isFinite(quota)) {
    // A 200 with success:false still carries the panel's own message.
    const message = typeof payload?.message === "string" && payload.message ? payload.message : "self response carries no quota";
    return { configured: true, error: message };
  }
  if (Number(data.status) !== 1) {
    return { configured: true, error: "AgentRouter account is disabled" };
  }

  const usedQuota = Number(data.used_quota);
  const requestCount = Number(data.request_count);
  const result = {
    configured: true,
    plan_name: null,
    // Balances, not windows — the card reads as a status line, never a bar.
    agentrouter_balance_usd: quota / NEW_API_QUOTA_PER_UNIT,
    agentrouter_used_usd: Number.isFinite(usedQuota) ? usedQuota / NEW_API_QUOTA_PER_UNIT : null,
    agentrouter_requests: Number.isFinite(requestCount) ? requestCount : null,
    agentrouter_quota_units: quota,
    source: "provider-api",
  };
  writeLastGood(home, {
    agentrouter_balance_usd: result.agentrouter_balance_usd,
    agentrouter_used_usd: result.agentrouter_used_usd,
    agentrouter_requests: result.agentrouter_requests,
    agentrouter_quota_units: result.agentrouter_quota_units,
    captured_at: new Date(nowMs).toISOString(),
  });
  return result;
}

module.exports = { fetchAgentRouterLimits };
