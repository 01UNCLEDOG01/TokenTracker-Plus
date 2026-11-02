"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  QODER_SITES,
  normalizeQoderUsageResponse,
  qoderRequestHeaders,
  fetchQoderUsage,
  normalizeQoderRpcUsage,
  normalizeQoderActivityResponse,
  fetchQoderActivity,
  fetchQoderLimits,
  readQoderActivityCache,
  writeQoderActivityCache,
  readQoderLimitsCache,
  writeQoderLimitsCache,
  parseQoderQuotaLog,
  parseQoderAccountUsageLog,
  fetchQoderCnLimits,
  writeQoderCookieFile,
  readQoderCookieFile,
  qoderCookieFilePath,
} = require("../src/lib/qoder-limits");

test("normalizeQoderUsageResponse keeps the three credit pools apart (captured 2026-10-28)", () => {
  // Relative, not a literal date: poolExpiresAt drops an expiry at or before
  // now(), so a hard-coded day turns this test red the moment it passes.
  const expiresAt = Date.now() + 30 * 864e5;
  const result = normalizeQoderUsageResponse({
    plan_quota: { quota_summary: { used_value: 0, limit_value: 0, remaining_value: 0, usage_percentage: 0, unit: "credits" }, quota_detail: [] },
    resource_package_quota: {
      quota_summary: { used_value: 2000, limit_value: 2000, remaining_value: 0, usage_percentage: 100, unit: "credits" },
      quota_detail: [{ remaining_value: 0, expires_at: expiresAt, is_active: true }],
    },
    dedicated_resource_package_quota: {
      quota_summary: { used_value: 60, limit_value: 2000, remaining_value: 1940, usage_percentage: 4, unit: "credits" },
      quota_detail: [{ remaining_value: 1940, expires_at: expiresAt, is_active: true }],
    },
    total_quota: { quota_summary: { used_value: 2060, limit_value: 4000, remaining_value: 1940, usage_percentage: 52, unit: "credits" } },
    nextResetAt: Date.parse("2026-08-02T00:00:00Z"),
  });

  // The summed window still comes from the server, for callers that want one bar.
  assert.equal(result.primary_window.used_percent, 52);
  assert.equal(result.primary_window.reset_at, "2026-08-02T00:00:00.000Z");

  assert.deepEqual(result.pools.map((pool) => pool.key), ["plan", "resourcePackage", "dedicated"]);
  const [plan, pack, sota] = result.pools;
  assert.equal(plan.limit, 0);
  assert.equal(pack.used, 2000);
  assert.equal(pack.percent, 100);
  // The exhausted pack has nothing left, so it contributes no expiry.
  assert.equal(pack.expires_at, null);
  assert.equal(sota.remaining, 1940);
  assert.equal(sota.percent, 4);
  assert.equal(sota.expires_at, new Date(expiresAt).toISOString());
});

test("normalizeQoderUsageResponse merges camel-case base and shared quotas", () => {
  const result = normalizeQoderUsageResponse({
    totalQuota: {
      quotaSummary: {
        usedValue: 20,
        limitValue: 100,
        remainingValue: 80,
        usagePercentage: 20,
        unit: "credits",
      },
    },
    sharedQuota: {
      quotaSummary: {
        usedValue: 30,
        limitValue: 200,
        remainingValue: 170,
        unit: "credits",
      },
    },
    nextResetAt: "2026-08-01T00:00:00Z",
  });

  assert.equal(result.configured, true);
  assert.equal(result.primary_window.used_credits, 50);
  assert.equal(result.primary_window.limit_credits, 300);
  assert.equal(result.primary_window.remaining_credits, 250);
  assert.ok(Math.abs(result.primary_window.used_percent - (50 / 3)) < 1e-12);
  assert.equal(result.primary_window.reset_at, "2026-08-01T00:00:00.000Z");
});

test("normalizeQoderUsageResponse accepts snake case and exhausted zero quota", () => {
  const result = normalizeQoderUsageResponse({
    total_quota: {
      quota_summary: {
        used_value: 0,
        limit_value: 0,
        remaining_value: 0,
        unit: "credits",
      },
    },
    next_reset_at: 1_785_542_400_000,
  });
  // An empty 0/0 bucket (no active plan) reads as 0%, matching Qoder's own
  // Credits UI — a 100% red bar for "nothing configured" is a false alarm.
  // (Absorbed from upstream fff445d; the panel drops the empty row entirely.)
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.reset_at, "2026-08-01T00:00:00.000Z");
});

