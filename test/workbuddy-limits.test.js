const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  collectPackageRows,
  fetchWorkbuddyAiLimits,
  fetchWorkbuddyLimits,
  originAllowed,
  readWorkbuddyLimitsCache,
  selectWorkbuddyPlanQuota,
  selectWorkbuddyLimits,
  VARIANTS,
  workbuddyLimitsCachePath,
  writeWorkbuddyLimitsCache,
} = require("../src/lib/workbuddy-limits");
const { withWorkbuddyProviderTimeout } = require("../src/lib/usage-limits");

const TRIAL = "TCACA_code_008_cfWoLwvjU4";
const REWARD = "TCACA_code_007_nzdH5h4Nl0";
const BONUS = "TCACA_code_028_NtpWi0jzXs";
const PRO_YEAR = "TCACA_code_003_FAnt7lcmRT";

function trialRow(overrides = {}) {
  return {
    PackageCode: TRIAL,
    PackageName: "体验版",
    CycleTotalCapacity: 500,
    CycleRemainCapacity: 251.71,
    CycleUsedCapacity: 248.29,
    CycleEndTime: "2026-10-31 23:59:59",
    ...overrides,
  };
}

test("plan quota keeps the subscription package and drops reward grants", () => {
  const quota = selectWorkbuddyPlanQuota([
    ...collectPackageRows({
      code: 0,
      data: {
        Packages: [trialRow(), {
          PackageCode: REWARD,
          PackageName: "官方活动发放",
          CycleTotalCapacity: 500,
          CycleRemainCapacity: 500,
          CycleUsedCapacity: 0,
          CycleEndTime: "2026-11-21 22:31:43",
        }, {
          PackageCode: BONUS,
          PackageName: "成长计划奖励",
          CycleTotalCapacity: 1000,
          CycleRemainCapacity: 1000,
          CycleUsedCapacity: 0,
          CycleEndTime: "2026-11-21 22:57:49",
        }],
        SubscriptionPackageName: "体验版",
      },
    }),
  ], { name: "体验版" });

  assert.equal(quota.package_code, TRIAL);
  assert.equal(quota.plan_label, "Free");
  assert.ok(Math.abs(quota.primary_window.used_percent - (248.29 / 500) * 100) < 1e-9);
  assert.equal(quota.primary_window.reset_at, new Date("2026-10-31T23:59:59").toISOString());
  assert.equal(quota.primary_window.limit_credits, 500);
  assert.equal(quota.primary_window.used_credits, 248.29);
  assert.equal(quota.primary_window.remaining_credits, 251.71);
});

test("one WorkBuddy product chooses a usable edition without summing account balances", () => {
  const china = { configured: true, plan_label: "Free", primary_window: { used_percent: 50, limit_credits: 500 } };
  const ai = { configured: true, plan_label: "Pro", primary_window: { used_percent: 20, limit_credits: 1000 } };
  assert.equal(selectWorkbuddyLimits(china, ai), china);
  assert.equal(selectWorkbuddyLimits({ configured: false }, ai), ai);
  assert.equal(selectWorkbuddyLimits({ configured: true, error: "not running" }, ai), ai);
  assert.equal(selectWorkbuddyLimits({ configured: true, primary_window: null }, ai), ai);
  assert.deepEqual(selectWorkbuddyLimits({ configured: false }, { configured: false }), { configured: false });
});

test("a higher plan tier wins over a trial package", () => {
  const quota = selectWorkbuddyPlanQuota([
    { code: TRIAL, name: "体验版", total: 500, remain: 500, used: 0, cycleEnd: "2026-10-31 23:59:59" },
    { code: PRO_YEAR, name: "专业版", total: 2000, remain: 1500, used: 500, cycleEnd: "2027-01-01 00:00:00" },
    { code: REWARD, name: "奖励", total: 9000, remain: 9000, used: 0, cycleEnd: "2026-12-01 00:00:00" },
  ]);
  assert.equal(quota.package_code, PRO_YEAR);
  assert.equal(quota.plan_label, "STANDARD");
});

