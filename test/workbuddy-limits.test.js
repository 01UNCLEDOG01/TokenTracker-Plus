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
  selectWorkbuddyPlanQuota,
  selectWorkbuddyLimits,
  VARIANTS,
} = require("../src/lib/workbuddy-limits");

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