test("normalizeQoderUsageResponse rejects invalid quota values", () => {
  assert.throws(
    () => normalizeQoderUsageResponse({
      totalQuota: {
        quotaSummary: {
          usedValue: -1,
          limitValue: 100,
          remainingValue: 101,
        },
      },
    }),
    /nonnegative/,
  );
  assert.throws(
    () => normalizeQoderUsageResponse({
      totalQuota: {
        quotaSummary: {
          usedValue: 1,
          limitValue: 0,
          remainingValue: 0,
        },
      },
    }),
    /zero total quota/,
  );
});

test("Qoder IPC add-on credits do not borrow the aggregate percentage or plan expiry", () => {
  const result = normalizeQoderRpcUsage({
    userType: "personal_pro", expiresAt: "2026-12-01T00:00:00Z", totalUsagePercentage: 10,
    userQuota: { total: 100, used: 25, remaining: 75, percentage: 25 },
    addOnQuota: { total: 500, used: 35, remaining: 465, percentage: 7 },
  });
  assert.equal(result.primary_window.used_percent, 25);
  assert.equal(result.primary_window.limit_credits, 100);
  assert.equal(result.primary_window.reset_at, "2026-12-01T00:00:00.000Z");
  assert.equal(result.secondary_window, undefined);
  assert.equal(result.tertiary_window.remaining_credits, 465);
  assert.equal(result.tertiary_window.reset_at, null);
});

test("Qoder caches add-on credits independently from plan and Ultimate expiry", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-addon-cache-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nowMs = Date.parse("2026-10-15T00:00:00Z");
  const result = normalizeQoderRpcUsage({
    expiresAt: "2026-10-15T01:00:00Z",
    userQuota: { total: 100, used: 25, remaining: 75 },
    addOnQuota: { total: 500, used: 35, remaining: 465 },
  });
  result.secondary_window = { used_percent: 40, used_credits: 80, limit_credits: 200,
    remaining_credits: 120, reset_at: "2026-10-15T03:00:00Z", unit: "calls" };
  writeQoderLimitsCache(result, { home, nowMs, namespace: "cn" });
  const cached = readQoderLimitsCache({ home, nowMs: nowMs + 2 * 3600_000, namespace: "cn" });
  assert.equal(cached.primary_window, null);
  assert.deepEqual(cached.secondary_window, result.secondary_window);
  assert.deepEqual(cached.tertiary_window, result.tertiary_window);
  assert.equal(readQoderLimitsCache({ home, nowMs, namespace: undefined }), null);
  assert.equal(readQoderLimitsCache({ home, nowMs: nowMs + 13 * 3600_000, namespace: "cn" }), null);
  writeQoderLimitsCache({ ...result, primary_window: null, secondary_window: null }, { home, nowMs, namespace: "cn" });
  assert.deepEqual(readQoderLimitsCache({ home, nowMs, namespace: "cn" }).tertiary_window, result.tertiary_window);
});

test("fetchQoderUsage sends the CodeXbar-compatible browser request", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          totalQuota: {
            quotaSummary: {
              usedValue: 25,
              limitValue: 100,
              remainingValue: 75,
              usagePercentage: 25,
            },
          },
        };
      },
    };
  };

  const result = await fetchQoderUsage("session=secret", QODER_SITES.international, fetchImpl);
  assert.equal(result.primary_window.used_percent, 25);
  assert.equal(captured.url, "https://qoder.com/api/v2/me/usages/big_model_credits");
  assert.deepEqual(
    captured.options.headers,
    qoderRequestHeaders("session=secret", QODER_SITES.international),
  );
  assert.equal(captured.options.headers["Bx-V"], "2.5.35");
  assert.equal(captured.options.headers["X-Requested-With"], "XMLHttpRequest");
});

test("fetchQoderLimits keeps explicit QODER_COOKIE provider access", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-manual-cookie-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let observedCookie = null;

  const result = await fetchQoderLimits({
    home,
    platform: "darwin",
    env: { QODER_COOKIE: "session=manual-secret" },
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async (_url, options) => {
      observedCookie = options.headers.Cookie;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            totalQuota: {
              quotaSummary: {
                usedValue: 25,
                limitValue: 100,
                remainingValue: 75,
                usagePercentage: 25,
              },
            },
          };
        },
      };
    },
  });

  assert.equal(observedCookie, "session=manual-secret");
  assert.equal(result.primary_window.remaining_credits, 75);
  assert.equal(result.cookie_source, "QODER_COOKIE");
});

