const fs = require("node:fs");
const { ProxyAgent } = require("undici");
const os = require("node:os");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// Vyce AI (vyceai.com) account-level spend, read with the user's own API key.
// Recon verified live 2026-11-01:
//
//   GET https://vyceai.com/v1/me
//       Authorization: Bearer <api_key>
//       → { name, balance, totalSpent, totalRequests, modelUsage:
//           { "<model>": { inputTokens, outputTokens, cost } }, rateLimit, … }
//
// The dashboard's 用量统计 page renders exactly this payload (verified
// field-by-field against the signed-in /user/dashboard, whose `stats` block
// is identical), and the site keeps NO per-day history anywhere — so this
// card is account-level only: balance, lifetime spend, per-model totals.
// Client-side logs don't help either: proxied Codex sessions carry no usage
// in Vyce's responses, so the local rollout ledger stays empty for it.

const VYCEAI_ME_URL = "https://vyceai.com/v1/me";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), "vyceai-credentials.json");
}

function lastGoodPath(home) {
  return path.join(getTrackerRootDir({ home }), "vyceai-last-good.json");
}

function readLastGood(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastGoodPath(home), "utf8"));
    if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.vyceai_balance_usd))) return null;
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

function readManualCredentials(home) {
  try {
    const creds = JSON.parse(fs.readFileSync(credentialsPath(home), "utf8"));
    const apiKey = typeof creds?.api_key === "string" ? creds.api_key.trim() : "";
    if (!apiKey) return null;
    // vyceai.com is unreachable from some networks without an egress proxy
    // (TLS disconnected mid-handshake); the credentials file may pin one.
    const proxy = typeof creds?.proxy === "string" && creds.proxy.trim() ? creds.proxy.trim() : null;
    return { apiKey, proxy };
  } catch {
    return null;
  }
}

// Proxy resolution order: credentials file → standard env vars → direct.
function resolveProxy(home, env, manualProxy) {
  return (
    manualProxy ||
    env.HTTPS_PROXY ||
    env.https_proxy ||
    env.ALL_PROXY ||
    env.all_proxy ||
    null
  );
}

// fetch options with an optional undici dispatcher; the shared module tests
// keep passing plain option objects, so the dispatcher key is undefined when
// no proxy applies.
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Unified wire options: browser UA (Vyce sits behind Cloudflare and
// challenges bare-UA API hits with an HTML page), optional proxy
// dispatcher, caller headers last so Authorization wins.
function connectionFetchOptions(proxy, timeoutMs, headers = {}) {
  const options = {
    headers: { "User-Agent": BROWSER_UA, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  };
  if (proxy) options.dispatcher = new ProxyAgent(proxy);
  return options;
}

// A Cloudflare challenge arrives as a 200/403 HTML page; detect it by body
// shape so the caller sees "challenge" instead of a JSON parse error.
async function readJsonOrChallenge(res) {
  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("Vyce AI returned a Cloudflare challenge page (retry later)");
  }
  return JSON.parse(text);
}

// Auto-discovery: Codex pointed at Vyce carries the key inline as
// `experimental_bearer_token` inside the [model_providers.*] section whose
// base_url names vyceai.com. A focused line parser instead of a TOML
// dependency — the file is small and the shape is stable.
function discoverCodexApiKey(home, env = process.env) {
  const configPath = path.join(
    env.CODEX_HOME || path.join(home || os.homedir(), ".codex"),
    "config.toml",
  );
  let text;
  try {
    text = fs.readFileSync(configPath, "utf8");
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  let baseUrl = "";
  let bearer = "";
  let inMatchingSection = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[model_providers\.([^\]]+)\]\s*$/);
    if (header) {
      // A new section starts: flush the previous one only when it matched.
      if (inMatchingSection && bearer) return bearer;
      inMatchingSection = false;
      baseUrl = "";
      bearer = "";
      continue;
    }
    const urlMatch = line.match(/^\s*base_url\s*=\s*"([^"]+)"/);
    if (urlMatch) {
      baseUrl = urlMatch[1];
      if (/vyceai\.com/i.test(baseUrl)) inMatchingSection = true;
      continue;
    }
    const tokenMatch = line.match(/^\s*experimental_bearer_token\s*=\s*"([^"]+)"/);
    if (tokenMatch) bearer = tokenMatch[1].trim();
  }
  return inMatchingSection && bearer ? bearer : null;
}

function resolveConnection(home, env) {
  const manual = readManualCredentials(home);
  if (manual) return { apiKey: manual.apiKey, proxy: resolveProxy(home, env, manual.proxy) };
  const apiKey = discoverCodexApiKey(home, env);
  return apiKey ? { apiKey, proxy: resolveProxy(home, env, null) } : null;
}

// Returns the shared usage-limits shape (_flat_), or {configured:false} when
// no key exists anywhere (the provider stays invisible rather than erroring).
async function fetchVyceAiLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const connection = resolveConnection(home, env);
  if (!connection) return { configured: false, error: null };

  let payload;
  try {
    let lastError = null;
    payload = null;
    for (let attempt = 1; attempt <= 2 && !payload; attempt += 1) {
      try {
        if (attempt > 1) await new Promise((r) => setTimeout(r, 2000));
        const res = await fetchImpl(VYCEAI_ME_URL, connectionFetchOptions(
          connection.proxy,
          timeoutMs,
          { Authorization: `Bearer ${connection.apiKey}` },
        ));
        if (!res.ok) throw new Error(`Vyce AI HTTP ${res.status} for /v1/me`);
        payload = await readJsonOrChallenge(res);
      } catch (error) {
        lastError = error;
      }
    }
    if (!payload) throw lastError;
  } catch (error) {
    const lastGood = readLastGood(home);
    if (lastGood) return { configured: true, ...lastGood, stale: true };
    return { configured: true, error: error?.message || "fetch failed" };
  }

  const balance = Number(payload?.balance);
  if (!Number.isFinite(balance)) {
    return { configured: true, error: "Vyce AI /v1/me carries no balance" };
  }
  const totalSpent = Number(payload?.totalSpent);
  const totalRequests = Number(payload?.totalRequests);
  const modelUsage =
    payload?.modelUsage && typeof payload?.modelUsage === "object" && !Array.isArray(payload.modelUsage)
      ? payload.modelUsage
      : null;

  const result = {
    configured: true,
    error: null,
    plan_name: null,
    // Account-level aggregates, never window quotas — status lines, no bars.
    vyceai_balance_usd: balance,
    vyceai_total_spent_usd: Number.isFinite(totalSpent) ? totalSpent : null,
    vyceai_requests: Number.isFinite(totalRequests) ? totalRequests : null,
    vyceai_model_usage: modelUsage,
    source: "provider-api",
  };
  writeLastGood(home, {
    vyceai_balance_usd: result.vyceai_balance_usd,
    vyceai_total_spent_usd: result.vyceai_total_spent_usd,
    vyceai_requests: result.vyceai_requests,
    vyceai_model_usage: result.vyceai_model_usage,
    captured_at: new Date(nowMs).toISOString(),
  });
  return result;
}

module.exports = { fetchVyceAiLimits, resolveConnection, connectionFetchOptions, readJsonOrChallenge };
