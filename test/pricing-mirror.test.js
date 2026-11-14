// 价表镜像守卫（2026-11-14，站主拍板「统一价格表」）：运行副本的定价表必须与
// src/lib/pricing 逐字节一致。背景=2026-11-13 spark-x2.6 事故：本地 17680 用安装树
// 旧表兜底重算，账户汇总先显示错误高价、云端数据到达后才被纠正——根因是改价表后
// 没有同步全部运行副本。本测试把「忘了跑 mirror」从静默漂移变成红灯。
// 安装树缺失时（CI / 纯源码检出）跳过，不假红。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(REPO_ROOT, "src", "lib", "pricing");
// 两棵安装树：仓库内载荷树 + 工作区 app 树（仓库上一级，仅本机存在）。
const TREES = [
  ["payload-tree", path.join(REPO_ROOT, "TokenTrackerWin", "EmbeddedServer", "tokentracker", "src", "lib", "pricing")],
  ["app-tree", path.join(REPO_ROOT, "..", "app", "EmbeddedServer", "tokentracker", "src", "lib", "pricing")],
];

function listPricingFiles(dir) {
  return fs.readdirSync(dir).filter((name) => fs.statSync(path.join(dir, name)).isFile()).sort();
}

test("pricing tables in install trees match src byte-for-byte", (t) => {
  const srcFiles = listPricingFiles(SRC_DIR);
  assert.ok(srcFiles.length > 0, "src/lib/pricing must not be empty");
  // Skip ONCE up front: a nested test.skip() scheduled right before the parent
  // returns gets cancelled by the runner ("did not finish before its parent")
  // and paints the parent red on machines without any install tree (CI/mac).
  const present = TREES.filter(([, treeDir]) => fs.existsSync(treeDir));
  if (present.length === 0) {
    t.skip("no install tree on this machine (CI / pure source checkout)");
    return;
  }
  for (const [label, treeDir] of present) {
    const treeFiles = listPricingFiles(treeDir);
    assert.deepEqual(
      treeFiles,
      srcFiles,
      `${label}: pricing file set drifted from src — run \`npm run mirror:installed\``,
    );
    for (const name of srcFiles) {
      const a = fs.readFileSync(path.join(SRC_DIR, name));
      const b = fs.readFileSync(path.join(treeDir, name));
      assert.ok(
        a.equals(b),
        `${label}/${name}: pricing table drifted from src (stale local fallback would show wrong prices first) — run \`npm run mirror:installed\``,
      );
    }
  }
});