test("parseQoderQuotaLog reads the latest personal quota snapshot without filling a 0/0 bar", () => {
  const parsed = parseQoderQuotaLog(`
    userType=personal_standard,totalUsagePercentage=42,isQuotaExceeded=false,
    userQuota used=42,total=100,remaining=58,percentage=42,unit=credits,addOnQuota none
    userType=personal_standard,totalUsagePercentage=0,isQuotaExceeded=true,
    userQuota=used=0, total=0, remaining=0, percentage=0, unit=credits, addOnQuota=<none>
  `);
  assert.equal(parsed.plan_label, "personal_standard");
  assert.equal(parsed.quota_exceeded, true);
  assert.equal(parsed.primary_window.used_percent, 0);
  assert.equal(parsed.primary_window.limit_credits, 0);
  assert.equal(parsed.source, "local-log");
});

test("parseQoderQuotaLog preserves a non-exceeded zero quota snapshot", () => {
  const parsed = parseQoderQuotaLog(`
    userType=personal_standard,totalUsagePercentage=0,isQuotaExceeded=false,
    userQuota=used=0, total=0, remaining=0, percentage=0, unit=credits, addOnQuota=<none>
  `);
  assert.equal(parsed.quota_exceeded, false);
  assert.equal(parsed.primary_window.used_percent, 0);
});

test("normalizeQoderRpcUsage keeps Qoder's quota-exceeded 0/0 Credits bucket at 0%", () => {
  const result = normalizeQoderRpcUsage({
    userType: "personal_standard",
    totalUsagePercentage: 0,
    isQuotaExceeded: true,
    userQuota: { used: 0, total: 0, remaining: 0, percentage: 0, unit: "credits" },
    expiresAt: 253_402_214_400_000,
  });

  assert.equal(result.quota_exceeded, true);
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.reset_at, null);
});

test("normalizeQoderActivityResponse exposes Ultimate Free Calls as a separate window", () => {
  const result = normalizeQoderActivityResponse({
    code: 0,
    msg: "ok",
    data: {
      activities: [{
        type: "MODEL_FREE_QUOTA",
        activityId: "ultimate_200_free_invoke",
        modelName: "Ultimate Free Calls",
        limit: 1200,
        used: 789,
        remaining: 411,
        resetAt: 0,
        resetStrategy: "NEVER_EXPIRE",
        eligible: true,
        activityEndAt: 1_785_427_140_000,
      }],
    },
  }, { nowMs: 1_780_000_000_000 });

  assert.deepEqual(result, {
    used_percent: 65.75,
    reset_at: "2026-07-30T15:59:00.000Z",
    used_credits: 789,
    limit_credits: 1200,
    remaining_credits: 411,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  });
});

test("fetchQoderActivity sends a COSY-signed GET without exposing the local token", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          msg: "ok",
          data: {
            activities: [{
              activityId: "ultimate_200_free_invoke",
              limit: 1200,
              used: 300,
              remaining: 900,
              eligible: true,
              activityEndAt: 1_785_427_140_000,
            }],
          },
        };
      },
    };
  };

  const window = await fetchQoderActivity({
    id: "user-1",
    name: "Test",
    userType: "personal_standard",
    token: "oauth-secret",
    refreshToken: "refresh-secret",
  }, fetchImpl, { nowMs: 1_780_000_000_000 });

  assert.equal(captured.url, "https://openapi.qoder.sh/algo/api/v2/activity");
  assert.equal(captured.options.method, "GET");
  assert.match(captured.options.headers.authorization, /^Bearer COSY\./);
  assert.equal(JSON.stringify(captured.options.headers).includes("oauth-secret"), false);
  assert.equal(window.remaining_credits, 900);
});

test("fetchQoderLimits merges local Plan Credits with the activity window", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-merge-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let activeRpcRequests = 0;
  const rpcRequest = async (method) => {
    activeRpcRequests += 1;
    assert.equal(activeRpcRequests, 1, "Qoder local RPC requests must be serialized");
    await new Promise((resolve) => setImmediate(resolve));
    activeRpcRequests -= 1;
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 0,
        isQuotaExceeded: false,
        userQuota: { used: 0, total: 0, remaining: 0, percentage: 0, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return {
      id: "user-1",
      name: "Test",
      userType: "personal_standard",
      token: "oauth-secret",
      refreshToken: "refresh-secret",
    };
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        data: {
          activities: [{
            activityId: "ultimate_200_free_invoke",
            limit: 1200,
            used: 789,
            remaining: 411,
            eligible: true,
            activityEndAt: 2_000_000_000_000,
          }],
        },
      };
    },
  });

  const result = await fetchQoderLimits({ home, rpcRequest, fetchImpl });
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.reset_at, null);
  assert.equal(result.secondary_window.remaining_credits, 411);
  assert.equal(result.source, "local-ipc+provider-api");
});

