const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { verifyTree, mirrorTree, pruneStash, countFiles, awaitStartup } = require("../scripts/mirror-installed.cjs");

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

// KI-037: a slow cold start used to be reported as a failed hot update. The
// verdict must distinguish "never came up" from "came up during the grace
// window" — the latter is a success, and the retry hint must not fire.
test("暂存修剪保留最近 N 份，且绝不碰非 dist 命名的目录", () => {
  const stamps = [
    "2026-10-30T10-00-00-000Z",
    "2026-10-30T11-00-00-000Z",
    "2026-10-30T12-00-00-000Z",
    "2026-10-30T13-00-00-000Z",
  ];
  withFixture(({ tree }) => {
    const stashRoot = path.join(path.dirname(tree), `${path.basename(tree)}-stash`);
    for (const stamp of stamps) {
      fs.mkdirSync(path.join(stashRoot, `dist-${stamp}`), { recursive: true });
      fs.writeFileSync(path.join(stashRoot, `dist-${stamp}`, "index.html"), "<html></html>");
    }
    fs.mkdirSync(path.join(stashRoot, "keep-me-by-hand"), { recursive: true });

    const { removed } = pruneStash(stashRoot, 2);
    assert.deepEqual([...removed].sort(), [`dist-${stamps[0]}`, `dist-${stamps[1]}`]);
    const left = fs.readdirSync(stashRoot).sort();
    assert.deepEqual(left, ["dist-2026-10-30T12-00-00-000Z", "dist-2026-10-30T13-00-00-000Z", "keep-me-by-hand"]);
  });
});

test("热更会自动修剪暂存（旧批次不再无限堆积）", () => {
  withFixture(({ repo, tree }) => {
    const stashRoot = path.join(path.dirname(tree), `${path.basename(tree)}-stash`);
    for (const stamp of ["2026-10-29T10-00-00-000Z", "2026-10-29T11-00-00-000Z", "2026-10-29T12-00-00-000Z"]) {
      fs.mkdirSync(path.join(stashRoot, `dist-${stamp}`), { recursive: true });
    }
    mirrorTree(tree, repo);
    mirrorTree(tree, repo);
    mirrorTree(tree, repo);
    const stashes = fs.readdirSync(stashRoot).filter((n) => n.startsWith("dist-"));
    assert.equal(stashes.length, 3, `应只保留最近 3 份，实得 ${stashes.length}`);
    assert.ok(!stashes.includes("dist-2026-10-29T10-00-00-000Z"), "最旧一份应已被修剪");
    assert.ok(!stashes.includes("dist-2026-10-29T11-00-00-000Z"), "第二旧应已被修剪");
    assert.deepEqual(verifyTree(tree, path.join(repo, "dashboard", "dist"), repo), []);
  });
});

test("MIRROR_STASH_KEEP=0 时热更后不留旧暂存", () => {
  withFixture(({ repo, tree }) => {
    mirrorTree(tree, repo);
    mirrorTree(tree, repo, { stashKeep: 0 });
    const stashRoot = path.join(path.dirname(tree), `${path.basename(tree)}-stash`);
    const stashes = fs.existsSync(stashRoot) ? fs.readdirSync(stashRoot) : [];
    assert.deepEqual(stashes, []);
  });
});

test("startup inside the main budget is a primary success", async () => {
  const calls = [];
  const verdict = await awaitStartup("http://127.0.0.1:1", {
    probe: async (_url, ms) => { calls.push(ms); return true; },
    log: () => {},
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.phase, "primary");
  assert.equal(calls.length, 1, "grace probe must not run when the first budget succeeds");
});

test("startup that only answers inside the grace window counts as success", async () => {
  const calls = [];
  const logs = [];
  const verdict = await awaitStartup("http://127.0.0.1:1", {
    timeoutMs: 180000,
    graceMs: 60000,
    probe: async (_url, ms) => { calls.push(ms); return calls.length > 1; },
    log: (line) => logs.push(line),
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.phase, "grace");
  assert.deepEqual(calls, [180000, 60000]);
  assert.match(logs.join("\n"), /宽限/);
});

test("a server that never answers fails only after both budgets", async () => {
  const calls = [];
  const verdict = await awaitStartup("http://127.0.0.1:1", {
    timeoutMs: 1000,
    graceMs: 2000,
    probe: async (_url, ms) => { calls.push(ms); return false; },
    log: () => {},
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.phase, "failed");
  assert.deepEqual(calls, [1000, 2000]);
});

