"use strict";

// Regression gate: the sessions-browser L2 disk cache must live under the
// active tracker data dir (isolatedTrackerDataDir || dirname(queuePath)), never
// under a hard-coded ~/.tokentracker path. A hard-coded path made every unit
// test that boots the local API read and overwrite the owner's real 30MB cache.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("sessions disk cache path follows trackerDataDir, not os.homedir()", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "local-api.js"),
    "utf8",
  );
  const cacheLine = source
    .split("\n")
    .find((line) => line.includes("sessionsDiskCachePath ="));
  assert.ok(cacheLine, "local-api.js must define sessionsDiskCachePath");
  assert.equal(
    /os\.homedir\(\)/.test(cacheLine),
    false,
    "the sessions cache path must not be hard-coded to the home dir",
  );
  assert.match(
    cacheLine,
    /path\.join\(\s*trackerDataDir\s*,\s*"sessions-browser-cache\.json"\s*\)/,
    "sessions-browser-cache.json must be built from trackerDataDir",
  );
});
