"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  fetchRaccoonDailyUsage,
  beijingDateKey,
  beijingMidnightMs,
  accumulateBills,
  MAX_PAGES,
} = require("../src/lib/raccoon-daily-usage");

// Fixed clock: 2026-11-09T16:30:00Z = 2026-11-10 00:30 Beijing, so the
// Beijing "today" differs from the UTC day and the boundary math has to
// prove itself across it.
const NOW_MS = Date.parse("2026-11-09T16:30:00Z");
const TODAY_KEY = "2026-11-10";

function writeAuthFixture(home, { token = "rcn-token" } = {}) {
  const file = path.join(home, "auth.json");
  fs.writeFileSync(file, JSON.stringify({ access_token: token, office_identity: {} }));
  return file;
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

function bill({ bizType = "desktop", points = -2, createdAt = "2026-11-10T00:20:00+08:00", grantAt = null } = {}) {
  const out = {
    bill_id: "bill_" + Math.random().toString(36).slice(2),
    biz_type: bizType,
    event_name: bizType,
    points,
    created_at: createdAt,
  };
  if (grantAt) out.grant_at = grantAt;
  return out;
}

function billsPage({ items, hasMore = false, nextCursor = null }) {
  return mockResponse({ json: { code: 0, message: "success", data: { items, has_more: hasMore, ...(nextCursor ? { next_cursor: nextCursor } : {}) } } });
}

function happyRoutes({ balance = { available_points: 9516, daily_points: 2100 } } = {}) {
  return [
    { match: "/v1/balance", response: mockResponse({ json: { code: 0, data: balance } }) },
    {
      match: "/v2/bills",
      response: billsPage({
        items: [
          bill({ bizType: "daily_grant", points: 300, createdAt: "2026-11-10T00:01:00+08:00", grantAt: "2026-11-10T00:00:00+08:00" }),
          bill({ bizType: "desktop", points: -2, createdAt: "2026-11-10T00:20:00+08:00" }),
          // Yesterday's Beijing-evening bill must not leak into today.
          bill({ bizType: "desktop", points: -50, createdAt: "2026-11-09T23:00:00+08:00" }),
          // An expiry is a lapse, not usage.
          bill({ bizType: "daily_expire", points: -300, createdAt: "2026-11-10T00:00:00+08:00" }),
        ],
      }),
    },
  ];
}

function authEnv(home) {
  return { TOKENTRACKER_RACCOON_AUTH_FILE: path.join(home, "auth.json") };
}

test("beijing day helpers: UTC evening maps to the next Beijing day", () => {
  assert.equal(beijingDateKey(NOW_MS), TODAY_KEY);
  const midnight = beijingMidnightMs(TODAY_KEY);
  assert.equal(midnight, Date.parse("2026-11-10T00:00:00+08:00"));
  assert.equal(beijingDateKey(midnight), TODAY_KEY);
});

test("accumulateBills: grants group by grant_at, expiry is not usage", () => {
  const start = Date.parse("2026-11-10T00:00:00+08:00");
  const sums = accumulateBills([
    bill({ bizType: "daily_grant", points: 300, grantAt: "2026-11-10T00:00:00+08:00", createdAt: "2026-11-10T00:01:00+08:00" }),
    bill({ bizType: "reward_grant", points: 1500, createdAt: "2026-11-10T08:00:00+08:00" }),
    bill({ bizType: "desktop", points: -30, createdAt: "2026-11-10T09:00:00+08:00" }),
    bill({ bizType: "daily_expire", points: -300, createdAt: "2026-11-10T00:00:00+08:00" }),
    bill({ bizType: "desktop", points: -99, createdAt: "2026-11-09T23:59:59+08:00" }),
  ], start, start + 24 * 60 * 60 * 1000);
  // Reward grants are not daily quota; the expiry is not usage.
  assert.deepEqual(sums, { grant: 300, used: 30 });
});

test("accumulateBills: consumption groups by created_at even if a grant_at points elsewhere", () => {
  const start = Date.parse("2026-11-10T00:00:00+08:00");
  // Hypothetical future shape: a consumption bill stamped with the grant batch
  // it drew from must not fall back to that older grant day.
  const sums = accumulateBills([
    bill({ bizType: "desktop", points: -12, createdAt: "2026-11-10T10:00:00+08:00", grantAt: "2026-11-04T00:00:00+08:00" }),
  ], start, start + 24 * 60 * 60 * 1000);
  assert.deepEqual(sums, { grant: 0, used: 12 });
});

test("HTTP 200 with a business error code degrades to an honest error", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home);
  const routes = [
    { match: "/v1/balance", response: mockResponse({ json: { code: 0, data: { available_points: 9516, daily_points: 2100 } } }) },
    { match: "/v2/bills", response: mockResponse({ json: { code: 42, message: "tenant mismatch", data: null } }) },
  ];
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl: mockFetch(routes), nowMs: NOW_MS });
  assert.equal(result.configured, true);
  assert.match(result.error, /bills error 42/);
  assert.equal(result.raccoon_daily_usage, undefined);
});

test("no desktop session: the lane stays invisible", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  const result = await fetchRaccoonDailyUsage({ home, env: {}, nowMs: NOW_MS });
  assert.deepEqual(result, { configured: false, error: null });
});

