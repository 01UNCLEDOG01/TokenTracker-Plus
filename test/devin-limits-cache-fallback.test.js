"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");

const { getUsageLimits, resetUsageLimitsCache } = require("./helpers/usage-limits");
const { resolveDevinCacheIdentity } = require("../src/lib/devin-limits");

const PLAN_URL =
  "https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus";

function futureIso(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function futureUnixSec(hours) {
  return Math.floor((Date.now() + hours * 3_600_000) / 1000);
}

// The token value must change across rewrites along with the file size, so the
// credential-file revision (the cache partition key) provably changes.
function writeDevinCredentials(xdg, token, { pad = "" } = {}) {
  const dir = path.join(xdg, "devin");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "credentials.toml"),
    `windsurf_api_key = "${token}"${pad}\n`,
    { mode: 0o600 },
  );
}

function planBody() {
  return {
    planStatus: {
      planInfo: { planName: "Pro", billingStrategy: "BILLING_STRATEGY_QUOTA" },
      dailyQuotaRemainingPercent: 70,
      dailyQuotaResetAtUnix: futureUnixSec(20),
      weeklyQuotaRemainingPercent: 40,
      weeklyQuotaResetAtUnix: futureUnixSec(24 * 5),
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

function baseOptions(home, env, overrides = {}) {
  return {
    home,
    env,
    devinEnabled: true,
    providerTimeoutMs: 2000,
    securityRunner: () => ({ status: 1, stdout: "" }),
    commandRunner: () => ({ status: 1, stdout: "" }),
    ...overrides,
  };
}

function cachePath(home) {
  return path.join(home, ".tokentracker", "tracker", "devin-usage-limits-cache.json");
}

function seedDevinCache(home, identity, entry) {
  fs.mkdirSync(path.dirname(cachePath(home)), { recursive: true });
  fs.writeFileSync(
    cachePath(home),
    JSON.stringify({ devin: { identity, ...entry } }),
  );
}

// The seeded identity must match what the live fetch captures for the same
// file — derive it through the production resolver, not a local re-derivation
// that could drift and green-light a broken partition.
function credentialRevision(xdg) {
  return resolveDevinCacheIdentity({ home: undefined, env: { XDG_DATA_HOME: xdg } });
}

describe("Devin limits disk-cache fallback", () => {
  beforeEach(() => {
    resetUsageLimitsCache();
  });

  it("persists a live read and serves it stale when a later fetch fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-devin-cache-"));
    const xdg = path.join(home, "xdg");
    try {
      writeDevinCredentials(xdg, "dev-token-a");
      const env = { XDG_DATA_HOME: xdg };
      const live = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? okResponse(planBody()) : errorResponse(500)),
      }));
      assert.equal(live.devin.configured, true);
      assert.equal(live.devin.error, null);
      assert.equal(live.devin.stale, false);
      assert.equal(live.devin.plan_label, "Pro");
      assert.equal(live.devin.primary_window.used_percent, 30);
      assert.equal(live.devin.secondary_window.used_percent, 60);
      assert.equal(live.devin.provenance.source, "provider-api");
      assert.ok(!("cache_identity" in live.devin), "internal identity marker must not reach the payload");

      const disk = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
      assert.equal(disk.devin.identity, credentialRevision(xdg));
      assert.equal(disk.devin.primary_window.used_percent, 30);
      assert.deepEqual(Object.keys(disk.devin).sort(), [
        "cached_at", "identity", "plan_label", "primary_window", "secondary_window",
      ]);

      resetUsageLimitsCache();
      const stale = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? errorResponse(503) : errorResponse(500)),
      }));
      assert.equal(stale.devin.configured, true);
      assert.equal(stale.devin.error, null, "stale cache must be served instead of a red error");
      assert.equal(stale.devin.stale, true);
      assert.equal(stale.devin.primary_window.used_percent, 30);
      assert.equal(stale.devin.cached_at, live.devin.cached_at, "stale read must preserve the original cached_at");
      assert.equal(stale.devin.provenance.source, "disk-cache");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not hide an expired sign-in (401) behind stale cache", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-devin-cache-"));
    const xdg = path.join(home, "xdg");
    try {
      writeDevinCredentials(xdg, "dev-token-a");
      const env = { XDG_DATA_HOME: xdg };
      await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? okResponse(planBody()) : errorResponse(500)),
      }));
      resetUsageLimitsCache();

      const rejected = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? errorResponse(401) : errorResponse(500)),
      }));
      assert.equal(rejected.devin.configured, true);
      assert.match(rejected.devin.error, /sign-in expired|devin auth login/i);
      assert.equal(rejected.devin.auth_action_required, "reauth");
      assert.notEqual(rejected.devin.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not hide a persistent HTTP 400 rejection behind stale cache", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-devin-cache-"));
    const xdg = path.join(home, "xdg");
    try {
      writeDevinCredentials(xdg, "dev-token-a");
      const env = { XDG_DATA_HOME: xdg };
      await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? okResponse(planBody()) : errorResponse(500)),
      }));
      resetUsageLimitsCache();

      // 429/5xx qualify for the fallback; a 400 is an ambiguous or persistent
      // rejection the live error must surface (upstream PR 995).
      const rejected = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? errorResponse(400) : errorResponse(500)),
      }));
      assert.equal(rejected.devin.configured, true);
      assert.match(rejected.devin.error, /HTTP 400/);
      assert.notEqual(rejected.devin.stale, true);

      resetUsageLimitsCache();
      const throttled = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? errorResponse(429) : errorResponse(500)),
      }));
      assert.equal(throttled.devin.stale, true, "429 is a blip the cache may cover");
      assert.equal(throttled.devin.error, null);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses a cache entry after the credentials file changed (revision partition)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-devin-cache-"));
    const xdg = path.join(home, "xdg");
    try {
      writeDevinCredentials(xdg, "dev-token-a");
      const env = { XDG_DATA_HOME: xdg };
      await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? okResponse(planBody()) : errorResponse(500)),
      }));
      resetUsageLimitsCache();

      // A different sign-in rewrites the file; the revision changes and the
      // previous account's snapshot must be refused.
      writeDevinCredentials(xdg, "dev-token-b-longer-value");
      const switched = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? errorResponse(503) : errorResponse(500)),
      }));
      assert.notEqual(switched.devin.error, null, "a previous credential revision must not serve");
      assert.notEqual(switched.devin.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("drops cached windows whose reset has passed", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-devin-cache-"));
    const xdg = path.join(home, "xdg");
    try {
      writeDevinCredentials(xdg, "dev-token-a");
      const env = { XDG_DATA_HOME: xdg };
      seedDevinCache(home, credentialRevision(xdg), {
        plan_label: "Pro",
        primary_window: { used_percent: 10, reset_at: futureIso(-1) },
        secondary_window: null,
        cached_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      resetUsageLimitsCache();
      const expired = await getUsageLimits(baseOptions(home, env, {
        fetchImpl: (url) => (url === PLAN_URL ? errorResponse(503) : errorResponse(500)),
      }));
      assert.notEqual(expired.devin.error, null, "a window past its reset is stale data, not a fallback");
      assert.notEqual(expired.devin.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