test("a reward code is never treated as the subscription package", () => {
  const quota = selectWorkbuddyPlanQuota(
    [{ code: REWARD, name: "奖励", total: 1500, remain: 1500, used: 0, cycleEnd: "2026-11-21 22:31:43" }],
    { code: REWARD, name: "奖励" },
  );
  assert.equal(quota, null);
});

test("English names come from the response or the official desktop edition labels", () => {
  const known = [
    [TRIAL, "Free", "Free"],
    [PRO_YEAR, "STANDARD", "Pro"],
    ["TCACA_code_039_KRcQj7wUat", "STANDARD TRIAL", "Pro-Trial"],
    ["TCACA_code_026_BaESVICNoi", "Advanced", "Advanced"],
    ["TCACA_code_027_0FCGVA6vSa", "Ultimate", "Ultimate"],
    ["TCACA_code_023_4xbGhMrE6q", "Youth", "Youth"],
    ["TCACA_code_035_ArVxJcGDsm", "Free", "Free"],
  ];
  for (const [code, cnLabel, aiLabel] of known) {
    const rows = collectPackageRows({ Packages: [trialRow({ PackageCode: code })] });
    assert.equal(selectWorkbuddyPlanQuota(rows).plan_label, cnLabel);
    assert.equal(selectWorkbuddyPlanQuota(rows, {}, "workbuddyAi").plan_label, aiLabel);
    assert.equal(selectWorkbuddyPlanQuota(rows, { name: "Provider English Name" }).plan_label, "Provider English Name");
  }
  const code = "future-package-code";
  const unknownRows = collectPackageRows({ Packages: [trialRow({ PackageCode: code, PackageName: "新套餐" })] });
  assert.equal(selectWorkbuddyPlanQuota(unknownRows, { code, name: "新套餐" }).plan_label, null);
  assert.equal(selectWorkbuddyPlanQuota(unknownRows, { code, name: "Future Plan" }).plan_label, "Future Plan");
});

test("edition allowlists gate hosts, with the AI edition carrying both billing domains", () => {
  assert.equal(originAllowed("https://www.workbuddy.cn", VARIANTS.workbuddy), true);
  assert.equal(originAllowed("https://copilot.tencent.com", VARIANTS.workbuddy), true);
  assert.equal(originAllowed("https://www.workbuddy.ai", VARIANTS.workbuddy), false);
  assert.equal(originAllowed("https://www.workbuddy.ai", VARIANTS.workbuddyAi), true);
  // f7b90a9b：AI 版额度走 CN 计费域（wb-product-config 记录 www.workbuddy.cn），
  // official-product allowlist 双域（.ai + .cn）。
  assert.equal(originAllowed("https://www.workbuddy.cn", VARIANTS.workbuddyAi), true);
  assert.equal(originAllowed("https://www.codebuddy.cn", VARIANTS.workbuddy), false);
  assert.equal(originAllowed("https://workbuddy.example.com", VARIANTS.workbuddyAi), false);
});

test("china fetch uses only the china host and ignores reward rows", async () => {
  const calls = [];
  const result = await fetchWorkbuddyLimits({
    env: { HOME: os.tmpdir(), WORKBUDDY_ACCESS_TOKEN: "cn-token" },
    origin: "https://www.workbuddy.cn",
    fetchImpl: async (url, init) => {
      calls.push({ url, auth: init.headers.Authorization });
      if (url.endsWith("get-user-resource-summary")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            code: 0,
            data: {
              SubscriptionPackageName: "体验版",
              Packages: [trialRow(), {
                PackageCode: REWARD,
                PackageName: "官方活动发放",
                CycleTotalCapacity: 1500,
                CycleRemainCapacity: 1500,
                CycleUsedCapacity: 0,
              }],
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { Accounts: [] } }) };
    },
  });

  assert.equal(result.plan_label, "Free");
  assert.ok(Math.abs(result.primary_window.used_percent - 49.658) < 0.001);
  assert.ok(calls.every((call) => call.url.startsWith("https://www.workbuddy.cn/")));
  assert.ok(calls.every((call) => call.auth === "Bearer cn-token"));
  assert.equal(calls.some((call) => call.url.includes("workbuddy.ai")), false);
});

