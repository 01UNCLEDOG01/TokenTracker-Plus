"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");

const { getUsageLimits, resetUsageLimitsCache } = require("./helpers/usage-limits");

const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const TOKEN_URL = "https://auth.x.ai/oauth2/token";

function b64url(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// A JWT-shaped access token: the cache partition key is the unverified `sub`
// claim, so the fixture must be a real three-segment token.
function fakeGrokJwt(sub) {
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url({ sub })}.${b64url({ sig: 1 })}`;
}

function writeGrokAuth(home, sub, { expiresAt = Date.now() + 3_600_000, refreshToken = "grok-refresh" } = {}) {
  fs.mkdirSync(path.join(home, ".grok"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".grok", "auth.json"),
    JSON.stringify({
      default: {
        key: fakeGrokJwt(sub),
        refresh_token: refreshToken,
        expires_at: new Date(expiresAt).toISOString(),
      },
    }),
    { mode: 0o600 },
  );
}

function futureIso(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function billingBody() {
  return {
    subscriptionTier: "supergrok",
    config: {
      currentPeriod: { start: futureIso(-24), end: futureIso(24 * 3), type: "weekly" },
      creditUsagePercent: 42,
      productUsage: [{ product: "grok-code", usagePercent: 30 }],
    },
  };
}

const okResponse = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
});

const errorResponse = (status) => ({
  ok: false,
  status,
  json: async () => ({}),
});

function grokFetchImpl({ billing, token } = {}) {
  return (url) => {
    if (url === BILLING_URL) return Promise.resolve().then(billing);
    if (url === TOKEN_URL) return Promise.resolve().then(token || (() => errorResponse(500)));
    return Promise.resolve(errorResponse(500));
  };
}

function baseOptions(home, overrides = {}) {
  return {
    home,
    // Empty env: GROK_HOME / TOKENTRACKER_GROK_HOME in the host environment
    // would silently redirect both the fetch side and the cache out of the
    // temp home.
    env: {},
    providerTimeoutMs: 2000,
    securityRunner: () => ({ status: 1, stdout: "" }),
    commandRunner: () => ({ status: 1, stdout: "" }),
    ...overrides,
  };
}

function cachePath(home) {
  return path.join(home, ".tokentracker", "tracker", "grok-usage-limits-cache.json");
}

function seedGrokCache(home, sub, entry) {
  fs.mkdirSync(path.dirname(cachePath(home)), { recursive: true });
  fs.writeFileSync(
    cachePath(home),
    JSON.stringify({ grok: { identity: sub, ...entry } }),
  );
}

describe("Grok limits disk-cache fallback", () => {
  beforeEach(() => {
    resetUsageLimitsCache();
  });

  it("persists a live read and serves it stale when a later fetch fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-grok-cache-"));
    try {
      writeGrokAuth(home, "grok-sub-a");
      const live = await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => okResponse(billingBody()) }),
      }));
      assert.equal(live.grok.configured, true);
      assert.equal(live.grok.error, null);
      assert.equal(live.grok.stale, false);
      assert.equal(live.grok.primary_window.used_percent, 42);
      assert.equal(live.grok.plan_label, "SuperGrok");
      assert.equal(live.grok.provenance.source, "provider-api");
      assert.ok(!("cache_identity" in live.grok), "internal identity marker must not reach the payload");

      // Pin the on-disk schema: identity-stamped entry with the render fields.
      const disk = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
      assert.equal(disk.grok.identity, "grok-sub-a");
      assert.equal(disk.grok.primary_window.used_percent, 42);
      assert.deepEqual(Object.keys(disk.grok).sort(), [
        "billing_period_start", "cached_at", "credit_usage_percent", "identity",
        "monthly_credits_limit", "monthly_credits_used", "on_demand_cap",
        "on_demand_used", "period_type", "plan_label", "primary_window",
        "products", "secondary_window",
      ]);

      resetUsageLimitsCache();
      const stale = await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => errorResponse(503) }),
      }));
      assert.equal(stale.grok.configured, true);
      assert.equal(stale.grok.error, null, "stale cache must be served instead of a red error");
      assert.equal(stale.grok.stale, true);
      assert.equal(stale.grok.primary_window.used_percent, 42);
      assert.equal(stale.grok.cached_at, live.grok.cached_at, "stale read must preserve the original cached_at");
      assert.equal(stale.grok.provenance.source, "disk-cache");
      assert.ok(!("cache_identity" in stale.grok));
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not hide a re-auth error behind stale cache", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-grok-cache-"));
    try {
      writeGrokAuth(home, "grok-sub-a");
      await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => okResponse(billingBody()) }),
      }));
      resetUsageLimitsCache();

      // An expired access token with no refresh capability lets billing
      // decide; a 401 there (GROK_AUTH_REQUIRED) is a dead login and must
      // surface, not stale bars.
      writeGrokAuth(home, "grok-sub-a", { expiresAt: 1, refreshToken: "" });
      const expired = await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => errorResponse(401) }),
      }));
      assert.equal(expired.grok.configured, true);
      assert.notEqual(expired.grok.error, null);
      assert.notEqual(expired.grok.stale, true);
      assert.ok(!("auth_error" in expired.grok), "internal auth marker must not reach the payload");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses a cache entry from a different account (identity partition)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-grok-cache-"));
    try {
      writeGrokAuth(home, "grok-sub-a");
      await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => okResponse(billingBody()) }),
      }));
      resetUsageLimitsCache();

      // A different login must never inherit the previous account's bars.
      writeGrokAuth(home, "grok-sub-b");
      const switched = await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => errorResponse(503) }),
      }));
      assert.notEqual(switched.grok.error, null, "another account's cache must not serve");
      assert.notEqual(switched.grok.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("drops cached windows whose reset has passed and entries past max age", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-grok-cache-"));
    try {
      writeGrokAuth(home, "grok-sub-a");

      seedGrokCache(home, "grok-sub-a", {
        plan_label: "SuperGrok",
        period_type: "weekly",
        primary_window: { used_percent: 10, reset_at: futureIso(-1) },
        secondary_window: null,
        products: [],
        cached_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      resetUsageLimitsCache();
      const expiredReset = await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => errorResponse(503) }),
      }));
      assert.notEqual(expiredReset.grok.error, null, "a window past its reset is stale data, not a fallback");

      seedGrokCache(home, "grok-sub-a", {
        plan_label: "SuperGrok",
        period_type: "weekly",
        primary_window: { used_percent: 10, reset_at: futureIso(24) },
        secondary_window: null,
        products: [],
        cached_at: new Date(Date.now() - 8 * 24 * 3_600_000).toISOString(),
      });
      resetUsageLimitsCache();
      const tooOld = await getUsageLimits(baseOptions(home, {
        fetchImpl: grokFetchImpl({ billing: () => errorResponse(503) }),
      }));
      assert.notEqual(tooOld.grok.error, null, "an entry past the 7-day max age must not serve");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
