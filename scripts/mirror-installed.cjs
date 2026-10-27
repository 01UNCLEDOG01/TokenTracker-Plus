#!/usr/bin/env node
/**
 * scripts/mirror-installed.cjs
 *
 * 一条命令做完「热更到安装副本」，替代 GATE_REGISTRY §4 里那套手工步骤。
 * 2026-10-27 的教训：手工热更时漏了 `TOKENTRACKER_BUILD_PET=1`，又把 dist 整目录
 * 替换，结果 pet.html / quota.html 被删、桌宠显示 404 —— 流程写在文档里，但没人保证
 * 每次都会先读。所以把它固化成脚本，任何一步不对就非零退出。
 *
 * 做的事：带 flag 构建 → 两棵安装树各镜像 dist(先删再拷)/src/bin → 逐棵核对
 * （文件数、入口页、src+bin 文件大小）→ HTTP 冒烟 → 重启应用 → 再次冒烟。
 *
 * 用法：
 *   npm run mirror:installed              # 全部做，最后重启应用
 *   npm run mirror:installed -- --no-restart
 *   npm run mirror:installed -- --skip-build   # 只镜像现有 dist（调试用）
 * 环境变量：TOKENTRACKER_APP_EXE 覆盖 exe 路径；MIRROR_TREES 用 ; 分隔覆盖安装树。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const REPO_DIST = path.join(ROOT, "dashboard", "dist");
const DEFAULT_TREES = [
  "D:\\TokenTrackerPlus\\app\\EmbeddedServer\\tokentracker",
  path.join(os.homedir(), ".tokentracker", "tracker", "app"),
];
const DEFAULT_EXE = "D:\\TokenTrackerPlus\\app\\TokenTracker.exe";
const SMOKE_PATHS = ["/", "/pet.html", "/quota.html", "/app-icon.png?v=2", "/achievements/wishing-well.png?v=16"];

function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(d, entry.name));
      else n += 1;
    }
  };
  walk(dir);
  return n;
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full));
    }
  };
  walk(dir);
  return out;
}

/**
 * Compare one installed tree against the repo payload. Pure (no network), so the
 * guard test can drive it with fixtures.
 */
function verifyTree(treeDir, repoDistDir, repoRoot) {
  const errors = [];
  const dist = path.join(treeDir, "dashboard", "dist");
  if (!fs.existsSync(dist)) return [`${treeDir}: 没有 dashboard/dist`];
  for (const entry of ["index.html", "pet.html", "quota.html"]) {
    if (!fs.existsSync(path.join(dist, entry))) {
      errors.push(`${treeDir}: dist 缺 ${entry}${entry === "pet.html" || entry === "quota.html" ? "（构建时没带 TOKENTRACKER_BUILD_PET=1？）" : ""}`);
    }
  }
  const want = countFiles(repoDistDir);
  const got = countFiles(dist);
  if (got !== want) errors.push(`${treeDir}: dist 有 ${got} 个文件，仓库构建是 ${want} 个`);
  for (const dir of ["src", "bin"]) {
    const repoDir = path.join(repoRoot, dir);
    const treeSub = path.join(treeDir, dir);
    for (const rel of listFiles(repoDir)) {
      const target = path.join(treeSub, rel);
      if (!fs.existsSync(target)) { errors.push(`${treeDir}: ${dir}/${rel} 缺失`); continue; }
      const a = fs.statSync(path.join(repoDir, rel)).size;
      const b = fs.statSync(target).size;
      if (a !== b) errors.push(`${treeDir}: ${dir}/${rel} 大小不一致（${b} != ${a}）`);
    }
  }
  return errors;
}

function mirrorTree(treeDir, repoRoot) {
  const distTarget = path.join(treeDir, "dashboard", "dist");
  // 先删再拷：只覆盖会把历史构建的 hashed chunk 永远留在原地。
  fs.rmSync(distTarget, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(distTarget), { recursive: true });
  fs.cpSync(path.join(repoRoot, "dashboard", "dist"), distTarget, { recursive: true });
  for (const dir of ["src", "bin"]) {
    fs.cpSync(path.join(repoRoot, dir), path.join(treeDir, dir), { recursive: true, force: true });
  }
}

async function smoke(baseUrl) {
  const errors = [];
  for (const p of SMOKE_PATHS) {
    try {
      const res = await fetch(baseUrl + p, { signal: AbortSignal.timeout(10000) });
      if (res.status !== 200) errors.push(`冒烟 ${p} 返回 ${res.status}`);
    } catch (err) {
      errors.push(`冒烟 ${p} 失败：${err.message}`);
    }
  }
  return errors;
}

