"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { fetchQoderCnCliLimits } = require("./qoder-cn-cli-limits");

const QODER_SITES = {
  international: {
    id: "international",
    origin: "https://qoder.com",
    usageUrl: "https://qoder.com/api/v2/me/usages/big_model_credits",
    activityUrl: "https://openapi.qoder.sh/algo/api/v2/activity",
    domains: new Set(["qoder.com", "www.qoder.com"]),
  },
  china: {
    id: "china",
    origin: "https://qoder.cn",
    usageUrl: "https://qoder.cn/api/v2/me/usages/big_model_credits",
    activityUrl: "https://openapi.qoder.com.cn/algo/api/v2/activity",
    domains: new Set(["qoder.cn", "www.qoder.cn", "qoder.com.cn", "www.qoder.com.cn"]),
  },
};

const QODER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

// Qoder 1.18 serves promotional call buckets (including Ultimate Free Calls)
// from its OpenAPI activity endpoint. The request uses the same COSY envelope
// as Qoder CLI 1.0.22. Authentication comes from Qoder's already-running local
// service over JSON-RPC; TokenTracker never persists or logs those credentials.
const QODER_ACTIVITY_URL = "https://openapi.qoder.sh/algo/api/v2/activity";
const QODER_ULTIMATE_ACTIVITY_ID = "ultimate_200_free_invoke";
const QODER_COSY_VERSION = "1.0.22";
const QODER_ACTIVITY_CACHE_FILE = "qoder-activity-cache.json";
const QODER_ACTIVITY_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const QODER_LIMITS_CACHE_FILE = "qoder-usage-limits-cache.json";
const QODER_LIMITS_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const QODER_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS = 12 * 60 * 60 * 1000;
// Qoder CN spend: the cost-center daily trend caps one call at a 90-day
// span, so the spend walk pages backward until two consecutive windows
// are empty (or the window budget runs out).
const QODER_CN_COST_TREND_URL = "https://qoder.com.cn/api/v1/me/cost-center/credits/daily-trend";
const QODER_CN_COST_TREND_SPAN_MS = 90 * 24 * 60 * 60 * 1000;
const QODER_CN_COST_TREND_MAX_WINDOWS = 6;
// daily-trend only reports closed Beijing days; the per-conversation histories
// endpoint is the only real-time source for "today".
const QODER_CN_HISTORIES_URL = "https://qoder.com.cn/api/v1/me/usages/big_model_credits/histories";
const QODER_CN_BJ_OFFSET_MS = 8 * 3600 * 1000;
const QODER_SERVER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Qoder usage response is missing ${field}.`);
  }
  return number;
}

function firstDefined(object, camel, snake) {
  return object?.[camel] ?? object?.[snake];
}

function normalizeResetAt(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    const milliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function quotaSummary(container) {
  return firstDefined(container, "quotaSummary", "quota_summary") || null;
}

function normalizeQuotaSummary(summary) {
  if (!summary || typeof summary !== "object") {
    throw new Error("Qoder usage response is missing totalQuota.quotaSummary.");
  }
  const used = finiteNumber(firstDefined(summary, "usedValue", "used_value"), "usedValue");
  const total = finiteNumber(firstDefined(summary, "limitValue", "limit_value"), "limitValue");
  const rawRemaining = firstDefined(summary, "remainingValue", "remaining_value");
  const remaining = rawRemaining === null || rawRemaining === undefined
    ? Math.max(0, total - used)
    : finiteNumber(rawRemaining, "remainingValue");
  const rawPercentage = firstDefined(summary, "usagePercentage", "usage_percentage");
  const providedPercentage = rawPercentage === null || rawPercentage === undefined
    ? null
    : finiteNumber(rawPercentage, "usagePercentage");

  if (used < 0 || total < 0 || remaining < 0) {
    throw new Error("Qoder quota values must be nonnegative.");
  }
  if (total === 0 && (used !== 0 || remaining !== 0)) {
    throw new Error("Qoder zero total quota must have zero usage and remaining.");
  }
  const usagePercentage = providedPercentage ?? (total > 0 ? (used / total) * 100 : 100);
  return {
    used,
    total,
    remaining,
    usagePercentage: Math.max(0, Math.min(100, usagePercentage)),
    unit: typeof summary.unit === "string" && summary.unit.trim() ? summary.unit.trim() : null,
  };
}

// Qoder splits credits into three pools the official panel lists separately:
// 套餐内 (plan), 资源包 (resource package) and SOTA 专属积分 (dedicated).
// `total_quota` is the server's sum of them; showing only that hides the fact
// that one pool is exhausted while another still holds credits.
const QODER_POOL_DEFS = [
  ["plan", "planQuota", "plan_quota"],
  ["resourcePackage", "resourcePackageQuota", "resource_package_quota"],
  ["dedicated", "dedicatedResourcePackageQuota", "dedicated_resource_package_quota"],
];

// Earliest future expiry among the pool's still-unspent grants. A pool made of
// 20 small packs (resource package) reports the pack that runs out first.
function poolExpiresAt(container) {
  const details = firstDefined(container, "quotaDetail", "quota_detail");
  if (!Array.isArray(details)) return null;
  let earliest = null;
  for (const row of details) {
    if (!row || row.is_active === false) continue;
    const remaining = Number(firstDefined(row, "remainingValue", "remaining_value"));
    if (Number.isFinite(remaining) && remaining <= 0) continue;
    const iso = normalizeResetAt(firstDefined(row, "expiresAt", "expires_at"));
    if (!iso) continue;
    const at = Date.parse(iso);
    if (!Number.isFinite(at) || at <= Date.now()) continue;
    if (!earliest || at < Date.parse(earliest)) earliest = iso;
  }
  return earliest;
}

function normalizeQoderUsageResponse(response) {
  if (!response || typeof response !== "object") {
    throw new Error("Qoder usage response is not an object.");
  }
  const totalContainer = firstDefined(response, "totalQuota", "total_quota");
  const sharedContainer = firstDefined(response, "sharedQuota", "shared_quota");
  const base = normalizeQuotaSummary(quotaSummary(totalContainer));
  const sharedSummary = quotaSummary(sharedContainer);
  const shared = sharedSummary ? normalizeQuotaSummary(sharedSummary) : null;

  const used = base.used + (shared?.used || 0);
  const total = base.total + (shared?.total || 0);
  const remaining = base.remaining + (shared?.remaining || 0);
  const usedPercent = shared
    ? total > 0
      ? (used / total) * 100
      : 100
    : base.usagePercentage;

  const pools = QODER_POOL_DEFS.map(([key, camel, snake]) => {
    const container = firstDefined(response, camel, snake);
    const summary = quotaSummary(container);
    if (!summary) return null;
    const quota = normalizeQuotaSummary(summary);
    return {
      key,
      used: quota.used,
      limit: quota.total,
      remaining: quota.remaining,
      percent: quota.usagePercentage,
      unit: quota.unit,
      expires_at: poolExpiresAt(container),
    };
  }).filter(Boolean);

  return {
    configured: true,
    error: null,
    primary_window: {
      used_percent: Math.max(0, Math.min(100, usedPercent)),
      // Raw passthrough: the provider sometimes leaves this months in the past
      // (observed 2026-08-02 on an active October account), so the renderer —
      // not the parser — decides whether a stale value is worth showing.
      reset_at: normalizeResetAt(firstDefined(response, "nextResetAt", "next_reset_at")),
      used_credits: used,
      limit_credits: total,
      remaining_credits: remaining,
      unit: base.unit || shared?.unit || null,
    },
    pools,
    user_id: typeof response.user_id === "string" ? response.user_id : undefined,
    source: "provider-api",
  };
}

function qoderDataRoot({
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  appDir = "Qoder",
  envPrefix = "QODER",
} = {}) {
  const homeKey = `${envPrefix}_HOME`;
  if (typeof env[homeKey] === "string" && env[homeKey].trim()) {
    return path.resolve(env[homeKey].trim());
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", appDir);
  }
  if (platform === "win32") {
    return path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), appDir);
  }
  return path.join(home, ".config", appDir);
}

function qoderRpcRequest(method, params = {}, {
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  appDir = "Qoder",
  envPrefix = "QODER",
  timeoutMs = 1500,
  netModule = net,
} = {}) {
  return new Promise((resolve, reject) => {
    const infoPath = path.join(qoderDataRoot({ home, env, platform, appDir, envPrefix }), "SharedClientCache", ".info.json");
    let info;
    try {
      info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
    } catch (_error) {
      reject(new Error("Qoder local service is not running."));
      return;
    }
    const socketPath = typeof info?.ipcServerPath === "string" ? info.ipcServerPath.trim() : "";
    if (!socketPath) {
      reject(new Error("Qoder local service endpoint is unavailable."));
      return;
    }

    let settled = false;
    let buffer = Buffer.alloc(0);
    const socket = netModule.createConnection(socketPath);
    const timer = setTimeout(() => finish(new Error("Qoder local service request timed out.")), timeoutMs);

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }

    socket.on("connect", () => {
      const body = Buffer.from(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
      }));
      socket.write(`Content-Length: ${body.length}\r\n\r\n`);
      socket.write(body);
    });
    socket.on("error", (error) => finish(error));
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString("ascii"));
      if (!match) {
        finish(new Error("Qoder local service returned an invalid response."));
        return;
      }
      const bodyLength = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (!Number.isFinite(bodyLength) || bodyLength < 0 || bodyLength > 4 * 1024 * 1024) {
        finish(new Error("Qoder local service response is too large."));
        return;
      }
      if (buffer.length < bodyStart + bodyLength) return;
      try {
        const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + bodyLength).toString("utf8"));
        if (message.error) {
          finish(new Error(message.error.message || "Qoder local service request failed."));
        } else {
          finish(null, message.result);
        }
      } catch (_error) {
        finish(new Error("Qoder local service returned invalid JSON."));
      }
    });
  });
}

function normalizeQoderAddOnQuota(quota) {
  if (quota == null) return null;
  const used = Number(quota.used);
  const total = Number(quota.total);
  const remaining = quota.remaining == null ? Math.max(0, total - used) : Number(quota.remaining);
  if (quota.used == null || quota.total == null
    || ![used, total, remaining].every(Number.isFinite) || Math.min(used, total, remaining) < 0
    || (total === 0 && (used !== 0 || remaining !== 0))) {
    throw new Error("Qoder add-on quota values are invalid.");
  }
  return {
    used_percent: total > 0 ? Math.min(100, (used / total) * 100) : 0,
    // The official addOnQuota has no renewal date. Plan expiry does not apply.
    reset_at: null,
    used_credits: used,
    limit_credits: total,
    remaining_credits: remaining,
    unit: typeof quota.unit === "string" && quota.unit.trim() ? quota.unit.trim() : "credits",
  };
}

function normalizeQoderRpcUsage(response) {
  if (!response || typeof response !== "object") return null;
  const quota = response.userQuota;
  // Qoder CN CLI 1.1.71 renders userQuota and addOnQuota as separate buckets.
  // Only its account-level total_remaining adds them together.
  const addOnWindow = normalizeQoderAddOnQuota(response.addOnQuota);
  if ((!quota || typeof quota !== "object") && !addOnWindow) return null;
  const used = quota ? finiteNumber(quota.used, "userQuota.used") : 0;
  const total = quota ? finiteNumber(quota.total, "userQuota.total") : 0;
  const remaining = quota ? finiteNumber(quota.remaining, "userQuota.remaining") : 0;
  const reportedPercent = Number(response.totalUsagePercentage ?? quota?.percentage);
  const usedPercent = total === 0
    ? 0
    : addOnWindow
      ? (used / total) * 100
      : response.isQuotaExceeded === true
        ? 100
        : Number.isFinite(reportedPercent)
          ? reportedPercent
          : (used / total) * 100;
  const normalizedExpiry = normalizeResetAt(response.expiresAt);
  const expiryMs = normalizedExpiry ? Date.parse(normalizedExpiry) : NaN;
  return {
    configured: true,
    error: null,
    plan_label: typeof response.userType === "string" ? response.userType : null,
    quota_exceeded: response.isQuotaExceeded === true,
    primary_window: quota ? {
      used_percent: Math.max(0, Math.min(100, usedPercent)),
      // Qoder uses 9999-12-31 as a no-expiry sentinel for Free accounts.
      reset_at: Number.isFinite(expiryMs) && expiryMs < Date.UTC(2100, 0, 1)
        ? normalizedExpiry
        : null,
      used_credits: used,
      limit_credits: total,
      remaining_credits: remaining,
      unit: typeof quota.unit === "string" && quota.unit.trim() ? quota.unit.trim() : "credits",
    } : null,
    ...(addOnWindow ? { tertiary_window: addOnWindow } : {}),
    source: "local-ipc",
  };
}

function normalizeQoderActivityResponse(response, { nowMs = Date.now() } = {}) {
  if (!response || typeof response !== "object") {
    throw new Error("Qoder activity response is not an object.");
  }
  if (response.code !== undefined && Number(response.code) !== 0) {
    throw new Error(`Qoder activity API returned ${response.msg || `code ${response.code}`}.`);
  }
  const activities = Array.isArray(response.data?.activities) ? response.data.activities : [];
  const activity = activities.find((entry) => {
    if (!entry || entry.activityId !== QODER_ULTIMATE_ACTIVITY_ID || entry.eligible === false) return false;
    if (String(entry.tagStyle || "").toUpperCase() === "EXPIRED") return false;
    const endAt = Number(entry.activityEndAt);
    return !Number.isFinite(endAt) || endAt <= 0 || endAt > nowMs;
  });
  if (!activity) return null;
  const used = finiteNumber(activity.used, "activity.used");
  const total = finiteNumber(activity.limit, "activity.limit");
  const rawRemaining = Number(activity.remaining);
  const remaining = Number.isFinite(rawRemaining) ? rawRemaining : Math.max(0, total - used);
  if (used < 0 || total <= 0 || remaining < 0) {
    throw new Error("Qoder activity quota values are invalid.");
  }
  return {
    used_percent: Math.max(0, Math.min(100, (used / total) * 100)),
    reset_at: normalizeResetAt(activity.activityEndAt),
    used_credits: used,
    limit_credits: total,
    remaining_credits: remaining,
    unit: "calls",
    activity_id: QODER_ULTIMATE_ACTIVITY_ID,
  };
}

function qoderActivityCachePath({ home = os.homedir(), namespace } = {}) {
  const file = namespace
    ? `qoder-${namespace}-activity-cache.json`
    : QODER_ACTIVITY_CACHE_FILE;
  return path.join(home, ".tokentracker", "tracker", file);
}

function readQoderActivityCache({
  home = os.homedir(),
  nowMs = Date.now(),
  namespace,
  maxAgeMs = QODER_ACTIVITY_CACHE_MAX_AGE_MS,
} = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(qoderActivityCachePath({ home, namespace }), "utf8"));
    const window = parsed?.activity_window;
    const cachedAtMs = Date.parse(parsed?.cached_at || "");
    if (!window || !Number.isFinite(cachedAtMs) || cachedAtMs > nowMs + 60_000) return null;
    const resetAtMs = Date.parse(window.reset_at || "");
    if (Number.isFinite(resetAtMs)) {
      if (resetAtMs <= nowMs) return null;
    } else if (nowMs - cachedAtMs > maxAgeMs) {
      return null;
    }
    const used = Number(window.used_credits);
    const total = Number(window.limit_credits);
    const remaining = Number(window.remaining_credits);
    if (!Number.isFinite(used) || !Number.isFinite(total) || !Number.isFinite(remaining)
      || used < 0 || total <= 0 || remaining < 0) return null;
    return window;
  } catch (_error) {
    return null;
  }
}

function writeQoderActivityCache(window, {
  home = os.homedir(),
  nowMs = Date.now(),
  namespace,
} = {}) {
  if (!window) return;
  const cachePath = qoderActivityCachePath({ home, namespace });
  const payload = {
    activity_window: window,
    cached_at: new Date(nowMs).toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

function qoderLimitsCachePath({ home = os.homedir(), namespace } = {}) {
  const file = namespace
    ? `qoder-${namespace}-usage-limits-cache.json`
    : QODER_LIMITS_CACHE_FILE;
  return path.join(home, ".tokentracker", "tracker", file);
}

function qoderCookieFilePath({ home = os.homedir(), namespace } = {}) {
  const file = namespace
    ? "qoder-" + namespace + "-usage-cookie.txt"
    : "qoder-usage-cookie.txt";
  return path.join(home, ".tokentracker", "tracker", file);
}

function readQoderCookieFile({ home = os.homedir(), namespace } = {}) {
  try {
    return fs.readFileSync(qoderCookieFilePath({ home, namespace }), "utf8").trim();
  } catch (_error) {
    return "";
  }
}

// A 401 on this route says nothing about the user's Qoder sign-in: the website
// API is only ever called with a cookie TT-plus saved by hand, and that copy
// goes stale on its own while the desktop client stays logged in. Name the
// artifact that actually expired, or the panel sends the user to re-login for
// nothing (they will come back and still see the error).
function describeSavedSessionExpired({ sourceLabel, site, home, cacheNamespace }) {
  const file = qoderCookieFilePath({ home, namespace: cacheNamespace });
  let savedAt = "";
  try {
    savedAt = fs.statSync(file).mtime.toISOString().slice(0, 10);
  } catch (_error) {}
  const origin = sourceLabel === "cookie-file"
    ? `${file}${savedAt ? ` (saved ${savedAt})` : ""}`
    : `the ${sourceLabel} environment variable`;
  const error = new Error(
    `Saved ${site.origin} session no longer accepted: ${origin}. `
    + "Your Qoder sign-in itself is unaffected - refresh that cookie, or delete the file to fall back to local data.",
  );
  error.code = "SAVED_SESSION_EXPIRED";
  return error;
}

function qoderCachedWindow(window, { cachedAtMs, nowMs } = {}) {
  if (!window || typeof window !== "object") return null;
  const resetAtMs = Date.parse(window.reset_at || "");
  if (Number.isFinite(resetAtMs)) return resetAtMs > nowMs ? window : null;
  return nowMs - cachedAtMs <= QODER_LIMITS_CACHE_UNKNOWN_RESET_TTL_MS ? window : null;
}

function readQoderLimitsCache({
  home = os.homedir(),
  nowMs = Date.now(),
  namespace,
} = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(qoderLimitsCachePath({ home, namespace }), "utf8"))?.qoder;
    const cachedAtMs = Date.parse(raw?.cached_at || "");
    if (!Number.isFinite(cachedAtMs) || cachedAtMs > nowMs + 60_000) return null;
    const primaryWindow = qoderCachedWindow(raw.primary_window, { cachedAtMs, nowMs });
    const secondaryWindow = qoderCachedWindow(raw.secondary_window, { cachedAtMs, nowMs });
    const tertiaryWindow = qoderCachedWindow(raw.tertiary_window, { cachedAtMs, nowMs });
    if (!primaryWindow && !secondaryWindow && !tertiaryWindow) return null;
    const hasUnexpiredDatedWindow = [primaryWindow, secondaryWindow, tertiaryWindow]
      .some((window) => Number.isFinite(Date.parse(window?.reset_at || "")));
    if (nowMs - cachedAtMs > QODER_LIMITS_CACHE_MAX_AGE_MS && !hasUnexpiredDatedWindow) {
      return null;
    }
    return {
      configured: true,
      error: null,
      plan_label: typeof raw.plan_label === "string" ? raw.plan_label : null,
      quota_exceeded: raw.quota_exceeded === true,
      primary_window: primaryWindow,
      secondary_window: secondaryWindow,
      ...(tertiaryWindow ? { tertiary_window: tertiaryWindow } : {}),
      cached: true,
      stale: true,
      cached_at: raw.cached_at,
      spend: raw.spend && typeof raw.spend === "object" ? raw.spend : null,
      spend_stale: raw.spend_stale === true,
      spend_cached_at: typeof raw.spend_cached_at === "string" ? raw.spend_cached_at : null,
      source: "disk-cache",
    };
  } catch (_error) {
    return null;
  }
}

// Raw spend reader used to carry the last good CN spend snapshot forward
// when a refresh fails. readQoderLimitsCache drops the whole snapshot once
// its quota windows expire, but the spend totals (and the estimate rows
// built on them) stay valid far longer.
function readCachedQoderSpend({ home = os.homedir(), namespace } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(qoderLimitsCachePath({ home, namespace }), "utf8"))?.qoder;
    return raw?.spend && typeof raw.spend === "object" ? raw.spend : null;
  } catch (_error) {
    return null;
  }
}

// When the quota windows have expired, readQoderLimitsCache bails out early and
// the spend snapshot survives without a timestamp attached. The panel needs
// that date to say how old the numbers on screen are, so read it straight off
// the file rather than leaving the reader to guess.
function readCachedQoderSpendCapturedAt({ home = os.homedir(), namespace } = {}) {
  try {
    const raw = JSON.parse(fs.readFileSync(qoderLimitsCachePath({ home, namespace }), "utf8"))?.qoder;
    const parsed = Date.parse(raw?.cached_at || "");
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  } catch (_error) {
    return null;
  }
}

function writeQoderLimitsCache(limits, {
  home = os.homedir(),
  nowMs = Date.now(),
  namespace,
} = {}) {
  if (!limits?.configured || limits.error || (!limits.primary_window && !limits.secondary_window && !limits.tertiary_window)) return;
  const cachePath = qoderLimitsCachePath({ home, namespace });
  const payload = {
    qoder: {
      plan_label: limits.plan_label || null,
      quota_exceeded: limits.quota_exceeded === true,
      primary_window: limits.primary_window || null,
      secondary_window: limits.secondary_window || null,
      spend: limits.spend || null,
      // Provenance for the spend specifically. A source that answers quota only
      // (the CN CLI) carries the previous snapshot forward instead of dropping
      // it, and these two fields are what let a reader tell that apart from a
      // spend that was genuinely fetched just now.
      spend_stale: limits.spend_stale === true,
      spend_cached_at: limits.spend_cached_at || null,
      ...(limits.tertiary_window ? { tertiary_window: limits.tertiary_window } : {}),
      cached_at: new Date(nowMs).toISOString(),
    },
  };
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    const tmpPath = `${cachePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tmpPath, cachePath);
  } catch (_error) {}
}

