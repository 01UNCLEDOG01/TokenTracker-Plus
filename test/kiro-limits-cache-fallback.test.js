"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it, beforeEach } = require("node:test");

const { getUsageLimits, resetUsageLimitsCache } = require("./helpers/usage-limits");

const USAGE_OUTPUT = `
Estimated Usage | resets on 2030-08-01 | KIRO PRO
████████████ 25%
(25 of 100 covered in plan)
`;

const PROFILE_ARN = "arn:aws:codewhisperer:us-east-1:123456789012:profile/TESTARN";

function writeKiroAuth(home, arn = PROFILE_ARN) {
  fs.mkdirSync(path.join(home, ".aws", "sso", "cache"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".aws", "sso", "cache", "kiro-auth-token.json"),
    JSON.stringify({ profileArn: arn }),
    { mode: 0o600 },
  );
}

// A commandRunner that answers only kiro-cli's probes; every other provider's
// spawns get the inert status-1 result the way the Kimi fixture does.
function kiroCommandRunner({ versionOutput, usageResult }) {
  return (command, args) => {
    if (command === "which" || command === "where") {
      return args[0] === "kiro-cli"
        ? { status: 0, stdout: "/opt/kiro-cli\n", stderr: "" }
        : { status: 1, stdout: "", stderr: "" };
    }
    if (command === "/opt/kiro-cli" && args[0] === "--version") {
      return { status: 0, stdout: versionOutput, stderr: "" };
    }
    if (command === "/usr/bin/script" || command === "/opt/kiro-cli") {
      return typeof usageResult === "function" ? usageResult() : usageResult;
    }
    return { status: 1, stdout: "", stderr: "" };
  };
}

function baseOptions(home, overrides = {}) {
  return {
    home,
    env: {},
    providerTimeoutMs: 2000,
    platform: "darwin",
    securityRunner: () => ({ status: 1, stdout: "" }),
    ...overrides,
  };
}

function cachePath(home) {
  return path.join(home, ".tokentracker", "tracker", "kiro-usage-limits-cache.json");
}

function seedKiroCache(home, identity, entry) {
  fs.mkdirSync(path.dirname(cachePath(home)), { recursive: true });
  fs.writeFileSync(
    cachePath(home),
    JSON.stringify({ kiro: { identity, ...entry } }),
  );
}

function futureIso(hours) {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

describe("Kiro limits disk-cache fallback", () => {
  beforeEach(() => {
    resetUsageLimitsCache();
  });

  it("persists a live read and serves it stale when the CLI later fails", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-kiro-lcache-"));
    try {
      writeKiroAuth(home);
      const live = await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 0, stdout: USAGE_OUTPUT, stderr: "" },
        }),
      }));
      assert.equal(live.kiro.configured, true);
      assert.equal(live.kiro.error, null);
      assert.equal(live.kiro.stale, false);
      assert.equal(live.kiro.plan_name, "KIRO PRO");
      assert.equal(live.kiro.primary_window.used_percent, 25);
      assert.equal(live.kiro.provenance.source, "provider-api");
      assert.ok(!("cache_identity" in live.kiro), "internal identity marker must not reach the payload");

      const disk = JSON.parse(fs.readFileSync(cachePath(home), "utf8"));
      assert.equal(disk.kiro.identity, PROFILE_ARN);
      assert.equal(disk.kiro.primary_window.used_percent, 25);
      assert.deepEqual(Object.keys(disk.kiro).sort(), [
        "cached_at", "identity", "plan_name", "primary_window", "secondary_window",
      ]);

      resetUsageLimitsCache();
      const stale = await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 1, stdout: "", stderr: "backend unavailable" },
        }),
      }));
      assert.equal(stale.kiro.configured, true);
      assert.equal(stale.kiro.error, null, "stale cache must be served instead of a red error");
      assert.equal(stale.kiro.stale, true);
      assert.equal(stale.kiro.primary_window.used_percent, 25);
      assert.equal(stale.kiro.cached_at, live.kiro.cached_at, "stale read must preserve the original cached_at");
      assert.equal(stale.kiro.provenance.source, "disk-cache");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not hide a not-logged-in panel behind stale cache", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-kiro-lcache-"));
    try {
      writeKiroAuth(home);
      await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 0, stdout: USAGE_OUTPUT, stderr: "" },
        }),
      }));
      resetUsageLimitsCache();

      const loggedOut = await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 1, stdout: "", stderr: "Error: not logged in to Kiro. Run `kiro-cli login`." },
        }),
      }));
      assert.equal(loggedOut.kiro.configured, true);
      assert.match(loggedOut.kiro.error, /not logged in to kiro/i);
      assert.notEqual(loggedOut.kiro.stale, true);
      assert.ok(!("auth_error" in loggedOut.kiro), "internal auth marker must not reach the payload");
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("refuses a cache entry for a different profile ARN (identity partition)", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-kiro-lcache-"));
    try {
      writeKiroAuth(home);
      await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 0, stdout: USAGE_OUTPUT, stderr: "" },
        }),
      }));
      resetUsageLimitsCache();

      writeKiroAuth(home, "arn:aws:codewhisperer:us-east-1:123456789012:profile/OTHER");
      const switched = await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 1, stdout: "", stderr: "backend unavailable" },
        }),
      }));
      assert.notEqual(switched.kiro.error, null, "another profile's cache must not serve");
      assert.notEqual(switched.kiro.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("drops cached windows whose reset has passed", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-kiro-lcache-"));
    try {
      writeKiroAuth(home);
      seedKiroCache(home, PROFILE_ARN, {
        plan_name: "KIRO PRO",
        primary_window: { used_percent: 10, reset_at: futureIso(-1) },
        secondary_window: null,
        cached_at: new Date(Date.now() - 3_600_000).toISOString(),
      });
      resetUsageLimitsCache();
      const expired = await getUsageLimits(baseOptions(home, {
        commandRunner: kiroCommandRunner({
          versionOutput: "kiro-cli 2.13.0\n",
          usageResult: { status: 1, stdout: "", stderr: "backend unavailable" },
        }),
      }));
      assert.notEqual(expired.kiro.error, null, "a window past its reset is stale data, not a fallback");
      assert.notEqual(expired.kiro.stale, true);
    } finally {
      resetUsageLimitsCache();
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
