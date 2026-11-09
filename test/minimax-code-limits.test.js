const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  readMinimaxCodeSession,
  parseMinimaxCodePlan,
  fetchMinimaxCodeLimits,
} = require("../src/lib/minimax-code-limits");

const NOW_MS = 1_800_000_000_000;

function writeAuthFixture(home, { region = "cn", token = "mmoat-test-token", expiresAtMs = NOW_MS + 3_600_000, generation = 7, status = "authenticated", scopes = ["agent.default"] } = {}) {
  const dir = path.join(home, ".minimax", "auth", "prod", region, "mcode-public");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "auth.json"), JSON.stringify({
    schemaVersion: 1,
    records: {
      [`com.minimax.mcode.oauth.prod.${region}\u0000fixture-suffix`]: {
        schemaVersion: 1,
        accessToken: token,
        refreshToken: "mmort-fixture",
        tokenType: "Bearer",
        clientId: "mcode-public",
        scopes: {},
        audience: "agent-backend",
        expiresAtMs,
        generation,
        loginEpoch: "fixture-epoch",
      },
    },
  }));
  fs.writeFileSync(path.join(dir, "auth-state.json"), JSON.stringify({
    schemaVersion: 2,
    status,
    storeKind: "file",
    clientId: "mcode-public",
    scopes,
    audience: "agent-backend",
    buildEnv: "prod",
    region,
    generation,
    expiresAtMs,
  }));
  return dir;
}

function mockResponse({ ok = true, status = 200, json = null } = {}) {
  return { ok, status, json: async () => json };
}

function mockFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const route = routes.find((entry) => url.includes(entry.match));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return typeof route.response === "function" ? route.response(url, options) : route.response;
  };
  impl.calls = calls;
  return impl;
}

function happyRoutes() {
  return [
    {
      match: "get_user_extra_info",
      response: mockResponse({ json: { user_extra: {}, workspaces: [{ workspace_id: 0, workspace_type: 0 }, { workspace_id: "ws-team", workspace_type: 1 }], base_resp: { status_code: 0 } } }),
    },
    {
      match: "get_membership_info",
      response: mockResponse({ json: { data: { op_credit_summary: { total_remaining_amount: "4624" }, op_group_id: "grp-123", has_token_plan: true, token_plan_tier: "pro", plan_name: "MiniMax Pro" }, base_resp: { status_code: 0 } } }),
    },
    {
      match: "remains_percent",
      response: mockResponse({ json: { data: { model_remains: [
        { model_name: "general", current_interval_used_percent: "30", current_interval_total_percent: "100", current_interval_status: 1, end_time: 1795000000000, current_weekly_used_percent: "15% ", weekly_end_time: 1795600000000 },
        { model_name: "general-video", current_interval_used_count: "5", current_interval_total_count: "20", end_time: 1795600000000 },
      ] }, base_resp: { status_code: 0 } } }),
    },
  ];
}

test("reads the cn OAuth session and prefers it over en", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode-"));
  writeAuthFixture(home, { region: "en", token: "en-token", expiresAtMs: NOW_MS + 1000 });
  writeAuthFixture(home, { region: "cn", token: "cn-token", expiresAtMs: NOW_MS + 2000 });
  const session = readMinimaxCodeSession({ ...process.env, HOME: home });
  assert.equal(session.accessToken, "cn-token");
  assert.equal(session.region, "cn");
  assert.equal(session.generation, 7);
});

test("generation mismatch falls back to newest lease and a missing session reports not configured", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode2-"));
  const dir = writeAuthFixture(home, { generation: 7 });
  // Rewrite auth.json with two records; only the newer generation matches.
  const authPath = path.join(dir, "auth.json");
  const doc = JSON.parse(fs.readFileSync(authPath, "utf8"));
  const [key] = Object.keys(doc.records);
  doc.records[key].generation = 6;
  doc.records[`${key}-old`] = { accessToken: "stale-token", generation: 6, expiresAtMs: NOW_MS + 999 };
  doc.records[`${key}-new`] = { accessToken: "fresh-token", generation: 7, expiresAtMs: NOW_MS + 5000 };
  fs.writeFileSync(authPath, JSON.stringify(doc));
  const session = readMinimaxCodeSession({ ...process.env, HOME: home });
  assert.equal(session.accessToken, "fresh-token", "the generation-matching record wins");

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode3-"));
  assert.equal(readMinimaxCodeSession({ ...process.env, HOME: empty }), null);
});

