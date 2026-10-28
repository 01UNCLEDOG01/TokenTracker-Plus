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
 * 启动判定（KI-037）：主预算 180 秒内 200 即算成功；超时后宽限 60 秒复查一次，
 * 宽限内上线记为「冷启动慢」而不是失败。可用 MIRROR_STARTUP_TIMEOUT_MS /
 * MIRROR_STARTUP_GRACE_MS 覆盖（机器更慢时不必改代码）。
 *
 * 用法：
 *   npm run mirror:installed              # 全部做，最后重启应用
 *   npm run mirror:installed -- --no-restart
 *   npm run mirror:installed -- --skip-build   # 只镜像现有 dist（调试用）
 *   npm run mirror:installed -- --purge-old    # 删掉旧 dist 而不是挪到暂存目录
 * 环境变量：TOKENTRACKER_APP_EXE 覆盖 exe 路径；MIRROR_TREES 用 ; 分隔覆盖安装树；
 * MIRROR_STASH_DIR 覆盖旧 dist 的暂存目录（默认 %TEMP%/tokentracker-mirror-stash）。
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

function mirrorTree(treeDir, repoRoot, { purgeOld = false } = {}) {
  const distTarget = path.join(treeDir, "dashboard", "dist");
  // 先挪后拷：只覆盖会把历史构建的 hashed chunk 永远留在原地。
  //
  // 2026-10-28: 这一步从「删掉旧 dist」改成「把旧 dist 挪到暂存目录」。
  // 站点环境的 safe-delete 守卫会拦下批量删除（733 个文件 > 500 阈值），
  // 挪走同样能达成「安装树里只剩新构建」的效果，而且旧构建留在暂存目录里
  // 可以随时回滚。需要真正的删除语义时显式传 --purge-old。
  if (purgeOld) {
    fs.rmSync(distTarget, { recursive: true, force: true });
  } else if (fs.existsSync(distTarget)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    // The stash must live on the SAME volume as the tree: a rename across
    // devices fails with EXDEV, and the install trees span D: and C:.
    // Default to a sibling of the tree (same parent ⇒ same volume).
    const stashRoot = process.env.MIRROR_STASH_DIR
      || path.join(path.dirname(treeDir), `${path.basename(treeDir)}-stash`);
    const stash = path.join(stashRoot, `dist-${stamp}`);
    fs.mkdirSync(stashRoot, { recursive: true });
    fs.renameSync(distTarget, stash);
    console.log(`[mirror] 旧 dist 暂存 → ${stash}`);
  }
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

// KI-037: Windows 桌面端拉起内嵌 node serve 实测约 60 秒，机器忙时更久。旧的单次
// 180 秒判定会把「镜像已完成、应用只是慢」当成热更失败，退出码不可信、还会诱导重跑
// （重跑又产生一份 dist 暂存）。现在超时后再宽限一轮复查，并把两种结论分开报。
const STARTUP_TIMEOUT_MS = Number(process.env.MIRROR_STARTUP_TIMEOUT_MS || 180000);
const STARTUP_GRACE_MS = Number(process.env.MIRROR_STARTUP_GRACE_MS || 60000);

async function waitForServer(baseUrl, timeoutMs = STARTUP_TIMEOUT_MS) {
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

// 纯判定逻辑，便于单测注入假探针：主预算内上线 → primary；超时但宽限内上线 →
// grace（镜像有效，只是冷启动慢）；两轮都没上线 → failed（此时才该怀疑启动本身）。
async function awaitStartup(baseUrl, options = {}) {
  const {
    timeoutMs = STARTUP_TIMEOUT_MS,
    graceMs = STARTUP_GRACE_MS,
    probe = waitForServer,
    log = console.log,
  } = options;
  if (await probe(baseUrl, timeoutMs)) return { ok: true, phase: "primary", graceUsedMs: 0 };
  log(`[mirror] ${Math.round(timeoutMs / 1000)} 秒内没有响应，宽限 ${Math.round(graceMs / 1000)} 秒再复查一次（镜像文件此时已全部就位）…`);
  if (await probe(baseUrl, graceMs)) return { ok: true, phase: "grace", graceUsedMs: graceMs };
  return { ok: false, phase: "failed", graceUsedMs: graceMs };
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
  // Node 18.20+ 不允许 spawn .cmd 时不经 shell（会直接 EINVAL，status=null），
  // 所以 Windows 上显式经 cmd.exe 调，别再回到 shell:true 那条带注入风险和弃用告警的老路。
  const run = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm run dashboard:build"], { cwd: ROOT, env, stdio: "inherit" })
    : spawnSync("npm", ["run", "dashboard:build"], { cwd: ROOT, env, stdio: "inherit" });
  if (run.status !== 0) throw new Error(`dashboard:build 失败（exit ${run.status}${run.error ? `: ${run.error.message}` : ""}）`);
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
  // 硬杀宿主会把它内嵌的 node 服务变成孤儿，继续占着 17680 —— 之后应用只能退到随机端口
  // （2026-10-27 实测：端口被占 → "preferred port 17680 unavailable; falling back to a dynamic port"）。
  spawnSync("powershell", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ExecutablePath -like '*TokenTrackerPlus\\app\\EmbeddedServer*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; exit 0",
  ], { stdio: "inherit" });
}

function lastPickedPort() {
  try {
    const log = fs.readFileSync(path.join(os.homedir(), "AppData", "Local", "TokenTracker", "windows-host.log"), "utf8");
    const hits = [...log.matchAll(/picked port (\d+)/g)];
    return hits.length ? hits[hits.length - 1][1] : null;
  } catch {
    return null;
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
  const purgeOld = argv.includes("--purge-old");
  if (!noRestart) {
    stopApp();
    if (!(await waitForPortFree(baseUrl))) errors.push("应用已停但端口 30 秒内没有释放，镜像可能被旧进程占用");
  }
  for (const tree of trees) {
    console.log(`[mirror] 镜像 → ${tree}`);
    mirrorTree(tree, ROOT, { purgeOld });
    errors.push(...verifyTree(tree, REPO_DIST, ROOT));
  }

  if (noRestart) {
    console.log("[mirror] --no-restart：文件已换，应用没停也没起，下次启动才生效。");
  } else if (errors.length === 0) {
    startApp(exePath);
    const startup = await awaitStartup(baseUrl);
    if (!startup.ok) {
      const picked = lastPickedPort();
      const hint = picked && !baseUrl.endsWith(picked) ? `；宿主最后落在 ${picked}，说明 17680 被占，先清掉占用者` : "";
      errors.push(
        `启动后 ${Math.round((STARTUP_TIMEOUT_MS + STARTUP_GRACE_MS) / 1000)} 秒内 ${baseUrl} 没有响应${hint}` +
        `。注意：镜像文件已全部就位（前面各棵树的核对与冒烟前检查都通过了），失败点在「应用没起来」，重跑热更不能解决`
      );
    } else {
      if (startup.phase === "grace") {
        console.log(`[mirror] 宽限期内上线（冷启动慢，不是热更失败）；本次多等了 ${Math.round(startup.graceUsedMs / 1000)} 秒。`);
      }
      errors.push(...(await smoke(baseUrl)));
    }
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

module.exports = { verifyTree, mirrorTree, countFiles, listFiles, SMOKE_PATHS, waitForServer, awaitStartup };

if (require.main === module) {
  main().catch((err) => {
    console.error(`[mirror] ${err.message}`);
    process.exit(1);
  });
}
