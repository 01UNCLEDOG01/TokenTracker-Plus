// Measure which tests are actually flaky, instead of guessing.
//
//   node scripts/collect-test-reds.cjs <runs> <outdir>
//
// Runs the fast suite N times, records the red set each time, then splits the
// result into:
//   stable  - red in every run  -> the real baseline
//   flaky   - red in some runs  -> must never be used as a gate on its own
//   clean   - never red
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repo = path.resolve(__dirname, "..");
const runs = Number(process.argv[2] || 3);
const outDir = process.argv[3] || path.join(os.tmpdir(), "tt-reds");
fs.mkdirSync(outDir, { recursive: true });

const SPAWN_HEAVY = [
  "init-local-runtime-reinstall", "notify-debug-log", "scan-roots-sync",
  "init-spawn-error", "legacy-baseurl-migration", "init-uninstall",
  "status-json-light", "codex-source-scoped-cache", "vite-pet-api",
  "cloud-access-sandbox-build", "cline-cli", "cloud-sandbox-build",
  "rollout-parser", "self-host-backend", "cloud-billing-database",
];
const testDir = path.join(repo, "test");
const all = fs.readdirSync(testDir).filter((f) => f.endsWith(".test.js")).sort();
const fast = all.filter((f) => !SPAWN_HEAVY.includes(f.replace(/\.test\.js$/, "")));

const sets = [];
for (let i = 1; i <= runs; i++) {
  const tap = path.join(outDir, `run${i}.tap`);
  const started = Date.now();
  spawnSync(process.execPath, [
    "--test", "--test-reporter=tap", `--test-reporter-destination=${tap}`,
    ...fast.map((f) => path.join("test", f)),
  ], { cwd: repo, encoding: "utf8", maxBuffer: 1 << 28 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  const lines = fs.readFileSync(tap, "utf8").split(/\r?\n/);
  const red = new Set();
  for (const l of lines) {
    const m = l.match(/^not ok \d+ - (.*)$/);
    if (m) red.add(m[1].trim());
  }
  fs.rmSync(tap, { force: true });
  sets.push(red);
  console.log(`run ${i}/${runs}: ${red.size} red, ${secs}s`);
}

// stable = in every run; flaky = in some but not all
const union = new Set();
for (const s of sets) for (const n of s) union.add(n);
const stable = [...union].filter((n) => sets.every((s) => s.has(n))).sort();
const flaky = [...union].filter((n) => !sets.every((s) => s.has(n))).sort();

const lines = [];
lines.push(`runs=${runs}`);
lines.push(`red counts: ${sets.map((s) => s.size).join(", ")}`);
lines.push(`stable (red every run) = ${stable.length}`);
lines.push(`flaky  (red some runs)  = ${flaky.length}`);
lines.push("");
lines.push("=== flaky ===");
for (const n of flaky) {
  const hits = sets.map((s, i) => (s.has(n) ? `r${i + 1}` : "-")).join("");
  lines.push(`  ${hits}  ${n}`);
}
fs.writeFileSync(path.join(outDir, "flaky.txt"), flaky.join("\n") + "\n", "utf8");
fs.writeFileSync(path.join(outDir, "stable.txt"), stable.join("\n") + "\n", "utf8");
console.log("\n" + lines.join("\n"));
