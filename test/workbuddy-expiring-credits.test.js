"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { selectWorkbuddyRewardWindow: selectRewardWindow, REWARD_CODES } = require("../src/lib/workbuddy-limits");

const NOW_MS = Date.parse('2026-11-03T00:00:00Z');
function selectWorkbuddyRewardWindow(rows) { return selectRewardWindow(rows, { nowMs: NOW_MS }); }

const REWARD_CODES_LIST = [...REWARD_CODES];
let grantSeq = 0;

// Package row in the shape collectPackageRows/mergePackageRows produce. Each
// grant gets a distinct reward code: mergePackageRows collapses same-code rows
// (last write wins), which would silently fuse the fixture's grants.
function grant({ total, remain, cycleEnd }) {
  const code = REWARD_CODES_LIST[grantSeq % REWARD_CODES_LIST.length];
  grantSeq += 1;
  return { code, name: "grant", total, remain, used: total !== null && remain !== null ? Math.max(0, total - remain) : null, cycleEnd };
}

test("the lapse anchors on the earliest expiry's Beijing calendar day", () => {
  // Same Beijing day (11-05): two grants; a later day (11-09) does not join.
  const rows = [
    grant({ total: 1000, remain: 300, cycleEnd: "2026-11-05T10:00:00+08:00" }),
    grant({ total: 1000, remain: 200, cycleEnd: "2026-11-05T20:00:00+08:00" }),
    grant({ total: 1000, remain: 500, cycleEnd: "2026-11-09T12:00:00+08:00" }),
    grant({ total: 1000, remain: 100, cycleEnd: null }),
  ];
  const window = selectWorkbuddyRewardWindow(rows);
  assert.ok(window, "pool builds");
  assert.equal(window.reset_at, new Date("2026-11-05T10:00:00+08:00").toISOString());
  assert.equal(window.expiring_first_at, new Date("2026-11-05T10:00:00+08:00").toISOString());
  assert.equal(window.expiring_at, new Date("2026-11-05T20:00:00+08:00").toISOString());
  assert.equal(window.expiring_credits, 500);
  assert.equal(window.remaining_credits, 1100);
});

test("grants without any expiry advertise no lapse", () => {
  const window = selectWorkbuddyRewardWindow([grant({ total: 500, remain: 250, cycleEnd: null })]);
  assert.ok(window);
  assert.equal(window.expiring_credits, undefined);
  assert.equal(window.expiring_at, undefined);
  assert.equal(window.expiring_first_at, undefined);
  assert.equal(window.reset_at, null);
});

test("fractional expiring credits keep two decimals", () => {
  const rows = [
    grant({ total: 1000, remain: 100.5, cycleEnd: "2026-11-06T09:00:00+08:00" }),
    grant({ total: 1000, remain: 200.25, cycleEnd: "2026-11-06T23:00:00+08:00" }),
  ];
  const window = selectWorkbuddyRewardWindow(rows);
  assert.equal(window.expiring_credits, 300.75);
});

test("a pool whose only expiring grant is the anchor carries exactly its remaining", () => {
  const window = selectWorkbuddyRewardWindow([
    grant({ total: 400, remain: 150, cycleEnd: "2026-11-07T08:00:00+08:00" }),
  ]);
  assert.equal(window.expiring_credits, 150);
  assert.equal(window.expiring_first_at, window.expiring_at);
});
