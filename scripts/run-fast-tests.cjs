// The fast gate: run the suite minus the spawn-heavy files, then compare the red
// set against the frozen baseline. One command, one machine verdict.
//
//   npm run test:fast
//
// Why the split exists: 15 of 395 test files (3.8%) own 71% of the wall clock,
// because each of their cases spawns real subprocesses and waits for them.
// Excluding them takes a full run from ~302s to ~87s. They are not less
// correct, only slower, so they stay in `npm test` and run at merge and deploy.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");

// Each of these holds at least one test that takes 20-150s on its own.
const SPAWN_HEAVY = [
  "init-local-runtime-reinstall", "notify-debug-log", "scan-roots-sync",
  "init-spawn-error", "legacy-baseurl-migration", "init-uninstall",
  "status-json-light", "codex-source-scoped-cache", "vite-pet-api",
  "cline-cli",
  "rollout-parser", "self-host-backend",
];

const testDir = path.join(repo, "test");
const all = fs.readdirSync(testDir).filter((f) => f.endsWith(".test.js")).sort();
const missing = SPAWN_HEAVY.filter((n) => !all.includes(n + ".test.js"));
if (missing.length) {
  console.error(`SPAWN_HEAVY lists files that no longer exist: ${missing.join(", ")}`);
  console.error("Remove them from the list rather than letting the gate silently shrink.");
  process.exit(78);
}
const fast = all.filter((f) => !SPAWN_HEAVY.includes(f.replace(/\.test\.js$/, "")));

const tap = path.join(os.tmpdir(), `tokentracker-fast-${process.pid}.tap`);
const started = Date.now();
const res = spawnSync(process.execPath, [
  "--test",
  "--test-reporter=tap",
  `--test-reporter-destination=${tap}`,
  ...fast.map((f) => path.join("test", f)),
], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
const secs = (Date.now() - started) / 1000;
if (res.error || res.signal || (res.status !== 0 && res.status !== 1)) {
  console.error(`fast runner failed: ${res.error?.message || res.signal || res.status}`);
  console.error(`TAP evidence: ${tap}`);
  process.exit(1);
}

const tapText = fs.readFileSync(tap, "utf8");
const grab = (k) => {
  const m = tapText.match(new RegExp("^#\\s*" + k + "\\s+(\\S+)", "m"));
  return m ? m[1] : "?";
};

console.log(`fast gate: ${fast.length}/${all.length} files, ${secs.toFixed(1)}s`);
console.log(`  tests=${grab("tests")} pass=${grab("pass")} fail=${grab("fail")} skipped=${grab("skipped")}`);
console.log(`  (the ${SPAWN_HEAVY.length} spawn-heavy files were skipped; npm test still covers them)`);

const check = spawnSync(process.execPath,
  [path.join("scripts", "check-test-baseline.cjs"), "--check", tap],
  { cwd: repo, encoding: "utf8" });
process.stdout.write(check.stdout || "");
process.stderr.write(check.stderr || "");
if (check.status !== 0 || (res.status === 1 && grab("fail") === "0")) {
  console.error(`\nfast gate FAILED (node exit ${res.status})`);
  console.error(`TAP evidence: ${tap}`);
  process.exit(1);
}
fs.rmSync(tap, { force: true });
console.log("\nfast gate OK");
