const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8").replace(/\r\n/g, "\n");
}

test("Windows tray runs the upstream check manually and never installs", () => {
  const source = readSource("TokenTrackerWin/TrayApplicationContext.cs");

  assert.match(
    source,
    /_updateChecker\.CheckAsync\(silent: false\)/,
    "the tray action must run an explicit foreground check",
  );
  assert.doesNotMatch(
    source,
    /_updateChecker\.CheckAsync\(silent: true\)/,
    "no launch or periodic silent check may run: the check is read-only",
  );
  assert.doesNotMatch(source, /_updateCheckTimer/, "the periodic update timer must be gone");
  assert.doesNotMatch(source, /DownloadAndInstallAsync/, "the tray must not download or install upstream builds");
  assert.doesNotMatch(source, /QuitRequested/, "the tray must not hand off to an installer");
  assert.doesNotMatch(source, /IntegrityCheckFailed/, "installer integrity handling is unreachable and must stay out");
});

test("UpdateChecker is a read-only upstream version check", () => {
  const source = readSource("TokenTrackerWin/UpdateChecker.cs");

  assert.match(source, /if \(silent\)/, "background checks must short-circuit");
  assert.match(source, /CheckOutcome\.Skipped/, "a skipped background check must be explicit");
  assert.match(source, /FetchLatestAsync/, "the checker must resolve the upstream release tag");
  assert.doesNotMatch(source, /DownloadAndInstallAsync/, "no install entry point may exist");
  assert.doesNotMatch(source, /ResumableDownloader/, "no installer downloader may exist");
  assert.doesNotMatch(source, /LaunchSilentInstaller/, "no silent installer launcher may exist");
  assert.doesNotMatch(source, /QuitRequested|IntegrityCheckFailed/, "no install hand-off events may exist");
});