test("fetchQoderLimits keeps an unexpired activity when the provider briefly returns none", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-empty-activity-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nowMs = Date.parse("2030-07-29T16:00:00.000Z");
  const activityWindow = {
    used_percent: 65.75,
    reset_at: "2030-07-30T15:59:00.000Z",
    used_credits: 789,
    limit_credits: 1200,
    remaining_credits: 411,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  };
  writeQoderActivityCache(activityWindow, {
    home,
    nowMs: nowMs - 60_000,
  });

  const rpcRequest = async (method) => {
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 0,
        isQuotaExceeded: false,
        userQuota: { used: 0, total: 0, remaining: 0, percentage: 0, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return {
      id: "user-1",
      name: "Test",
      userType: "personal_standard",
      token: "oauth-secret",
    };
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { code: 0, data: { activities: [] } };
    },
  });

  const result = await fetchQoderLimits({
    home,
    nowMs,
    rpcRequest,
    fetchImpl,
  });

  assert.equal(result.secondary_window.remaining_credits, 411);
  assert.equal(result.source, "local-ipc+cached-activity");
  assert.deepEqual(readQoderActivityCache({ home, nowMs }), activityWindow);
});

test("fetchQoderLimits preserves the last unexpired activity window while Qoder is closed", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-activity-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const activityWindow = {
    used_percent: 65.75,
    reset_at: "2030-07-30T15:59:00.000Z",
    used_credits: 789,
    limit_credits: 1200,
    remaining_credits: 411,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  };
  writeQoderActivityCache(activityWindow, {
    home,
    nowMs: Date.parse("2030-07-29T15:59:00.000Z"),
  });
  assert.deepEqual(
    readQoderActivityCache({
      home,
      nowMs: Date.parse("2030-07-29T16:00:00.000Z"),
    }),
    activityWindow,
  );

  const result = await fetchQoderLimits({
    home,
    platform: "linux",
    nowMs: Date.parse("2030-07-29T16:00:00.000Z"),
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => {
      throw new Error("Provider unavailable.");
    },
  });

  assert.equal(result.primary_window, null);
  assert.equal(result.secondary_window.remaining_credits, 411);
  assert.equal(result.source, "cached-activity");
});

test("Qoder activity cache stays usable until the activity expires", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-activity-expiry-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const activityWindow = {
    used_percent: 50,
    reset_at: "2030-08-01T00:00:00.000Z",
    used_credits: 600,
    limit_credits: 1200,
    remaining_credits: 600,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  };
  writeQoderActivityCache(activityWindow, {
    home,
    nowMs: Date.parse("2030-07-20T00:00:00.000Z"),
  });

  assert.deepEqual(
    readQoderActivityCache({
      home,
      nowMs: Date.parse("2030-07-30T00:00:00.000Z"),
    }),
    activityWindow,
  );
  assert.equal(
    readQoderActivityCache({
      home,
      nowMs: Date.parse("2030-08-01T00:00:00.000Z"),
    }),
    null,
  );
});

test("fetchQoderLimits persists a provider-level last-good cache for app restarts", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-limits-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const liveNowMs = Date.parse("2030-07-29T00:00:00.000Z");
  const rpcRequest = async (method) => {
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 25,
        isQuotaExceeded: false,
        userQuota: { used: 25, total: 100, remaining: 75, percentage: 25, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return {
      id: "user-1",
      name: "Test",
      userType: "personal_standard",
      token: "oauth-secret",
    };
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        data: {
          activities: [{
            activityId: "ultimate_200_free_invoke",
            limit: 1200,
            used: 900,
            remaining: 300,
            eligible: true,
            activityEndAt: Date.parse("2030-08-01T00:00:00.000Z"),
          }],
        },
      };
    },
  });

  const live = await fetchQoderLimits({ home, rpcRequest, fetchImpl, nowMs: liveNowMs });
  assert.equal(live.primary_window.remaining_credits, 75);
  assert.equal(live.secondary_window.remaining_credits, 300);
  assert.equal(readQoderLimitsCache({ home, nowMs: liveNowMs }).primary_window.remaining_credits, 75);

  const cached = await fetchQoderLimits({
    home,
    platform: "linux",
    nowMs: liveNowMs + 60_000,
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => {
      throw new Error("Browser session unavailable.");
    },
  });

  assert.equal(cached.primary_window.remaining_credits, 75);
  assert.equal(cached.secondary_window.remaining_credits, 300);
  assert.equal(cached.cached, true);
  // Still inside the fresh TTL: inherit the live write's source (PR 955).
  assert.equal(cached.stale, false);
  assert.match(cached.source, /local-ipc/);
});

