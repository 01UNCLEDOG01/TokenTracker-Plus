const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");

// MiniMax Coding Plan quota / API balance. Ported from Token Monitor's
// provider (Javis603/token-monitor, src/shared/providers/minimax/limits.js).
//
// Token-plan mode: GET /v1/token_plan/remains (legacy fallback
// /v1/api/openplatform/coding_plan/remains) with a Bearer API key. The
// `model_remains[].model_name === "general"` row carries the 5-hour and weekly
// remaining percentages. API mode: GET /account/query_balance returns
// `available_amount`.
//
// The key is user-supplied. Read it from ~/.tokentracker/minimax-credentials.json
// ({ "api_key": "...", "region": "cn|en|auto", "billing_mode": "token-plan|api" })
// or MINIMAX_CODING_API_KEY. Region defaults to CN because that is the region
// a mainland key belongs to; "auto" tries CN then EN.

const MINIMAX_REGIONS = ["cn", "en"];
const DEFAULT_TIMEOUT_MS = 12_000;
const WINDOW_5H_SECONDS = 5 * 60 * 60;
const WINDOW_WEEKLY_SECONDS = 7 * 24 * 60 * 60;

const URLS = {
  cn: {
    tokenPlan: "https://api.minimaxi.com/v1/token_plan/remains",
    legacy: "https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
    balance: "https://api.minimaxi.com/account/query_balance",
    currency: "CNY",
  },
  en: {
    tokenPlan: "https://api.minimax.io/v1/token_plan/remains",
    legacy: "https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
    balance: "https://api.minimax.io/account/query_balance",
    currency: "USD",
  },
};

function credentialsPath(home) {
  return path.join(getTrackerRootDir({ home }), "minimax-credentials.json");
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRegion(value) {
  const raw = clean(value).toLowerCase();
  if (["cn", "minimaxi.com", "api.minimaxi.com"].includes(raw)) return "cn";
  if (["en", "intl", "global", "international", "minimax.io", "api.minimax.io"].includes(raw)) return "en";
  return "auto";
}

function normalizeBillingMode(value) {
  return clean(value).toLowerCase() === "api" ? "api" : "token-plan";
}

function readConfig(home) {
  let file = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(credentialsPath(home), "utf8"));
    if (parsed && typeof parsed === "object") file = parsed;
  } catch {
    file = {};
  }
  const apiKey = clean(process.env.MINIMAX_CODING_API_KEY) || clean(file.api_key) || clean(file.apiKey);
  if (!apiKey) return null;
  return {
    apiKey,
    region: normalizeRegion(process.env.MINIMAX_API_REGION || process.env.MINIMAX_API_HOST || file.region || "cn"),
    billingMode: normalizeBillingMode(process.env.MINIMAX_BILLING_MODE || file.billing_mode || file.billingMode),
  };
}

function numberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/%$/, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function millisToIso(value) {
  const n = numberOrNull(value);
  if (n === null) return null;
  const ms = n < 1_000_000_000_000 ? n * 1000 : n;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function generalBucket(body) {
  const rows = Array.isArray(body?.data?.model_remains)
    ? body.data.model_remains
    : Array.isArray(body?.model_remains)
      ? body.model_remains
      : [];
  return rows.find((row) => row && row.model_name === "general") || null;
}

function windowFromRemaining(percent, resetMs, seconds) {
  const remaining = numberOrNull(percent);
  if (remaining === null) return null;
  const remainingPercent = Math.max(0, Math.min(100, remaining));
  const usedPercent = Math.max(0, Math.min(100, 100 - remainingPercent));
  return {
    used_percent: usedPercent,
    remaining_percent: remainingPercent,
    reset_at: millisToIso(resetMs),
    limit_window_seconds: seconds,
  };
}

function parseTokenPlan(body) {
  const item = generalBucket(body);
  if (!item) return null;
  const placeholder = (percentField, statusField) => {
    const status = numberOrNull(item[statusField]);
    const percent = numberOrNull(item[percentField]);
    return status === 3 && (percent === null || percent >= 100);
  };
  let primary = null;
  let secondary = null;
  if (!placeholder("current_interval_remaining_percent", "current_interval_status")) {
    primary = windowFromRemaining(
      item.current_interval_remaining_percent,
      item.end_time,
      WINDOW_5H_SECONDS,
    );
  }
  if (!placeholder("current_weekly_remaining_percent", "current_weekly_status")) {
    secondary = windowFromRemaining(
      item.current_weekly_remaining_percent,
      item.weekly_end_time,
      WINDOW_WEEKLY_SECONDS,
    );
  }
  return primary || secondary ? { primary, secondary } : null;
}

function parseBalance(body) {
  const amount = numberOrNull(body?.available_amount);
  return amount === null ? null : amount;
}

function minimaxBaseRespError(body) {
  const statusCode = numberOrNull(body?.base_resp?.status_code);
  if (statusCode === null || statusCode === 0) return null;
  const message = clean(body?.base_resp?.status_msg) || `MiniMax error code ${statusCode}`;
  const error = new Error(message);
  error.statusCode = /log\s*in|cookie|token|auth|key|expired|invalid/i.test(message) ? 401 : 502;
  return error;
}

function attemptsFor(config) {
  const regions = config.region === "auto" ? ["cn", "en"] : [config.region];
  if (config.billingMode === "api") {
    return regions.map((region) => ({ region, mode: "balance", url: URLS[region].balance }));
  }
  return regions.flatMap((region) => [
    { region, mode: "tokenPlan", url: URLS[region].tokenPlan },
    { region, mode: "legacy", url: URLS[region].legacy },
  ]);
}

async function fetchMinimaxLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const config = readConfig(home);
  if (!config) return { configured: false, error: null };

  let lastError = null;
  for (const attempt of attemptsFor(config)) {
    let response;
    try {
      response = await fetchImpl(attempt.url, {
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      lastError = error;
      continue;
    }
    if (!response.ok) {
      lastError = new Error(`MiniMax HTTP ${response.status} for ${new URL(attempt.url).pathname}`);
      if ([401, 403, 404, 405].includes(response.status)) continue;
      break;
    }
    let body;
    try {
      body = await response.json();
    } catch (error) {
      lastError = error;
      continue;
    }
    const baseError = minimaxBaseRespError(body);
    if (baseError) {
      lastError = baseError;
      if (baseError.statusCode === 401) continue;
      break;
    }
    if (attempt.mode === "balance") {
      const balance = parseBalance(body);
      if (balance === null) {
        lastError = new Error("MiniMax balance response carries no available_amount");
        continue;
      }
      return {
        configured: true,
        plan_name: "Pay-as-you-go",
        minimax_balance: balance,
        minimax_currency: URLS[attempt.region].currency,
        minimax_billing_mode: "api",
        source: "provider-api",
        region: attempt.region,
        captured_at: new Date(nowMs).toISOString(),
      };
    }
    const parsed = parseTokenPlan(body);
    if (!parsed) {
      lastError = new Error("MiniMax token-plan response has no quota windows");
      continue;
    }
    return {
      configured: true,
      plan_name: "Token Plan",
      primary_window: parsed.primary,
      secondary_window: parsed.secondary,
      minimax_billing_mode: "token-plan",
      source: "provider-api",
      region: attempt.region,
      captured_at: new Date(nowMs).toISOString(),
    };
  }
  return { configured: true, error: lastError?.message || "MiniMax quota fetch failed" };
}

module.exports = {
  fetchMinimaxLimits,
  credentialsPath,
  normalizeRegion,
  normalizeBillingMode,
  parseTokenPlan,
  parseBalance,
};
