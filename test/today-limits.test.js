const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  TODAY_AUTH_TOKEN_URL,
  TODAY_COOKIE_NAME,
  credentialsPath,
  normalizeTodaySessionCookie,
  isBareTodaySessionToken,
  readCookie,
  writeCookieFile,
  clearCookieFile,
  parseTodayStatus,
  parseTodayResets,
  fetchTodayLimits,
} = require("../src/lib/today-limits.js");

const ACCESS_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0b2RheSJ9.sig";
const SESSION_TOKEN = "cLW84Ig6b5zrqyGtGko6V0Z6nuMwEAeC";
const SIGNED_COOKIE_HEADER =
  "__Secure-better-auth.session_token=cLW4Ig6b5zrqyGtGko6V07EC.0Pt%2FwK9j%2FEI1X46GY2%2FBay0O3KPkwI%2B%3D; " +
  "__Secure-better-auth.session_token.cLW84=cLW84Ig6b5zrqyGtGko6V0Z6nuMwEAeC";

function withHome(t, files = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "today-limits-"));
  // TOKENTRACKER_HOME 若在环境中设置会劫持 credentialsPath——测试内强制清空，
  // 防止把夹具写进真实用户目录（探针写穿历史教训）。
  const savedHomeEnv = process.env.TOKENTRACKER_HOME;
  delete process.env.TOKENTRACKER_HOME;
  t.after(() => {
    if (savedHomeEnv === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = savedHomeEnv;
    fs.rmSync(home, { recursive: true, force: true });
  });
  for (const [name, body] of Object.entries(files)) {
    // 凭据文件按库自己的路径规则落位（home/.tokentracker/…），不猜目录。
    const target = name === "today-cn-credentials.json" ? credentialsPath(home) : path.join(home, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, { mode: 0o600 });
  }
  return home;
}

function statusBody(progress = 26) {
  return {
    success: true,
    data: {
      status: {
        plan: "pro",
        entitlementEndsAt: "2027-01-26T23:56:13.712Z",
        display: { title: "Pro" },
        usage: {
          period: "monthly",
          resetAt: "2026-11-26T23:56:13.712Z",
          progress,
          breakdown: {
            items: [
              { key: "tasks", usedPercent: 11, display: { title: "Complex tasks" } },
              { key: "scheduled_tasks", usedPercent: 9, display: { title: "Scheduled Tasks" } },
            ],
          },
        },
      },
    },
  };
}

function resetsBody(count) {
  return {
    success: true,
    data: { items: Array.from({ length: count }, (_, i) => ({ resetId: "r" + i, expiresAt: "2199-12-31T15:59:59Z" })), totalCount: count },
  };
}

// fetchImpl stub: routes by URL and asserts the bearer chain.
function stubFetch(t, handlers) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url: String(url), headers: options.headers || {} });
    const route = handlers.find((h) => h.match.test(String(url)));
    if (!route) throw new Error("unexpected fetch: " + url);
    return route.respond(calls.length, options);
  };
  t.after(() => { /* nothing to dispose */ });
  return { impl, calls };
}

test("normalizeTodaySessionCookie keeps session pairs verbatim and ignores strangers", () => {
  const header = normalizeTodaySessionCookie(SIGNED_COOKIE_HEADER);
  assert.match(header, /__Secure-better-auth\.session_token=cLW4Ig6b5zrqyGtGko6V07EC\.0Pt%2FwK9j%2FEI1X46GY2%2FBay0O3KPkwI%2B%3D/);
  assert.match(header, /__Secure-better-auth\.session_token\.cLW84=cLW84Ig6b5zrqyGtGko6V0Z6nuMwEAeC/);
  // 多行粘贴（DevTools Application 一行一个）同样归一。
  const multiline = normalizeTodaySessionCookie(SIGNED_COOKIE_HEADER.replace(/; /g, "\n"));
  assert.equal(header, multiline);
  // 非会话 cookie 不进头。
  assert.equal(normalizeTodaySessionCookie("other=1; another=2"), "");
});

test("isBareTodaySessionToken accepts the bare token and rejects signed envelopes", () => {
  assert.equal(isBareTodaySessionToken(SESSION_TOKEN), true);
  assert.equal(isBareTodaySessionToken("cLW4.sig.part"), false);
  assert.equal(isBareTodaySessionToken("short"), false);
});

test("credential precedence: saved file wins over env; invalid file never falls through", (t) => {
  const home = withHome(t, { "today-cn-credentials.json": JSON.stringify({ cookie: SIGNED_COOKIE_HEADER }) });
  const read = readCookie(home, { TOKENTRACKER_TODAY_COOKIE: "should-not-win" });
  assert.equal(read.cookieHeader, true);
  assert.match(read.cookie, /__Secure-better-auth\.session_token=cLW4Ig6b5zrqyGtGko6V07EC\.0Pt%2FwK9j/);
  assert.equal(read.source, "file");

  const bad = withHome(t, { "today-cn-credentials.json": JSON.stringify({ cookie: "garbage !! nope" }) });
  const invalid = readCookie(bad, { TOKENTRACKER_TODAY_COOKIE: SESSION_TOKEN });
  assert.equal(invalid.cookie, "");
  assert.equal(invalid.source, "file-invalid");

  const missing = withHome(t);
  const envRead = readCookie(missing, { TOKENTRACKER_TODAY_COOKIE: SESSION_TOKEN });
  assert.equal(envRead.source, "env");
});