function buildQoderActivityHeaders(authStatus, {
  nowMs = Date.now(),
  randomUUID = crypto.randomUUID,
} = {}) {
  const userId = String(authStatus?.id || authStatus?.accountId || "").trim();
  const accessToken = String(authStatus?.token || "").trim();
  if (!userId || !accessToken) {
    throw new Error("Qoder local session is missing activity credentials.");
  }
  const temporaryKey = Buffer.from(randomUUID().replace(/-/g, "").slice(0, 16), "ascii");
  const cosyKey = crypto.publicEncrypt(
    { key: QODER_SERVER_PUBLIC_KEY, padding: crypto.constants.RSA_PKCS1_PADDING },
    temporaryKey,
  ).toString("base64");
  const identity = {
    name: authStatus.name || "",
    aid: userId,
    uid: userId,
    yx_uid: authStatus.yxUid || "",
    organization_id: authStatus.orgId || "",
    organization_name: authStatus.orgName || "",
    user_type: authStatus.userType || "personal_standard",
    security_oauth_token: accessToken,
    refresh_token: authStatus.refreshToken || "",
  };
  const cipher = crypto.createCipheriv("aes-128-cbc", temporaryKey, temporaryKey);
  const info = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(identity), "utf8")),
    cipher.final(),
  ]).toString("base64");
  const payload = Buffer.from(JSON.stringify({
    version: "v1",
    requestId: randomUUID(),
    info,
    cosyVersion: QODER_COSY_VERSION,
    ideVersion: "",
  }), "utf8").toString("base64");
  const cosyDate = String(Math.floor(nowMs / 1000));
  const signature = crypto
    .createHash("md5")
    .update(`${payload}\n${cosyKey}\n${cosyDate}\n\n/api/v2/activity`, "utf8")
    .digest("hex");
  const machineId = randomUUID();
  return {
    "cosy-data-policy": "agree",
    "cosy-machinetype": "5",
    "cosy-clienttype": "5",
    "cosy-date": cosyDate,
    "cosy-user": userId,
    "cosy-key": cosyKey,
    "cache-control": "no-cache",
    "cosy-business-product": "cli",
    "cosy-business-type": "agent",
    "cosy-scene": "assistant",
    accept: "application/json",
    authorization: `Bearer COSY.${payload}.${signature}`,
    "accept-encoding": "identity",
    "cosy-version": QODER_COSY_VERSION,
    "cosy-machineid": machineId,
    "cosy-machinetoken": machineId,
    "login-version": "v2",
    "user-agent": "Go-http-client/2.0",
  };
}