test("international fetch adopts a desktop session on the CN billing domain", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-ai-"));
  const authPath = path.join(dir, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, JSON.stringify({
    auth: { accessToken: "cn-session", domain: "www.workbuddy.cn" },
  }));
  const called = [];
  const result = await fetchWorkbuddyAiLimits({
    env: { HOME: dir, WORKBUDDY_AI_HOME: path.join(dir, "missing-ai") },
    authFiles: [authPath],
    fetchImpl: async (url) => {
      called.push(url);
      return { ok: true, status: 200, json: async () => ({ code: 0, data: {} }) };
    },
  });
  // f7b90a9b：AI 版接纳 allowlist 内的 CN 域桌面会话（这正是 AI 额度卡的修复目标），
  // 计费请求仍打本版默认域 workbuddy.ai；域外会话才拒绝。
  assert.equal(result.configured, true);
  assert.ok(called.length > 0);
  assert.ok(called.every((url) => url.includes("workbuddy.ai")), called.join(","));
});

test("an encrypted session without a running proxy asks to start WorkBuddy", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-enc-"));
  const authPath = path.join(dir, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, JSON.stringify({
    auth: {
      domain: "www.workbuddy.cn",
      accessToken: { $wbEncrypted: 1, envelope: "ciphertext" },
    },
  }));
  const called = [];
  const result = await fetchWorkbuddyLimits({
    env: { HOME: dir },
    authFiles: [authPath],
    fetchImpl: async (url) => {
      called.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });
  assert.equal(result.configured, true);
  assert.match(result.error, /Start WorkBuddy and sign in/);
  assert.deepEqual(called, []);
});

test("a plaintext china session is sent only to the china host", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-plain-"));
  const authPath = path.join(dir, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, JSON.stringify({
    auth: { accessToken: "plain-cn-token", domain: "www.workbuddy.cn" },
  }));
  const urls = [];
  const result = await fetchWorkbuddyLimits({
    env: { HOME: dir, WORKBUDDY_HOME: path.join(dir, "nope") },
    authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: async (url, init) => {
      urls.push(url);
      assert.equal(init.headers.Authorization, "Bearer plain-cn-token");
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 0, data: { Packages: [trialRow()] } }),
      };
    },
  });
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.ok(urls.every((url) => url.startsWith("https://www.workbuddy.cn/")));
});

// 守卫：wbipc 命名管道校验只在 Windows 走 win32 分支，Linux CI 跳过。
(process.platform === "win32" ? test : test.skip)("an unreachable daemon reads as client_not_running, not a red failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-ipc-"));
  fs.mkdirSync(path.join(dir, "wbipc"), { recursive: true });
  fs.writeFileSync(path.join(dir, "wbipc", "endpoint.json"), JSON.stringify({
    ticket: "A".repeat(43),
    endpoint: "\\\\.\\pipe\\wbipc-test-not-running",
  }));
  const result = await fetchWorkbuddyAiLimits({
    env: { HOME: dir },
    workbuddyHome: dir,
    connectImpl: () => {
      throw new Error("Start WorkBuddy and sign in to read its subscription quota.");
    },
  });
  assert.equal(result.configured, true);
  assert.equal(result.reason, "client_not_running");
  assert.match(result.error, /Start WorkBuddy and sign in/);
});

// ── Last-good disk cache（PR 954 移植）────────────────────────────
// 活体读成功按版本+账号分区落盘；此后「应用关闭」稳态（加密会话不可读）
// 用最后好数据续供，并如实标注 stale/cached_at。跨版本、跨账号永不互借。

const WB_CACHE_T0 = Date.parse("2026-07-08T00:00:00Z");

function wbCacheSummary(summary) {
  return async (url) => (
    url.endsWith("get-user-resource-summary")
      ? { ok: true, status: 200, json: async () => summary }
      : { ok: true, status: 200, json: async () => ({ code: 0, data: { Accounts: [] } }) }
  );
}

function wbCachePlanWindow(resetAt) {
  return {
    used_percent: 49.658,
    reset_at: resetAt,
    used_credits: 248.29,
    limit_credits: 500,
    remaining_credits: 251.71,
  };
}

