'use strict';

// The floating pill's accent dot must tint to the chosen companion on every
// host. The dashboard owns the table (dashboard/src/lib/pet-appearance.js +
// bot-appearance.js); the mac pill is native, so PetPillAppearance.swift mirrors
// it. They drifted once already: gengxu rendered purple (should be the neutral
// gray fallback), yeacat had no entry, and bot ignored the user's body colour.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const petAppearance = read('dashboard/src/lib/pet-appearance.js');
const botAppearance = read('dashboard/src/lib/bot-appearance.js');
const botSkins = read('dashboard/src/lib/bot/skins.ts');
const swift = read('TokenTrackerMac/Sources/PetPillAppearance.swift');

const hexToRgb = (hex) => {
  const value = parseInt(hex.replace('#', ''), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

// Slice a Swift table body between its declaration and the closing bracket.
const swiftTableBody = (name) => {
  const start = swift.indexOf('static let ' + name);
  assert.ok(start >= 0, 'Swift ' + name + ' not found');
  const assign = swift.indexOf('= [', start);
  assert.ok(assign > start, 'Swift ' + name + ' table assignment not found');
  const end = swift.indexOf('\n    ]', assign);
  assert.ok(end > assign, 'Swift ' + name + ' body not found');
  return swift.slice(assign, end);
};

const parseSwiftTable = (name) => {
  const table = {};
  const re = /"([a-z0-9-]+)": RGB\(r: (\d+), g: (\d+), b: (\d+)\)/g;
  for (const m of swiftTableBody(name).matchAll(re)) {
    table[m[1]] = { r: Number(m[2]), g: Number(m[3]), b: Number(m[4]) };
  }
  assert.ok(Object.keys(table).length > 0, 'Swift ' + name + ' parsed empty');
  return table;
};

test('character dot table matches pet-appearance.js exactly', () => {
  const block = petAppearance.match(/PET_PILL_DOT_COLORS = Object\.assign\(Object\.create\(null\), \{([\s\S]*?)\}\)/);
  assert.ok(block, 'PET_PILL_DOT_COLORS not found');
  const jsTable = {};
  for (const m of block[1].matchAll(/([a-z0-9-]+): "(#[0-9a-f]{6})"/g)) {
    jsTable[m[1]] = hexToRgb(m[2]);
  }
  assert.deepStrictEqual(parseSwiftTable('characterColors'), jsTable);
});

test('fallback color matches PET_PILL_DOT_FALLBACK', () => {
  const m = petAppearance.match(/PET_PILL_DOT_FALLBACK = "(#[0-9a-f]{6})"/);
  assert.ok(m, 'PET_PILL_DOT_FALLBACK not found');
  const fallback = hexToRgb(m[1]);
  const swiftFallback = swift.match(/static let fallback = RGB\(r: (\d+), g: (\d+), b: (\d+)\)/);
  assert.ok(swiftFallback, 'Swift fallback not found');
  assert.deepStrictEqual({
    r: Number(swiftFallback[1]), g: Number(swiftFallback[2]), b: Number(swiftFallback[3]),
  }, fallback);
});

test('bot palette matches bot/skins.ts COLORS', () => {
  const jsTable = {};
  for (const m of botSkins.matchAll(/\{ id: '([a-z]+)', hex: '(#[0-9a-f]{6})' \}/g)) {
    jsTable[m[1]] = hexToRgb(m[2]);
  }
  assert.ok(Object.keys(jsTable).length >= 12, 'expected the full bot palette');
  assert.deepStrictEqual(parseSwiftTable('botColors'), jsTable);
});

test('bot pinned choices + auto ends match bot-appearance.js', () => {
  const choices = botAppearance.match(/BOT_COLOR_CHOICES = \[([^\]]+)\]/);
  assert.ok(choices, 'BOT_COLOR_CHOICES not found');
  const jsChoices = [...choices[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]).filter((id) => id !== 'auto');
  const swiftChoices = swift.match(/let choices = \[([^\]]+)\]/);
  assert.ok(swiftChoices, 'Swift bot choices not found');
  const swiftList = [...swiftChoices[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(swiftList, jsChoices);
  assert.match(botAppearance, /BOT_DEFAULT_COLOR_LIGHT = "encre"/);
  assert.match(botAppearance, /BOT_DEFAULT_COLOR_DARK = "creme"/);
  assert.match(swift, /return isDark \? "creme" : "encre"/);
});

test('character RGB values match the Windows MonitorWidgetWindow literals', () => {
  const windows = read('TokenTrackerWin/MonitorWidgetWindow.cs');
  const cases = {
    clawd: /case PetWindow\.CharacterClawd: color = System\.Windows\.Media\.Color\.FromRgb\((\d+), (\d+), (\d+)\);/,
    sprout: /case PetWindow\.CharacterSprout: color = System\.Windows\.Media\.Color\.FromRgb\((\d+), (\d+), (\d+)\);/,
    byte: /case PetWindow\.CharacterByte: color = System\.Windows\.Media\.Color\.FromRgb\((\d+), (\d+), (\d+)\);/,
    ember: /case PetWindow\.CharacterEmber: color = System\.Windows\.Media\.Color\.FromRgb\((\d+), (\d+), (\d+)\);/,
    yeacat: /case PetWindow\.CharacterYeacat: color = System\.Windows\.Media\.Color\.FromRgb\((\d+), (\d+), (\d+)\);/,
  };
  const swiftTable = parseSwiftTable('characterColors');
  for (const [id, re] of Object.entries(cases)) {
    const m = windows.match(re);
    assert.ok(m, 'Windows dot case for ' + id + ' not found');
    assert.deepStrictEqual(swiftTable[id], { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) },
      id + ' dot must match MonitorWidgetWindow.ApplyStyle');
  }
  // Default fallback (gengxu / user-installed pets) is the same neutral gray.
  const fallback = windows.match(/System\.Windows\.Media\.Color color = System\.Windows\.Media\.Color\.FromRgb\((\d+), (\d+), (\d+)\);/);
  assert.ok(fallback, 'Windows default dot color not found');
  assert.deepStrictEqual(swift.match(/static let fallback = RGB\(r: (\d+), g: (\d+), b: (\d+)\)/).slice(1).map(Number),
    [Number(fallback[1]), Number(fallback[2]), Number(fallback[3])]);
});

test('mac divergence: island dot always follows the pet; tray style owns the menu bar only', () => {
  const windows = read('TokenTrackerWin/MonitorWidgetWindow.cs');
  const pill = read('TokenTrackerMac/Sources/IslandCapsule.swift');
  const tray = read('TokenTrackerMac/Sources/StatusItemController.swift');
  // Windows ApplyStyle still conflates the two settings (reference contract).
  assert.match(windows, /style == "lightning"\s*[\r\n]*[\s\S]*?FromRgb\(/);
  assert.match(windows, /_accent\.Visibility = Visibility\.Collapsed/);
  // The mac island dot has NO tray-style branch: every style keeps the
  // per-character dot (owner request 2026-11-10, noted in the Swift comment).
  assert.ok(!/appearance\.trayStyle/.test(pill),
    'IslandCapsule dot must not branch on trayStyle');
  assert.match(pill, /DELIBERATE macOS divergence from Windows/);
  // The dot view is never swapped out for a cat animation anymore.
  assert.match(pill, /dotView\?\.isHidden = false/);
  // The tray style keeps its real job: the menu-bar icon (cat/mascot/lightning).
  for (const style of ['"cat"', '"mascot"', 'default']) {
    assert.ok(tray.includes(`case ${style}`) || style === 'default',
      `tray style ${style} missing in StatusItemController`);
  }
  assert.match(tray, /catFrameTimer/);
  assert.match(tray, /isTemplate = true/);
});
