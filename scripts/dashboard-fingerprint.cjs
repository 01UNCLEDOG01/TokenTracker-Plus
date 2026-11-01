#!/usr/bin/env node
/**
 * scripts/dashboard-fingerprint.cjs
 *
 * 陈旧 dist 门禁（站主令 2026-10-31：陈旧 dist 事故 5+ 次后的结构化堵死）。
 *
 * dashboard 侧改动（福利卡/宠物/文案…）只有在「重新 PET 构建」后才会进入
 * dashboard/dist；过去发版链只校验「载荷 == 磁盘 dist」，磁盘 dist 本身陈旧
 * 时门禁是瞎的。本脚本把 dist 绑定到 dashboard/src + dashboard/public 两棵树的
 * 哈希上（图集/品牌标在 public，只扫 src 对「手工改图集」是瞎的）：
 *
 *   --write              构建后调用：把当前 src+public 树哈希写进 dashboard/dist/build-fingerprint.json
 *   --check <distDir>    发版链 verify 调用：dist 内指纹 vs 当前 src+public 树哈希，不一致即拒绝
 *
 * dashboard/package.json 的 build 串已接 --write，verify-windows-package.cjs 已接 --check。
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
// 指纹覆盖 src + public 两棵树：宠物图集/品牌标等静态资产在 public、不在 src——
// 只扫 src 的旧版对「手工改图集」是瞎的（2026-11-01 并行会话对抗性审查抓到的洞）。
const HASH_ROOTS = [
  path.join(ROOT, "dashboard", "src"),
  path.join(ROOT, "dashboard", "public"),
];
const FINGERPRINT_NAME = "build-fingerprint.json";

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/** dashboard/src + dashboard/public 树哈希：仓库相对路径 + 每文件 sha256 一起进总哈希。 */
function computeSrcHash() {
  const files = HASH_ROOTS.flatMap((root) => walk(root, []).map((file) => ({
    rel: path.relative(ROOT, file).replaceAll("\\", "/"),
    body: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }))).sort((a, b) => (a.rel < b.rel ? -1 : 1));
  const hash = crypto.createHash("sha256");
  for (const f of files) hash.update(`${f.rel}\n${f.body}\n`);
  return hash.digest("hex");
}

function writeFingerprint() {
  const dist = path.join(ROOT, "dashboard", "dist");
  if (!fs.existsSync(dist)) throw new Error("dashboard/dist 不存在——先跑 vite build 再写指纹");
  const payload = { algorithm: "sha256", hash: computeSrcHash(), generatedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dist, FINGERPRINT_NAME), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`dashboard fingerprint written: ${payload.hash.slice(0, 16)}…`);
}

/** 供 verify-windows-package.cjs 调用：dist 指纹与当前 src 不一致即抛错。 */
function assertFresh(distDir) {
  const marker = path.join(distDir, FINGERPRINT_NAME);
  if (!fs.existsSync(marker)) {
    throw new Error("dist 缺 build-fingerprint.json（早于门禁上线的构建）——重跑 PET dashboard 构建后再验");
  }
  const recorded = JSON.parse(fs.readFileSync(marker, "utf8")).hash;
  const current = computeSrcHash();
  if (recorded !== current) {
    throw new Error(`dashboard/dist 落后于 dashboard/src|public（指纹 ${recorded.slice(0, 12)}… ≠ 当前 ${current.slice(0, 12)}…）——重跑 TOKENTRACKER_BUILD_PET=1 dashboard 构建后再验，不准进 ISCC`);
  }
}

module.exports = { computeSrcHash, assertFresh };

if (require.main === module) {
  if (process.argv.includes("--write")) writeFingerprint();
  else if (process.argv.includes("--check")) {
    const distDir = process.argv[process.argv.indexOf("--check") + 1];
    if (!distDir) throw new Error("usage: --check <embeddedDistDir>");
    assertFresh(distDir);
    console.log("dashboard fingerprint ok: dist 与 dashboard/src+public 一致");
  } else console.log(computeSrcHash());
}