// 桌面应用写出的 auth 记录：会话令牌（默认加密）+ 登录账号 uid
// ——应用关闭后 uid 仍然可读。
function wbCacheAuthInfo({ domain = "www.workbuddy.cn", token, uid } = {}) {
  return JSON.stringify({
    ...(uid ? { account: { uid } } : {}),
    auth: {
      domain,
      accessToken: token ?? { $wbEncrypted: 1, envelope: "ciphertext" },
    },
  });
}

const WB_CACHE_CN_SUMMARY = {
  code: 0,
  data: {
    SubscriptionPackageName: "体验版",
    Packages: [trialRow({ CycleTotalCapacity: 500, CycleRemainCapacity: 0, CycleUsedCapacity: 500 })],
    CreditGroups: [
      { Kind: "plan_base", CycleTotalCapacity: "500", CycleRemainCapacity: "0", CycleUsedCapacity: "500" },
      { Kind: "benefit", CycleTotalCapacity: "0", CycleRemainCapacity: "0", CycleUsedCapacity: "0" },
    ],
  },
};

test("a live read persists last-good windows per edition without crossing editions", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ token: "cn-token", uid: "uid-cn" }));
  const cn = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn", fetchImpl: wbCacheSummary(WB_CACHE_CN_SUMMARY),
  });
  assert.equal(cn.error, null);
  const ai = await fetchWorkbuddyAiLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home, WORKBUDDY_AI_ACCESS_TOKEN: "ai-token" },
    origin: "https://www.workbuddy.ai",
    fetchImpl: wbCacheSummary({
      code: 0,
      data: {
        SubscriptionPackageName: "Free",
        Packages: [trialRow({ PackageCode: "TCACA_code_035_ArVxJcGDsm", CycleTotalCapacity: 100, CycleRemainCapacity: 100, CycleUsedCapacity: 0 })],
        CreditGroups: [
          { Kind: "plan_base", CycleTotalCapacity: "100", CycleRemainCapacity: "100", CycleUsedCapacity: "0" },
          { Kind: "benefit", CycleTotalCapacity: "0", CycleRemainCapacity: "0", CycleUsedCapacity: "0" },
        ],
      },
    }),
  });
  assert.equal(ai.error, null);

  const stored = JSON.parse(fs.readFileSync(workbuddyLimitsCachePath({ home }), "utf8"));
  assert.deepEqual(Object.keys(stored).sort(), ["workbuddy", "workbuddyAi"]);
  assert.equal(stored.workbuddy.identity, "uid-cn");
  assert.equal(stored.workbuddyAi.identity, "unknown");
  assert.ok(Number.isFinite(Date.parse(stored.workbuddy.cached_at)));
});

test("a closed app serves the last-good windows with stale markers", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ token: "cn-token", uid: "uid-cn" }));
  const live = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn", fetchImpl: wbCacheSummary(WB_CACHE_CN_SUMMARY),
  });
  assert.equal(live.error, null);

  // App closed: the session token is encrypted and unreadable, but the same
  // auth record still names the account that produced the cached windows.
  fs.writeFileSync(authPath, wbCacheAuthInfo({ uid: "uid-cn" }));
  const calls = [];
  const cached = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: async (url) => { calls.push(url); throw new Error("no network in this test"); },
  });
  assert.deepEqual(calls, []);
  assert.equal(cached.configured, true);
  assert.equal(cached.error, null);
  assert.equal(cached.stale, true);
  assert.equal(cached.cached, true);
  assert.equal(cached.source, "disk-cache");
  assert.equal(cached.primary_window.limit_credits, 500);
  const stored = JSON.parse(fs.readFileSync(workbuddyLimitsCachePath({ home }), "utf8"));
  assert.equal(cached.cached_at, stored.workbuddy.cached_at);
});

