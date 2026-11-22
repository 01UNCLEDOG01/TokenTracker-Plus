#!/usr/bin/env node
/**
 * scripts/validate-about-gate.cjs
 *
 * GitHub 仓库「About」对外计数门禁（2026-11-23 站主令）：
 *   About 描述 / topics / 官网落地页三处的对外计数必须与代码真值一致。
 *
 * 背景：五源吸收批把工具数 55→59 时，六语 README、落地页、package.json
 * 都改了，但 GitHub 仓库描述漏改——连续多个发行版都靠站主提醒才同步。
 * 本门禁把它变成机器检查：计数同源（SUPPORTED_PROVIDERS / LIMIT_PROVIDER_IDS），
 * 谁漏改谁红。
 *
 * 网络语义：
 *   - 匿名 GitHub API 可读公开仓 About（无需 token）；请求失败（断网/限流）
 *     记 WARN 并放行——门禁绝不能因为本机断网把提交卡死（假红纪律）。
 *   - 有 GH_TOKEN / GITHUB_TOKEN 时走认证请求，放宽限流。
 *   - landing 页与 package.json 是纯本地文件，照常硬校验（这部分不依赖网络）。
 *
 * 失败修复方式：PATCH /repos/{owner}/{repo}（description）与
 * PUT /repos/{owner}/{repo}/topics（注意：PATCH /repo 的 topics 字段
 * 只收前 10 个，静默丢弃多余项——必须走专用端点）。
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// ── 代码真值（与 validate-readme-stats / discovery-metadata 同源） ──────────
function toolCountFromInit() {
  const source = fs.readFileSync(path.join(ROOT, "src/commands/init.js"), "utf8");
  const block = source.match(/const SUPPORTED_PROVIDERS = \[([\s\S]*?)\];/);
  if (!block) throw new Error("SUPPORTED_PROVIDERS declaration not found in src/commands/init.js");
  const names = [...block[1].matchAll(/^\s*"([^"]+)",?$/gm)].map((m) => m[1]);
  return names.length;
}

function limitCountFromDashboard() {
  const source = fs.readFileSync(path.join(ROOT, "dashboard/src/lib/limits-providers.js"), "utf8");
  const block = source.match(/export const LIMIT_PROVIDER_IDS = \[([\s\S]*?)\];/);
  if (!block) throw new Error("LIMIT_PROVIDER_IDS declaration not found");
  return [...block[1].matchAll(/^\s*"([^"]+)",?$/gm)].length;
}

function perksCountFromData() {
  // 与 validate-perks-data.cjs 逐字节同款解析（盲复刻差一个字符偏移会得到
  // 「丢开头 [ 的对象流」，JSON.parse 的 946 报错会误导三轮——别改这个形状）：
  // indexOf 的 marker 带尾 '['，但 slice 偏移量用**不带 '['** 的 marker 长度，
  // 于是 body 以 '[' 本身开头，depth=0 起扫、终点的 ']' 正是数组闭合。
  const source = fs.readFileSync(path.join(ROOT, "dashboard/src/data/perksData.js"), "utf8");
  const marker = "export const PERK_PROVIDERS = [";
  const start = source.indexOf(marker);
  if (start < 0) throw new Error("PERK_PROVIDERS not found in perksData.js");
  const body = source.slice(start + "export const PERK_PROVIDERS = ".length);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] === "[") depth += 1;
    else if (body[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("PERK_PROVIDERS is not balanced in perksData.js");
  return JSON.parse(body.slice(0, end + 1)).length;
}

// ── 本地硬校验（无网络依赖） ────────────────────────────────────────────────
function checkLandingPage(toolCount) {
  const file = path.join(ROOT, "dashboard/index.html");
  const html = fs.readFileSync(file, "utf8");
  const problems = [];
  // 既有哨兵（与 discovery-metadata 同款三处计数）。
  if (!new RegExp(`Supported AI coding tools \\(${toolCount}\\)`).test(html)) {
    problems.push(`landing page missing "Supported AI coding tools (${toolCount})"`);
  }
  if (!new RegExp(`supports ${toolCount} tools`).test(html)) {
    problems.push(`landing page missing "supports ${toolCount} tools"`);
  }
  // 上一版计数残留：任何 (55)/55 tools 形态的旧数字都是漏改。
  const stale = [...html.matchAll(/(?:Supported AI coding tools \((\d+)\)|supports (\d+) tools)/g)]
    .filter((m) => Number(m[1] || m[2]) !== toolCount)
    .map((m) => m[0]);
  for (const s of stale) problems.push(`landing page carries stale count: ${s}`);
  return problems;
}

function checkPackageJson(toolCount) {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const problems = [];
  if (!new RegExp(`for ${toolCount} tools`).test(pkg.description || "")) {
    problems.push(`package.json description missing "for ${toolCount} tools"`);
  }
  return problems;
}

// ── GitHub About（网络，失败降级为 WARN） ───────────────────────────────────
function readToken() {
  // 1) 环境变量；2) 仓库根 .env.local（gitignored，本机凭据约定处）。
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
    const m = env.match(/^GH_TOKEN\s*=\s*(.+)$/m) || env.match(/^GITHUB_TOKEN\s*=\s*(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* no .env.local */ }
  return null;
}

