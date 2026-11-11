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

test('verify-macos-package requires a registerable widget', () => {
  const verify = read('scripts/verify-macos-package.cjs');
  assert.match(verify, /Missing widget extension/, 'a missing appex must be red');
  assert.match(verify, /com\.apple\.widgetkit-extension/, 'the declaration must be checked');
  assert.match(verify, /Widget version must match the app version/);
  assert.match(verify, /Widget extension is not sandboxed/);
  assert.match(verify, /must not claim an App Group/);
});

test('native settings advertise the live widget gallery', () => {
  const bridge = read('TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Services/NativeBridge.swift');
  const payloads = [...bridge.matchAll(/"widgetGallerySupported": (true|false)/g)].map((m) => m[1]);
  assert.ok(payloads.length >= 1, 'pushSettings must carry widgetGallerySupported');
  assert.ok(payloads.every((value) => value === 'true'),
    'every native payload must report the gallery as supported once the appex ships');
});
