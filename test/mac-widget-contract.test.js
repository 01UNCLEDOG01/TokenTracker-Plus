'use strict';

// WidgetKit extension contract. 2026-11-12: the fork re-enabled the vendored
// widget after proving (macOS 27.2) that an ad-hoc signed, sandboxed appex
// declaring com.apple.widgetkit-extension registers with pkd — no paid
// Developer ID and no App Group. These assertions keep the four things that
// silently break it from drifting apart again:
//   1. the declaration (Info.plist + project.yml documentation),
//   2. the embed + sandbox settings in the committed pbxproj,
//   3. the data path id (host writes where the sandboxed widget reads),
//   4. the packaging/verification chain (ship + sign + require it).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const WIDGET_BUNDLE_ID = 'com.tokentrackerplus.mac.widget';
const widgetPlist = () => read('TokenTrackerMac/TokenTrackerBar/TokenTrackerWidget/Info.plist');

test('widget extension declares the WidgetKit extension point', () => {
  const plist = widgetPlist();
  assert.match(plist, /<key>NSExtension<\/key>/);
  assert.match(
    plist,
    /<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.widgetkit-extension<\/string>/,
  );
  // The gallery label comes from CFBundleDisplayName; without it the widget
  // shows as the bare product name (or not at all if the plist is malformed).
  assert.match(plist, /<key>CFBundleDisplayName<\/key>\s*<string>TokenTracker Widgets<\/string>/);
  // Version must be build-setting driven so package-macos.sh can stamp it and
  // verify-macos-package.cjs can compare it to the app version.
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
  assert.match(plist, /<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
  assert.doesNotMatch(plist, /application-groups/, 'no App Group: it needs a provisioning profile we do not have');
});

test('project.yml documents the same widget declaration it generates', () => {
  const yml = read('TokenTrackerMac/TokenTrackerBar/project.yml');
  const widgetBlock = yml.slice(yml.indexOf('TokenTrackerWidget:'));
  assert.ok(widgetBlock.length > 0, 'widget target missing from project.yml');
  assert.match(widgetBlock, /NSExtensionPointIdentifier:\s*com\.apple\.widgetkit-extension/);
  assert.match(widgetBlock, /PRODUCT_BUNDLE_IDENTIFIER:\s*com\.tokentrackerplus\.mac\.widget/);
  assert.match(widgetBlock, /ENABLE_APP_SANDBOX:\s*YES/);
  assert.doesNotMatch(widgetBlock, /application-groups/);
});

test('committed pbxproj embeds the appex and builds it sandboxed', () => {
  const pbx = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar.xcodeproj/project.pbxproj');
  assert.match(pbx, /TokenTrackerWidget\.appex in Embed Foundation Extensions/);
  assert.match(pbx, /name = "Embed Foundation Extensions"/);
  assert.match(pbx, /dstSubfolderSpec = 13;/, 'appex must land in Contents/PlugIns');
  assert.match(pbx, /remoteInfo = TokenTrackerWidget;/, 'app target must depend on the widget target');
  assert.match(pbx, /target = \w+ \/\* TokenTrackerWidget \*\/;/, 'widget target dependency must exist');
  const widgetSettings = pbx.match(/ENABLE_APP_SANDBOX = YES;\n[\s\S]{0,400}?PRODUCT_BUNDLE_IDENTIFIER = com\.tokentrackerplus\.mac\.widget;/g) || [];
  assert.ok(widgetSettings.length >= 2, 'widget target must be sandboxed in Debug and Release');
});

test('widget data path ids point at our own container', () => {
  const snapshot = read('TokenTrackerMac/TokenTrackerBar/Shared/WidgetSnapshot.swift');
  const idMatch = snapshot.match(/widgetBundleIdentifier = "([^"]+)"/);
  assert.equal(idMatch && idMatch[1], WIDGET_BUNDLE_ID,
    'host fallback must write into the widget target\'s own sandbox container');
  assert.doesNotMatch(snapshot, /group\.com\.tokentracker\.bar"/,
    'upstream group id is never provisioned in this build');
  assert.doesNotMatch(snapshot, /"com\.tokentracker\.bar\.widget"/,
    'upstream widget id would make widgets read an empty container ("no data")');
});

test('widget entitlements file is sandboxed and stays App-Group-free', () => {
  // The file codesign actually consumes. Keeping this separate from the pbxproj
  // check means re-adding an App Group entitlement (which needs a provisioning
  // profile we do not have) cannot stay green.
  const entitlements = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerWidget/TokenTrackerWidget.entitlements');
  assert.match(entitlements, /<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/,
    'widget entitlements must sandbox the extension');
  assert.match(entitlements, /<key>com\.apple\.security\.network\.client<\/key>\s*<true\/>/,
    'widget reads localhost snapshots through the network client entitlement');
  assert.doesNotMatch(entitlements, /application-groups/,
    'an App Group entitlement cannot be built without a provisioning profile');
});