test("parseMinimaxCodePlan handles used-percent rows, unlimited status, and video counts", () => {
  const used = parseMinimaxCodePlan({ data: { model_remains: [
    { model_name: "general", current_interval_used_percent: "30", current_interval_total_percent: "100", current_interval_status: 1, end_time: 1795000000000, current_weekly_used_percent: "15% ", weekly_end_time: 1795600000000 },
    { model_name: "general-video", current_interval_used_count: "5", current_interval_total_count: "20", end_time: 1795600000000 },
  ] } });
  assert.equal(used.general.used_percent, 30);
  assert.equal(used.general.weekly_used_percent, 15, "percent strings with a suffix and spaces parse");
  assert.equal(used.video.used, 5);
  assert.equal(used.video.limit, 20);
  assert.equal(used.unlimited, false);

  const unlimited = parseMinimaxCodePlan({ data: { model_remains: [
    { model_name: "general", current_interval_status: 3, end_time: 1795000000000 },
  ] } });
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.general.unlimited, true);
  assert.equal(unlimited.general.used_percent, undefined, "unlimited carries no fake meter value");
});

test("fetchMinimaxCodeLimits renders windows, video, points, and never leaks the token", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode4-"));
  writeAuthFixture(home);
  const fetchImpl = mockFetch(happyRoutes());
  const result = await fetchMinimaxCodeLimits({ home, fetchImpl, nowMs: NOW_MS, env: { ...process.env, HOME: home } });
  assert.equal(result.configured, true);
  assert.equal(result.error, undefined);
  assert.equal(result.primary_window.used_percent, 30);
  assert.equal(result.secondary_window.used_percent, 15);
  assert.equal(result.minimax_code_video_window.limit, 20);
  assert.equal(result.minimax_code_points, 4624, "string points parse to numbers");
  assert.equal(result.plan_name, "MiniMax Pro");
  assert.equal(result.minimax_code_region, "cn");
  // The X-Group-Id header rides only on the remains call.
  const remainsCall = fetchImpl.calls.find((call) => call.url.includes("remains_percent"));
  assert.equal(remainsCall.options.headers["X-Group-Id"], "grp-123");
  // Workspace body carries the personal workspace id as a NUMBER — the
  // commerce endpoints reject stringified ids (HTTP 400) and a real install
  // returns workspace_id: 0 for the personal workspace.
  const membershipCall = fetchImpl.calls.find((call) => call.url.includes("get_membership_info"));
  assert.deepEqual(JSON.parse(membershipCall.options.body), { workspace_id: 0 });
  // Token is never echoed in the result.
  assert.equal(JSON.stringify(result).includes("mmoat-test-token"), false);
});

test("fetchMinimaxCodeLimits maps business codes and HTTP statuses", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode5-"));
  writeAuthFixture(home);

  // Business 1004 on the user-info call = unauthorized.
  const c1004 = await fetchMinimaxCodeLimits({
    home,
    fetchImpl: mockFetch([{ match: "get_user_extra_info", response: mockResponse({ json: { base_resp: { status_code: 1004, status_msg: "invalid token" } } }) }]),
    nowMs: NOW_MS,
    env: { ...process.env, HOME: home },
  });
  assert.match(c1004.error, /expired|unauthorized/i);

  // HTTP 401 on any call = unauthorized.
  const http401 = await fetchMinimaxCodeLimits({
    home,
    fetchImpl: mockFetch([{ match: "get_user_extra_info", response: mockResponse({ ok: false, status: 401 }) }]),
    nowMs: NOW_MS,
    env: { ...process.env, HOME: home },
  });
  assert.match(http401.error, /expired|unauthorized/i);

  // Business 2062 on remains = no token plan: points still render.
  const c2062 = await fetchMinimaxCodeLimits({
    home,
    fetchImpl: mockFetch([
      ...happyRoutes().slice(0, 2),
      { match: "remains_percent", response: mockResponse({ json: { base_resp: { status_code: 2062 } } }) },
    ]),
    nowMs: NOW_MS,
    env: { ...process.env, HOME: home },
  });
  assert.equal(c2062.configured, true);
  assert.equal(c2062.primary_window, null);
  assert.equal(c2062.minimax_code_points, 4624);
});

test("fetchMinimaxCodeLimits refuses locally expired sessions without any network call", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode6-"));
  writeAuthFixture(home, { expiresAtMs: NOW_MS - 1000 });
  const fetchImpl = mockFetch([]);
  const result = await fetchMinimaxCodeLimits({ home, fetchImpl, nowMs: NOW_MS, env: { ...process.env, HOME: home } });
  assert.equal(result.configured, true);
  assert.match(result.error, /expired|re-login/i);
  assert.equal(fetchImpl.calls.length, 0);
});

test("fetchMinimaxCodeLimits reports not configured when no session exists", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mcode7-"));
  const result = await fetchMinimaxCodeLimits({ home, fetchImpl: mockFetch([]), nowMs: NOW_MS, env: { ...process.env, HOME: home } });
  assert.deepEqual(result, { configured: false, error: null });
});
