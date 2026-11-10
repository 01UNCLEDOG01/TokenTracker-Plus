'use strict';

// The macOS desktop pet hosts the SAME page as the Windows pet window
// (dashboard/src/pet.jsx), so the two hosts must agree on the window/sprite
// geometry it derives the sprite size from. They drifted once already: the mac
// shell added the raw bubble band to a hardcoded 340pt base while the page sizes
// the sprite from `innerHeight - band`, so every hover grew the pet ~33% and
// slid it upward. Keep the three sources (page, Windows host, macOS host) in
// lockstep.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const page = read('dashboard/src/pet.jsx');
const windows = read('TokenTrackerWin/PetWindow.cs');
const mac = read('TokenTrackerMac/Sources/PetPanel.swift');

const num = (source, re, label) => {
  const m = source.match(re);
  assert.ok(m, label + ' not found');
  return Number(m[1]);
};

test('min bubble band is 138 on the page, Windows host and macOS host', () => {
  assert.strictEqual(num(page, /const MIN_BUBBLE_BAND = (\d+);/, 'pet.jsx MIN_BUBBLE_BAND'), 138);
  assert.strictEqual(num(windows, /private const double MinBubbleBand = (\d+);/, 'PetWindow.cs MinBubbleBand'), 138);
  assert.strictEqual(
    num(mac, /static let minBubbleBand: CGFloat = (\d+)/, 'PetPanel.swift minBubbleBand'),
    138,
  );
});

test('macOS window width matches the Windows surface width', () => {
  const win = num(windows, /private const double WindowWidth = (\d+);/, 'PetWindow.cs WindowWidth');
  const macWidth = num(mac, /static let windowWidth: CGFloat = (\d+)/, 'PetPanel.swift windowWidth');
  assert.strictEqual(macWidth, win);
});

test('macOS base heights match Windows SizeDimensions for every preset', () => {
  const winDimensions = windows.match(
    /private static \(double Width, double Height\) SizeDimensions\(string size\) => size switch[\s\S]*?\};/,
  );
  assert.ok(winDimensions, 'PetWindow.cs SizeDimensions not found');
  const winSmall = Number(winDimensions[0].match(/SizeSmall => \(WindowWidth, (\d+)\)/)[1]);
  const winLarge = Number(winDimensions[0].match(/SizeLarge => \(WindowWidth, (\d+)\)/)[1]);
  const winMedium = Number(winDimensions[0].match(/_ => \(WindowWidth, (\d+)\)/)[1]);

  const macBlock = mac.match(/enum PetSizePreset[\s\S]*?var baseHeight: CGFloat \{([\s\S]*?)\n    \}/);
  assert.ok(macBlock, 'PetPanel.swift baseHeight switch not found');
  const macHeights = {};
  for (const preset of ['small', 'medium', 'large']) {
    const m = macBlock[1].match(new RegExp('case \\.' + preset + ': return (\\d+)'));
    assert.ok(m, 'mac baseHeight for ' + preset + ' not found');
    macHeights[preset] = Number(m[1]);
  }
  assert.deepStrictEqual(macHeights, { small: winSmall, medium: winMedium, large: winLarge });
});

test('bubble-band growth keeps height - band constant on both hosts', () => {
  // Windows: Height = baseHeight + (_bubbleBand - MinBubbleBand)
  assert.match(windows, /Height = baseHeight \+ \(_bubbleBand - MinBubbleBand\);/);
  // macOS: same formula, so pet.jsx's (innerHeight - band) sprite input is stable.
  assert.match(mac, /let target = baseHeight \+ \(bubbleBand - Self\.minBubbleBand\)/);
  // The old broken math added the raw band to a fixed base.
  assert.doesNotMatch(mac, /static let baseHeight: CGFloat = 340/);
});

test('macOS sprite hit-test uses the page sprite-size formula', () => {
  assert.match(page, /Math\.max\(40, Math\.min\(window\.innerWidth, window\.innerHeight - bubbleBand\) - 8\)/);
  assert.match(mac, /max\(40, min\(width, height - band\) - 8\)/);
});