test("readQoderLimitsCache fresh TTL keeps written provenance then ages honestly (PR 955)", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-fresh-ttl-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nowMs = Date.parse("2030-07-29T12:00:00.000Z");
  const limits = {
    configured: true,
    error: null,
    plan_label: "personal_standard",
    quota_exceeded: false,
    primary_window: {
      used_percent: 25,
      reset_at: null,
      used_credits: 25,
      limit_credits: 100,
      remaining_credits: 75,
      unit: "credits",
    },
    source: "local-ipc",
  };
  writeQoderLimitsCache(limits, { home, nowMs });

  // Two minutes later: still fresh — provenance stays the written source and
  // the hit is not flagged stale (no self-lock into permanent disk-cache).
  const fresh = readQoderLimitsCache({ home, nowMs: nowMs + 2 * 60_000 });
  assert.equal(fresh.source, "local-ipc");
  assert.equal(fresh.stale, false);
  assert.equal(fresh.cached, true);

  // Past the fresh TTL the same payload is honest about its age.
  const aged = readQoderLimitsCache({ home, nowMs: nowMs + 11 * 60_000 });
  assert.equal(aged.source, "disk-cache");
  assert.equal(aged.stale, true);
});

test("fetchQoderLimits returns last-good before explicit provider fallback", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cache-first-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nowMs = Date.parse("2030-07-29T00:00:00.000Z");
  writeQoderLimitsCache({
    configured: true,
    error: null,
    plan_label: "personal_standard",
    primary_window: {
      used_percent: 25,
      reset_at: null,
      used_credits: 25,
      limit_credits: 100,
      remaining_credits: 75,
      unit: "credits",
    },
    secondary_window: {
      used_percent: 75,
      reset_at: "2030-08-01T00:00:00.000Z",
      used_credits: 900,
      limit_credits: 1200,
      remaining_credits: 300,
      unit: "calls",
    },
  }, { home, nowMs });

  let providerFetches = 0;

  const cached = await fetchQoderLimits({
    home,
    platform: "darwin",
    env: { QODER_COOKIE: "session=manual-secret" },
    nowMs: nowMs + 60_000,
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => {
      providerFetches += 1;
      throw new Error("Provider fallback must not run before the last-good cache.");
    },
  });

  assert.equal(cached.source, "disk-cache");
  assert.equal(cached.secondary_window.remaining_credits, 300);
  assert.equal(providerFetches, 0);
});

test("fetchQoderLimits does not probe the macOS browser Keychain by default", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-keychain-default-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cookiePath = path.join(
    home,
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "Default",
    "Cookies",
  );
  fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
  fs.writeFileSync(cookiePath, "");
  let keychainReads = 0;
  let cookieReads = 0;
  let networkReads = 0;

  const result = await fetchQoderLimits({
    home,
    platform: "darwin",
    env: {},
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    securityRunner: async () => {
      keychainReads += 1;
      return "safe-storage-password";
    },
    sqliteReader: async () => {
      cookieReads += 1;
      return [];
    },
    fetchImpl: async () => {
      networkReads += 1;
      throw new Error("Unexpected provider request.");
    },
  });

  assert.deepEqual(result, { configured: false });
  assert.equal(keychainReads, 0);
  assert.equal(cookieReads, 0);
  assert.equal(networkReads, 0);
});

test("Qoder limits source contains no browser credential-store access", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "qoder-limits.js"), "utf8");
  const normalizedSource = source.replace(/\s+/g, " ");
  const forbiddenPatterns = [
    [/["'](?:node:)?child_process["']/, "child process execution", 'require("child_process")'],
    [/["'][^"']*sqlite-reader(?:\.js)?["']/, "browser SQLite access", 'require("../lib/sqlite-reader.js")'],
    [/["'](?:\/usr\/bin\/)?security["']/, "macOS Keychain CLI access", 'execFile("security", args)'],
    [/find-generic-password|Safe Storage/i, "browser Safe Storage access", "Microsoft Edge Safe Storage"],
    [/decryptChromiumCookie/, "Chromium cookie decryption", "decryptChromiumCookie(payload)"],
    [/encrypted_value/, "encrypted browser cookie reads", "SELECT encrypted_value FROM cookies"],
  ];

  for (const [pattern, capability, example] of forbiddenPatterns) {
    assert.match(example, pattern, `guard must detect ${capability}`);
    assert.doesNotMatch(normalizedSource, pattern, `Qoder limits must not contain ${capability}`);
  }
});

test("fetchQoderCnLimits falls back to the qoder.cn site and its own cache namespace", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cn-site-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let capturedUrl = null;

  const result = await fetchQoderCnLimits({
    home,
    platform: "darwin",
    env: { QODER_CN_COOKIE: "session=manual-secret" },
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            totalQuota: {
              quotaSummary: {
                usedValue: 25,
                limitValue: 100,
                remainingValue: 75,
                usagePercentage: 25,
              },
            },
          };
        },
      };
    },
  });

  assert.equal(capturedUrl, "https://qoder.cn/api/v2/me/usages/big_model_credits");
  assert.equal(result.primary_window.remaining_credits, 75);
  assert.equal(result.site, "china");
});

