const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { verifyTree, mirrorTree, countFiles } = require("../scripts/mirror-installed.cjs");

function makeRepo(root) {
  fs.mkdirSync(path.join(root, "dashboard", "dist", "assets"), { recursive: true });
  for (const f of ["index.html", "pet.html", "quota.html"]) {
    fs.writeFileSync(path.join(root, "dashboard", "dist", f), `<html>${f}</html>`);
  }
  fs.writeFileSync(path.join(root, "dashboard", "dist", "assets", "main-abc.js"), "console.log(1)");
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "src", "lib", "local-api.js"), "module.exports = 1;");
  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "bin", "cli.js"), "#!/usr/bin/env node");
}

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-test-"));
  const repo = path.join(root, "repo");
  const tree = path.join(root, "app", "EmbeddedServer", "tokentracker");
  fs.mkdirSync(tree, { recursive: true });
  makeRepo(repo);
  try {
    return fn({ repo, tree });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a mirrored tree verifies clean against the repo payload", () => {
  withFixture(({ repo, tree }) => {
    mirrorTree(tree, repo);
    assert.deepEqual(verifyTree(tree, path.join(repo, "dashboard", "dist"), repo), []);
  });
});

test("a dist without pet.html is rejected with the build-flag hint", () => {
  withFixture(({ repo, tree }) => {
    mirrorTree(tree, repo);
    fs.rmSync(path.join(tree, "dashboard", "dist", "pet.html"));
    const errors = verifyTree(tree, path.join(repo, "dashboard", "dist"), repo);
    assert.equal(errors.length, 2, errors.join(" | "));
    assert.match(errors.join("\n"), /pet\.html/);
    assert.match(errors.join("\n"), /TOKENTRACKER_BUILD_PET=1/);
  });
});

test("a stale extra chunk is caught by the file-count check", () => {
  withFixture(({ repo, tree }) => {
    mirrorTree(tree, repo);
    fs.writeFileSync(path.join(tree, "dashboard", "dist", "assets", "old-chunk.js"), "stale");
    const errors = verifyTree(tree, path.join(repo, "dashboard", "dist"), repo);
    assert.ok(errors.some((e) => /dist 有 \d+ 个文件/.test(e)), errors.join(" | "));
  });
});

test("a drifted src file is caught by the size check", () => {
  withFixture(({ repo, tree }) => {
    mirrorTree(tree, repo);
    fs.writeFileSync(path.join(tree, "src", "lib", "local-api.js"), "module.exports = 2222222;");
    const errors = verifyTree(tree, path.join(repo, "dashboard", "dist"), repo);
    const joined = errors.join(" | ").replace(/\\/g, "/");
    assert.ok(errors.some(() => /src\/lib\/local-api\.js/.test(joined) && /大小不一致/.test(joined)), joined);
  });
});

test("mirroring twice keeps the tree at the repo file count (no accumulation)", () => {
  withFixture(({ repo, tree }) => {
    mirrorTree(tree, repo);
    mirrorTree(tree, repo);
    const want = countFiles(path.join(repo, "dashboard", "dist"));
    assert.equal(countFiles(path.join(tree, "dashboard", "dist")), want);
  });
});
