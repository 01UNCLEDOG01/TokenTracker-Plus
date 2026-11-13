#!/usr/bin/env node
/**
 * scripts/dashboard-fingerprint.cjs
 *
 * 陈旧 dist 门禁（站主令 2026-10-31：陈旧 dist 事故 5+ 次后的结构化堵死）。
 *
 * dashboard 侧改动（福利卡/宠物/文案…）只有在「重新 PET 构建」后才会进入
 * dashboard/dist；过去发版链只校验「载荷 == 磁盘 dist」，磁盘 dist 本身陈旧
 * 时门禁是瞎的。本脚本把 dist 绑定到 dashboard 构建输入的哈希上（src/public 两棵
 * 树 + 配置/入口文件，图集/品牌标在 public，只扫 src 对「手工改图集」是瞎的）：
 *
 *   --write              构建后调用：把当前构建输入哈希写进 dashboard/dist/build-fingerprint.json
 *   --check <distDir>    发版链 verify 调用：dist 内指纹 vs 当前输入哈希，不一致即拒绝
 *   --is-fresh <distDir> 打包链调用：一致时退出 0（可跳过重复构建），否则 1
 *
 * dashboard/package.json 的 build 串已接 --write，verify-windows-package.cjs 已接 --check，
 * bundle-node.ps1 / mirror-installed.cjs 已接 --is-fresh。
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
// 指纹覆盖 src + public 两棵树：宠物图集/品牌标等静态资产在 public、不在 src——
// 只扫 src 的旧版对「手工改图集」是瞎的（2026-11-01 并行会话对抗性审查抓到的洞）。
// 2026-11-13 补齐其余构建输入：vite/vitest 配置、入口 HTML、package/lock、构建脚本
// 都会改变 dist 产物。补之前的指纹对「只改 vite.config.js」是瞎的，拿它跳过构建
// 会把旧产物发出去。dashboard/scripts 里的 copy-registry 插件也属于构建输入。
const HASH_ROOTS = [
  path.join(ROOT, "dashboard", "src"),
  path.join(ROOT, "dashboard", "public"),
  path.join(ROOT, "dashboard", "scripts"),
];
const HASH_FILES = [
  // 根 package.json 的 version 会经 vite.config.js 的 loadAppVersion 注进产物；
  // 不在指纹里的话，发版 bump 版本后打包链会跳过重建、装出旧版本号的页面。
  "package.json",
  "dashboard/vite.config.js",
  "dashboard/vitest.config.ts",
  "dashboard/index.html",
  "dashboard/pet.html",
  "dashboard/quota.html",
  "dashboard/share.html",
  "dashboard/package.json",
  "dashboard/package-lock.json",
  "dashboard/postcss.config.cjs",
  "dashboard/tailwind.config.cjs",
  "dashboard/tsconfig.json",
  "dashboard/vercel.json",
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

/** 所有会进入 dist 的输入文件（树 + 单文件）。缺失的路径跳过，由构建自己报错。 */
function collectInputs() {
  const files = [];
  for (const root of HASH_ROOTS) {
    if (fs.existsSync(root)) files.push(...walk(root, []));
  }
  for (const rel of HASH_FILES) {
    const full = path.join(ROOT, rel);
    if (fs.existsSync(full)) files.push(full);
  }
  return files;
}

/** dashboard 构建输入哈希：仓库相对路径 + 每文件 sha256 一起进总哈希。 */
function computeSrcHash() {
  const files = collectInputs().map((file) => ({
    rel: path.relative(ROOT, file).replaceAll("\\", "/"),
    body: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  })).sort((a, b) => (a.rel < b.rel ? -1 : 1));
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

/** 只回答「dist 是不是当前输入构建出来的」，不抛错：供打包链跳过重复构建用。 */
function isFresh(distDir) {
  const marker = path.join(distDir, FINGERPRINT_NAME);
  if (!fs.existsSync(marker)) return false;
  try {
    return JSON.parse(fs.readFileSync(marker, "utf8")).hash === computeSrcHash();
  } catch {
    return false;
  }
}

/** 供 verify-windows-package.cjs 调用：dist 指纹与当前输入不一致即抛错。 */
function assertFresh(distDir) {
  const marker = path.join(distDir, FINGERPRINT_NAME);
  if (!fs.existsSync(marker)) {
    throw new Error("dist 缺 build-fingerprint.json（早于门禁上线的构建）——重跑 PET dashboard 构建后再验");
  }
  const recorded = JSON.parse(fs.readFileSync(marker, "utf8")).hash;
  const current = computeSrcHash();
  if (recorded !== current) {
    throw new Error(`dashboard/dist 落后于 dashboard 构建输入（指纹 ${recorded.slice(0, 12)}… ≠ 当前 ${current.slice(0, 12)}…）——重跑 TOKENTRACKER_BUILD_PET=1 dashboard 构建后再验，不准进 ISCC`);
  }
}

module.exports = { computeSrcHash, assertFresh, isFresh, HASH_FILES };

if (require.main === module) {
  if (process.argv.includes("--write")) writeFingerprint();
  else if (process.argv.includes("--check")) {
    const distDir = process.argv[process.argv.indexOf("--check") + 1];
    if (!distDir) throw new Error("usage: --check <embeddedDistDir>");
    assertFresh(distDir);
    console.log("dashboard fingerprint ok: dist 与构建输入一致");
  } else if (process.argv.includes("--is-fresh")) {
    const distDir = process.argv[process.argv.indexOf("--is-fresh") + 1];
    if (!distDir) throw new Error("usage: --is-fresh <distDir>");
    const fresh = isFresh(distDir);
    console.log(fresh ? "fresh" : "stale");
    process.exitCode = fresh ? 0 : 1;
  } else console.log(computeSrcHash());
}
