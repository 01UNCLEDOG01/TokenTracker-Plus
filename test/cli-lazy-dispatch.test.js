const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

function loadCli(invoke = async () => {}) {
  const loaded = [];
  const calls = [];
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../src/cli.js"), "utf8"), {
    module,
    process: { stdout: { write() {} } },
    console: { log() {} },
    require(id) {
      loaded.push(id);
      if (id === "../package.json") return { version: "1.0.0" };
      return new Proxy({}, { get: (_target, method) => async (args) => {
        calls.push({ id, method, args });
        await invoke();
      } });
    },
  });
  return { run: module.exports.run, loaded, calls };
}

test("loading the CLI and asking for help does not load collectors", async () => {
  const cli = loadCli();
  assert.deepEqual(cli.loaded, []);
  await cli.run(["--help"]);
  assert.deepEqual(cli.loaded, []);
  await cli.run(["--version"]);
  assert.deepEqual(cli.loaded, ["../package.json"]);
});

test("every command loads its own handler and preserves arguments", async () => {
  const methods = {
    serve: "cmdServe", init: "cmdInit", sync: "cmdSync", status: "cmdStatus",
    diagnostics: "cmdDiagnostics", doctor: "cmdDoctor", uninstall: "cmdUninstall",
    "device-login": "cmdDeviceLogin", wrapped: "cmdWrapped", sessions: "cmdSessions",
    backup: "cmdBackup", restore: "cmdRestore",
  };
  for (const [command, method] of Object.entries(methods)) {
    const cli = loadCli();
    const file = `./commands/${command === "restore" ? "backup" : command}`;
    await cli.run([command, "--json", "an argument with spaces"]);
    assert.deepEqual(cli.loaded, [file]);
    assert.equal(cli.calls[0].method, method);
    assert.deepEqual(Array.from(cli.calls[0].args), ["--json", "an argument with spaces"]);
  }
});

test("default launch loads only serve and unknown commands load nothing", async () => {
  const cli = loadCli();
  const argv = [];
  await cli.run(argv);
  assert.deepEqual(cli.loaded, ["./commands/serve"]);
  assert.equal(cli.calls[0].args, argv);
  const unknown = loadCli();
  await assert.rejects(unknown.run(["constructor"]), /Unknown command/);
  assert.deepEqual(unknown.loaded, []);
});

test("lazy dispatch waits for command completion and preserves failures", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const cli = loadCli(() => pending);
  let complete = false;
  const running = cli.run(["sync"]).then(() => { complete = true; });
  await Promise.resolve();
  assert.equal(complete, false);
  release();
  await running;
  assert.equal(complete, true);

  const error = new Error("fixture command failure");
  const failing = loadCli(async () => { throw error; });
  await assert.rejects(failing.run(["sync"]), (actual) => actual === error);
});
