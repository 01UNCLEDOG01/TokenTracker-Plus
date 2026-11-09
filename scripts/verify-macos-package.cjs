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

const required = [
  path.join(appDir, "Contents", "MacOS", "TokenTracker-plus"),
  path.join(appDir, "Contents", "Info.plist"),
  // Runtime sentinels: the embedded node binary and the PET dashboard pages the
  // desktop pet/widget load. A non-PET dist or a missing node binary passes every
  // source comparison below and still kills the shell at startup.
  path.join(resources, "node"),
  path.join(runtime, "bin", "tracker.js"),
  path.join(runtime, "package-lock.json"),
  ...["index.html", "pet.html", "quota.html", "share.html", "privacy.html", "ip-check.html", "leaderboard.html"]
    .map(name => path.join(runtime, "dashboard", "dist", name)),
];
for (const file of required) {
  assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `Missing ${path.relative(appDir, file)}`);
}
// The embedded node must actually run and match the pinned version.
const bundledNode = path.join(resources, "node");
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
const plist = fs.readFileSync(path.join(appDir, "Contents", "Info.plist"), "utf8");
const plistVersion = (plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/) || [])[1];
const packageVersion = JSON.parse(fs.readFileSync(path.join(runtime, "package.json"), "utf8")).version;
assert.equal(plistVersion, packageVersion, `Info.plist version ${plistVersion} != package.json ${packageVersion}`);
const report = {
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  version: packageVersion,
  matchedInputs: matched,
  nodeVersion,
  files: packageFiles.map(file => {
    const bytes = fs.readFileSync(file);
    return { path: path.relative(appDir, file), bytes: bytes.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  }),
};
if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ sourceSha: report.sourceSha, version: report.version,
  matchedInputs: matched, nodeVersion, packageFiles: packageFiles.length }));
