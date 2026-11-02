const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

// Execute the real orchestration scripts with only subprocess results injected.
// A fake successful baseline check must never hide a failed test runner.
function runFixture(t, script, result, fail = 0) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tt-runner-result-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logs = [];
  let tap;
  let exit = 0;
  const stopped = {};
  const filename = path.join(__dirname, "../scripts", script);
  const fakeSpawn = (_command, args) => {
    if (args.includes("--test")) {
      tap = args.find((arg) => arg.startsWith("--test-reporter-destination=")).split("=")[1];
      fs.writeFileSync(tap, `TAP version 13\n${fail ? "not " : ""}ok 1 - case\n1..1\n# tests 1\n# pass ${1 - fail}\n# fail ${fail}\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 1\n`);
      return result;
    }
    return { status: 0, stdout: "BASELINE MATCH\n", stderr: "" };
  };
  const write = (message) => logs.push(String(message));
  try {
    vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
      __dirname: path.dirname(filename),
      require(name) {
        if (name === "node:child_process") return { spawnSync: fakeSpawn };
        if (name === "node:os") return { ...os, tmpdir: () => root };
        return require(name);
      },
      console: { log: write, error: write },
      process: {
        env: {}, argv: [], pid: 42, execPath: process.execPath, stdout: { write }, stderr: { write },
        exit(code) { exit = code; throw stopped; },
      },
    }, { filename });
  } catch (error) {
    if (error !== stopped) throw error;
  }
  return { exit, evidenceKept: fs.existsSync(tap), logs: logs.join("\n") };
}

for (const script of ["run-fast-tests.cjs", "run-full-tests.cjs"]) {
  test(`${script} rejects abnormal runner termination and retains evidence`, (t) => {
    for (const result of [{ status: null, error: new Error("spawn failed") }, { status: null, signal: "SIGTERM" }, { status: 2 }]) {
      const run = runFixture(t, script, result);
      assert.equal(run.exit, 1);
      assert.equal(run.evidenceKept, true);
    }
  });
  test(`${script} rejects exit 1 with a green summary`, (t) => {
    const run = runFixture(t, script, { status: 1 });
    assert.equal(run.exit, 1);
    assert.equal(run.evidenceKept, true);
  });
  test(`${script} accepts completed green runs and known failure baselines`, (t) => {
    assert.equal(runFixture(t, script, { status: 0 }).exit, 0);
    assert.equal(runFixture(t, script, { status: 1 }, 1).exit, 0);
  });
}
