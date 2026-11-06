"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");

const { getUsageLimits, resetUsageLimitsCache } = require("./helpers/usage-limits");

const QUOTA_URL = "https://api.github.com/copilot_internal/user";

function futureIso(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

function writeCopilotToken(home, token) {
  fs.mkdirSync(path.join(home, ".config", "github-copilot"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".config", "github-copilot", "hosts.json"),
    JSON.stringify({ "github.com": { oauth_token: token } }),
    { mode: 0o600 },
  );
}

function quotaBody() {
  return {
    copilot_plan: "pro",
    quota_reset_date: futureIso(24 * 20),
    quota_snapshots: {
      premium_interactions: { entitlement: 300, remaining: 150, percent_remaining: 50 },
      chat: { entitlement: 0, remaining: 0, percent_remaining: 0 },
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

function baseOptions(home, overrides = {}) {
  return {
    home,
    env: {},
    providerTimeoutMs: 2000,
    // Windows/darwin keyrings must never leak host credentials into the
    // fixture; a plain miss keeps the plaintext hosts.json path authoritative.
    securityRunner: () => ({ status: 1, stdout: "" }),
    commandRunner: () => ({ status: 1, stdout: "" }),
    ...overrides,
  };
}

function cachePath(home) {
  return path.join(home, ".tokentracker", "tracker", "copilot-usage-limits-cache.json");
}

function seedCopilotCache(home, identity, entry) {
  fs.mkdirSync(path.dirname(cachePath(home)), { recursive: true });
  fs.writeFileSync(
    cachePath(home),
    JSON.stringify({ copilot: { identity, ...entry } }),
  );
}

function tokenIdentity(token) {
  return require("node:crypto").createHash("sha256").update(token).digest("hex").slice(0, 16);
}

describe("Copilot limits disk-cache fallback", () => {
  beforeEach(() => {
    resetUsageLimitsCache();
  });

  it("persists a live read and serves it stale when a later fetch fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-cache-"));
    try {
      writeCopilotToken(home, "gho_token_a");
      const live = await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? okResponse(quotaBody()) : errorResponse(500)),
      }));
      assert.equal(live.copilot.configured, true);
      assert.equal(live.copilot.error, null);
      assert.equal(live.copilot.stale, false);
      assert.equal(live.copilot.plan_name, "Pro");
      assert.equal(live.copilot.primary_window.used_percent, 50);
      assert.equal(live.copilot.provenance.source, "provider-api");
      assert.ok(!("cache_identity" in live.copilot), "internal identity marker must not reach the payload");

      const disk = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
      assert.equal(disk.copilot.identity, tokenIdentity("gho_token_a"));
      assert.equal(disk.copilot.primary_window.used_percent, 50);
      assert.deepEqual(Object.keys(disk.copilot).sort(), [
        "cached_at", "identity", "plan_name", "primary_window", "secondary_window",
      ]);

      resetUsageLimitsCache();
      const stale = await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? errorResponse(503) : errorResponse(500)),
      }));
      assert.equal(stale.copilot.configured, true);
      assert.equal(stale.copilot.error, null, "stale cache must be served instead of a red error");
      assert.equal(stale.copilot.stale, true);
      assert.equal(stale.copilot.primary_window.used_percent, 50);
      assert.equal(stale.copilot.cached_at, live.copilot.cached_at, "stale read must preserve the original cached_at");
      assert.equal(stale.copilot.provenance.source, "disk-cache");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not hide a rejected token (401) behind stale cache", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-cache-"));
    try {
      writeCopilotToken(home, "gho_token_a");
      await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? okResponse(quotaBody()) : errorResponse(500)),
      }));
      resetUsageLimitsCache();

      const rejected = await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? errorResponse(401) : errorResponse(500)),
      }));
      assert.equal(rejected.copilot.configured, true);
      assert.match(rejected.copilot.error, /token rejected|Re-authenticate/i);
      assert.notEqual(rejected.copilot.stale, true);
      assert.ok(!("auth_error" in rejected.copilot), "internal auth marker must not reach the payload");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses a cache entry after the OAuth token changed (identity partition)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-cache-"));
    try {
      writeCopilotToken(home, "gho_token_a");
      await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? okResponse(quotaBody()) : errorResponse(500)),
      }));
      resetUsageLimitsCache();

      // A rotated token means a different login (or a refreshed one); the
      // partition key changes and the previous entry must not serve. A miss
      // is the safe direction — the next successful read repopulates.
      writeCopilotToken(home, "gho_token_b");
      const switched = await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? errorResponse(503) : errorResponse(500)),
      }));
      assert.notEqual(switched.copilot.error, null, "another token's cache must not serve");
      assert.notEqual(switched.copilot.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("drops cached windows whose reset has passed", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-copilot-cache-"));
    try {
      writeCopilotToken(home, "gho_token_a");
      seedCopilotCache(home, tokenIdentity("gho_token_a"), {
        plan_name: "Pro",
        primary_window: { used_percent: 10, reset_at: futureIso(-1) },
        secondary_window: null,
        cached_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      resetUsageLimitsCache();
      const expired = await getUsageLimits(baseOptions(home, {
        fetchImpl: (url) => (url === QUOTA_URL ? errorResponse(503) : errorResponse(500)),
      }));
      assert.notEqual(expired.copilot.error, null, "a window past its reset is stale data, not a fallback");
      assert.notEqual(expired.copilot.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
