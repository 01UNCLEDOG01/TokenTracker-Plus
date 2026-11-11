'use strict';

// Native <-> dashboard settings contract for the SHIPPING macOS chain
// (TokenTrackerMac/TokenTrackerBar). B2a added host identity + capability flags
// to `getSettings`, moved the pet page from a WebView2-only transport probe to a
// capability probe, and made limits preferences pass the dashboard's full
// provider registry through. The dashboard gates real UI on each key below, so
// these assertions are the drift guard: dropping or renaming one fails here
// instead of silently hiding a control in the app.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

const nativeBridge = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Services/NativeBridge.swift');
const limitsStore = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Models/LimitsSettingsStore.swift');
const dashboardBridge = read('dashboard/src/lib/native-bridge.js');

function between(source, start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, 'missing marker: ' + start);
  const to = source.indexOf(end, from);
  assert.ok(to > from, 'missing end marker: ' + end);
  return source.slice(from, to);
}

const pushSettings = between(nativeBridge, 'func pushSettings()', 'func pushPetSettings()');
const pushPetSettings = between(nativeBridge, 'func pushPetSettings()', '// MARK: - Setters');
const applyPetSetting = between(nativeBridge, 'private func applyPetSetting', 'private func setLaunchAtLogin');

test('macOS getSettings advertises platform + host capability keys', () => {
  // Dashboard gates: SettingsPage/MenuBarSection read `platform`; B2b hides the
  // dead WidgetKit gallery on widgetGallerySupported=false; B3c toggles the
  // quota panel on quotaWindow; the pet page probes petBridge.
  assert.match(pushSettings, /"platform": "macos"/, 'getSettings must report platform "macos"');
  assert.match(pushSettings, /"petBridge": true/, 'getSettings must advertise petBridge: true');
  // The quota PANEL does not exist until B3c (no QuotaPanelController yet), so
  // advertising true would ship a 桌面限额 toggle that turns nothing on. B3c
  // flips this to true in the same commit that lands the window.
  assert.match(pushSettings, /"quotaWindow": false/,
    'getSettings must advertise quotaWindow: false until B3c ships the window');
  assert.doesNotMatch(pushSettings, /"quotaWindow": true/,
    'quotaWindow must never be advertised true before the window exists (dead control)');
  assert.match(pushSettings, /"widgetGallerySupported": false/,
    'getSettings must advertise widgetGallerySupported: false (WidgetKit appex is not shipped)');
  assert.match(pushSettings, /"trayIconStyles": MenuBarIconStyle\.allCases/,
    'getSettings must list the supported tray/icon styles');
  // The pet page filters its controls on the finer host capabilities: macOS has
  // no free-floating island and no pose action lock, so it must say so instead of
  // rendering dead controls that write values it ignores.
  assert.match(pushSettings, /"islandModes": \["island"\]/,
    'getSettings must advertise islandModes: ["island"] (no 自由悬浮 on macOS)');
  assert.match(pushSettings, /"petActionLockSupported": false/,
    'getSettings must advertise petActionLockSupported: false (pose filter not implemented)');
  // Additive-only: the pre-existing keys the dashboard already renders must stay.
  for (const key of ['showStats', 'menuBarItems', 'menuBarAvailableItems', 'menuBarMaxItems',
    'menuBarIconStyle', 'dynamicIslandEnabled', 'dynamicIslandSupported', 'hideMenuBarIcon',
    'version', 'locale', 'currency', 'currencySymbol', 'exchangeRate', 'limitsDisplayMode',
    'limitsPreferences', 'launchAtLogin', 'launchAtLoginSupported']) {
    assert.ok(pushSettings.includes('"' + key + '"'), 'getSettings lost the existing key ' + key);
  }
});

test('pet channel accepts the richer dashboard settings and echoes its capabilities', () => {
  // Every key the dashboard's pet page can send must have a handler, or the
  // control is silently dead in the native app.
  for (const key of ['visible', 'character', 'botColor', 'size', 'monitor', 'islandMode',
    'quota', 'trayStyle', 'actionLock']) {
    assert.ok(applyPetSetting.includes('case "' + key + '"'),
      'applyPetSetting must handle "' + key + '"');
  }
  for (const key of ['visible', 'character', 'botColor', 'size', 'monitor', 'islandMode',
    'trayStyle']) {
    assert.ok(pushPetSettings.includes('"' + key + '":'),
      'pushPetSettings must echo "' + key + '" so the page converges');
  }
  // actionLock is accepted + persisted, but NOT advertised: the pose filter is not
  // implemented yet (getSettings says petActionLockSupported:false), so echoing it
  // would put a live-looking control in front of a no-op.
  assert.doesNotMatch(pushPetSettings, /"actionLock":/,
    'pushPetSettings must not advertise the unimplemented actionLock');
  // Same rule for the quota window: applyPetSetting still persists it, but the
  // capability stays unadvertised until QuotaPanelController ships (B3c).
  assert.doesNotMatch(pushPetSettings, /"quota":/,
    'pushPetSettings must not echo the unimplemented quota window');
  assert.match(applyPetSetting, /case "quota"/,
    'applyPetSetting must still accept + persist a quota value from an older dashboard');
  // A catalog refresh must be answered by another push, otherwise the pet page
  // keeps the pre-import list until an unrelated setting changes.
  const refresh = between(nativeBridge, 'case "refreshPetCatalog":', 'case "getSystemAppearance"');
  assert.match(refresh, /PetCatalog\.shared\.refresh\(\)/);
  assert.match(refresh, /pushPetSettings\(\)/,
    'refreshPetCatalog must re-push pet settings after refreshing the catalog');
});

