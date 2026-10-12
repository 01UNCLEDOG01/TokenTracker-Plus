"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveLoomyDbPaths } = require("../src/lib/loomy-paths");

// One temp `Public/Loomy/<id>/share/opencode/opencode.db` per install id, with a
// sibling `user` home so discovery's `<home>/../Public` derivation lands on it
// (the resolver never reads the ambient PUBLIC variable).
function makeLayout(installs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loomy-paths-"));
  const home = path.join(root, "user");
  fs.mkdirSync(home, { recursive: true });
  const expected = [];
  for (const id of installs) {
    const dbPath = path.join(root, "Public", "Loomy", id, "share", "opencode", "opencode.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "sqlite");
    expected.push(dbPath);
  }
  return { root, home, expected };
}

test("discovers every Loomy install database under the shared Public root", (t) => {
  const { root, home, expected } = makeLayout(["016faae34f94", "aabbccdd"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const found = resolveLoomyDbPaths({ env: {}, home });
  assert.deepEqual([...found].sort(), [...expected].sort());
});

test("LOOMY_HOME accepts the install root, the share dir, or the db file", (t) => {
  const { root, expected } = makeLayout(["inst1"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dbPath = expected[0];
  const installRoot = path.join(root, "Public", "Loomy", "inst1");
  const shareDir = path.join(installRoot, "share", "opencode");
  for (const candidate of [installRoot, shareDir, dbPath]) {
    const found = resolveLoomyDbPaths({ env: { LOOMY_HOME: candidate }, home: path.join(root, "nowhere") });
    assert.deepEqual(found, [dbPath], `LOOMY_HOME=${candidate}`);
  }
});

test("missing database files are dropped and duplicates collapse", (t) => {
  const { root, home, expected } = makeLayout(["onlyone"]);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // An install directory with no database must not be reported.
  fs.mkdirSync(path.join(root, "Public", "Loomy", "empty", "share", "opencode"), { recursive: true });
  const found = resolveLoomyDbPaths({ env: { LOOMY_HOME: expected[0] }, home });
  assert.deepEqual(found, [expected[0]]);
});

test("a home without a sibling Public tree yields nothing", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loomy-none-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "user");
  fs.mkdirSync(home, { recursive: true });
  assert.deepEqual(resolveLoomyDbPaths({ env: {}, home }), []);
});
