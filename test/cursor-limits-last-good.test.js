"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  readCursorLimitsCache: readCache,
  writeCursorLimitsCache: writeCache,
  normalizeCursorCachedLimits,
  resolveCursorLimitsCachePath,
  CURSOR_LIMITS_CACHE_FILE,
} = require("../src/lib/usage-limits");

const NOW_MS = Date.parse('2026-11-03T00:00:00Z');
function readCursorLimitsCache(options = {}) { return readCache({ nowMs: NOW_MS, ...options }); }
function writeCursorLimitsCache(limits, options = {}) { return writeCache(limits, { nowMs: NOW_MS, ...options }); }

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-cursor-cache-"));
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

const LIVE_LIMITS = {
  configured: true,
  error: null,
  membership_type: "pro",
  primary_window: { used_percent: 41.5, reset_at: "2026-12-01T00:00:00.000Z" },
  secondary_window: { used_percent: 12, reset_at: "2026-12-01T00:00:00.000Z" },
  tertiary_window: { used_percent: 3.2, reset_at: "2026-12-01T00:00:00.000Z" },
  quaternary_window: { used_percent: 9, reset_at: "2026-12-01T00:00:00.000Z" },
};

test("write then read round-trips the last-good windows as stale", () => {
  const home = sandbox();
  try {
    writeCursorLimitsCache(LIVE_LIMITS, { home, nowMs: NOW_MS, identity: "user-A" });
    const cached = readCursorLimitsCache({ home, nowMs: NOW_MS, identity: "user-A" });
    assert.ok(cached, "cache should read back");
    assert.equal(cached.configured, true);
    assert.equal(cached.error, null);
    assert.equal(cached.stale, true);
    assert.equal(cached.membership_type, "pro");
    assert.equal(cached.primary_window.used_percent, 41.5);
    assert.equal(cached.quaternary_window.used_percent, 9);
    assert.ok(fs.existsSync(resolveCursorLimitsCachePath({ home })));
    assert.ok(resolveCursorLimitsCachePath({ home }).endsWith(CURSOR_LIMITS_CACHE_FILE));
  } finally {
    cleanup(home);
  }
});

test("windows whose reset has passed are dropped, not served as fallback", () => {
  const home = sandbox();
  try {
    writeCursorLimitsCache(
      { ...LIVE_LIMITS, primary_window: { used_percent: 99, reset_at: "2020-01-01T00:00:00.000Z" } },
      { home, nowMs: NOW_MS, identity: "user-A" },
    );
    const cached = readCursorLimitsCache({ home, nowMs: NOW_MS, identity: "user-A" });
    assert.ok(cached);
    assert.equal(cached.primary_window, null, "expired window must not serve");
    assert.equal(cached.secondary_window.used_percent, 12, "live windows still serve");
  } finally {
    cleanup(home);
  }
});

test("cache older than the max age is rejected", () => {
  const home = sandbox();
  try {
    const staleAt = new Date(NOW_MS - 8 * 24 * 60 * 60 * 1000).toISOString();
    writeCursorLimitsCache(LIVE_LIMITS, { home, nowMs: NOW_MS, identity: "user-A" });
    const cached = normalizeCursorCachedLimits(
      JSON.parse(fs.readFileSync(resolveCursorLimitsCachePath({ home }), "utf8")).cursor,
      { nowMs: NOW_MS, maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
    );
    assert.ok(cached, "within max age still serves");
    // Rewind cached_at past the 7-day max age.
    const raw = JSON.parse(fs.readFileSync(resolveCursorLimitsCachePath({ home }), "utf8"));
    raw.cursor.cached_at = staleAt;
    fs.writeFileSync(resolveCursorLimitsCachePath({ home }), JSON.stringify(raw));
    assert.equal(readCursorLimitsCache({ home, nowMs: NOW_MS }), null, "over-age cache rejected");
  } finally {
    cleanup(home);
  }
});

test("a snapshot is identity-partitioned: another account reads nothing", () => {
  const home = sandbox();
  try {
    writeCursorLimitsCache(LIVE_LIMITS, { home, nowMs: NOW_MS, identity: "user-A" });
    assert.equal(readCursorLimitsCache({ home, nowMs: NOW_MS, identity: "user-B" }), null, "cross-account read refused");
    assert.ok(readCursorLimitsCache({ home, nowMs: NOW_MS, identity: "user-A" }), "own account still reads");
    // No identity at all (caller without auth) reads nothing either.
    assert.equal(readCursorLimitsCache({ home, nowMs: NOW_MS }), null);
  } finally {
    cleanup(home);
  }
});

test("writes without an identity are refused entirely", () => {
  const home = sandbox();
  try {
    writeCursorLimitsCache(LIVE_LIMITS, { home, nowMs: NOW_MS });
    assert.equal(fs.existsSync(resolveCursorLimitsCachePath({ home })), false, "unattributable snapshot is worse than none");
  } finally {
    cleanup(home);
  }
});

test("unversioned Cursor snapshots are rejected even when their identity matches", () => {
  const home = sandbox();
  try {
    writeCursorLimitsCache(LIVE_LIMITS, { home, identity: "user-A" });
    const file = resolveCursorLimitsCachePath({ home });
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    delete raw.schema;
    fs.writeFileSync(file, JSON.stringify(raw));
    assert.equal(readCursorLimitsCache({ home, identity: "user-A" }), null);
  } finally {
    cleanup(home);
  }
});

test("error and window-less live reads never poison the cache", () => {
  const home = sandbox();
  try {
    writeCursorLimitsCache({ configured: true, error: "Fetch failed" }, { home, nowMs: NOW_MS });
    writeCursorLimitsCache({ configured: true, error: null }, { home, nowMs: NOW_MS });
    writeCursorLimitsCache({ configured: false }, { home, nowMs: NOW_MS });
    assert.equal(fs.existsSync(resolveCursorLimitsCachePath({ home })), false, "no cache file written");
    assert.equal(readCursorLimitsCache({ home, nowMs: NOW_MS }), null);
  } finally {
    cleanup(home);
  }
});
