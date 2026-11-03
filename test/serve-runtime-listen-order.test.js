const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

test("the first HTML response does not wait for runtime copy or hook repair", { timeout: 15000 }, async () => {
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const root = path.resolve(__dirname, "..");
  const script = `
    const root = ${JSON.stringify(root)};
    const path = require("node:path");
    const mock = (file, exports) => { const id = require.resolve(path.join(root, file)); require.cache[id] = { id, filename: id, loaded: true, exports }; };
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    mock("src/commands/init.js", { installLocalTrackerApp: () => blocked, repairRuntimeIntegrations: async () => ({ warnings: [] }), cmdInit: async () => {} });
    mock("src/lib/tracker-paths.js", { resolveTrackerPaths: async () => ({ trackerDir: path.join(root, ".tmp", "owned-startup-test"), binDir: root, cacheDir: root }) });
    mock("src/lib/local-api.js", { createLocalApiHandler: () => async () => false, resolveQueuePath: () => path.join(root, ".tmp", "owned-startup-test", "queue.jsonl") });
    mock("src/lib/pricing", { ensurePricingLoaded: async () => {} });
    mock("src/lib/star-cta.js", { maybeShowStarCta: async () => {} });
    process.on("message", () => release());
    const source = require("node:fs").readFileSync(path.join(root, "src/commands/serve.js"), "utf8");
    const Module = require("node:module");
    const mod = new Module(path.join(root, "src/commands/serve.js"), module);
    mod.filename = path.join(root, "src/commands/serve.js"); mod.paths = module.paths;
    mod._compile(source, mod.filename);
    mod.exports.cmdServe(["--port", "${port}", "--no-sync", "--no-open"]).catch(() => process.exit(1));
  `;
  const child = spawn(process.execPath, ["-e", script], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"], env: { ...process.env, TOKENTRACKER_NO_TELEMETRY: "1", TOKENTRACKER_APP_SHELL: "cli" } });
  let output = "";
  let errors = "";
  child.stdout.on("data", (value) => { output += value; });
  child.stderr.on("data", (value) => { errors += value; });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("listener waited for blocked runtime copy")), 5000);
      child.stdout.on("data", () => { if (output.includes("dashboard running at:")) { clearTimeout(timeout); resolve(); } });
      child.once("exit", () => { clearTimeout(timeout); reject(new Error("startup child exited: " + errors)); });
    });
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("/api/runtime-config.js"));
  } finally {
    child.kill();
    if (child.exitCode == null) await new Promise((resolve) => child.once("exit", resolve));
  }
});