test("an account switch keeps the previous login's windows out of the fallback", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ token: "cn-token", uid: "uid-cn" }));
  await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn", fetchImpl: wbCacheSummary(WB_CACHE_CN_SUMMARY),
  });

  fs.writeFileSync(authPath, wbCacheAuthInfo({ uid: "uid-other" }));
  const switched = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: async () => { throw new Error("no network in this test"); },
  });
  assert.equal(switched.configured, true);
  assert.match(switched.error, /Start WorkBuddy and sign in/);

  fs.writeFileSync(authPath, wbCacheAuthInfo({ uid: "uid-cn" }));
  const restored = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: async () => { throw new Error("no network in this test"); },
  });
  assert.equal(restored.error, null);
  assert.equal(restored.source, "disk-cache");
});

test("an edition never falls back to the other edition's cached windows", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ token: "cn-token", uid: "uid-cn" }));
  await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn", fetchImpl: wbCacheSummary(WB_CACHE_CN_SUMMARY),
  });

  const aiAuth = path.join(home, "workbuddy-ai.info");
  fs.writeFileSync(aiAuth, wbCacheAuthInfo({ domain: "www.workbuddy.ai", uid: "uid-ai" }));
  const calls = [];
  const ai = await fetchWorkbuddyAiLimits({
    home, env: { HOME: home }, authFiles: [aiAuth],
    fetchImpl: async (url) => { calls.push(url); throw new Error("no network in this test"); },
  });
  assert.deepEqual(calls, []);
  assert.equal(ai.configured, true);
  assert.match(ai.error, /Start WorkBuddy and sign in/);
});

test("auth expiry bypasses the cache so re-login stays visible", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ token: "cn-token", uid: "uid-cn" }));
  await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn", fetchImpl: wbCacheSummary(WB_CACHE_CN_SUMMARY),
  });
  await assert.rejects(
    fetchWorkbuddyLimits({
      home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
      origin: "https://www.workbuddy.cn",
      fetchImpl: async () => ({ ok: false, status: 401 }),
    }),
    /sign-in expired/,
  );
});

test("a never-signed-in install stays unconfigured even with cache on disk", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  writeWorkbuddyLimitsCache(
    { configured: true, error: null, plan_label: "Free", primary_window: wbCachePlanWindow("2027-01-01T00:00:00Z"), secondary_window: null },
    { home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "unknown" },
  );
  const result = await fetchWorkbuddyLimits({ home, env: { HOME: home } });
  assert.deepEqual(result, { configured: false });
});

test("an unreadable account matches only its own cache entries", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home, WORKBUDDY_ACCESS_TOKEN: "cn-token" },
    origin: "https://www.workbuddy.cn", fetchImpl: wbCacheSummary(WB_CACHE_CN_SUMMARY),
  });

  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ uid: "uid-cn" }));
  const named = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: async () => { throw new Error("no network in this test"); },
  });
  assert.match(named.error, /Start WorkBuddy and sign in/);

  fs.unlinkSync(authPath);
  fs.mkdirSync(path.join(home, ".workbuddy"), { recursive: true });
  const unnamed = await fetchWorkbuddyLimits({
    home, nowMs: WB_CACHE_T0, env: { HOME: home },
    origin: "https://www.workbuddy.cn",
    fetchImpl: async () => { throw new Error("no network in this test"); },
  });
  assert.equal(unnamed.error, null);
  assert.equal(unnamed.source, "disk-cache");
});

test("cache windows expire by rollover and by the undated snapshot TTL", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const write = (windows) => writeWorkbuddyLimitsCache(
    { configured: true, error: null, plan_label: "Free", primary_window: windows.primary ?? null, secondary_window: windows.secondary ?? null },
    { home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "uid" },
  );
  const read = (nowMs = WB_CACHE_T0) => readWorkbuddyLimitsCache({ home, nowMs, variantId: "workbuddy", identity: "uid" });

  write({ primary: wbCachePlanWindow("2026-07-01T00:00:00Z"), secondary: { used_percent: 10, reset_at: null, used_credits: 1, limit_credits: 10, remaining_credits: 9 } });
  let cached = read();
  assert.equal(cached.primary_window, null);
  assert.equal(cached.secondary_window.limit_credits, 10);

  write({ primary: wbCachePlanWindow("2027-01-01T00:00:00Z") });
  cached = read();
  assert.equal(cached.primary_window.limit_credits, 500);
  assert.equal(cached.secondary_window, null);

  write({ primary: wbCachePlanWindow("2026-07-01T00:00:00Z") });
  assert.equal(read(), null);

  write({ primary: wbCachePlanWindow(null), secondary: { used_percent: 10, reset_at: null, used_credits: 1, limit_credits: 10, remaining_credits: 9 } });
  assert.ok(read(WB_CACHE_T0 + 11 * 60 * 60 * 1000));
  assert.equal(read(WB_CACHE_T0 + 13 * 60 * 60 * 1000), null);
});

