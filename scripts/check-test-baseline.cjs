// Generate or check the test baseline.
//
//   node scripts/check-test-baseline.cjs --write <tap-file>   freeze the red set
//   node scripts/check-test-baseline.cjs --check <tap-file>   diff against it
//
// Compare complete run evidence with the locally maintained baseline and
// flaky names. Historical dependency/platform failures are not assumed to
// remain present: the current files are authoritative, and incomplete runs
// are rejected before either checking or writing a baseline.
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
  // A killed runner can leave a valid-looking prefix with no failures. Only
  // Node's completed root plan and final counters are evidence of a full run.
  const text = lines.join("\n");
  const plans = [...text.matchAll(/^1\.\.(\d+)\s*$/gm)];
  const results = [...text.matchAll(/^(?:not )?ok \d+ - /gm)];
  const counters = {};
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"]) {
    const matches = [...text.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`, "gm"))];
    if (matches.length !== 1) throw new Error(`Incomplete TAP: missing or repeated ${key} counter`);
    counters[key] = Number(matches[0][1]);
  }
  if (!/^TAP version 13\r?$/m.test(text) || plans.length !== 1 || Number(plans[0][1]) !== results.length
      || counters.tests === 0 || !/^# duration_ms \d+(?:\.\d+)?\s*$/m.test(text)
      || counters.tests !== counters.pass + counters.fail + counters.cancelled + counters.skipped + counters.todo) {
    throw new Error("Incomplete TAP: plan or final summary does not match the run");
  }
  if (counters.cancelled) throw new Error(`Incomplete TAP: ${counters.cancelled} cancelled test(s)`);
  if (/^\s*Bail out!/m.test(text)) throw new Error("Incomplete TAP: runner bailed out");
  const out = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*not ok \d+ - (.*)$/);
    if (!m || / # (?:TODO|SKIP)\b/i.test(m[1])) continue;
    let end = i + 1;
    while (end < lines.length && !/^\s*(?:not )?ok \d+ - /.test(lines[end])) end += 1;
    // Suites/parents repeat their children's failure. Compare leaf failures,
    // including indented children, so a known parent cannot hide a new child.
    if (!/^\s+failureType:\s*['"]?subtestsFailed\b/m.test(lines.slice(i + 1, end).join("\n"))) out.add(m[1].trim());
  }
  if (counters.fail > 0 && out.size === 0) throw new Error("Incomplete TAP: failed tests have no failure records");
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

let current;
try {
  current = redsFromTap(tapPath);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

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
