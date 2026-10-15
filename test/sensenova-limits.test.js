"use strict";

// The SenseNova provider (docs/sensenova-api-recon.md): a browser-captured
// OIDC refresh token renews the 3h Bearer JWT against signin.sensecore.cn, and
// the quotas live in /lite/console/v1/tokenplan/pool-usage (two pools, each
// with a 5h and a 7d window, plus granted credits).
//
// The refresh token is SINGLE-USE — every refresh returns a replacement and the
// old one stops working — so the tests below pin that the new value is adopted
// and written back, and that a blip serves the last good snapshot.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchSensenovaLimits } = require("../src/lib/sensenova-limits");

const ACCESS_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.sig";

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-sensenova-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function credsFile(home) {
  return path.join(home, ".tokentracker", "sensenova-credentials.json");
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function poolUsageBody() {
  return {
    plan: { id: "free", name: "Free Plan" },
    pools: [
      {
        name: "通用积分池",
        pool_type: "default",
        window_5h: { limit: "60000", used: "0", remaining: "60000", reset_at: "1792069830" },
        window_7d: { limit: "600000", used: "150000", remaining: "450000", reset_at: "1792577430" },
        grant_balance: "519.696",
        nearest_grant_expiry: "1794222000",
      },
      {
        name: "Flash-Lite积分池",
        pool_type: "dedicated",
        window_5h: { limit: "60000", used: "30000", remaining: "30000", reset_at: "1792069830" },
        window_7d: { limit: "600000", used: "0", remaining: "600000", reset_at: "1792577430" },
        grant_balance: "0",
        nearest_grant_expiry: "0",
      },
    ],
  };
}

test("reports unconfigured without a credentials file", async () => {
  const home = sandbox();
  const result = await fetchSensenovaLimits({ home, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.configured, false);
  assert.equal(result.error, null);
});

test("refreshes, maps both pools' windows and scales granted credits", async () => {
  const home = sandbox();
  fs.writeFileSync(credsFile(home), JSON.stringify({ refresh_token: "rt-old" }));

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ?? null, auth: options.headers?.Authorization ?? null });
    if (String(url).endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: ACCESS_JWT, refresh_token: "rt-new", expires_in: 10800 });
    }
    if (String(url).endsWith("/tokenplan/pool-usage")) {
      return jsonResponse(poolUsageBody());
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await fetchSensenovaLimits({ home, fetchImpl, nowMs: Date.now() });
  assert.equal(result.configured, true);
  assert.equal(result.plan_name, "Free Plan");
  // General pool: 5h untouched, 7d a quarter spent.
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.limit, 60000);
  assert.equal(result.secondary_window.used_percent, 25);
  assert.equal(result.secondary_window.limit_window_seconds, 604800);
  // Flash-Lite pool: 5h half spent, 7d untouched.
  assert.equal(result.tertiary_window.used_percent, 50);
  assert.equal(result.quaternary_window.used_percent, 0);
  // Grants: the API quotes thousands, the console shows credits.
  assert.equal(result.grant_credits, 519696);
  assert.equal(result.grant_expires_at, new Date(1794222000 * 1000).toISOString());
  assert.equal(calls.filter((c) => c.url.endsWith("/oauth2/token")).length, 1);
  assert.match(calls.find((c) => c.url.endsWith("/pool-usage")).auth, /^Bearer /);
});

test("adopts the rotated refresh token (single-use) and reuses a fresh access token", async () => {
  const home = sandbox();
  fs.writeFileSync(credsFile(home), JSON.stringify({ refresh_token: "rt-old" }));

  const fetchImpl = async (url) => {
    if (String(url).endsWith("/oauth2/token")) {
      return jsonResponse({ access_token: ACCESS_JWT, refresh_token: "rt-rotated", expires_in: 10800 });
    }
    return jsonResponse(poolUsageBody());
  };
  await fetchSensenovaLimits({ home, fetchImpl, nowMs: Date.now() });

  const stored = JSON.parse(fs.readFileSync(credsFile(home), "utf8"));
  assert.equal(stored.refresh_token, "rt-rotated");
  assert.equal(stored.access_token, ACCESS_JWT);
  assert.ok(stored.access_exp_ms > Date.now());

  // The stored access token is still fresh, so the next poll must not refresh.
  let tokenCalls = 0;
  const second = await fetchSensenovaLimits({
    home,
    fetchImpl: async (url) => {
      if (String(url).endsWith("/oauth2/token")) tokenCalls += 1;
      return jsonResponse(poolUsageBody());
    },
    nowMs: Date.now(),
  });
  assert.equal(second.configured, true);
  assert.equal(tokenCalls, 0);
});

test("serves the last good snapshot when a poll blips", async () => {
  const home = sandbox();
  fs.writeFileSync(credsFile(home), JSON.stringify({ refresh_token: "rt-old" }));
  const ok = async (url) =>
    String(url).endsWith("/oauth2/token")
      ? jsonResponse({ access_token: ACCESS_JWT, refresh_token: "rt-1", expires_in: 10800 })
      : jsonResponse(poolUsageBody());
  await fetchSensenovaLimits({ home, fetchImpl: ok, nowMs: Date.now() });

  const stale = await fetchSensenovaLimits({
    home,
    fetchImpl: async () => { throw new Error("network down"); },
    nowMs: Date.now(),
  });
  assert.equal(stale.configured, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.plan_name, "Free Plan");
  assert.equal(stale.secondary_window.used_percent, 25);
});

test("surfaces the sign-in failure when the refresh token is dead and nothing was cached", async () => {
  const home = sandbox();
  fs.writeFileSync(credsFile(home), JSON.stringify({ refresh_token: "rt-dead" }));
  const result = await fetchSensenovaLimits({
    home,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "invalid_grant" }) }),
    nowMs: Date.now(),
  });
  assert.equal(result.configured, true);
  assert.match(result.error, /sign-in expired/i);
});