test("the CN CLI fallback carries the spend ledger forward instead of blanking it", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cn-cli-spend-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const seededAt = Date.parse("2030-07-28T00:00:00.000Z");

  // A spend snapshot captured while the website cookie still worked.
  writeQoderLimitsCache({
    configured: true,
    error: null,
    plan_label: "personal_standard",
    primary_window: {
      used_percent: 25,
      reset_at: null,
      used_credits: 25,
      limit_credits: 100,
      remaining_credits: 75,
      unit: "credits",
    },
    spend: { credits_total: 85.31, messages_total: 106, daily: [] },
  }, { home, nowMs: seededAt, namespace: "cn" });

  // The cookie has expired and the CLI answers quota windows only - no spend.
  const result = await fetchQoderLimits({
    home,
    platform: "darwin",
    envPrefix: "QODER_CN",
    site: QODER_SITES.china,
    sitePinned: true,
    cacheNamespace: "cn",
    nowMs: seededAt + 60_000,
    env: { QODER_CN_COOKIE: "session=expired" },
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => {
      const error = new Error("Qoder CN login expired. Sign in to Qoder CN CLI again.");
      error.code = "AUTH_EXPIRED";
      throw error;
    },
    cliLimitsRequest: async () => ({
      configured: true,
      error: null,
      plan_label: "personal_standard",
      quota_exceeded: false,
      primary_window: {
        used_percent: 0,
        reset_at: null,
        used_credits: 0,
        limit_credits: 0,
        remaining_credits: 0,
        unit: "credits",
      },
      source: "cli-api",
    }),
  });

  assert.equal(result.source, "cli-api");
  // Dropping it here is what made the panel render "no spend" as "no component
  // at all", which reads as "you used nothing today".
  assert.equal(result.spend?.credits_total, 85.31);
  assert.equal(result.spend?.messages_total, 106);
  assert.equal(result.spend_stale, true);
  assert.equal(result.spend_cached_at, new Date(seededAt).toISOString());
  // The saved cookie failed but the CLI answered: the frontend must learn the
  // cookie itself is stale, even though the card still has a carried ledger.
  assert.equal(result.saved_session_expired, true);

  // It has to survive the write to disk, or the next read loses it again.
  const reread = readQoderLimitsCache({ home, nowMs: seededAt + 120_000, namespace: "cn" });
  assert.equal(reread?.spend?.credits_total, 85.31);
  assert.equal(reread?.spend_stale, true);

  // The CN cache lives under its own namespace — the international cache stays
  // untouched, so the two editions never clobber each other. Read at the same
  // seeded instant the cache was written at; a wall-clock nowMs would be older
  // than the entry and trip the freshness check.
  const cnCache = readQoderLimitsCache({ home, nowMs: seededAt, namespace: "cn" });
  // The CLI fallback carries the spend ledger forward (75-credit window from the
  // website snapshot is gone — the CLI only answers quota, so it wrote its own
  // quota-only window with remaining_credits 0); what must survive the round-trip
  // is the spend, which it does.
  assert.ok(cnCache && cnCache.primary_window, "CN namespace cache survived the CLI fallback write");
  assert.equal(cnCache?.primary_window?.remaining_credits, 0);
  assert.equal(cnCache?.spend?.credits_total, 85.31);
  assert.equal(readQoderLimitsCache({ home, nowMs: seededAt }), null);
});

test("fetchQoderCnLimits targets the china activity host for Ultimate Free Calls", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cn-activity-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let capturedUrl = null;
  const rpcRequest = async (method) => {
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 25,
        isQuotaExceeded: false,
        userQuota: { used: 25, total: 100, remaining: 75, percentage: 25, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return { id: "user-1", name: "Test", userType: "personal_standard", token: "oauth-secret" };
  };
  const fetchImpl = async (url) => {
    capturedUrl = url;
    return {
      ok: true,
      status: 200,
      async json() {
        return { code: 0, data: { activities: [] } };
      },
    };
  };

  const result = await fetchQoderCnLimits({ home, platform: "darwin", env: {}, rpcRequest, fetchImpl });
  assert.equal(capturedUrl, "https://openapi.qoder.com.cn/algo/api/v2/activity");
  assert.equal(result.primary_window.remaining_credits, 75);
});

