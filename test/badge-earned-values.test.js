"use strict";

// 挣到值捕获单测（KI-084，站主 2026-11-14 拍板）：只捕「新鲜解锁」（achieved
// ≤36h）的首观察读数且永不改写——存量成就不回填今日读数（对抗审查 F2），
// 读数回落不抹除，损坏/降级文件不炸不覆写（F7），junk 读数不进表（F6）。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CAPTURE_FRESH_MS, captureBadgeEarnedValues, readBadgeEarnedValues } = require("../src/lib/badge-earned-values");

const NOW = Date.parse("2026-11-14T12:00:00Z");
const fresh = (hoursAgo) => new Date(NOW - hoursAgo * 3600 * 1000).toISOString();

function fixtureDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tt-earned-values-"));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

test("capture records the first observed reading per tier and never rewrites it", () => {
  const dir = fixtureDir();
  try {
    // Unlocked 2h ago (fresh), observed now with a reading of 132.
    const first = captureBadgeEarnedValues(dir, [
      { id: "streak", tier: 4, metric_value: 132, achieved: { bronze: fresh(2), silver: fresh(2), gold: fresh(1), diamond: fresh(1) } },
    ], { nowMs: NOW });
    assert.deepEqual(first.streak, { bronze: 132, silver: 132, gold: 132, diamond: 132 });
    // A later poll with a different live reading must not move the recorded values.
    const second = captureBadgeEarnedValues(dir, [
      { id: "streak", tier: 4, metric_value: 7, achieved: { bronze: fresh(2), silver: fresh(2), gold: fresh(1), diamond: fresh(1) } },
    ], { nowMs: NOW + 60000 });
    assert.deepEqual(second.streak, { bronze: 132, silver: 132, gold: 132, diamond: 132 });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "badge-earned-values.json"), "utf8"));
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.badges.streak.diamond, 132);
  } finally {
    cleanup(dir);
  }
});

test("capture records higher tiers the first time they appear, keeping lower tiers intact", () => {
  const dir = fixtureDir();
  try {
    captureBadgeEarnedValues(dir, [
      { id: "token_titan", tier: 2, metric_value: 5100, achieved: { bronze: fresh(1), silver: fresh(1), gold: null, diamond: null } },
    ], { nowMs: NOW });
    const grown = captureBadgeEarnedValues(dir, [
      { id: "token_titan", tier: 4, metric_value: 90000, achieved: { bronze: fresh(1), silver: fresh(1), gold: fresh(0.2), diamond: fresh(0.2) } },
    ], { nowMs: NOW });
    assert.deepEqual(grown.token_titan, { bronze: 5100, silver: 5100, gold: 90000, diamond: 90000 });
    // A dip (share/streak badges legitimately fall) never downgrades the table.
    const dipped = captureBadgeEarnedValues(dir, [
      { id: "token_titan", tier: 1, metric_value: 10, achieved: { bronze: fresh(1), silver: fresh(1), gold: fresh(0.2), diamond: fresh(0.2) } },
    ], { nowMs: NOW });
    assert.deepEqual(dipped.token_titan, { bronze: 5100, silver: 5100, gold: 90000, diamond: 90000 });
  } finally {
    cleanup(dir);
  }
});

test("pre-existing unlocks are never backfilled with today's reading (F2)", () => {
  const dir = fixtureDir();
  try {
    // The streak diamond was earned months ago; this device only starts
    // capturing after the feature ships. Its true earning reading is gone —
    // today's 132 must NOT be recorded as 挣到时数值.
    const stale = captureBadgeEarnedValues(dir, [
      { id: "streak", tier: 4, metric_value: 132, achieved: { bronze: "2026-09-01T00:00:00Z", silver: "2026-09-08T00:00:00Z", gold: "2026-09-15T00:00:00Z", diamond: "2026-09-23T00:00:00Z" } },
    ], { nowMs: NOW });
    assert.deepEqual(stale, {});
    assert.equal(fs.existsSync(path.join(dir, "badge-earned-values.json")), false);
  } finally {
    cleanup(dir);
  }
});

test("capture ignores junk readings and an empty wall writes nothing", () => {
  const dir = fixtureDir();
  try {
    const table = captureBadgeEarnedValues(dir, [
      { id: "real_money", tier: 2, metric_value: "not-a-number", achieved: { bronze: fresh(1), silver: fresh(1), gold: null, diamond: null } },
      { id: "real_money", tier: 0, metric_value: 12, achieved: { bronze: fresh(1), silver: null, gold: null, diamond: null } },
      { id: "real_money", tier: 1, metric_value: Number.POSITIVE_INFINITY, achieved: { bronze: fresh(1), silver: null, gold: null, diamond: null } },
      { id: "null_value", tier: 1, metric_value: null, achieved: { bronze: fresh(1), silver: null, gold: null, diamond: null } },
    ], { nowMs: NOW });
    assert.deepEqual(table, {});
    assert.equal(fs.existsSync(path.join(dir, "badge-earned-values.json")), false,
      "nothing learned → no file written");
  } finally {
    cleanup(dir);
  }
});

test("a corrupt or foreign file starts from an empty table, not a crash", () => {
  const dir = fixtureDir();
  try {
    fs.writeFileSync(path.join(dir, "badge-earned-values.json"), "{ version: 999, garbage");
    const table = captureBadgeEarnedValues(dir, [
      { id: "streak", tier: 1, metric_value: 6, achieved: { bronze: fresh(1), silver: null, gold: null, diamond: null } },
    ], { nowMs: NOW });
    assert.equal(table.streak.bronze, 6);
    assert.equal(readBadgeEarnedValues(dir).version, 1);
    // An unknown-shape file with the right version is also refused.
    fs.writeFileSync(path.join(dir, "badge-earned-values.json"), JSON.stringify({ version: 1, badges: [] }));
    assert.deepEqual(readBadgeEarnedValues(dir).badges, {});
  } finally {
    cleanup(dir);
  }
});

test("a file from a newer version is never downgraded by a rolled-back binary (F7)", () => {
  const dir = fixtureDir();
  try {
    fs.writeFileSync(path.join(dir, "badge-earned-values.json"), JSON.stringify({
      version: 2,
      badges: { streak: { bronze: 42, silver: 43, gold: 44, diamond: 45, future_tier: 46 } },
    }));
    captureBadgeEarnedValues(dir, [
      { id: "streak", tier: 1, metric_value: 6, achieved: { bronze: fresh(1), silver: null, gold: null, diamond: null } },
    ], { nowMs: NOW });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "badge-earned-values.json"), "utf8"));
    assert.equal(onDisk.version, 2, "the v2 file must survive untouched");
    assert.equal(onDisk.badges.streak.future_tier, 46);
  } finally {
    cleanup(dir);
  }
});

test("capture window covers midnight-stale derived dates but not older ones", () => {
  const dir = fixtureDir();
  try {
    const boundary = captureBadgeEarnedValues(dir, [
      { id: "streak", tier: 1, metric_value: 6, achieved: { bronze: new Date(NOW - CAPTURE_FRESH_MS).toISOString(), silver: null, gold: null, diamond: null } },
      { id: "marathoner", tier: 1, metric_value: 8, achieved: { bronze: new Date(NOW - CAPTURE_FRESH_MS - 1).toISOString(), silver: null, gold: null, diamond: null } },
    ], { nowMs: NOW });
    assert.equal(boundary.streak.bronze, 6, "exactly at the window still counts");
    assert.equal(boundary.marathoner, undefined, "one millisecond past the window is stock");
  } finally {
    cleanup(dir);
  }
});
