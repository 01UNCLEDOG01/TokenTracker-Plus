'use strict';
// Dynamic Island fullscreen-presence contract: the island hides while a
// full-screen app covers its screen, but screensaver-level (>= 1000) windows
// are shared with helper surfaces (automation toolkits keep full-screen
// capture overlays there for a whole session — 站主 2026-11-13: the island
// vanished while an agent session was active). Only an actual screensaver
// owner is decisive at that layer; the regression guard pins the gate to the
// scan so a refactor cannot silently drop it.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('island fullscreen scan only treats screensaver owners as decisive at screensaver level', () => {
  const swift = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Services/DynamicIslandController.swift');
  // The scan runs the layer gate first (screensaver level passes it), then
  // requires a screensaver owner before the covering-window check.
  assert.match(swift, /if layer >= 1000 && !owner\.lowercased\(\)\.contains\("screensaver"\) \{\n\s*continue/);
  // The screensaver exemption must live INSIDE the island window scan, not
  // as a blanket layer change in the shared policy.
  const policy = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Models/DynamicIslandLayoutPolicy.swift');
  assert.doesNotMatch(policy, /layer >= 1000/, 'policy must keep accepting screensaver-level layers for the scan');
  // And the plain fullscreen rule for regular windows stays intact.
  assert.match(swift, /windowLayerCanCoverIslandScreen\(layer\)/);
});
