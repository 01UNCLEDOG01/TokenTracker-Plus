"use strict";

// The APIGOTO provider (docs/apigoto-api-recon.md): a refresh-token session
// renews the 24h Bearer JWT, and the weekly quota lives in
// /user/subscription/policy-limit's usage_limits[] — the same array the panel
// renders as "订阅额度 98%".

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchApigotoLimits } = require("../src/lib/apigoto-limits");

const ACCESS_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjQxMDI0NDQ4MDB9.sig";

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-apigoto-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test("reports unconfigured without a credentials file", async () => {
  const home = sandbox();
  const result = await fetchApigotoLimits({ home, fetchImpl: async () => { throw new Error("must not fetch"); } });
  assert.equal(result.configured, false);
});

test("refreshes then returns the weekly window with percent and reset", async () => {
  const home = sandbox();
  fs.writeFileSync(path.join(home, ".tokentracker", "apigoto-credentials.json"), JSON.stringify({
    refresh_token: "rt-old",
  }));

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ?? null, auth: options.headers?.Authorization ?? null });
    if (url.endsWith("/user/refresh")) {
      return jsonResponse({ code: 0, data: { access_token: ACCESS_JWT, refresh_token: "rt-new" } });
    }
    if (url.endsWith("/subscription/policy-limit")) {
      return jsonResponse({ code: 0, data: {
        policy_name: "APIGOTO PLUS",
        usage_limits: [{ dim: "f", window_sec: 604800, used: 98179050.86, limit: 100000000, reset_at: 1792146995 }],
      } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await fetchApigotoLimits({ home, fetchImpl, nowMs: Date.now() });
  assert.equal(result.configured, true);
  assert.equal(result.configured, true);
  assert.equal(result.plan_name, "APIGOTO PLUS");
  assert.equal(result.primary_window.used_percent, 98);
  assert.equal(result.primary_window.reset_at, "2026-10-16T10:36:35.000Z");
  assert.equal(result.primary_window.limit_window_seconds, 604800);

  // The refresh ran once with the stored token and the new pair was persisted.
  assert.equal(calls[0].url.endsWith("/user/refresh"), true);
  assert.deepEqual(JSON.parse(calls[0].body), { refresh_token: "rt-old" });
  const persisted = JSON.parse(fs.readFileSync(path.join(home, ".tokentracker", "apigoto-credentials.json"), "utf8"));
  assert.equal(persisted.access_token, ACCESS_JWT);
  assert.equal(persisted.refresh_token, "rt-new");
  assert.ok(Number.isFinite(persisted.access_exp_ms) && persisted.access_exp_ms > Date.now());
});

test("reuses a live access token instead of refreshing every poll", async () => {
  const home = sandbox();
  fs.writeFileSync(path.join(home, ".tokentracker", "apigoto-credentials.json"), JSON.stringify({
    access_token: ACCESS_JWT,
    refresh_token: "rt-kept",
    access_exp_ms: Date.now() + 3600 * 1000,
  }));

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url.endsWith("/subscription/policy-limit")) {
      return jsonResponse({ code: 0, data: { usage_limits: [{ dim: "f", window_sec: 604800, used: 1, limit: 100, reset_at: 1792146995 }] } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const result = await fetchApigotoLimits({ home, fetchImpl, nowMs: Date.now() });
  assert.equal(result.primary_window.used_percent, 1);
  // The poll now also carries the subscription identity read; neither call
  // may be a token refresh while the stored access token is live.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].endsWith("/subscription/policy-limit"), true);
  assert.equal(calls[1].endsWith("/subscription/current"), true);
});

test("surfaces a stale marker when the panel returns no usage window", async () => {
  const home = sandbox();
  fs.writeFileSync(path.join(home, ".tokentracker", "apigoto-credentials.json"), JSON.stringify({
    access_token: ACCESS_JWT,
    refresh_token: "rt",
    access_exp_ms: Date.now() + 3600 * 1000,
  }));
  const result = await fetchApigotoLimits({
    home,
    fetchImpl: async () => jsonResponse({ code: 0, data: { policy_name: "APIGOTO PLUS", usage_limits: [] } }),
  });
  assert.equal(result.configured, true);
  assert.equal(result.configured, true);
  assert.match(result.error, /no usage window/);
});

// The subscription identity (/user/subscription/current, verified live
// 2026-10-22) feeds an expiry row paced by elapsed period — RouterCode PLUS's
// own lifetime, not a quota window.

function credsSandbox() {
  const home = sandbox();
  fs.writeFileSync(path.join(home, ".tokentracker", "apigoto-credentials.json"), JSON.stringify({
    access_token: ACCESS_JWT,
    refresh_token: "rt",
    access_exp_ms: Date.now() + 3600 * 1000,
  }));
  return home;
}

function subscriptionFetchImpl({ policyLimit, current }) {
  return async (url) => {
    if (url.endsWith("/subscription/policy-limit")) return jsonResponse(policyLimit);
    if (url.endsWith("/subscription/current")) return jsonResponse(current);
    throw new Error(`unexpected fetch ${url}`);
  };
}

test("builds the subscription expiry row from the current-subscription endpoint", async () => {
  const startedMs = Date.parse("2026-10-09T09:30:40Z");
  const expiresMs = Date.parse("2026-11-09T09:30:40Z");
  // The injected clock sits inside the subscription period; the stored access
  // token must still be live against THAT clock, not the real one.
  const nowMs = startedMs + Math.round((expiresMs - startedMs) * 0.6);
  const home = sandbox();
  fs.writeFileSync(path.join(home, ".tokentracker", "apigoto-credentials.json"), JSON.stringify({
    access_token: ACCESS_JWT,
    refresh_token: "rt",
    access_exp_ms: nowMs + 3600 * 1000,
  }));
  try {
    const result = await fetchApigotoLimits({
      home,
      fetchImpl: subscriptionFetchImpl({
        policyLimit: { code: 0, data: { policy_name: "APIGOTO PLUS", usage_limits: [{ dim: "f", window_sec: 604800, used: 23, limit: 100, reset_at: 1792146995 }] } },
        // Microsecond fractional seconds, exactly what the live endpoint returns.
        current: { code: 0, data: { plan_name: "RouterCode PLUS", status: "active", started_at: "2026-10-09T09:30:40.222837Z", expires_at: new Date(expiresMs).toISOString().replace("Z", "000000Z") } },
      }),
      nowMs,
    });
    assert.equal(result.configured, true);
    assert.equal(result.secondary_window.used_percent, 60);
    assert.equal(new Date(result.secondary_window.reset_at).getTime(), expiresMs);
    assert.equal(result.secondary_window.subscription_plan_name, "RouterCode PLUS");
  } finally {
    cleanup(home);
  }
});

test("keeps the quota window when the subscription endpoint blips", async () => {
  const home = credsSandbox();
  try {
    const result = await fetchApigotoLimits({
      home,
      fetchImpl: async (url) => {
        if (url.endsWith("/subscription/policy-limit")) {
          return jsonResponse({ code: 0, data: { policy_name: "APIGOTO PLUS", usage_limits: [{ dim: "f", window_sec: 604800, used: 23, limit: 100, reset_at: 1792146995 }] } });
        }
        throw new Error("current endpoint down");
      },
      nowMs: Date.now(),
    });
    assert.equal(result.configured, true);
    assert.equal(result.primary_window.used_percent, 23);
    assert.equal(result.secondary_window, undefined);
    assert.equal(result.error, undefined);
  } finally {
    cleanup(home);
  }
});

test("omits the expiry row for a non-active subscription", async () => {
  const home = credsSandbox();
  try {
    const result = await fetchApigotoLimits({
      home,
      fetchImpl: subscriptionFetchImpl({
        policyLimit: { code: 0, data: { policy_name: "APIGOTO PLUS", usage_limits: [{ dim: "f", window_sec: 604800, used: 23, limit: 100, reset_at: 1792146995 }] } },
        current: { code: 0, data: { plan_name: "RouterCode PLUS", status: "expired", started_at: "2026-09-09T00:00:00Z", expires_at: "2026-10-01T00:00:00Z" } },
      }),
      nowMs: Date.now(),
    });
    assert.equal(result.configured, true);
    assert.equal(result.secondary_window, undefined);
  } finally {
    cleanup(home);
  }
});
