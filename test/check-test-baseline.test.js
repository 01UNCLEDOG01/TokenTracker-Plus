const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

function check(t, tap, baseline = "", mode = "--check") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-baseline-check-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "test"));
  const script = path.join(root, "scripts/check-test-baseline.cjs");
  fs.copyFileSync(path.join(__dirname, "../scripts/check-test-baseline.cjs"), script);
  fs.writeFileSync(path.join(root, "test/baseline-red.txt"), baseline);
  fs.writeFileSync(path.join(root, "result.tap"), tap);
  return spawnSync(process.execPath, [script, mode, path.join(root, "result.tap")], { encoding: "utf8" });
}

const summary = (tests, pass, fail, cancelled = 0) =>
  `# tests ${tests}\n# suites 0\n# pass ${pass}\n# fail ${fail}\n# cancelled ${cancelled}\n# skipped 0\n# todo 0\n# duration_ms 1\n`;

test("baseline checker rejects empty and truncated evidence, including --write", (t) => {
  for (const tap of ["", "TAP version 13\nok 1 - green\n", "TAP version 13\n1..1\nok 1 - green\n"])
    for (const mode of ["--check", "--write"])
      assert.notEqual(check(t, tap, "", mode).status, 0, `${mode} accepted incomplete TAP`);
});

test("baseline checker accepts a complete green run", (t) => {
  assert.equal(check(t, `TAP version 13\nok 1 - green\n1..1\n${summary(1, 1, 0)}`).status, 0);
});

test("baseline checker rejects cancellations and plan mismatches", (t) => {
  assert.notEqual(check(t, `TAP version 13\nok 1 - green\n1..2\n${summary(1, 1, 0)}`).status, 0);
  assert.notEqual(check(t, `TAP version 13\nnot ok 1 - cancelled\n1..1\n${summary(1, 0, 0, 1)}`, "cancelled\n").status, 0);
});

test("baseline checker reports a new nested failure even when its parent is known", (t) => {
  const tap = `TAP version 13\n# Subtest: known parent\n    not ok 1 - new child failure\n      ---\n      failureType: 'testCodeFailure'\n      ...\n    1..1\nnot ok 1 - known parent\n  ---\n  failureType: 'subtestsFailed'\n  ...\n1..1\n${summary(2, 0, 2)}`;
  const result = check(t, tap, "known parent\n");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /NEW\s+new child failure/);
});

test("baseline checker ignores aggregate failures and permits known failed leaves", (t) => {
  const tap = `TAP version 13\n    not ok 1 - known child\n      ---\n      failureType: 'testCodeFailure'\n      ...\n    1..1\nnot ok 1 - parent\n  ---\n  failureType: 'subtestsFailed'\n  ...\n1..1\n${summary(2, 0, 2)}`;
  assert.equal(check(t, tap, "known child\n").status, 0);
});