test("fetchQoderCnLimits reads credentials via QODER_CN_HOME, not the international QODER_HOME", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cn-rpc-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const cnRoot = path.join(home, "cn-root");
  fs.mkdirSync(path.join(cnRoot, "SharedClientCache"), { recursive: true });
  fs.writeFileSync(
    path.join(cnRoot, "SharedClientCache", ".info.json"),
    JSON.stringify({ ipcServerPath: "/tmp/qodercn-test.sock" }),
  );

  const rpc = require("../src/lib/qoder-limits").qoderRpcRequest;
  const message = await rpc(
    "credit/usage",
    {},
    { home, env: { QODER_HOME: "/int-should-lose", QODER_CN_HOME: cnRoot }, platform: "darwin", appDir: "QoderCN", envPrefix: "QODER_CN" },
  ).then(
    () => "resolved",
    (err) => err.message,
  );
  // If QODER_CN_HOME were ignored, the probe would fail before ever touching
  // the socket ("Qoder local service is not running"). Reaching the socket
  // means the QoderCN .info.json was found.
  assert.ok(message !== "Qoder local service is not running.", "QODER_CN_HOME must locate the QoderCN .info.json");
});

test("fetchQoderCnLimits stays on the china site even when QODER_SITE points elsewhere", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cn-sitepin-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let capturedUrl = null;

  const result = await fetchQoderCnLimits({
    home,
    platform: "darwin",
    env: { QODER_CN_COOKIE: "session=manual-secret", QODER_SITE: "qoder.com" },
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            totalQuota: {
              quotaSummary: {
                usedValue: 25,
                limitValue: 100,
                remainingValue: 75,
                usagePercentage: 25,
              },
            },
          };
        },
      };
    },
  });

  // QODER_SITE is an international-flow knob — the CN flow must stay pinned to
  // qoder.cn even if a user set QODER_SITE=qoder.com for the international
  // install.
  assert.equal(capturedUrl, "https://qoder.cn/api/v2/me/usages/big_model_credits");
  assert.equal(result.site, "china");
  assert.equal(result.primary_window.remaining_credits, 75);
});

test("fetchQoderLimits blames the stale saved cookie, not the user's Qoder sign-in", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-stale-cookie-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const trackerDir = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "qoder-usage-cookie.txt"), "qoder_session_cookie=stale\n");

  const result = await fetchQoderLimits({
    home,
    platform: "darwin",
    env: {},
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => ({ ok: false, status: 401, async json() { return {}; } }),
  });

  // The desktop client can be perfectly signed in while this cookie copy is
  // dead, so the card must not claim the user's login expired: it drops to the
  // panel's localized "not connected" state with the reason kept as a note.
  assert.equal(result.configured, false);
  assert.equal(result.error, undefined);
  assert.equal(result.auth_action_required, undefined);
  assert.equal(result.saved_session_expired, true);
  assert.match(result.note, /qoder-usage-cookie\.txt/);
  assert.match(result.note, /sign-in itself is unaffected/);
  assert.doesNotMatch(result.note, /Sign in at qoder\.com again/);
});

test("parseQoderAccountUsageLog maps the 0.4.x JSON line via normalizeQoderRpcUsage (absorbed from upstream #921)", () => {
  const line = '[2026-11-01T03:00:00.000Z] [Auth] [AccountUsage] {"userType":"Pro","expiresAt":"9999-12-31T00:00:00.000Z","isQuotaExceeded":false,"qoderUsage":{"userQuota":{"used":120,"total":1000,"remaining":880,"unit":"credits"},"addOnQuota":{"used":5,"total":100,"remaining":95}}}';
  const observed = Date.parse("2026-11-01T03:00:01Z");
  const hit = parseQoderAccountUsageLog(line, observed);
  assert.equal(hit.limits.primary_window.used_credits, 120);
  assert.equal(hit.limits.primary_window.limit_credits, 1000);
  // 9999-12-31 = no-expiry sentinel -> reset_at stays null.
  assert.equal(hit.limits.primary_window.reset_at, null);
  assert.equal(hit.limits.tertiary_window.remaining_credits, 95);
  assert.equal(hit.limits.source, "local-log");
  assert.equal(hit.observedAtMs, Date.parse("2026-11-01T03:00:00.000Z"));
});

test("parseQoderAccountUsageLog ignores lines without qoderUsage", () => {
  assert.equal(parseQoderAccountUsageLog("plain log line", 0), null);
});