test('packaging ships, stamps and signs the appex', () => {
  const script = read('TokenTrackerMac/scripts/package-macos.sh');
  assert.doesNotMatch(script, /rm -rf "\$APP_DIR\/Contents\/PlugIns\/TokenTrackerWidget\.appex"/,
    'the packaging script must not delete the widget again');
  assert.match(script, /lipo -create "\$APEX\/Contents\/MacOS\/TokenTrackerWidget"/,
    'appex binary must be lipo-merged for the universal app');
  assert.match(script, /PlistBuddy -c "Set :CFBundleShortVersionString \$VERSION" "\$APEX\/Contents\/Info\.plist"/,
    'appex version must be stamped like the app version');
  // The appex MUST be re-signed with its sandbox entitlements explicitly: a bare
  // --force --sign strips them and pkd rejects the plugin ("plug-ins must be
  // sandboxed") — that was the first packaging failure of this batch.
  const appexSign = script.indexOf('codesign --force --sign - --entitlements "$WIDGET_ENTITLEMENTS" "$APEX"');
  const appSign = script.indexOf('codesign --force --sign - "$APP_DIR"');
  assert.ok(appexSign > 0, 'the appex must be re-signed with its entitlements file');
  assert.ok(appSign > appexSign, 'the appex must be signed before the app seals it');
  assert.match(script, /WIDGET_ENTITLEMENTS="\$MAC_DIR\/TokenTrackerBar\/TokenTrackerWidget\/TokenTrackerWidget\.entitlements"/);
});

test('widgets dialog tells users to search the gallery for "TokenTracker"', () => {
  // Review P1: the gallery lists the extension as "TokenTracker Widgets", so
  // searching "TT-Plus" finds nothing. Every locale must say "TokenTracker".
  const strings = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Utilities/Strings.swift');
  const title = strings.match(/static var addWidgetsTitle: String \{ ([^}]+) \}/);
  assert.ok(title, 'addWidgetsTitle missing');
  assert.match(title[1], /TokenTracker/);
  assert.doesNotMatch(title[1], /TT-Plus/);
  const message = strings.slice(strings.indexOf('static var addWidgetsMessage'));
  const block = message.slice(0, message.indexOf('static var gotItButton'));
  // The Swift source carries escaped quotes (\"), so match the search phrase
  // structurally: the sentence must name the gallery term and never TT-Plus.
  assert.match(block, /search for/, 'the English sentence must contain a search instruction');
  assert.match(block, /TokenTracker/, 'the English sentence must name the gallery entry');
  assert.doesNotMatch(block, /TT-Plus/, 'no locale may tell users to search TT-Plus');
  assert.doesNotMatch(block, /search for[^\n]*TT-Plus/, 'the search term itself must never be TT-Plus');
  // Six locale arguments per string, like the rest of Strings.swift.
  assert.equal((block.match(/t\(/g) || []).length, 1);
  assert.ok((block.match(/\n\s+"/g) || []).length >= 6, 'message must carry six locale lines');
});

test('widget strings are six-locale (German included)', () => {
  const widgetStrings = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerWidget/Views/WidgetStrings.swift');
  assert.match(widgetStrings, /private static func t\(_ en: String, _ zhCN: String, _ zhTW: String, _ ja: String, _ ko: String, _ de: String\)/);
  assert.match(widgetStrings, /case NativeLocalization\.germanLocale: return de/);
  assert.match(widgetStrings, /Nutzung/, 'German widget labels must be present');
  // No five-argument call may remain: a partial migration would silently keep
  // English labels for German users.
  assert.doesNotMatch(widgetStrings, /t\([^)]*\),\s*\n?\s{0,8}"[^"]*"\)/);
});

test('verify-macos-package requires a registerable widget', () => {
  const verify = read('scripts/verify-macos-package.cjs');
  assert.match(verify, /Missing widget extension/, 'a missing appex must be red');
  assert.match(verify, /com\.apple\.widgetkit-extension/, 'the declaration must be checked');
  assert.match(verify, /Widget version must match the app version/);
  assert.match(verify, /Widget extension is not sandboxed/);
  assert.match(verify, /must not claim an App Group/);
  // Release-integrity guards added at review: a universal appex, a strict
  // whole-bundle signature check and a byte-identical CFBundleVersion.
  assert.match(verify, /lipo", \["-archs"/, 'the gate must inspect the appex architectures');
  assert.match(verify, /x86_64/, 'x86_64 must be required in the appex');
  assert.match(verify, /"--deep", "--strict"/, 'the app must pass strict deep verification');
  assert.match(verify, /Widget CFBundleVersion must match the app version/);
});

test('native settings advertise the widget gallery only on macOS 14+', () => {
  const bridge = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Services/NativeBridge.swift');
  // Widgets are a macOS 14 feature (the appex deployment target); the app still
  // runs on 12, where a true flag would resurrect the dead gallery entry.
  assert.match(bridge, /private static var widgetGalleryIsSupported: Bool \{\s*\n\s*if #available\(macOS 14\.0, \*\) \{ return true \}\s*\n\s*return false/,
    'the capability must be OS-gated to macOS 14');
  const payloads = [...bridge.matchAll(/"widgetGallerySupported": ([^,\n]+),/g)].map((m) => m[1].trim());
  assert.ok(payloads.length >= 2, 'both getSettings payloads must carry widgetGallerySupported');
  assert.ok(payloads.every((value) => value === 'Self.widgetGalleryIsSupported'),
    'both payloads must consult the shared OS gate');
  assert.doesNotMatch(bridge, /"widgetGallerySupported": (true|false)/,
    'no payload may hard-code the capability');
});
