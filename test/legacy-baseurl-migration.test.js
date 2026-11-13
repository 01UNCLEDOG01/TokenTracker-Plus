const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { cmdSync } = require("../src/commands/sync");
const { cmdDeviceLogin } = require("../src/commands/device-login");
const { resolveRuntimeConfig, isLegacyInsforgeBaseUrl } = require("../src/lib/runtime-config");

const LEGACY_BASE_URL = "https://b46ug8xu.us-east.insforge.app";
const UPSTREAM_BASE_URL = "https://srctyff5.us-east.insforge.app";

async function withTempHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokentracker-legacy-baseurl-"));
  const savedFetch = global.fetch;
  const saved = {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    CODEX_HOME: process.env.CODEX_HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CODE_HOME: process.env.CODE_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    DSH_HOME: process.env.DSH_HOME,
    TOKENTRACKER_DSH_HOME: process.env.TOKENTRACKER_DSH_HOME,
    TOKENTRACKER_TRAE_HOME: process.env.TOKENTRACKER_TRAE_HOME,
    TOKENTRACKER_TRAE_DB: process.env.TOKENTRACKER_TRAE_DB,
    TOKENTRACKER_DEVICE_TOKEN: process.env.TOKENTRACKER_DEVICE_TOKEN,
    TOKENTRACKER_INSFORGE_BASE_URL: process.env.TOKENTRACKER_INSFORGE_BASE_URL,
    TOKENTRACKER_INSFORGE_ANON_KEY: process.env.TOKENTRACKER_INSFORGE_ANON_KEY,
    TOKENTRACKER_SKIP_FIRST_SYNC: process.env.TOKENTRACKER_SKIP_FIRST_SYNC,
  };
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.APPDATA = path.join(home, "AppData", "Roaming");
    process.env.LOCALAPPDATA = path.join(home, "AppData", "Local");
    process.env.CODEX_HOME = path.join(home, ".codex");
    delete process.env.CLAUDE_CONFIG_DIR;
    process.env.CODE_HOME = path.join(home, ".code");
    process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
    process.env.TOKENTRACKER_TRAE_HOME = path.join(home, ".trae");
    delete process.env.TOKENTRACKER_TRAE_DB;
    delete process.env.TOKENTRACKER_DEVICE_TOKEN;
    delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    delete process.env.TOKENTRACKER_INSFORGE_ANON_KEY;
    delete process.env.DSH_HOME;
    delete process.env.TOKENTRACKER_DSH_HOME;
    const trackerDir = path.join(home, ".tokentracker", "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.writeFile(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
    return await fn(home);
  } finally {
    global.fetch = savedFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
}

// These tests exercise backend migration, not discovery of installed tools.
// HOME alone does not isolate Windows APPDATA or explicit provider roots.
function syncFixture(home, argv) {
  return cmdSync(argv, {
    home,
    trackerDataDir: path.join(home, ".tokentracker", "tracker"),
    scanSources: [],
  });
}

