#!/usr/bin/env node
/**
 * scripts/validate-fast.cjs
 *
 * `npm run validate:fast` 的单进程入口（2026-11-13）。
 *
 * 原来的链是 `npm run a && npm run b && …` 十段：校验器本身实测合计约 3 秒，
 * 但每次 `npm run` 在 Windows 上要再起一层 npm（约 0.8 秒），整条链实测 11.4 秒。
 * 这里用一个 node 进程顺序 spawn 十个校验器，输出、顺序、失败语义都与原链一致：
 * 第一道失败立即停，退出码 1；子进程的 stdout/stderr 直接继承，不吞报错。
 *
 * 需要单跑某一道时仍用 `npm run validate:<name>`——package.json 里的单项脚本没动。
 */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");

// 顺序与 2026-11-02 核对的 package.json 链一致；不要随手重排——art/docs 依赖
// 前面几道已经暴露的语言包与 copy 注册表状态。
const STEPS = [
  ["validate:readme", "scripts/validate-readme-stats.cjs"],
  ["validate:copy", "scripts/validate-copy-registry.cjs"],
  ["validate:locale", "scripts/validate-locale-coverage.cjs"],
  ["validate:ui-hardcode", "scripts/ops/validate-ui-hardcode.cjs"],
  ["validate:guardrails", "scripts/validate-architecture-guardrails.cjs"],
  ["validate:versions", "scripts/validate-versions.cjs"],
  ["validate:retros", "scripts/validate-retros.cjs"],
  ["validate:art", "scripts/validate-art-versions.cjs"],
  ["validate:docs", "scripts/validate-doc-facts.cjs"],
  ["validate:perks", "scripts/validate-perks-data.cjs"],
];

function run() {
  const failures = [];

  for (const [name, script] of STEPS) {
    const started = Date.now();
    const res = spawnSync(process.execPath, [path.join(ROOT, script)], {
      cwd: ROOT,
      stdio: "inherit",
    });
    const ms = Date.now() - started;
    if (res.error) {
      failures.push(`${name}: ${res.error.message}`);
      break;
    }
    if (res.status !== 0) {
      failures.push(`${name}: exit ${res.status}${res.signal ? ` (${res.signal})` : ""}`);
      break;
    }
    console.log(`validate-fast: ${name} ok (${ms} ms)`);
  }

  if (failures.length) {
    console.error("\nvalidate-fast FAILED:");
    for (const line of failures) console.error(`  - ${line}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\nvalidate-fast: ${STEPS.length} 项全部通过`);
}

module.exports = { STEPS, run };

if (require.main === module) run();
