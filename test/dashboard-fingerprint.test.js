const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const { computeSrcHash, isFresh, HASH_FILES } = require("../scripts/dashboard-fingerprint.cjs");

// 2026-11-13: 指纹此前只覆盖 dashboard/src + public，对「只改 vite.config.js」是瞎的；
// 现在打包链拿它决定「能不能跳过重建」，漏一个输入就会把旧产物发出去。这里锁住
// 「会改变 dist 的输入必须在指纹里」，以及 isFresh 的三种判定。
test("会改变 dist 的构建输入都在指纹里", () => {
  const required = [
    "package.json",
    "dashboard/vite.config.js",
    "dashboard/index.html",
    "dashboard/pet.html",
    "dashboard/quota.html",
    "dashboard/package.json",
    "dashboard/tailwind.config.cjs",
  ];
  for (const rel of required) {
    assert.ok(fs.existsSync(path.join(repo, rel)), `${rel} 不存在，指纹清单该同步删除`);
    assert.ok(HASH_FILES.includes(rel), `${rel} 会改变 dist，却不在指纹输入里`);
  }
});

test("isFresh：缺指纹 false，指纹一致 true，指纹过期 false", (t) => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), "tt-fingerprint-"));
  t.after(() => fs.rmSync(dist, { recursive: true, force: true }));
  const marker = path.join(dist, "build-fingerprint.json");

  assert.equal(isFresh(dist), false, "没有 build-fingerprint.json 时必须判 stale");

  fs.writeFileSync(marker, JSON.stringify({ algorithm: "sha256", hash: computeSrcHash() }));
  assert.equal(isFresh(dist), true);

  fs.writeFileSync(marker, JSON.stringify({ algorithm: "sha256", hash: "0".repeat(64) }));
  assert.equal(isFresh(dist), false, "输入变了（指纹对不上）必须判 stale");

  fs.writeFileSync(marker, "{not json");
  assert.equal(isFresh(dist), false, "指纹损坏必须判 stale 而不是崩");
});
