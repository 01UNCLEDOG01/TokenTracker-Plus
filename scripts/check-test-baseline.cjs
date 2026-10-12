// Generate or check the test baseline.
//
//   node scripts/check-test-baseline.cjs --write <tap-file>   freeze the red set
//   node scripts/check-test-baseline.cjs --check <tap-file>   diff against it
//
// Why this exists: on this machine the suite cannot reach zero red. 40 tests
// require @insforge/sdk, which upstream added to neither package.json nor its
// own package-lock; 5 require the sqlite3 CLI, which only the Linux CI runner
// has; the rest were already red before the fork. Re-reading that list by eye
// after every run is what made verification expensive, not the run itself.
//
// Two lists, both measured rather than guessed (scripts/collect-test-reds.cjs,
// 4 consecutive fast runs):
//   test/baseline-red.txt  red in every run  -> the real environmental floor
//   test/flaky-red.txt     red in some runs  -> reported, never fatal on its own
// A strict set-diff over the baseline alone cries wolf on the flaky one, and a
// gate that cries wolf is worse than no gate.
const fs = require("node:fs");
const path = require("node:path");

const dir = path.join(__dirname, "..", "test");
const BASELINE = path.join(dir, "baseline-red.txt");
const FLAKY = path.join(dir, "flaky-red.txt");
const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};

function redsFromTap(tapPath) {
  const lines = fs.readFileSync(tapPath, "utf8").split(/\r?\n/);
  const out = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith("not ok ")) continue;
    const m = lines[i].match(/^not ok \d+ - (.*)$/);
    if (m) out.add(m[1].trim());
  }
  return out;
}

const mode = process.argv[2];
const tapPath = arg("--write") || arg("--check");
if (!mode || !tapPath) {
  console.error("usage: node scripts/check-test-baseline.cjs --write|--check <tap-file>");
  process.exit(64);
}
if (!fs.existsSync(tapPath)) {
  console.error(`no TAP file at ${tapPath} (run the suite with --test-reporter-destination first)`);
  process.exit(66);
}

const current = redsFromTap(tapPath);

if (mode === "--write") {
  const list = [...current].sort();
  fs.writeFileSync(BASELINE, list.join("\n") + "\n", "utf8");
  console.log(`baseline written: ${list.length} red tests -> test/baseline-red.txt`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error(`no baseline at ${BASELINE}; run --write <tap-file> first`);
  process.exit(66);
}
const known = new Set(fs.readFileSync(BASELINE, "utf8").split(/\r?\n/).filter(Boolean));
const flaky = fs.existsSync(FLAKY)
  ? new Set(fs.readFileSync(FLAKY, "utf8").split(/\r?\n/).filter(Boolean))
  : new Set();

const added = [...current].filter((n) => !known.has(n) && !flaky.has(n)).sort();
const seenFlaky = [...current].filter((n) => flaky.has(n)).sort();
const gone = [...known].filter((n) => !current.has(n)).sort();

console.log(`red now ${current.size}, baseline ${known.size}, known-flaky ${flaky.size}`);
if (seenFlaky.length) {
  console.log(`known-flaky fired this run (not fatal): ${seenFlaky.join(" | ")}`);
}
if (added.length === 0 && gone.length === 0) {
  console.log("BASELINE MATCH: no new failures");
  process.exit(0);
}
for (const n of added) console.log(`  NEW  ${n}`);
for (const n of gone) console.log(`  gone ${n}`);
console.log(added.length ? `BASELINE DRIFT: ${added.length} new failure(s)` : "BASELINE DRIFT: failures disappeared, re-freeze deliberately");
process.exit(1);