test("happy path: today's grant vs used with cursor paging and balance enrichment", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home);
  const routes = [
    { match: "/v1/balance", response: mockResponse({ json: { code: 0, data: { available_points: 9516, daily_points: 2100 } } }) },
    {
      match: "/v2/bills",
      response: (url) => {
        if (url.includes("cursor=")) {
          return billsPage({
            items: [bill({ bizType: "daily_grant", points: 300, createdAt: "2026-11-10T00:01:00+08:00", grantAt: "2026-11-10T00:00:00+08:00" })],
          });
        }
        return billsPage({
          items: [bill({ bizType: "desktop", points: -2, createdAt: "2026-11-10T00:20:00+08:00" })],
          hasMore: true,
          nextCursor: "cursor-page-2",
        });
      },
    },
  ];
  const fetchImpl = mockFetch(routes);
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl, nowMs: NOW_MS });
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.equal(result.raccoon_daily_usage.date, TODAY_KEY);
  assert.equal(result.raccoon_daily_usage.grant_points, 300);
  assert.equal(result.raccoon_daily_usage.used_points, 2);
  assert.equal(result.raccoon_daily_usage.daily_balance, 2100);
  assert.equal(result.raccoon_daily_usage.available_points, 9516);
  assert.equal(result.raccoon_daily_usage.source, "office-raccoon-desktop");
  const win = result.raccoon_daily_usage_window;
  assert.equal(win.used_percent, (2 / 300) * 100);
  assert.equal(win.used_credits, 2);
  assert.equal(win.limit_credits, 300);
  assert.equal(win.remaining_credits, 298);
  assert.equal(win.unit, "points");
  assert.equal(win.reset_at, Date.parse("2026-11-11T00:00:00+08:00"));
  assert.equal(win.limit_window_seconds, 24 * 60 * 60 * 1000);
  const billCalls = fetchImpl.calls.filter((call) => call.url.includes("/v2/bills"));
  assert.equal(billCalls.length, 2);
  assert.ok(billCalls[1].url.includes("cursor=cursor-page-2"));
});

test("overspend clamps the meter at 100% while the payload keeps raw amounts", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home);
  const routes = [
    {
      match: "/v1/balance",
      response: mockResponse({ json: { code: 0, data: { available_points: 5000, daily_points: 300 } } }),
    },
    {
      match: "/v2/bills",
      response: billsPage({
        items: [
          bill({ bizType: "daily_grant", points: 300, createdAt: "2026-11-10T00:01:00+08:00", grantAt: "2026-11-10T00:00:00+08:00" }),
          bill({ bizType: "desktop", points: -420, createdAt: "2026-11-10T01:00:00+08:00" }),
        ],
      }),
    },
  ];
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl: mockFetch(routes), nowMs: NOW_MS });
  assert.equal(result.raccoon_daily_usage.used_points, 420);
  assert.equal(result.raccoon_daily_usage_window.used_percent, 100);
  assert.equal(result.raccoon_daily_usage_window.remaining_credits, 0);
});

test("no grant today: usage rides along but no window renders", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home);
  const routes = [
    { match: "/v1/balance", response: mockResponse({ json: { code: 0, data: { available_points: 9516, daily_points: 0 } } }) },
    { match: "/v2/bills", response: billsPage({ items: [bill({ bizType: "desktop", points: -5, createdAt: "2026-11-10T00:20:00+08:00" })] }) },
  ];
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl: mockFetch(routes), nowMs: NOW_MS });
  assert.equal(result.raccoon_daily_usage.grant_points, 0);
  assert.equal(result.raccoon_daily_usage.used_points, 5);
  assert.equal(result.raccoon_daily_usage_window, null);
});

test("expired desktop session reports an honest re-login error", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home, { token: "stale-token" });
  const routes = [
    { match: "/v1/balance", response: mockResponse({ status: 401, ok: false }) },
    { match: "/v2/bills", response: mockResponse({ status: 401, ok: false }) },
  ];
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl: mockFetch(routes), nowMs: NOW_MS });
  assert.equal(result.configured, true);
  assert.match(result.error, /re-login/i);
  assert.equal(result.raccoon_daily_usage, undefined);
});

test("paging stops at the today boundary and flags partial past the page cap", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home);
  let pageIndex = 0;
  const routes = [
    {
      match: "/v2/bills",
      response: () => {
        pageIndex += 1;
        return billsPage({
          items: [bill({ bizType: "desktop", points: -1, createdAt: "2026-11-10T00:20:00+08:00" })],
          hasMore: true,
          nextCursor: "cursor-" + pageIndex,
        });
      },
    },
  ];
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl: mockFetch(routes), nowMs: NOW_MS });
  assert.equal(result.raccoon_daily_usage.partial, true);
  assert.equal(result.raccoon_daily_usage.used_points, MAX_PAGES);
  assert.equal(pageIndex, MAX_PAGES);
});

test("a page fully before today ends paging without touching the cap", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-rcn-daily-"));
  writeAuthFixture(home);
  let pageIndex = 0;
  const routes = [
    {
      match: "/v2/bills",
      response: () => {
        pageIndex += 1;
        if (pageIndex === 1) {
          return billsPage({
            items: [bill({ bizType: "desktop", points: -3, createdAt: "2026-11-10T00:20:00+08:00" })],
            hasMore: true,
            nextCursor: "cursor-2",
          });
        }
        return billsPage({
          items: [bill({ bizType: "desktop", points: -9, createdAt: "2026-11-08T10:00:00+08:00" })],
          hasMore: true,
          nextCursor: "cursor-3",
        });
      },
    },
  ];
  const result = await fetchRaccoonDailyUsage({ home, env: authEnv(home), fetchImpl: mockFetch(routes), nowMs: NOW_MS });
  assert.equal(pageIndex, 2);
  assert.equal(result.raccoon_daily_usage.used_points, 3);
  assert.equal(result.raccoon_daily_usage.partial, undefined);
});