test('dashboard treats a WKWebView host that advertises petBridge as a native pet host', () => {
  const probe = between(dashboardBridge, 'export function isPetBridgeAvailable()', 'function postPetMessage');
  // Keep the historical Windows marker...
  assert.match(probe, /window\.chrome\?\.webview/, 'isPetBridgeAvailable must keep the WebView2 marker');
  // ...and accept the macOS capability reply, which is the only signal there is
  // (WKWebView has no chrome.webview).
  assert.match(probe, /nativeSettingsDetail\?\.petBridge === true/,
    'isPetBridgeAvailable must accept a petBridge:true getSettings reply');
  // The pet channel must reach WKWebView too, not only window.chrome.webview.
  assert.match(between(dashboardBridge, 'function postPetMessage', 'export function requestNativePetSettings'),
    /return post\(message\);/,
    'pet-channel posts must route through the shared WKWebView/WebView2 transport');
});

test('native limits preferences pass unknown provider ids through', () => {
  // The dashboard registry is the source of truth for provider ids; the native
  // build renders a subset. Any native id the dashboard does not know would be
  // dropped by the dashboard's normalizeOrder on the next echo.
  const dashboardRegistry = between(
    read('dashboard/src/lib/limits-providers.js'), 'export const LIMIT_PROVIDER_IDS = [', '];');
  const dashboardIds = [...dashboardRegistry.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]);
  assert.ok(dashboardIds.length >= 20, 'expected the dashboard provider registry');

  const nativeList = between(limitsStore, 'static let allProviders: [String] = [', '\n');
  const nativeIds = [...nativeList.matchAll(/"([A-Za-z0-9]+)"/g)].map((m) => m[1]);
  assert.ok(nativeIds.length >= 20, 'expected the native provider catalog');
  for (const id of nativeIds) {
    assert.ok(dashboardIds.includes(id),
      'native provider "' + id + '" is not in the dashboard registry (the web would drop it)');
  }

  // The old normalizeProviderOrder filtered on allProviders and echoed the
  // truncated list; it must now accept unknown ids instead.
  const orderNormalizer = between(limitsStore, 'private static func normalizeProviderOrder', 'private static func normalizeProviderVisibility');
  assert.doesNotMatch(orderNormalizer, /guard allProviders\.contains\(rawId\)/,
    'normalizeProviderOrder must not filter the incoming order to allProviders');
  assert.match(orderNormalizer, /isBridgeProviderID/, 'normalizeProviderOrder must still validate ids');
  assert.match(orderNormalizer, /for id in allProviders where !seen\.contains\(id\)/,
    'known ids missing from the snapshot must still be appended');

  // The bridge echoes + persists the full order, while the native list is its
  // renderable subset.
  assert.match(limitsStore, /"providerOrder": bridgeProviderOrder,/,
    'limitsPreferences must echo the full pass-through order');
  assert.match(limitsStore, /userDefaults\.set\(bridgeProviderOrder, forKey: Self\.orderKey\)/,
    'the full order must be persisted (defaults read LimitsProviderOrder keeps every id)');
  assert.match(limitsStore, /nativeProviderOrder\(from:/,
    'the native list must be derived from the full order');
  // Visibility is pass-through for the same reason.
  const visibilityNormalizer = between(limitsStore, 'private static func normalizeProviderVisibility(_ raw: [String: Any]?)', 'private static func normalizeProviderVisibility(_ raw: [String: Bool])');
  assert.match(visibilityNormalizer, /for \(id, value\) in raw \?\? \[:\] where !allProviders\.contains\(id\)/,
    'normalizeProviderVisibility must pass unknown ids through');
});
test('pet page hides host-unsupported controls instead of writing ignored values', () => {
  const petPage = read('dashboard/src/pages/PetPage.jsx');
  const declarations = read('dashboard/src/lib/native-bridge.d.ts');

  // 自由悬浮 is filtered against the host's islandModes (macOS advertises only
  // ["island"]), and a single-mode segmented control is not rendered at all.
  assert.match(petPage, /nativeSettings\.settings\?\.islandModes/,
    'PetPage must read the host islandModes capability');
  assert.match(petPage, /islandModeOptions\.length > 1/,
    'PetPage must hide the island style row when the host offers only one mode');
  // The 动作 picker is gated on petActionLockSupported; the native host says false.
  assert.match(petPage, /petActionLockSupported !== false/,
    'PetPage must hide the action picker when the host does not support it');
  // Both probes drive the render, not just internal state.
  assert.match(petPage, /showActionPicker/, 'the action section must be capability-gated');
  // 桌面限额 is gated on quotaWindow; until B3c the host says false.
  assert.match(petPage, /nativeSettings\.settings\?\.quotaWindow/,
    'PetPage must read the host quotaWindow capability');
  assert.match(petPage, /showQuotaToggle/, 'the quota row must be capability-gated');
  assert.match(petPage, /\{showQuotaToggle \?/, 'the quota row must render through the capability gate');

  // New bridge exports/types are declared for TS consumers.
  assert.match(declarations, /export function getCachedNativeSettings\(\): NativeHostSettings \| null/,
    'native-bridge.d.ts must declare getCachedNativeSettings');
  assert.match(declarations, /export function hasNativeCapability\(name: string\): boolean/,
    'native-bridge.d.ts must declare hasNativeCapability');
  assert.match(declarations, /islandModes\?: Array<"island" \| "float">/,
    'native-bridge.d.ts must type islandModes');
  assert.match(declarations, /petActionLockSupported\?: boolean/,
    'native-bridge.d.ts must type petActionLockSupported');
  assert.match(dashboardBridge, /export function getCachedNativeSettings\(\)/);
  assert.match(dashboardBridge, /export function hasNativeCapability\(name\)/);
});