async function waitForServer(baseUrl, timeoutMs = 180000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(baseUrl + "/", { signal: AbortSignal.timeout(5000) });
      if (res.status === 200) return true;
    } catch { /* still warming up */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

async function waitForPortFree(baseUrl, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await fetch(baseUrl + "/", { signal: AbortSignal.timeout(2000) });
    } catch {
      return true; // 连不上 = 端口已释放
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function build() {
  console.log("[mirror] 构建 dashboard（TOKENTRACKER_BUILD_PET=1）…");
  const env = { ...process.env, TOKENTRACKER_BUILD_PET: "1" };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const run = spawnSync(npm, ["run", "dashboard:build"], { cwd: ROOT, env, stdio: "inherit" });
  if (run.status !== 0) throw new Error(`dashboard:build 失败（exit ${run.status}）`);
}

function isAppRunning() {
  const out = spawnSync("tasklist", ["/FI", "IMAGENAME eq TokenTracker.exe", "/NH"], { encoding: "utf8" });
  return String(out.stdout || "").includes("TokenTracker.exe");
}

function stopApp() {
  // 必须在动 dist 之前停：服务进程正在读那棵树，先删目录会让它直接死掉
  // （2026-10-27 实测：边跑边换 dist，五个冒烟点全部 fetch failed）。
  console.log("[mirror] 停止应用…");
  // PowerShell 即使把错误静音了也会返回 1，所以显式 exit 0，再用 tasklist 判真实状态。
  spawnSync("powershell", ["-NoProfile", "-Command",
    "$ErrorActionPreference='SilentlyContinue'; Get-Process TokenTracker | ForEach-Object { Stop-Process -Id $_.Id }; exit 0",
  ], { stdio: "inherit" });
  for (let i = 0; i < 12 && isAppRunning(); i++) {
    spawnSync("powershell", ["-NoProfile", "-Command", "Start-Sleep -Milliseconds 800"], {});
  }
  if (isAppRunning()) {
    console.warn("[mirror] 优雅退出没成功，强杀…");
    spawnSync("taskkill", ["/IM", "TokenTracker.exe", "/F"], { stdio: "inherit" });
    if (isAppRunning()) throw new Error("应用停不下来，拒绝在运行中替换文件");
  }
}

function startApp(exePath) {
  console.log("[mirror] 启动应用…");
  const dir = path.dirname(exePath);
  const script = `Start-Process -FilePath '${exePath.replace(/'/g, "''")}' -WorkingDirectory '${dir.replace(/'/g, "''")}'`;
  const run = spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
  if (run.status !== 0) throw new Error(`启动失败（exit ${run.status}）`);
}

async function main() {
  const argv = process.argv.slice(2);
  const skipBuild = argv.includes("--skip-build");
  const noRestart = argv.includes("--no-restart");
  const baseUrl = (argv.find((a) => a.startsWith("--base-url=")) || "--base-url=http://127.0.0.1:17680").split("=")[1];
  const trees = (process.env.MIRROR_TREES || DEFAULT_TREES.join(";")).split(";").filter(Boolean);
  const exePath = process.env.TOKENTRACKER_APP_EXE || DEFAULT_EXE;

  if (!skipBuild) build();
  if (!fs.existsSync(REPO_DIST)) throw new Error(`缺少 ${REPO_DIST}，先构建`);
  for (const entry of ["pet.html", "quota.html"]) {
    if (!fs.existsSync(path.join(REPO_DIST, entry))) {
      throw new Error(`仓库 dashboard/dist 里没有 ${entry} —— 构建没带 TOKENTRACKER_BUILD_PET=1，拒绝镜像`);
    }
  }

  const errors = [];
  if (!noRestart) {
    stopApp();
    if (!(await waitForPortFree(baseUrl))) errors.push("应用已停但端口 30 秒内没有释放，镜像可能被旧进程占用");
  }
  for (const tree of trees) {
    console.log(`[mirror] 镜像 → ${tree}`);
    mirrorTree(tree, ROOT);
    errors.push(...verifyTree(tree, REPO_DIST, ROOT));
  }

  if (noRestart) {
    console.log("[mirror] --no-restart：文件已换，应用没停也没起，下次启动才生效。");
  } else if (errors.length === 0) {
    startApp(exePath);
    if (!(await waitForServer(baseUrl))) errors.push("启动后 180 秒内服务没有起来");
    else errors.push(...(await smoke(baseUrl)));
  } else {
    startApp(exePath); // 文件有问题也要把应用拉起来，别让它停在那儿
    errors.push("镜像校验失败，已把应用重新启动，但内容可能不对");
  }

  if (errors.length) {
    console.error("[mirror] 失败：");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`[mirror] 完成：${trees.length} 棵树与仓库构建一致（${countFiles(REPO_DIST)} 个 dist 文件），冒烟 ${SMOKE_PATHS.length} 项 200。`);
}

module.exports = { verifyTree, mirrorTree, countFiles, listFiles, SMOKE_PATHS };

if (require.main === module) {
  main().catch((err) => {
    console.error(`[mirror] ${err.message}`);
    process.exit(1);
  });
}