async function fetchQoderActivity(authStatus, fetchImpl = fetch, options = {}) {
  const activityUrl = options.activityUrl || QODER_ACTIVITY_URL;
  const response = await fetchImpl(activityUrl, {
    method: "GET",
    headers: buildQoderActivityHeaders(authStatus, options),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Qoder activity session expired.");
  }
  if (!response.ok) {
    throw new Error(`Qoder activity API returned HTTP ${response.status}.`);
  }
  return normalizeQoderActivityResponse(await response.json(), options);
}

function qoderRequestHeaders(cookieHeader, site) {
  return {
    Cookie: cookieHeader,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent": QODER_USER_AGENT,
    Origin: site.origin,
    Referer: `${site.origin}/account/usage`,
    "X-Requested-With": "XMLHttpRequest",
    "Bx-V": "2.5.35",
  };
}

async function fetchQoderUsage(cookieHeader, site, fetchImpl) {
  const response = await fetchImpl(site.usageUrl, {
    method: "GET",
    headers: qoderRequestHeaders(cookieHeader, site),
  });
  if (response.status === 401 || response.status === 403) {
    const error = new Error("Qoder login expired. Sign in at qoder.com again.");
    error.code = "AUTH_EXPIRED";
    throw error;
  }
  if (!response.ok) {
    throw new Error(`Qoder usage API returned HTTP ${response.status}.`);
  }
  return normalizeQoderUsageResponse(await response.json());
}

// Qoder CN stopped recording token counts anywhere (local stores froze in
// 2026-07; official APIs expose credits / reference cost / messageCount only),
// so spend carries an estimate anchored on the last window with local ground
// truth: the legacy SQLite DB recorded 17,235,393 tokens for 2026-07-20..22
// while daily-trend counted 467 official messages for the same days
// (~36,907 tokens/message). The ratio scales to the official message total.
const QODER_CN_EST_ANCHOR = { tokens: 17235393, messages: 467, from: "2026-07-20", to: "2026-07-22" };

// Sum one Beijing day from the real-time histories endpoint. Its
// original_credits / original_cost are the list prices the trend endpoint
// calls credits / referenceCost, so the two stay on the same footing.
async function fetchQoderCnDayDetails(cookieHeader, site, fetchImpl, dayKey, { maxPages = 15 } = {}) {
  const dayStart = Date.parse(dayKey + "T00:00:00.000Z") - QODER_CN_BJ_OFFSET_MS;
  if (!Number.isFinite(dayStart)) return null;
  const dayEnd = dayStart + 24 * 3600 * 1000 - 1;
  let credits = 0;
  let cost = 0;
  let rows = 0;
  const creditsByModel = {};
  for (let page = 1; page <= maxPages; page += 1) {
    const url = QODER_CN_HISTORIES_URL +
      "?page=" + page + "&page_size=100" +
      "&start_time=" + dayStart + "&end_time=" + dayEnd +
      "&order_by=begin_at&order=-1";
    let payload = null;
    try {
      const response = await fetchImpl(url, { method: "GET", headers: qoderRequestHeaders(cookieHeader, site) });
      if (!response.ok) break;
      payload = await response.json();
    } catch (_error) {
      break;
    }
    const list = payload && Array.isArray(payload.data) ? payload.data : [];
    for (const row of list) {
      const beginAt = Number(row && row.begin_at);
      if (!Number.isFinite(beginAt)) continue;
      if (new Date(beginAt + QODER_CN_BJ_OFFSET_MS).toISOString().slice(0, 10) !== dayKey) continue;
      const rowCredits = Number(row.original_credits ?? row.credits) || 0;
      const rowCost = Number(row.original_cost ?? row.cost) || 0;
      credits += rowCredits;
      cost += rowCost;
      rows += 1;
      const model = typeof row.model_category === "string" && row.model_category ? row.model_category : "未知模型";
      creditsByModel[model] = (creditsByModel[model] || 0) + rowCredits;
    }
    const lastPage = Number(payload && payload.page_result && payload.page_result.last_page) || 1;
    if (page >= lastPage) break;
  }
  return rows > 0 ? { credits, cost, rows, creditsByModel } : null;
}

async function fetchQoderCnSpend(cookieHeader, site, fetchImpl, { userId, nowMs = Date.now() } = {}) {
  if (typeof userId !== "string" || !userId) return null;
  const todayKey = new Date(nowMs + 8 * 3600 * 1000).toISOString().slice(0, 10);
  let creditsTotal = 0;
  let costTotal = 0;
  let messagesTotal = 0;
  let creditsToday = 0;
  let costToday = 0;
  let messagesToday = 0;
  let since = null;
  let sawCredits = false;
  let zeroStreak = 0;
  const dailyByDate = new Map();
  const modelAgg = {};
  for (let index = 0; index < QODER_CN_COST_TREND_MAX_WINDOWS; index += 1) {
    const endMs = nowMs - index * QODER_CN_COST_TREND_SPAN_MS;
    const startMs = endMs - QODER_CN_COST_TREND_SPAN_MS;
    const url = QODER_CN_COST_TREND_URL +
      "?userId=" + encodeURIComponent(userId) +
      "&startTime=" + Math.round(startMs) + "&endTime=" + Math.round(endMs) + "&groupBy=model";
    let rows = null;
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: qoderRequestHeaders(cookieHeader, site),
      });
      if (!response.ok) break;
      const payload = await response.json();
      rows = Array.isArray(payload && payload.trend) ? payload.trend : [];
    } catch (_error) {
      break;
    }
    let windowCredits = 0;
    for (const row of rows) {
      const credits = Number(row && row.credits) || 0;
      const cost = Number(row && row.referenceCost) || 0;
      const messages = Number(row && row.messageCount) || 0;
      windowCredits += credits;
      creditsTotal += credits;
      costTotal += cost;
      messagesTotal += messages;
      const date = row && typeof row.date === "string" ? row.date : "";
      const group = row && typeof row.groupKey === "string" ? row.groupKey : "";
      if (credits > 0 && (!since || date < since)) since = date;
      if (group) {
        const agg = modelAgg[group] || { credits: 0, messages: 0 };
        agg.credits += credits;
        agg.messages += messages;
        modelAgg[group] = agg;
      }
      if (date === todayKey) {
        creditsToday += credits;
        costToday += cost;
        messagesToday += messages;
      }
      if (date && (credits > 0 || messages > 0)) {
        const dayEntry = dailyByDate.get(date) || { date, credits: 0, cost: 0, messages: 0, byModel: {} };
        dayEntry.credits += credits;
        dayEntry.cost += cost;
        dayEntry.messages += messages;
        if (group) dayEntry.byModel[group] = (dayEntry.byModel[group] || 0) + messages;
        dailyByDate.set(date, dayEntry);
      }
    }
    if (windowCredits > 0) {
      sawCredits = true;
      zeroStreak = 0;
    } else if (sawCredits) {
      zeroStreak += 1;
      if (zeroStreak >= 2) break;
    }
  }
  // daily-trend only reports closed Beijing days, so today would stay empty even
  // though the account page already lists it. Fill it from real-time histories:
  // messages are derived per model from that model's own credits-per-message
  // ratio across the trend window (period-wide ratio as fallback).
  let todayRealtime = false;
  if (sawCredits && messagesToday === 0 && creditsTotal > 0 && messagesTotal > 0) {
    const detail = await fetchQoderCnDayDetails(cookieHeader, site, fetchImpl, todayKey);
    if (detail && detail.credits > 0) {
      const globalPerCredit = messagesTotal / creditsTotal;
      const byModel = {};
      for (const [model, modelCredits] of Object.entries(detail.creditsByModel)) {
        const agg = modelAgg[model];
        const perCredit = agg && agg.credits > 0 ? agg.messages / agg.credits : globalPerCredit;
        byModel[model] = Math.round(modelCredits * perCredit);
      }
      const todayMessages = Object.values(byModel).reduce((sum, n) => sum + n, 0) ||
        Math.round(detail.credits * globalPerCredit);
      creditsToday = detail.credits;
      costToday = detail.cost;
      messagesToday = todayMessages;
      creditsTotal += detail.credits;
      costTotal += detail.cost;
      messagesTotal += todayMessages;
      dailyByDate.set(todayKey, {
        date: todayKey,
        credits: detail.credits,
        cost: detail.cost,
        messages: todayMessages,
        byModel,
        realtime: true,
      });
      todayRealtime = true;
    }
  }
  if (!sawCredits || !since) return null;
  return {
    credits_total: Number(creditsTotal.toFixed(3)),
    cost_total: Number(costTotal.toFixed(2)),
    credits_today: Number(creditsToday.toFixed(3)),
    cost_today: Number(costToday.toFixed(2)),
    messages_total: messagesTotal,
    messages_today: messagesToday,
    est_tokens_total: Math.round((QODER_CN_EST_ANCHOR.tokens / QODER_CN_EST_ANCHOR.messages) * messagesTotal),
    est_anchor: QODER_CN_EST_ANCHOR,
    since,
    daily: Array.from(dailyByDate.values())
      .map((entry) => ({
        date: entry.date,
        credits: Number(entry.credits.toFixed(3)),
        cost: Number(entry.cost.toFixed(2)),
        messages: entry.messages,
        by_model: entry.byModel,
        ...(entry.realtime ? { realtime: true } : {}),
      }))
      .sort((left, right) => left.date.localeCompare(right.date)),
    today: todayKey,
    realtime_today: todayRealtime,
    model_messages: Object.fromEntries(
      Object.entries(modelAgg).map(([model, agg]) => [model, { credits: Number(agg.credits.toFixed(3)), messages: agg.messages }])
    ),
    unit: "credits",
    currency: "CNY",
    source: "provider-api",
  };
}