async function writeTrackerState(home, { config, queue, queueState } = {}) {
  const trackerDir = path.join(home, ".tokentracker", "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  if (config) await fs.writeFile(path.join(trackerDir, "config.json"), JSON.stringify(config), "utf8");
  if (queue) await fs.writeFile(path.join(trackerDir, "queue.jsonl"), queue, "utf8");
  if (queueState) await fs.writeFile(path.join(trackerDir, "queue.state.json"), JSON.stringify(queueState), "utf8");
  return trackerDir;
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function sampleQueueLine() {
  return `${JSON.stringify({
    hour_start: "2026-04-20T00:00:00.000Z",
    source: "codex",
    model: "gpt-5.4",
    input_tokens: 100,
    output_tokens: 20,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 120,
    conversation_count: 1,
  })}\n`;
}

test("isLegacyInsforgeBaseUrl matches only the retired upstream project host", () => {
  assert.equal(isLegacyInsforgeBaseUrl(LEGACY_BASE_URL), true);
  assert.equal(isLegacyInsforgeBaseUrl(`${LEGACY_BASE_URL}/`), true);
  assert.equal(isLegacyInsforgeBaseUrl("https://B46UG8XU.us-east.insforge.app"), true);
  assert.equal(isLegacyInsforgeBaseUrl(UPSTREAM_BASE_URL), true,
    "upstream's live project is retired from this fork's perspective too");
  assert.equal(isLegacyInsforgeBaseUrl("https://example.invalid"), false);
  assert.equal(isLegacyInsforgeBaseUrl("not a url"), false);
  assert.equal(isLegacyInsforgeBaseUrl(undefined), false);
});

test("resolveRuntimeConfig drops a persisted retired or upstream URL", () => {
  for (const url of [LEGACY_BASE_URL, UPSTREAM_BASE_URL]) {
    const runtime = resolveRuntimeConfig({ config: { baseUrl: url, anonKey: `anon_${"a".repeat(40)}` }, env: {} });
    assert.equal(runtime.baseUrl, null, `${url} must not become the active instance`);
    assert.equal(runtime.sources.baseUrl, "default");
    assert.equal(runtime.configurationError, null);
  }

  // Explicit CLI values still win — only persisted config values are healed.
  const explicit = resolveRuntimeConfig({ cli: { baseUrl: LEGACY_BASE_URL }, config: {}, env: {} });
  assert.equal(explicit.baseUrl, LEGACY_BASE_URL);
  assert.equal(explicit.sources.baseUrl, "cli");
});

test("sync drops a retired persisted backend without replaying anything", async () => {
  await withTempHome(async (home) => {
    const trackerDir = await writeTrackerState(home, {});
    await syncFixture(home, ["--auto"]);

    const queue = sampleQueueLine();
    await writeTrackerState(home, {
      config: {
        installedAt: "2026-03-23T08:16:55.409Z",
        baseUrl: LEGACY_BASE_URL,
        anonKey: "legacy-anon-key",
        deviceToken: "legacy-token",
        deviceId: "legacy-device",
        user_id: "legacy-user",
        device_login_at: "2026-03-23T08:20:00.000Z",
        machineId: "machine-1",
      },
      queue,
      queueState: { offset: Buffer.byteLength(queue), updatedAt: "2026-07-27T11:20:56.334Z" },
    });

    const calls = [];
    global.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("a local-only install must not dial any host");
    };
    await syncFixture(home, ["--auto"]);

    const config = await readJsonFile(path.join(trackerDir, "config.json"));
    assert.equal(config.baseUrl, undefined, "the dead instance URL must be gone");
    assert.equal(config.anonKey, undefined, "its anonymous key belongs to that instance");
    assert.equal(config.deviceToken, undefined, "its device identity belongs to that instance");
    assert.equal(config.deviceId, undefined);
    assert.equal(config.user_id, undefined);
    assert.equal(config.machineId, "machine-1", "the local identity anchor survives");
    assert.equal(config.installedAt, "2026-03-23T08:16:55.409Z");

    const queueState = await readJsonFile(path.join(trackerDir, "queue.state.json"));
    assert.equal(queueState.offset, Buffer.byteLength(queue), "the queue offset is never rewound");
    const cloudCalls = calls.filter((url) => url.startsWith(LEGACY_BASE_URL) || url.startsWith(UPSTREAM_BASE_URL));
    assert.deepEqual(cloudCalls, [], "no upstream replay happens anywhere");
  });
});

test("device-login refuses a retired persisted backend without dialing it", async () => {
  await withTempHome(async (home) => {
    await writeTrackerState(home, { config: { baseUrl: LEGACY_BASE_URL, deviceToken: "legacy-token" } });

    const calls = [];
    const savedStdoutWrite = process.stdout.write;
    process.stdout.write = () => true;
    global.fetch = async (url) => {
      calls.push(String(url));
      throw new Error("stop after first request");
    };
    try {
      await assert.rejects(() => cmdDeviceLogin([], { home, sleep: async () => {} }));
    } finally {
      process.stdout.write = savedStdoutWrite;
    }
    assert.equal(calls.length, 0, `device login must not dial: ${calls.join(", ")}`);
  });
});

test("sync leaves a configured base URL untouched", async () => {
  await withTempHome(async (home) => {
    const trackerDir = await writeTrackerState(home, {});
    await syncFixture(home, ["--auto"]);

    await writeTrackerState(home, {
      config: {
        installedAt: "2026-05-01T00:00:00.000Z",
        baseUrl: "https://current.example",
        anonKey: `anon_${"a".repeat(40)}`,
        deviceToken: "current-token",
      },
      queueState: { offset: 500, updatedAt: "2026-07-27T00:00:00.000Z" },
    });

    await syncFixture(home, ["--auto"]);

    const config = await readJsonFile(path.join(trackerDir, "config.json"));
    assert.equal(config.baseUrl, "https://current.example");
    assert.equal(config.deviceToken, "current-token");

    const queueState = await readJsonFile(path.join(trackerDir, "queue.state.json"));
    assert.equal(queueState.offset, 500);
  });
});
