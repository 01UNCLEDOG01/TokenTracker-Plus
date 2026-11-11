// Check a macOS payload against the checkout that built it — the counterpart of
// verify-windows-package.cjs.
//
//   node scripts/verify-macos-package.cjs [path/to/.app] [report.json]
//
// Same lesson as the Windows gate (2026-11-09 FDD near-miss): source-consistency
// comparisons alone are NOT sufficient — the payload must carry its own runtime
// sentinels, checked here BEFORE any Release asset is produced.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const appDir = path.resolve(process.argv[2] || "TokenTrackerMac/build/TokenTracker-plus.app");
const reportPath = process.argv[3];
const runtime = path.join(appDir, "Contents", "Resources", "EmbeddedServer", "tokentracker");
const resources = path.join(appDir, "Contents", "Resources", "EmbeddedServer");

// The native chain's executable is the Xcode product name ("TokenTracker Plus");
// the earlier webview shell used "TokenTracker-plus". Derive it from Info.plist
// instead of hardcoding a name — the 2026-11-11 chain switch silently broke this
// gate (the shipped app never passed verify).
const infoPlistPath = path.join(appDir, "Contents", "Info.plist");
const plistText = fs.readFileSync(infoPlistPath, "utf8");
const execName = (plistText.match(/<key>CFBundleExecutable<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
assert.ok(execName, "Info.plist is missing CFBundleExecutable");
const bundleId = (plistText.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
assert.equal(bundleId, "com.tokentrackerplus.mac", `Unexpected bundle id: ${bundleId}`);

const required = [
  path.join(appDir, "Contents", "MacOS", execName),
  infoPlistPath,
  // Runtime sentinels: the embedded node binary and the PET dashboard pages the
  // desktop pet/widget load. A non-PET dist or a missing node binary passes every
  // source comparison below and still kills the shell at startup.
  path.join(resources, "node-arm64"),
  path.join(resources, "node-x64"),
  path.join(runtime, "bin", "tracker.js"),
  path.join(runtime, "package-lock.json"),
  ...["index.html", "pet.html", "quota.html", "share.html", "privacy.html", "ip-check.html", "leaderboard.html"]
    .map(name => path.join(runtime, "dashboard", "dist", name)),
];
for (const file of required) {
  assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing ${path.relative(appDir, file)}`);
}
// The WidgetKit extension MUST ship and MUST be a real, registerable widget.
// 2026-11-12: the fork re-enabled it after proving (on macOS 27.2) that pkd
// registers an ad-hoc signed, sandboxed appex which declares
// com.apple.widgetkit-extension — no paid Developer ID and no App Group needed.
// A missing appex, a missing declaration, a version mismatch or a stripped
// sandbox entitlement are all red: each silently yields a widget that can
// never appear (or that reads an empty container and renders "no data").
const plugInsDir = path.join(appDir, "Contents", "PlugIns");
const appexName = "TokenTrackerWidget.appex";
const appexDir = path.join(plugInsDir, appexName);
assert.ok(fs.existsSync(appexDir), `Missing widget extension: Contents/PlugIns/${appexName}`);
const appexPlistText = fs.readFileSync(path.join(appexDir, "Contents", "Info.plist"), "utf8");
assert.match(appexPlistText, /<key>NSExtension<\/key>/, "Widget extension has no NSExtension dict");
assert.match(
  appexPlistText,
  /<key>NSExtensionPointIdentifier<\/key>\s*<string>com\.apple\.widgetkit-extension<\/string>/,
  "Widget extension must declare com.apple.widgetkit-extension",
);
assert.match(
  appexPlistText,
  /<key>CFBundleDisplayName<\/key>\s*<string>TokenTracker Widgets<\/string>/,
  "Widget extension must carry its gallery display name",
);
const plistString = (text, key) =>
  (text.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]+)</string>`)) || [])[1];
const appShortVersion = plistString(plistText, "CFBundleShortVersionString");
assert.equal(
  plistString(appexPlistText, "CFBundleShortVersionString"),
  appShortVersion,
  "Widget version must match the app version",
);
assert.equal(
  plistString(appexPlistText, "CFBundleVersion"),
  plistString(plistText, "CFBundleVersion"),
  "Widget CFBundleVersion must match the app version",
);
assert.equal(
  plistString(appexPlistText, "CFBundleIdentifier"),
  "com.tokentrackerplus.mac.widget",
  "Unexpected widget bundle id",
);
const appexEntitlements = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", appexDir], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
assert.match(appexEntitlements, /com\.apple\.security\.app-sandbox/, "Widget extension is not sandboxed");
assert.doesNotMatch(
  appexEntitlements,
  /application-groups/,
  "Widget extension must not claim an App Group (requires a provisioning profile we do not have)",
);
execFileSync("codesign", ["--verify", appexDir]);

// The shipped app is universal; a package-macos.sh regression that skips the
// appex lipo step would silently ship an arm64-only widget (invisible to Intel
// users, and impossible to catch by eye on an Apple-silicon build machine).
const appexBinary = path.join(appexDir, "Contents", "MacOS", "TokenTrackerWidget");
const appexArchs = execFileSync("lipo", ["-archs", appexBinary], { encoding: "utf8" }).trim();
for (const arch of ["x86_64", "arm64"]) {
  assert.ok(appexArchs.split(/\s+/).includes(arch), `Widget binary is not universal (missing ${arch}): ${appexArchs}`);
}

// The whole bundle must verify under strict rules — not just the appex. Strict
// verification catches a broken seal (e.g. a file edited after signing), which
// the plain per-component checks above would miss.
execFileSync("codesign", ["--verify", "--deep", "--strict", appDir]);

// The embedded native-arch node must actually run and match the pinned version.
const nativeTag = process.arch === "arm64" ? "node-arm64" : "node-x64";
const bundledNode = path.join(resources, nativeTag);
const nodeVersion = execFileSync(bundledNode, ["-p", "process.versions.node"], { encoding: "utf8" }).trim();
assert.equal(nodeVersion, "22.22.2", `Bundled Node drifted: ${nodeVersion}`);

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), `Unexpected package link: ${entry.name}`);
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? files(filename) : [filename];
  });
}
let matched = 0;
for (const name of ["src", "dashboard/dist", "bin/tracker.js", "package.json", "package-lock.json"]) {
  const source = path.join(root, name);
  const expected = fs.statSync(source).isDirectory() ? files(source) : [source];
  const target = path.join(runtime, name);
  const actual = fs.statSync(target).isDirectory() ? files(target) : [target];
  assert.deepEqual(actual.map(file => path.relative(target, file)).sort(),
    expected.map(file => path.relative(source, file)).sort(), `File inventory differs: ${name}`);
  for (const file of expected) {
    assert.deepEqual(fs.readFileSync(path.join(runtime, path.relative(root, file))), fs.readFileSync(file),
      `Embedded input differs: ${path.relative(root, file)}`);
    matched++;
  }
}
const packageFiles = files(appDir);
for (const file of packageFiles) {
  assert.ok(!/^(?:\.env(?:\..*)?|project\.json|credentials\.json|.*private.*\.pem)$/i.test(path.basename(file)),
    `Private configuration in package: ${path.relative(appDir, file)}`);
}
// 陈旧 dist 门禁（站主令 2026-10-31）：与 Windows 侧同款，dist 必须携带与当前
// dashboard/src 一致的树指纹。
const { assertFresh } = require("./dashboard-fingerprint.cjs");
assertFresh(path.join(runtime, "dashboard", "dist"));
// Version across package.json / Info.plist must agree.
const plist = plistText;
const plistVersion = (plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
const packageVersion = JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8")).version;
assert.equal(plistVersion, packageVersion, `Info.plist version ${plistVersion} != package.json ${packageVersion}`);
const report = {
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  version: packageVersion,
  matchedInputs: matched,
  nodeVersion, nativeTag,
  files: packageFiles.map(file => {
    const bytes = fs.readFileSync(file);
    return { path: path.relative(appDir, file), bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }),
};
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceSha: report.sourceSha, version: report.version,
  matchedInputs: matched, nodeVersion, nativeTag, packageFiles: packageFiles.length }));