function listRecentQoderRendererLogs(logRoot, maxFiles = 12) {
  if (!fs.existsSync(logRoot)) return [];
  const files = [];
  const stack = [{ dir: logRoot, depth: 0 }];
  while (stack.length > 0 && files.length < 2000) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current.dir, entry.name);
      if (entry.isDirectory() && current.depth < 4) {
        stack.push({ dir: full, depth: current.depth + 1 });
      } else if (entry.isFile() && entry.name === "renderer.log") {
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(full).mtimeMs;
        } catch (_error) {}
        files.push({ full, mtimeMs });
      }
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map((entry) => entry.full);
}

function parseQoderQuotaLog(text) {
  if (typeof text !== "string" || !text) return null;
  const matches = Array.from(text.matchAll(
    /userType=([^,\s]+)[\s\S]*?isQuotaExceeded=(true|false)[\s\S]*?userQuota(?:=|\s+)used=([0-9.]+),\s*total=([0-9.]+),\s*remaining=([0-9.]+),\s*percentage=([0-9.]+),\s*unit=([^,\s]+)/g,
  ));
  const match = matches.at(-1);
  if (!match) return null;
  const quotaExceeded = match[2] === "true";
  const used = Number(match[3]);
  const total = Number(match[4]);
  const remaining = Number(match[5]);
  const percentage = Number(match[6]);
  if (![used, total, remaining, percentage].every(Number.isFinite)) return null;
  return {
    configured: true,
    error: null,
    plan_label: match[1],
    quota_exceeded: quotaExceeded,
    primary_window: {
      used_percent: total === 0
        ? 0
        : quotaExceeded
          ? 100
          : Math.max(0, Math.min(100, percentage)),
      reset_at: null,
      used_credits: used,
      limit_credits: total,
      remaining_credits: remaining,
      unit: match[7],
    },
    source: "local-log",
  };
}

