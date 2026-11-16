"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// KI-067 (2026-11-17): the mac shell's background sync bodies lacked
// "publishAccount":true, so the local-sync route never issued a device token
// for a panel-less native request and the mac's collected rows sat in the
// local queue until the dashboard was opened — account views on other devices
// showed stale daily totals (owner report 2026-11-16: the 11-14 ZCode 2.5亿
// backlog landed only when the mac came online). The string had already been
// silently stripped once before (6a27204's cloud-surface sweep), so pin both
// body variants here the way test/windows-background-sync-source.test.js pins
// the Windows shell's body.

const MAC_SHELL = "TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Services/APIClient.swift";

test("mac shell background sync bodies request publishAccount on both variants", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", MAC_SHELL), "utf8");
  const triggerSync = source.match(/func triggerSync\(drain: Bool = false, auto: Bool = false\)[\s\S]*?\n    \}/);
  assert.ok(triggerSync, "APIClient.swift: triggerSync not found");

  // The drain variant flushes the complete backlog AND publishes.
  assert.match(
    triggerSync[0],
    /\{"auto":true,"background":true,"allLocalSources":true,"drain":true,"publishAccount":true\}/,
    "drain body must carry publishAccount — without it the local-sync route never issues a device token for a panel-less request and the backlog never uploads",
  );
  // The auto variant is the 5-minute hidden-loop sync: same requirement.
  assert.match(
    triggerSync[0],
    /\{"auto":true,"background":true,"allLocalSources":true,"publishAccount":true\}/,
    "auto body must carry publishAccount",
  );
});

test("mac shell background sync still routes through the local-sync endpoint with the local auth header", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", MAC_SHELL), "utf8");
  assert.match(source, /\/functions\/tokentracker-local-sync/, "triggerSync must hit the local-sync endpoint");
  assert.match(source, /x-tokentracker-local-auth/, "local-sync mutations need the local auth header");
});
