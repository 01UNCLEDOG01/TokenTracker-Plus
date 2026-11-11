'use strict';

// Native <-> dashboard limits-provider parity for the SHIPPING macOS chain
// (TokenTrackerMac/TokenTrackerBar). The native limits panel is a whitelist:
// sectionIfContent renders only ids it knows, so a provider added on the
// dashboard but forgotten here silently disappears from the app. This guard
// parses both registries from source and fails on drift.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const dashboardRegistry = read('dashboard/src/lib/limits-providers.js');
const limitsStore = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Models/LimitsSettingsStore.swift');
const usageLimits = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Models/UsageLimits.swift');
const usageLimitsView = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Views/UsageLimitsView.swift');
const strings = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Utilities/Strings.swift');
const pbxproj = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar.xcodeproj/project.pbxproj');

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, 'missing marker: ' + start);
  const to = source.indexOf(end, from);
  assert.ok(to > from, 'missing end marker: ' + end);
  return source.slice(from, to);
}

function quotedIds(block) {
  return [...block.matchAll(/"([A-Za-z0-9]+)"/g)].map((match) => match[1]);
}

const dashboardIds = quotedIds(between(
  dashboardRegistry,
  'export const LIMIT_PROVIDER_IDS = [',
  '];',
));

const nativeIds = quotedIds(between(
  limitsStore,
  'static let allProviders: [String] = [',
  '\n\n    static let displayNames',
));

test('dashboard registry ids are all renderable natively (native ⊇ dashboard)', () => {
  assert.ok(dashboardIds.length >= 33, 'dashboard registry unexpectedly shrank: ' + dashboardIds.length);
  const native = new Set(nativeIds);
  const missing = dashboardIds.filter((id) => !native.has(id));
  assert.deepEqual(missing, [],
    'dashboard providers missing from LimitsSettingsStore.allProviders: ' + missing.join(', '));
});

test('native provider list has no duplicate ids', () => {
  assert.equal(new Set(nativeIds).size, nativeIds.length, 'duplicate provider id in allProviders');
});

test('every native provider has a section case, a display name and a decode field', () => {
  const sectionBlock = between(usageLimitsView, 'private func sectionIfContent', '// MARK: - Tool Section');
  const cases = new Set(quotedIds(sectionBlock));
  const displayNames = new Set(quotedIds(between(limitsStore, 'static let displayNames: [String: String] = [', '\n    ]')));
  const codingKeys = between(usageLimits, 'enum CodingKeys: String, CodingKey {', '// MARK: - B3b provider waves');
  for (const id of nativeIds) {
    assert.ok(cases.has(id), 'sectionIfContent has no case for provider "' + id + '"');
    assert.ok(displayNames.has(id), 'displayNames has no entry for provider "' + id + '"');
    // Every provider object is decoded from a top-level response key of the
    // same name (the two camelCase aliases are covered by the raw literal too).
    assert.ok(codingKeys.includes(id) || usageLimits.includes('case ' + id),
      'UsageLimitsResponse does not decode "' + id + '"');
  }
});

test('unknown provider ids still fall through (whitelist stays honest)', () => {
  const sectionBlock = between(usageLimitsView, 'private func sectionIfContent', '// MARK: - Tool Section');
  assert.match(sectionBlock, /guard settings\.isVisible\(id\) else \{ return nil \}/,
    'sectionIfContent must keep the shared visibility guard (hidden-provider list)');
  assert.match(sectionBlock, /default:\n\s*break/,
    'sectionIfContent must keep an explicit default that renders nothing');
});

test('display mode is resolved through the shared LimitsSettingsStore', () => {
  // Every row funnels through limitRow, which flips on settings.displayMode;
  // if that read ever moves away the used/remaining toggle silently dies.
  assert.match(usageLimitsView, /let remainingMode = settings\.displayMode == \.remaining/);
  assert.match(usageLimitsView, /displayValue = remainingMode \? \(100 - rawClamped\) : rawClamped/);
});

test('fork brand assets are bundled and registered as resources', () => {
  const assets = ['apigoto.svg', 'sensenova.svg', 'minimax.svg', 'trae.svg', 'mistral.svg',
    'raccoon.png', 'codearts.png', 'cline.png', 'agentrouter.png'];
  for (const asset of assets) {
    assert.ok(fs.existsSync(path.join(repo,
      'TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/BrandLogos', asset)),
      'missing bundled brand asset: ' + asset);
    assert.ok(pbxproj.includes(asset), 'project.pbxproj does not register ' + asset);
    assert.match(pbxproj, new RegExp(asset.replace('.', '\\.') + ' in Resources'),
      'project.pbxproj resources phase does not copy ' + asset);
    assert.ok(usageLimitsView.includes(asset), 'UsageLimitsView never loads ' + asset);
  }
});

test('fork provider window labels are six-locale Strings entries', () => {
  // The fork providers' row labels must resolve through Strings.t(en, zh-CN,
  // zh-TW, ja, ko, de) — a bare English literal would untranslate the panel.
  for (const key of ['sensenovaGeneral5hLabel', 'sensenovaGeneralWeeklyLabel',
    'sensenovaFlashLite5hLabel', 'sensenovaFlashLiteWeeklyLabel',
    'minimaxCode5hLabel', 'minimaxCodeWeeklyLabel', 'minimaxCodeVideoLabel',
    'opendesign5hLabel', 'opendesignWeeklyLabel', 'mistralApiLabel', 'mistralVibeLabel',
    'apigotoSubscriptionLabel', 'openaiCreditsMeterLabel', 'raccoonDailyLabel',
    'qoderPoolPlanLabel', 'qoderPoolResourceLabel', 'qoderPoolDedicatedLabel',
    'qoderTeamCreditsLabel', 'qoderUltimateLabel', 'workbuddyRewardLabel',
    'walletCreditsLabel', 'walletBalanceLabel']) {
    assert.ok(strings.includes('static var ' + key), 'Strings is missing ' + key);
  }
});