test("cache entries are scoped to the identity that wrote them", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  writeWorkbuddyLimitsCache(
    { configured: true, error: null, plan_label: "Free", primary_window: wbCachePlanWindow("2027-01-01T00:00:00Z"), secondary_window: null },
    { home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "uid-a" },
  );
  assert.equal(readWorkbuddyLimitsCache({ home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "uid-b" }), null);
  assert.ok(readWorkbuddyLimitsCache({ home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "uid-a" }));
  assert.equal(readWorkbuddyLimitsCache({ home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "unknown" }), null);
});

test("a cached_at in the future beyond the skew guard is not trusted", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  writeWorkbuddyLimitsCache(
    { configured: true, error: null, plan_label: "Free", primary_window: wbCachePlanWindow("2027-01-01T00:00:00Z"), secondary_window: null },
    { home, nowMs: WB_CACHE_T0 + 10 * 60 * 60 * 1000, variantId: "workbuddy", identity: "uid" },
  );
  assert.equal(readWorkbuddyLimitsCache({ home, nowMs: WB_CACHE_T0, variantId: "workbuddy", identity: "uid" }), null);
  assert.ok(readWorkbuddyLimitsCache({ home, nowMs: WB_CACHE_T0 + 10 * 60 * 60 * 1000 - 30_000, variantId: "workbuddy", identity: "uid" }));
});

test("a window that rolls while the live attempt runs is not served", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-cache-"));
  const authPath = path.join(home, "workbuddy-desktop.info");
  fs.writeFileSync(authPath, wbCacheAuthInfo({ token: "cn-token", uid: "uid-cn" }));
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: WB_CACHE_T0 });
  const live = await fetchWorkbuddyLimits({
    home, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: wbCacheSummary({
      code: 0,
      data: { SubscriptionPackageName: "体验版", Packages: [trialRow({ CycleEndTime: "2026-07-08T00:00:05.000Z" })] },
    }),
  });
  assert.equal(live.error, null);

  const pending = fetchWorkbuddyLimits({
    home, env: { HOME: home }, authFiles: [authPath],
    origin: "https://www.workbuddy.cn",
    fetchImpl: () => new Promise((_, reject) => { setTimeout(() => reject(new Error("offline")), 30_000); }),
  });
  t.mock.timers.tick(60_000);
  await assert.rejects(pending, /offline/);
});

test("the workbuddy budget lets the post-abort cache fallback win", async () => {
  const result = await withWorkbuddyProviderTimeout((signal) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => { setTimeout(() => resolve("cache-hit"), 10); });
  }), "WorkBuddy", 20);
  assert.equal(result, "cache-hit");
});

test("the workbuddy budget still enforces its hard bound", async () => {
  await assert.rejects(
    withWorkbuddyProviderTimeout(() => new Promise(() => {}), "WorkBuddy", 20, 20),
    /timed out/,
  );
});

test("a rejection the budget's abort caused reports the timeout, not the symptom", async () => {
  await assert.rejects(
    withWorkbuddyProviderTimeout((signal) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => { setTimeout(() => reject(new Error("WorkBuddy quota request was cancelled.")), 10); });
    }), "WorkBuddy", 20),
    /timed out/,
  );
});

test("an attempt that settles inside the workbuddy budget is served as-is", async () => {
  const result = await withWorkbuddyProviderTimeout(async () => "live", "WorkBuddy", 30_000);
  assert.equal(result, "live");
});

test("an attempt that rejects inside the workbuddy budget keeps its own error", async () => {
  await assert.rejects(
    withWorkbuddyProviderTimeout(async () => { throw new Error("WorkBuddy quota request failed."); }, "WorkBuddy", 30_000),
    /quota request failed/,
  );
});
