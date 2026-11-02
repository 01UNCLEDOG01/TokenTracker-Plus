#!/usr/bin/env node
/**
 * Full Node suite in one command, tuned for a workstation.
 *
 * The release gate pins `--test-concurrency=4` so a slow box never produces
 * timeout flakes. On a 20-core machine that leaves most of the box idle and
 * turns a ~7 minute run into a coffee break. This runner derives concurrency
 * from the actual core count (override with TT_TEST_CONCURRENCY=1..N), keeps
 * per-file isolation, writes TAP evidence, and finishes with the frozen
 * baseline diff so "red" always means the same thing.
 *
 *   npm run test:all                 # concurrency = cores - 2 (max 12)
 *   TT_TEST_CONCURRENCY=4 npm run test:all
 *   npm run test:all -- --keep-tap   # keep the TAP file path in the summary
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const cores = (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length) || 4;
const requested = Number(process.env.TT_TEST_CONCURRENCY);
const concurrency = Number.isFinite(requested) && requested > 0
  ? Math.floor(requested)
  : Math.max(4, Math.min(12, cores - 2));
const keepTap = process.argv.includes("--keep-tap");
const tapPath = path.join(os.tmpdir(), `tt-full-${process.pid}.tap`);

const startedAt = Date.now();
const run = spawnSync(process.execPath, [
  "--test",
  `--test-concurrency=${concurrency}`,
  "--test-timeout=180000",
  "--test-reporter=tap",
  `--test-reporter-destination=${tapPath}`,
  "test/*.test.js",
], { cwd: ROOT, stdio: "inherit" });

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`\n[full] node exited ${run.status} after ${elapsed}s (concurrency ${concurrency}, ${cores} cores)`);
if (run.error || run.signal || (run.status !== 0 && run.status !== 1)) {
  console.error(`[full] runner failed: ${run.error?.message || run.signal || run.status}`);
  console.error(`[full] TAP evidence: ${tapPath}`);
  process.exit(1);
}

const check = spawnSync(process.execPath, [
  path.join(ROOT, "scripts", "check-test-baseline.cjs"),
  "--check",
  tapPath,
], { cwd: ROOT, stdio: "inherit" });

const runnerMismatch = run.status === 1 && /^# fail 0\s*$/m.test(fs.readFileSync(tapPath, "utf8"));
if (runnerMismatch) console.error("[full] runner exited 1 despite reporting no failed tests");
if (keepTap || check.status !== 0 || runnerMismatch) console.log(`[full] TAP evidence: ${tapPath}`);
else fs.rmSync(tapPath, { force: true });

process.exit(runnerMismatch ? 1 : (check.status ?? 1));
