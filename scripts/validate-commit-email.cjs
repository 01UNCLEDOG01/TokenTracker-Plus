#!/usr/bin/env node
// 真实邮箱红线（2026-10-29 隐私事故后新增，见 CHANGELOG 2026-10-29f）。
// ① 本次提交的 author/committer 邮箱不得是真实邮箱；
// ② 暂存内容不得出现它——元数据和内容两条路都堵死。
// GitHub 端的 "Block command line pushes that expose my email" 是推送层的第二道；
// 本地这道负责在提交前就拦住，并给出修复指引。

const { execFileSync } = require("node:child_process");

const REAL_EMAIL = "156432729+01UNCLEDOG01@users.noreply.github.com";
const ALLOWED = new Set([
  "156432729+01UNCLEDOG01@users.noreply.github.com",
  "01UNCLEDOG01@users.noreply.github.com",
]);
const FIX_HINT = 'git config user.email "156432729+01UNCLEDOG01@users.noreply.github.com"';

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

const problems = [];

for (const envKey of ["GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"]) {
  const email = String(process.env[envKey] || "").trim();
  if (email && email.toLowerCase() === REAL_EMAIL) {
    problems.push(`${envKey} 是真实邮箱 —— 先改配置再提交：${FIX_HINT}`);
  } else if (email && !ALLOWED.has(email)) {
    // 软提示：未来的工具换了新的 noreply 形式时不要误伤，只提醒核对。
    console.error(`validate-commit-email: note (not blocking): ${envKey}=${email} 不在 noreply 白名单`);
  }
}

let staged = "";
try {
  // 只查新增行（+）：移除旧邮箱的 - 行天然包含它，那是清洗不是泄露。
  // 排除自身：本脚本的规则字符串天然包含目标邮箱，否则永远过不了自己的门。
  const diff = git(["diff", "--cached", "--", ".", ":(exclude)scripts/validate-commit-email.cjs"]);
  staged = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).join("\n");
} catch (error) {
  console.error(`validate-commit-email: 无法读取暂存区: ${error.message}`);
  process.exit(1);
}
if (staged.includes(REAL_EMAIL)) {
  problems.push("暂存内容里出现了真实邮箱 —— 公开仓库红线，请移除（规则见 GATE_REGISTRY §1）");
}

if (problems.length) {
  console.error("validate-commit-email failed:");
  for (const line of problems) console.error(`- ${line}`);
  process.exit(1);
}
