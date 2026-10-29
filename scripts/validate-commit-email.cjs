#!/usr/bin/env node
// 真实邮箱红线（2026-10-29 隐私事故后新增，规则见 CHANGELOG 2026-10-29h）。
// ① 本次提交的 author/committer 邮箱不得是红线邮箱；
// ② 暂存新增行不得出现它——元数据和内容两条路都堵死。
// GitHub 端的 "Block command line pushes that expose my email" 是推送层第二道。
// 红线地址不在本脚本里（曾用字面量被 filter-repo replace-text 腐蚀、改 join 拼接
// 仍会被人类读者拼出），而是读本机未入库配置：环境变量 REDLINE_EMAIL 优先，
// 否则 ~/.tokentracker/redline-email.json 的 {"email": "..."}。
// 没有该配置的机器（如陌生贡献者）只做 noreply 白名单软检查。

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ALLOWED = new Set([
  "156432729+01uncledog01@users.noreply.github.com",
  "01uncledog01@users.noreply.github.com",
]);
const FIX_HINT = 'git config user.email "156432729+01UNCLEDOG01@users.noreply.github.com"';

function loadRedlineEmail() {
  const fromEnv = String(process.env.REDLINE_EMAIL || "").trim();
  if (fromEnv) return fromEnv;
  const file = path.join(os.homedir(), ".tokentracker", "redline-email.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const email = String(parsed?.email || "").trim();
    return email || null;
  } catch {
    return null;
  }
}

function git(args) {
  // 大暂存 diff（批量导入、生成文件）会把 spawnSync 默认 1 MiB 缓冲撑爆
  // （ENOBUFS），fail-closed 堵住一切提交——给 diff 读取一个真实上限。
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const REAL_EMAIL = loadRedlineEmail();

// 自检：红线地址若与白名单相同，说明配置被（例如 replace-text 类）改写腐蚀——
// 宁可 fail-closed 堵住所有提交，也不能让红线空转。修复后若需越过损坏态提交
// 一次，仅限该场景可用 --no-verify。
if (REAL_EMAIL && ALLOWED.has(REAL_EMAIL.toLowerCase())) {
  console.error("validate-commit-email: 校验器已损坏（红线地址与白名单相同）——请人工恢复红线配置");
  process.exit(1);
}

const problems = [];

for (const envKey of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
  const email = String(process.env[envKey] || "").trim().toLowerCase();
  if (REAL_EMAIL && email && email === REAL_EMAIL.toLowerCase()) {
    problems.push(`${envKey} 是红线邮箱 —— 先改配置再提交：${FIX_HINT}`);
  } else if (email && !ALLOWED.has(email)) {
    // 软提示：未来的工具换了新的 noreply 形式时不要误伤，只提醒核对。
    console.error(`validate-commit-email: note (not blocking): ${envKey}=${email} 不在 noreply 白名单`);
  }
}

let staged = "";
try {
  // 只查新增行（+）：移除旧邮箱的 - 行天然包含它，那是清洗不是泄露。
  const diff = git(["diff", "--cached", "--", ".", ":(exclude)scripts/validate-commit-email.cjs"]);
  staged = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
} catch (error) {
  console.error(`validate-commit-email: 无法读取暂存区: ${error.message}`);
  process.exit(1);
}
if (REAL_EMAIL && staged.toLowerCase().includes(REAL_EMAIL.toLowerCase())) {
  problems.push("暂存内容里出现了红线邮箱 —— 公开仓库红线，请移除（规则见 GATE_REGISTRY §1）");
}

if (problems.length) {
  console.error("validate-commit-email failed:");
  for (const line of problems) console.error(`- ${line}`);
  process.exit(1);
}
