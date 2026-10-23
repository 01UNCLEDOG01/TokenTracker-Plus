"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  getTrackerRootDir,
  resolveTrackerPathsSync,
  resolveTrackerPaths,
} = require("../src/lib/tracker-paths");

test("resolveTrackerPaths defaults to ~/.tokentracker when plus dir does not exist", async (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-paths-test-"));
  t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

  const paths = await resolveTrackerPaths({ home: tmpHome });
  assert.equal(paths.rootDir, path.join(tmpHome, ".tokentracker"));
  assert.equal(paths.trackerDir, path.join(tmpHome, ".tokentracker", "tracker"));
  assert.equal(paths.binDir, path.join(tmpHome, ".tokentracker", "bin"));
  assert.equal(paths.cacheDir, path.join(tmpHome, ".tokentracker", "cache"));
  assert.equal(paths.petsDir, path.join(tmpHome, ".tokentracker", "pets"));
  assert.equal(paths.skillsDir, path.join(tmpHome, ".tokentracker", "skills"));
});

test("resolveTrackerPaths resolves to ~/.tokentracker-plus when plus dir exists", async (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-paths-test-"));
  t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

  const plusDir = path.join(tmpHome, ".tokentracker-plus");
  fs.mkdirSync(plusDir, { recursive: true });

  const paths = resolveTrackerPathsSync({ home: tmpHome });
  assert.equal(paths.rootDir, plusDir);
  assert.equal(paths.trackerDir, path.join(plusDir, "tracker"));
});

test("getTrackerRootDir respects TOKENTRACKER_HOME override", async (t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-paths-test-"));
  t.after(() => fs.rmSync(tmpHome, { recursive: true, force: true }));

  const customDir = path.join(tmpHome, "custom-tokentracker");
  const prevEnv = process.env.TOKENTRACKER_HOME;
  process.env.TOKENTRACKER_HOME = customDir;
  t.after(() => {
    if (prevEnv === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = prevEnv;
  });

  const root = getTrackerRootDir({ home: tmpHome });
  assert.equal(root, customDir);
});