async function fetchAbout(token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const [repoRes, topicsRes] = await Promise.all([
      fetch("https://api.github.com/repos/01UNCLEDOG01/TokenTracker-Plus", { headers, signal: controller.signal }),
      fetch("https://api.github.com/repos/01UNCLEDOG01/TokenTracker-Plus/topics", { headers, signal: controller.signal }),
    ]);
    if (repoRes.status === 403 || repoRes.status === 429) {
      return { degraded: "rate-limited" };
    }
    if (!repoRes.ok) return { degraded: `repo API ${repoRes.status}` };
    const repo = await repoRes.json();
    const topics = topicsRes.ok ? ((await topicsRes.json()).names || []) : [];
    return { description: repo.description || "", topics };
  } catch (err) {
    return { degraded: err?.name === "AbortError" ? "timeout" : (err?.cause?.code || err?.message || "network error") };
  } finally {
    clearTimeout(timer);
  }
}

function checkAbout({ description, topics }, { toolCount, limitCount, perksCount }) {
  const problems = [];
  const expectedNumbers = [toolCount, limitCount, perksCount];
  for (const n of expectedNumbers) {
    if (!new RegExp(`\\b${n}\\b`).test(description)) {
      problems.push(`About description missing count ${n}`);
    }
  }
  // 旧计数残留：描述里出现任何「低于现值的工具数」都算漏改（55/53/51 等历史值）。
  const staleToolCounts = [...description.matchAll(/(\d+)\s*款 AI 工具|(\d+)\s* AI (?:coding )?tools/gi)]
    .map((m) => Number(m[1] || m[2]))
    .filter((n) => n !== toolCount);
  for (const n of new Set(staleToolCounts)) {
    problems.push(`About description carries stale tool count ${n} (expected ${toolCount})`);
  }
  if (!/macos|mac os|& macos/i.test(description)) {
    problems.push("About description does not mention macOS (dual-platform since 2026-11-09)");
  }
  for (const wanted of ["macos", "junie"]) {
    if (!topics.includes(wanted)) problems.push(`About topics missing "${wanted}"`);
  }
  return problems;
}

async function main() {
  const toolCount = toolCountFromInit();
  const limitCount = limitCountFromDashboard();
  const perksCount = perksCountFromData();
  console.log(`[ABOUT-GATE] Code truth: ${toolCount} tools, ${limitCount} limits, ${perksCount} perks.`);

  let failed = false;

  for (const [label, problems] of [
    ["landing page", checkLandingPage(toolCount)],
    ["package.json", checkPackageJson(toolCount)],
  ]) {
    for (const p of problems) {
      console.error(`[ABOUT-GATE] FAIL ${label}: ${p}`);
      failed = true;
    }
  }
  if (!failed) console.log("[ABOUT-GATE] local surfaces (landing page, package.json) in sync.");

  const token = readToken();
  const about = await fetchAbout(token);
  if (about.degraded) {
    // 断网/限流：WARN 放行——本地门禁不能被网络卡死（假红纪律）。
    console.warn(`[ABOUT-GATE] WARN GitHub About not checked (${about.degraded}${token ? "" : ", no token"}) — fix locally with: PATCH /repos/.../description`);
  } else {
    const problems = checkAbout(about, { toolCount, limitCount, perksCount });
    for (const p of problems) {
      console.error(`[ABOUT-GATE] FAIL GitHub About: ${p}`);
      failed = true;
    }
    if (!problems.length) console.log("[ABOUT-GATE] GitHub About in sync (description + topics).");
  }

  if (failed) {
    console.error("[ABOUT-GATE] FAILED — update GitHub About (PATCH /repos/01UNCLEDOG01/TokenTracker-Plus, PUT .../topics) to match code truth.");
    process.exit(1);
  }
  console.log("[ABOUT-GATE] PASSED.");
}

module.exports.__test = { checkAbout, checkLandingPage, checkPackageJson };

if (require.main === module) main();
