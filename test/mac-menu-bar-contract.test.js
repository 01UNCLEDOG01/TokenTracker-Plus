'use strict';
// Menu-bar metrics contract: the macOS shell advertises metrics to the dashboard
// Widgets page (menu-bar-display.js) and consumes its slot/visibility settings.
// Keep the ids, the max slot count and the settings plumbing in lockstep.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('shell metric ids stay inside the dashboard menu-bar contract', () => {
  const dashboard = read('dashboard/src/lib/menu-bar-display.js');
  const fallbackIds = new Set([...dashboard.matchAll(/\{ id: "([A-Za-z0-9]+)"/g)].map((m) => m[1]));
  const swift = read('TokenTrackerMac/Sources/MenuBarMetrics.swift');
  const ids = [...swift.matchAll(/case [A-Za-z0-9]+(?: = "([A-Za-z0-9]+)")?/g)]
    .map((m) => m[1] || 'none');
  const metrics = ids.filter((id) => id !== 'none');
  assert.ok(metrics.length >= 4, 'expected several metrics');
  // todayTokens/todayCost/last7dTokens are the dashboard's own ids; the shell may
  // add its own (last30dTokens/conversations) because it advertises the list.
  for (const id of ['todayTokens', 'todayCost', 'last7dTokens']) {
    assert.ok(metrics.includes(id), 'shell must expose dashboard id ' + id);
    assert.ok(fallbackIds.has(id), 'dashboard fallback must define ' + id);
  }
  assert.match(swift, /static let maxItems = 2/);
  assert.match(dashboard, /maxItems = 2/);
});

test('shell advertises the Widgets-page contract in native settings', () => {
  const appDelegate = read('TokenTrackerMac/Sources/AppDelegate.swift');
  for (const key of ['showStats', 'menuBarItems', 'menuBarAvailableItems', 'menuBarMaxItems',
    'hideMenuBarIcon', 'limitsDisplayMode', 'toastOnReset', 'confettiOnReset']) {
    assert.ok(appDelegate.includes('"' + key + '"'), 'native settings must carry ' + key);
  }
  const petSettings = read('TokenTrackerMac/Sources/PetSettings.swift');
  assert.match(petSettings, /shellSettingApplier\?\(key, value\)/);
  const status = read('TokenTrackerMac/Sources/StatusItemController.swift');
  for (const setter of ['setShowStats', 'setMenuBarItems', 'setHideMenuBarIcon',
    'setLimitsDisplayMode', 'setToastOnReset', 'setConfettiOnReset']) {
    assert.ok(status.includes('func ' + setter), 'StatusItemController must expose ' + setter);
  }
  // Metrics are live: the stats poll refreshes the strip.
  assert.match(appDelegate, /refreshMenuBar\(\)/);
  // The dashboard's legacy display-mode channel must be answered by native settings.
  assert.match(read('dashboard/src/hooks/use-limits-display-prefs.js'), /limitsDisplayMode/);
});

test('tray icon slot stays fixed when the metrics strip is off', () => {
  const status = read('TokenTrackerMac/Sources/StatusItemController.swift');
  // text present -> variable length, text empty -> the fixed 30pt slot (the
  // variableLength/mascot spacing bug fix).
  assert.match(status, /statusItem\?\.length = NSStatusItem\.variableLength/);
  assert.match(status, /statusItem\?\.length = Self\.statusItemWidth/);
  assert.match(status, /private static let statusItemWidth: CGFloat = 30/);
});