test("writeQoderCookieFile persists the cookie and backs up the previous file", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cookie-write-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  const result = writeQoderCookieFile({
    home,
    namespace: "cn",
    cookie: "qoder_session_cookie=abc123; yunpk=xyz",
  });
  assert.equal(result.ok, true);
  assert.equal(result.file, "qoder-cn-usage-cookie.txt");
  // First write: nothing to back up.
  assert.equal(result.saved_at, null);
  assert.equal(readQoderCookieFile({ home, namespace: "cn" }), "qoder_session_cookie=abc123; yunpk=xyz");
  assert.equal(fs.existsSync(qoderCookieFilePath({ home, namespace: "cn" })), true);

  // Second write backs up the first as .bak-<date> and replaces the file.
  const second = writeQoderCookieFile({
    home,
    namespace: "cn",
    cookie: "qoder_session_cookie=newer",
  });
  assert.ok(second.saved_at, "backup date recorded");
  assert.equal(readQoderCookieFile({ home, namespace: "cn" }), "qoder_session_cookie=newer");
  const backups = fs.readdirSync(path.join(home, ".tokentracker", "tracker"))
    .filter((name) => name.startsWith("qoder-cn-usage-cookie.txt.bak-"));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(home, ".tokentracker", "tracker", backups[0]), "utf8"), "qoder_session_cookie=abc123; yunpk=xyz");
});

test("writeQoderCookieFile rejects empty or malformed cookies", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cookie-reject-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  assert.throws(() => writeQoderCookieFile({ home, namespace: "cn", cookie: "   " }), /must not be empty/i);
  assert.throws(() => writeQoderCookieFile({ home, namespace: "cn", cookie: "not-a-cookie-pair" }), /does not look like/i);
  // A pasted cookie with a line break would land in the Cookie: header and fail
  // with an obscure undici ERR_INVALID_CHAR; reject it at the input boundary.
  assert.throws(() => writeQoderCookieFile({ home, namespace: "cn", cookie: "a=1\r\nb=2" }), /single line/i);
  assert.throws(() => writeQoderCookieFile({ home, namespace: "cn", cookie: "a=1\nb=2" }), /single line/i);
  assert.equal(fs.existsSync(qoderCookieFilePath({ home, namespace: "cn" })), false);
});

test("writeQoderCookieFile uses the international file for the intl namespace", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cookie-intl-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  // The local-api route maps namespace "intl" to undefined (the international
  // flow has no cache namespace), so the file is qoder-usage-cookie.txt.
  writeQoderCookieFile({ home, namespace: undefined, cookie: "qoder_session_cookie=intl" });
  assert.equal(fs.existsSync(qoderCookieFilePath({ home, namespace: undefined })), true);
  assert.equal(readQoderCookieFile({ home, namespace: undefined }), "qoder_session_cookie=intl");
  // And it must not collide with the CN file.
  assert.equal(fs.existsSync(qoderCookieFilePath({ home, namespace: "cn" })), false);
});

test("writeQoderCookieFile backs up every previous version (timestamped, never overwrites)", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cookie-backups-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  writeQoderCookieFile({ home, namespace: "cn", cookie: "a=1" });
  const file = qoderCookieFilePath({ home, namespace: "cn" });
  // Force a distinct mtime so the next backup gets a clearly distinct stamp.
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(file, past, past);

  writeQoderCookieFile({ home, namespace: "cn", cookie: "b=2" });
  writeQoderCookieFile({ home, namespace: "cn", cookie: "c=3" });

  const backups = fs.readdirSync(path.join(home, ".tokentracker", "tracker"))
    .filter((name) => name.startsWith("qoder-cn-usage-cookie.txt.bak-"))
    .sort();
  // write2 backed up a=1 (stamped 60s ago), write3 backed up b=2 (stamped now):
  // the timestamped names must not collide, so both versions survive.
  assert.equal(backups.length, 2);
  const contents = backups.map((n) => fs.readFileSync(path.join(home, ".tokentracker", "tracker", n), "utf8")).sort();
  assert.deepEqual(contents, ["a=1", "b=2"]);
  assert.equal(readQoderCookieFile({ home, namespace: "cn" }), "c=3");
});

test("writeQoderCookieFile writes atomically and leaves no temp file", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cookie-atomic-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));

  writeQoderCookieFile({ home, namespace: "cn", cookie: "a=1" });
  writeQoderCookieFile({ home, namespace: "cn", cookie: "b=2" });
  assert.equal(readQoderCookieFile({ home, namespace: "cn" }), "b=2");
  const leftovers = fs.readdirSync(path.join(home, ".tokentracker", "tracker"))
    .filter((n) => n.includes(".tmp"));
  assert.deepEqual(leftovers, []);
});