test("write/clear round-trip stores 0600 credentials and rejects junk", (t) => {
  const home = withHome(t);
  const saved = writeCookieFile({ home, cookie: SIGNED_COOKIE_HEADER });
  assert.equal(saved.saved, true);
  const raw = fs.readFileSync(credentialsPath(home), "utf8");
  assert.match(raw, /"cookie"/);
  assert.equal(writeCookieFile({ home, cookie: "junk" }).saved, false);
  clearCookieFile({ home });
  assert.equal(fs.existsSync(credentialsPath(home)), false);
});

test("full chain: cookie intake → get-session → exchange → status+resets windows", async (t) => {
  const home = withHome(t, { "today-cn-credentials.json": JSON.stringify({ cookie: SIGNED_COOKIE_HEADER }) });
  const { impl, calls } = stubFetch(t, [
    {
      match: /auth\.todayai\.cn\/api\/auth\/get-session/,
      respond: () => ({ ok: true, json: async () => ({ session: { token: SESSION_TOKEN } }) }),
    },
    {
      match: /auth\.todayai\.cn\/api\/auth\/token/,
      respond: () => ({ ok: true, json: async () => ({ token: ACCESS_JWT }) }),
    },
    { match: /\/v1\/pricing\/status/, respond: () => ({ ok: true, json: async () => statusBody(26) }) },
    { match: /\/v1\/pricing\/resets/, respond: () => ({ ok: true, json: async () => resetsBody(1) }) },
  ]);
  const result = await fetchTodayLimits({ home, fetchImpl: impl });
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.equal(result.plan_name, "Today Pro");
  assert.equal(result.primary_window.used_percent, 26);
  assert.equal(result.primary_window.limit, 100);
  assert.equal(result.primary_window.percent_only, true);
  assert.equal(result.today_resets, 1);
  assert.equal(result.feature_windows.length, 2);
  // 请求顺序：get-session → token（Bearer 会话令牌）→ status/resets（Bearer JWT）。
  assert.match(calls[0].url, /get-session/);
  assert.equal(calls[0].headers.Cookie, SIGNED_COOKIE_HEADER);
  assert.equal(calls[1].headers.Authorization, "Bearer " + SESSION_TOKEN);
  assert.equal(calls[2].headers.Authorization, "Bearer " + ACCESS_JWT);
});

test("bare token intake skips get-session and goes straight to the exchange", async (t) => {
  const home = withHome(t, { "today-cn-credentials.json": JSON.stringify({ cookie: SESSION_TOKEN }) });
  const { impl, calls } = stubFetch(t, [
    { match: /\/api\/auth\/token/, respond: () => ({ ok: true, json: async () => ({ token: ACCESS_JWT }) }) },
    { match: /\/v1\/pricing\/status/, respond: () => ({ ok: true, json: async () => statusBody(10) }) },
    { match: /\/v1\/pricing\/resets/, respond: () => ({ ok: true, json: async () => resetsBody(0) }) },
  ]);
  const result = await fetchTodayLimits({ home, fetchImpl: impl });
  assert.equal(result.error, null);
  assert.equal(result.primary_window.used_percent, 10);
  assert.equal(calls.some((c) => /get-session/.test(c.url)), false);
});

test("expired/unauthorized sessions surface as a re-paste error, not silent failure", async (t) => {
  const home = withHome(t, { "today-cn-credentials.json": JSON.stringify({ cookie: SIGNED_COOKIE_HEADER }) });
  const { impl } = stubFetch(t, [
    { match: /get-session/, respond: () => ({ ok: false, status: 401, json: async () => ({}) }) },
  ]);
  const result = await fetchTodayLimits({ home, fetchImpl: impl });
  assert.equal(result.configured, true);
  assert.match(result.error, /expired or unauthorized/);
});

test("changed shapes are malformed — no partial numbers from a drifted API", async (t) => {
  const home = withHome(t, { "today-cn-credentials.json": JSON.stringify({ cookie: SIGNED_COOKIE_HEADER }) });
  const { impl } = stubFetch(t, [
    { match: /get-session/, respond: () => ({ ok: true, json: async () => ({ session: { token: SESSION_TOKEN } }) }) },
    { match: /\/api\/auth\/token/, respond: () => ({ ok: true, json: async () => ({ token: ACCESS_JWT }) }) },
    // progress 缺失（换成了别的计量字段）→ 整体 malformed。
    { match: /\/v1\/pricing\/status/, respond: () => ({ ok: true, json: async () => ({ data: { status: { usage: {} } } }) }) },
    { match: /\/v1\/pricing\/resets/, respond: () => ({ ok: true, json: async () => resetsBody(1) }) },
  ]);
  const result = await fetchTodayLimits({ home, fetchImpl: impl });
  assert.match(result.error, /malformed or lacks quota windows/);
});

test("not configured when no cookie exists anywhere", async (t) => {
  const home = withHome(t);
  const result = await fetchTodayLimits({ home, fetchImpl: async () => { throw new Error("should not fetch"); } });
  assert.deepEqual(result, { configured: false, error: null });
});