function readQoderLocalQuota({
  home = os.homedir(),
  platform = process.platform,
  env = process.env,
  appDir = "Qoder",
  envPrefix = "QODER",
} = {}) {
  const logRootKey = `${envPrefix}_LOG_ROOT`;
  const homeKey = `${envPrefix}_HOME`;
  const explicitLogRoot =
    typeof env[logRootKey] === "string" && env[logRootKey].trim()
      ? path.resolve(env[logRootKey].trim())
      : null;
  const configuredRoot =
    typeof env[homeKey] === "string" && env[homeKey].trim()
      ? path.resolve(env[homeKey].trim())
      : null;
  const logRoot = explicitLogRoot || (configuredRoot
    ? path.join(configuredRoot, "logs")
    : platform === "darwin"
      ? path.join(home, "Library", "Application Support", appDir, "logs")
      : platform === "win32"
        ? path.join(env.APPDATA || path.join(home, "AppData", "Roaming"), appDir, "logs")
        : path.join(home, ".config", appDir, "logs"));
  for (const logPath of listRecentQoderRendererLogs(logRoot)) {
    try {
      const fd = fs.openSync(logPath, "r");
      try {
        const stat = fs.fstatSync(fd);
        const length = Math.min(stat.size, 512 * 1024);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
        const parsed = parseQoderQuotaLog(buffer.toString("utf8"));
        if (parsed) return parsed;
      } finally {
        fs.closeSync(fd);
      }
    } catch (_error) {}
  }
  return null;
}

function siteFromEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "cn" || normalized === "china" || normalized.includes(".cn")
    ? QODER_SITES.china
    : QODER_SITES.international;
}

async function fetchQoderLimits({
  home = os.homedir(),
  env = process.env,
  platform = process.platform,
  appDir = "Qoder",
  envPrefix = "QODER",
  site = QODER_SITES.international,
  sitePinned = false,
  cacheNamespace,
  fetchImpl = fetch,
  rpcRequest = qoderRpcRequest,
  nowMs = Date.now(),
  cliLimitsRequest,
} = {}) {
  let rpcUsage = null;
  let rpcAuth = null;
  let activityWindow = null;
  let activitySource = null;
  const rpcOptions = { home, env, platform, appDir, envPrefix };
  // Qoder's shared client accepts only one reliable request at a time. Parallel
  // connections intermittently time out even while the desktop app is running.
  try {
    rpcUsage = normalizeQoderRpcUsage(await rpcRequest("credit/usage", {}, rpcOptions));
  } catch (_error) {}
  try {
    const authResult = await rpcRequest("auth/status", {}, rpcOptions);
    if (authResult && typeof authResult === "object") rpcAuth = authResult;
  } catch (_error) {}
  // Upstream invariant (test/qoder-limits.test.js): once the local service is
  // down, a bounded disk snapshot wins over ANY provider call. That is right for
  // quota windows, but Qoder CN's spend ledger only refreshes from the website
  // API and the desktop RPC is often not running at all — so the CN site keeps
  // trying the explicit session first and falls back to the snapshot below.
  const lastGoodLimits = readQoderLimitsCache({ home, nowMs, namespace: cacheNamespace });
  if (rpcAuth) {
    try {
      activityWindow = await fetchQoderActivity(rpcAuth, fetchImpl, { nowMs, activityUrl: site.activityUrl });
      if (activityWindow) {
        activitySource = "provider-api";
        writeQoderActivityCache(activityWindow, { home, nowMs, namespace: cacheNamespace });
      }
    } catch (_error) {}
  }
  // Qoder's activity endpoint occasionally succeeds with an empty activities
  // array while the promotion is still active. Treat that as a transient
  // omission, not an authoritative deletion: an activity carries its own
  // expiry, so the last observed window remains valid until reset_at.
  if (!activityWindow) {
    activityWindow = readQoderActivityCache({ home, nowMs, namespace: cacheNamespace });
    if (activityWindow) activitySource = "disk-cache";
  }
  if (rpcUsage) {
    if (!rpcUsage.plan_label && typeof rpcAuth?.userType === "string") {
      rpcUsage.plan_label = rpcAuth.userType;
    }
    if (activityWindow) rpcUsage.secondary_window = activityWindow;
    rpcUsage.source = activityWindow
      ? `local-ipc+${activitySource === "disk-cache" ? "cached-activity" : "provider-api"}`
      : "local-ipc";
    // The desktop RPC answers quota windows only; the CN spend totals live
    // behind the website API, so refresh them here too — otherwise the
    // cached spend (and every estimate built on it) stays frozen for as
    // long as the desktop app keeps answering.
    if (site.id === "china") {
      const cnCookieKey = `${envPrefix}_COOKIE`;
      const cnEnvCookie = typeof env[cnCookieKey] === "string" ? env[cnCookieKey].trim() : "";
      const cnCookie = cnEnvCookie || readQoderCookieFile({ home, namespace: cacheNamespace });
      const cnUserId = String(rpcAuth?.id || rpcAuth?.accountId || "").trim();
      let spend = null;
      if (cnCookie && cnUserId) {
        try {
          spend = await fetchQoderCnSpend(cnCookie, site, fetchImpl, { userId: cnUserId, nowMs });
        } catch (_error) {}
      }
      rpcUsage.spend = spend || readCachedQoderSpend({ home, namespace: cacheNamespace });
    }
    writeQoderLimitsCache(rpcUsage, { home, nowMs, namespace: cacheNamespace });
    return rpcUsage;
  }

  // Upstream's cookie-free route: the Qoder CN CLI stores its own credentials, so
  // the quota windows can be read without the desktop app and without a scraped
  // cookie. It answers quota only, though - never the spend ledger - so when a CN
  // cookie is configured the cookie path gets the first attempt (see below).
  let cliError = null;
  const tryCliLimits = async () => {
    if (!cliLimitsRequest) return null;
    try {
      const cliUsage = await cliLimitsRequest({ home, env, fetchImpl, normalizeRpcUsage: normalizeQoderRpcUsage });
      if (!cliUsage) return null;
      if (activityWindow) cliUsage.secondary_window = activityWindow;
      // The CLI answers quota windows only - never the spend ledger. Writing it
      // straight through blanks the CN figures, and blanks them silently: the
      // panel renders an absent spend as "no component at all", which reads as
      // "nothing was used today". Carry the last good snapshot forward instead
      // and label it, so the panel can say what it is actually showing.
      if (site.id === "china" && !cliUsage.spend) {
        const carried = lastGoodLimits?.spend && typeof lastGoodLimits.spend === "object"
          ? lastGoodLimits.spend
          : readCachedQoderSpend({ home, namespace: cacheNamespace });
        cliUsage.spend = carried || null;
        cliUsage.spend_stale = Boolean(carried);
        cliUsage.spend_cached_at = carried
          ? (lastGoodLimits?.cached_at || readCachedQoderSpendCapturedAt({ home, namespace: cacheNamespace }))
          : null;
      }
      writeQoderLimitsCache(cliUsage, { home, nowMs, namespace: cacheNamespace });
      return cliUsage;
    } catch (error) {
      cliError = error;
      return null;
    }
  };
  const cliCookieFirst = site.id === "china" && Boolean(
    (typeof env[`${envPrefix}_COOKIE`] === "string" && env[`${envPrefix}_COOKIE`].trim())
    || readQoderCookieFile({ home, namespace: cacheNamespace }),
  );
  if (!cliCookieFirst) {
    const cliUsage = await tryCliLimits();
    if (cliUsage) return cliUsage;
  }

  // Once native sources are unavailable, prefer a bounded disk snapshot before the
  // manual-cookie or local-log fallback. CN is the exception: its spend ledger only
  // refreshes behind the website API, so a snapshot returned here would freeze the
  // ledger - and every token estimate built on it - for as long as the cache holds.
  if (site.id !== "china" && lastGoodLimits) {
    if (activityWindow) lastGoodLimits.secondary_window = activityWindow;
    return lastGoodLimits;
  }

  // Manual-cookie fallback reads an envPrefix-specific key: QODER_COOKIE for
  // the international flow, QODER_CN_COOKIE for the CN flow — the two installs
  // hold different sessions and must never share a cookie. A tray-spawned
  // server never sees a setx environment, so the tracker data dir also stores
  // the cookie in a file; an explicit env cookie still takes precedence.
  const cookieKey = `${envPrefix}_COOKIE`;
  const envCookie = typeof env[cookieKey] === "string" ? env[cookieKey].trim() : "";
  const manualCookie = envCookie || readQoderCookieFile({ home, namespace: cacheNamespace });
  // QODER_SITE is an international-flow knob. A pinned site (the CN fetch)
  // must never be overridden by it — the CN flow always targets china.
  const manualSite = sitePinned ? site : env.QODER_SITE ? siteFromEnv(env.QODER_SITE) : site;
  const sessions = manualCookie
    ? [{
        cookieHeader: manualCookie,
        site: manualSite,
        sourceLabel: envCookie ? cookieKey : "cookie-file",
      }]
    : [];

  let lastError = cliError;
  for (const session of sessions) {
    try {
      const result = await fetchQoderUsage(session.cookieHeader, session.site, fetchImpl);
      // Qoder 1.18 can return an all-zero active plan with usage_percentage=0
      // while the desktop client separately marks the account quota-exceeded.
      // Preserve that status as metadata, but match Qoder's Credits UI by
      // rendering an empty 0/0 bucket as 0%, not a full red 100% bar.
      const local = result.primary_window?.limit_credits === 0
        ? readQoderLocalQuota({ home, platform, env, appDir, envPrefix })
        : null;
      if (local) {
        result.quota_exceeded = local.quota_exceeded === true;
        result.primary_window.reset_at = null;
        result.source = "provider-api+local-log";
        result.plan_label = local.plan_label || null;
      }
      if (activityWindow) {
        result.secondary_window = activityWindow;
        result.source += activitySource === "disk-cache" ? "+cached-activity" : "+activity";
      }
      const liveResult = {
        ...result,
        cookie_source: session.sourceLabel,
        site: session.site.id,
      };
      if (session.site.id === "china") {
        try {
          const spend = await fetchQoderCnSpend(session.cookieHeader, session.site, fetchImpl, {
            userId: result.user_id,
            nowMs,
          });
          liveResult.spend = spend || readCachedQoderSpend({ home, namespace: cacheNamespace });
        } catch (_error) {
          liveResult.spend = readCachedQoderSpend({ home, namespace: cacheNamespace });
        }
      }
      writeQoderLimitsCache(liveResult, { home, nowMs, namespace: cacheNamespace });
      return liveResult;
    } catch (error) {
      lastError = error?.code === "AUTH_EXPIRED"
        ? describeSavedSessionExpired({
            sourceLabel: session.sourceLabel,
            site: session.site,
            home,
            cacheNamespace,
          })
        : error;
    }
  }

  // The cookie was configured but produced nothing (missing, expired, or the site
  // moved). Fall back to the CLI's own credentials before trusting a snapshot.
  if (cliCookieFirst) {
    const cliUsage = await tryCliLimits();
    if (cliUsage) return cliUsage;
  }

  // When no explicit session is configured (or it just expired), prefer a
  // bounded disk snapshot before any other fallback.
  const cachedLimits = lastGoodLimits;
  if (cachedLimits) {
    if (activityWindow) cachedLimits.secondary_window = activityWindow;
    return cachedLimits;
  }

  const local = readQoderLocalQuota({ home, platform, env, appDir, envPrefix });
  if (local) {
    if (activityWindow) {
      local.secondary_window = activityWindow;
      local.source += activitySource === "disk-cache" ? "+cached-activity" : "+activity";
    }
    if (site.id === "china") {
      local.spend = readCachedQoderSpend({ home, namespace: cacheNamespace });
    }
    writeQoderLimitsCache(local, { home, nowMs, namespace: cacheNamespace });
    return local;
  }
  if (activityWindow) {
    return {
      configured: true,
      error: null,
      plan_label: typeof rpcAuth?.userType === "string" ? rpcAuth.userType : null,
      primary_window: null,
      secondary_window: activityWindow,
      source: activitySource === "disk-cache" ? "cached-activity" : "local-ipc+provider-api",
    };
  }
  if (lastError?.code === "SAVED_SESSION_EXPIRED") {
    // Only TT-plus's own saved cookie copy failed - the user's Qoder account is
    // signed in and nothing they do at qoder.com fixes this file. Render the
    // standard localized "not connected" state and keep the reason as a note
    // instead of a red error that sends them to re-login.
    return {
      configured: false,
      saved_session_expired: true,
      note: lastError.message,
    };
  }
  if (lastError) {
    return {
      configured: true,
      error: lastError.message || "Qoder usage fetch failed.",
      auth_action_required: lastError.code === "AUTH_EXPIRED" ? "reauth" : undefined,
    };
  }
  return { configured: false };
}

// CN has its own CLI credentials, legacy desktop root and cache namespace.
function fetchQoderCnLimits(opts = {}) {
  return fetchQoderLimits({
    ...opts,
    appDir: "QoderCN",
    envPrefix: "QODER_CN",
    site: QODER_SITES.china,
    sitePinned: true,
    cacheNamespace: "cn",
    cliLimitsRequest: fetchQoderCnCliLimits,
  });
}

module.exports = {
  QODER_SITES,
  normalizeQoderUsageResponse,
  normalizeQoderRpcUsage,
  normalizeQoderActivityResponse,
  qoderRequestHeaders,
  fetchQoderUsage,
  fetchQoderCnSpend,
  qoderRpcRequest,
  buildQoderActivityHeaders,
  fetchQoderActivity,
  readQoderActivityCache,
  writeQoderActivityCache,
  readQoderLimitsCache,
  writeQoderLimitsCache,
  parseQoderQuotaLog,
  readQoderLocalQuota,
  fetchQoderLimits,
  fetchQoderCnLimits,
};
