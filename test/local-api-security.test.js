const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beforeEach, test } = require("node:test");
const crypto = require("node:crypto");
const publicAnon = [Buffer.from('{"alg":"HS256"}').toString("base64url"),
  Buffer.from('{"role":"anon"}').toString("base64url"), "test-signature"].join(".");

function bindTestInstance(trackerDir, baseUrl = "https://cloud.example") {
  fs.writeFileSync(path.join(trackerDir, "config.json"), JSON.stringify({ machineId: "machine-abcdef12", baseUrl, anonKey: publicAnon }));
  fs.writeFileSync(path.join(trackerDir, "runtime-instance.json"), JSON.stringify({
    fingerprint: crypto.createHash("sha256").update(`${baseUrl}\0${publicAnon}`).digest("hex"),
  }));
}

beforeEach((t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-api-security-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // Upload security cases require an explicit opt-in and must not read the
  // developer's saved preference. Opt-out cases use their own nested fixture.
  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  t.after(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });
});

function createRequest({ method = "GET", headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;

  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(body));
    req.emit("end");
  });

  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

async function getLocalAuthToken(handler) {
  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(req, res, new URL("http://127.0.0.1/api/local-auth"));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Cache-Control"], "no-store");
  const body = JSON.parse(res.body.toString("utf8"));
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.length > 0);
  return body.token;
}

test("foreign pages cannot consume the one-time native OAuth callback marker", async () => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
  const token = await getLocalAuthToken(handler);
  const url = new URL("http://127.0.0.1:7680/api/auth-bridge/verifier");
  const marked = createResponse();
  await handler(createRequest({ method: "PUT", headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ native: true }) }), marked, url);
  assert.equal(marked.statusCode, 200);
  for (const headers of [{ origin: "https://untrusted.example.invalid" }, { origin: "null" },
    { referer: "https://untrusted.example.invalid/" }, { "sec-fetch-site": "cross-site" }]) {
    const res = createResponse();
    await handler(createRequest({ headers }), res, url);
    assert.equal(res.statusCode, 403);
  }
  for (const expected of [true, false]) {
    const res = createResponse();
    await handler(createRequest({ headers: { referer: "http://127.0.0.1:7680/auth/callback" } }), res, url);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body.toString()).native, expected);
  }
});

function loadLocalApiWithSpawn(fakeSpawn) {
  const childProcess = require("node:child_process");
  const cloudAccount = require("../src/lib/cloud-account");
  const originalSpawn = childProcess.spawn;
  cloudAccount.__resetCloudAccountCacheForTests();
  childProcess.spawn = fakeSpawn;
  delete require.cache[require.resolve("../src/lib/local-api")];
  const mod = require("../src/lib/local-api");
  const factory = mod.createLocalApiHandler;
  const generated = [];
  mod.createLocalApiHandler = options => {
    const queuePath = path.dirname(options.queuePath) === process.cwd()
      ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-api-spawn-")), "queue.jsonl") : options.queuePath;
    if (queuePath !== options.queuePath) generated.push(path.dirname(queuePath));
    if (queuePath !== options.queuePath && process.env.TOKENTRACKER_INSFORGE_BASE_URL) {
      bindTestInstance(path.dirname(queuePath), process.env.TOKENTRACKER_INSFORGE_BASE_URL);
    }
    return factory({ ...options, queuePath, trackerDataDir: path.dirname(queuePath), syncContext: { scanSources: [] } });
  };
  return {
    mod,
    restore() {
      childProcess.spawn = originalSpawn;
      cloudAccount.__resetCloudAccountCacheForTests();
      delete require.cache[require.resolve("../src/lib/local-api")];
      for (const directory of generated) fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("local device metadata exposes the system name separately from machine identity", () => {
  const { getSystemDeviceName } = require("../src/lib/local-api");
  const expected = os.hostname().replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 128) || null;
  assert.equal(getSystemDeviceName(), expected);
  assert.doesNotMatch(getSystemDeviceName() || "", /^Token Tracker .*#/u);
});

test("local auth reports the serve runtime version when provided", async (t) => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-auth-version-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const handler = createLocalApiHandler({
    queuePath: path.join(tempDir, "queue.jsonl"),
    serverVersion: "1.2.3-test",
  });
  const req = createRequest({ method: "GET" });
  const res = createResponse();

  const handled = await handler(req, res, new URL("http://127.0.0.1/api/local-auth"));

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body.toString("utf8"));
  assert.equal(body.serverVersion, "1.2.3-test");
  assert.equal(typeof body.token, "string");
  assert.ok(body.token.length > 0);
});

function createSuccessfulSpawn(calls) {
  return (cmd, args, options) => {
    calls.push({ cmd, args: args[0] === "-e" ? [path.join(process.cwd(), "bin/tracker.js"), "sync", ...args.slice(3)] : args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stdout.emit("data", "sync ok");
      child.emit("close", 0);
    });
    return child;
  };
}

function createBusySpawn(calls) {
  return (cmd, args, options) => {
    calls.push({ cmd, args: args[0] === "-e" ? [path.join(process.cwd(), "bin/tracker.js"), "sync", ...args.slice(3)] : args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    process.nextTick(() => {
      child.stderr.emit(
        "data",
        "Error: SYNC_BUSY: another sync is still running; no refresh was performed\n",
      );
      child.emit("close", 1);
    });
    return child;
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRelayedLoginFixture(prefix, { cloudSyncEnabled = true, includeRefreshToken = true } = {}) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://cloud.example";

  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: cloudSyncEnabled }));
  bindTestInstance(trackerDir);
  if (includeRefreshToken) {
    fs.writeFileSync(
      path.join(trackerDir, "relay-cookies.json"),
      JSON.stringify({
        insforge_refresh_token: "insforge_refresh_token=refresh-xyz; Path=/; HttpOnly; SameSite=Lax",
      }),
    );
  }

  return {
    trackerDir,
    restore() {
      if (prevHome === undefined) delete process.env.HOME;
      else process.env.HOME = prevHome;
      if (prevUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prevUserProfile;
      if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
      else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
      fs.rmSync(tmpHome, { recursive: true, force: true });
    },
  };
}

test("local sync rejects arbitrary insforgeBaseUrl overrides", async () => {
  const calls = [];
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://allowed.example";
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        insforgeBaseUrl: "https://evil.example",
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unsupported insforgeBaseUrl override",
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
  }
});

test("local sync preserves the SYNC_BUSY failure code", async () => {
  const calls = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-sync-busy-"));
  const { mod, restore } = loadLocalApiWithSpawn(createBusySpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(tempDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ drain: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 500);
    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.ok, false);
    assert.equal(body.code, "SYNC_BUSY");
    assert.match(body.error, /no refresh was performed/);
    assert.equal(calls.length, 1);
  } finally {
    restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("local sync accepts the configured insforgeBaseUrl override", async () => {
  const calls = [];
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://allowed.example";

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        insforgeBaseUrl: "https://allowed.example/",
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].options.env.TOKENTRACKER_INSFORGE_BASE_URL,
      "https://allowed.example",
    );
  } finally {
    restore();
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
  }
});

test("local sync drain request runs sync with --drain", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        drain: true,
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), [path.join(process.cwd(), "bin/tracker.js"), "sync", "--drain"]);
  } finally {
    restore();
  }
});

test("local sync auto background request runs sync with --auto --background", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        auto: true,
        background: true,
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-4), [
      path.join(process.cwd(), "bin/tracker.js"),
      "sync",
      "--auto",
      "--background",
    ]);
  } finally {
    restore();
  }
});

test("local sync all-local background request forwards the source expansion flag", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        auto: true,
        background: true,
        allLocalSources: true,
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-5), [
      path.join(process.cwd(), "bin/tracker.js"),
      "sync",
      "--auto",
      "--background",
      "--all-local-sources",
    ]);
  } finally {
    restore();
  }
});

test("local sync lightweight alias forwards background mode", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        auto: true,
        lightweight: true,
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-4), [
      path.join(process.cwd(), "bin/tracker.js"),
      "sync",
      "--auto",
      "--background",
    ]);
  } finally {
    restore();
  }
});

test("local sync combines background scan with drain priority", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({
        deviceToken: "device-token",
        drain: true,
        auto: true,
        background: true,
        lightweight: true,
      }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-5), [
      path.join(process.cwd(), "bin/tracker.js"),
      "sync",
      "--auto",
      "--background",
      "--drain",
    ]);
  } finally {
    restore();
  }
});

test("local sync only treats boolean true as background or lightweight", async () => {
  const cases = [
    { background: false },
    { background: "true" },
    { background: 1 },
    { lightweight: false },
    { lightweight: "true" },
    { lightweight: 1 },
  ];

  for (const body of cases) {
    const calls = [];
    const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

    try {
      const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
      const localAuthToken = await getLocalAuthToken(handler);
      const req = createRequest({
        method: "POST",
        headers: { "x-tokentracker-local-auth": localAuthToken },
        body: JSON.stringify({
          auto: true,
          ...body,
        }),
      });
      const res = createResponse();

      const handled = await handler(
        req,
        res,
        new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
      );

      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args.slice(-3), [
        path.join(process.cwd(), "bin/tracker.js"),
        "sync",
        "--auto",
      ]);
    } finally {
      restore();
    }
  }
});

test("local sync only treats boolean true as drain", async () => {
  const cases = [
    {},
    { drain: false },
    { drain: "true" },
    { drain: 1 },
  ];

  for (const body of cases) {
    const calls = [];
    const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

    try {
      const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
      const localAuthToken = await getLocalAuthToken(handler);
      const req = createRequest({
        method: "POST",
        headers: { "x-tokentracker-local-auth": localAuthToken },
        body: JSON.stringify({
          ...body,
        }),
      });
      const res = createResponse();

      const handled = await handler(
        req,
        res,
        new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
      );

      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args.slice(-2), [
        path.join(process.cwd(), "bin/tracker.js"),
        "sync",
      ]);
    } finally {
      restore();
    }
  }
});

test("local sync non-drain request mints a device token from relayed login when none is provided", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-");
  const prevFetch = global.fetch;

  const fetchCalls = [];
  global.fetch = async (urlStr, opts = {}) => {
    fetchCalls.push({ url: String(urlStr), opts });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return { ok: true, status: 200, json: async () => ({ accessToken: "access-token" }) };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      assert.equal(opts.headers.Authorization, "Bearer access-token");
      const body = JSON.parse(String(opts.body || "{}"));
      assert.equal(body.machine_id, "machine-abcdef12");
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "issued-device-token", device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), [
      path.join(process.cwd(), "bin/tracker.js"),
      "sync",
      "--wait-for-lock",
    ]);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.ok(fetchCalls.some((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")));
    assert.ok(fetchCalls.some((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")));
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync reuses relayed device token cache across repeated requests", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-cache-");
  const prevFetch = global.fetch;
  const fetchCalls = [];

  global.fetch = async (urlStr, opts) => {
    fetchCalls.push({ url: String(urlStr), opts });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      assert.equal(JSON.parse(String(opts.body || "{}")).refresh_token, "refresh-xyz");
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "access-token", refreshToken: "refresh-rotated" }),
      };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      assert.equal(opts.headers.Authorization, "Bearer access-token");
      const body = JSON.parse(String(opts.body || "{}"));
      assert.equal(body.machine_id, "machine-abcdef12");
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "issued-device-token", device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);

    for (let i = 0; i < 2; i += 1) {
      const req = createRequest({
        method: "POST",
        headers: { "x-tokentracker-local-auth": localAuthToken },
        body: JSON.stringify({}),
      });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
    }

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.equal(calls[1].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")).length, 1);
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")).length, 1);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync reuses relayed device token cache without refresh rotation", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-cache-stable-");
  const prevFetch = global.fetch;
  const fetchCalls = [];

  global.fetch = async (urlStr, opts) => {
    fetchCalls.push({ url: String(urlStr), opts });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      assert.equal(JSON.parse(String(opts.body || "{}")).refresh_token, "refresh-xyz");
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "access-token" }),
      };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      assert.equal(opts.headers.Authorization, "Bearer access-token");
      const body = JSON.parse(String(opts.body || "{}"));
      assert.equal(body.machine_id, "machine-abcdef12");
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "issued-device-token", device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);

    for (let i = 0; i < 2; i += 1) {
      const req = createRequest({
        method: "POST",
        headers: { "x-tokentracker-local-auth": localAuthToken },
        body: JSON.stringify({}),
      });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
    }

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.equal(calls[1].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")).length, 1);
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")).length, 1);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync dedupes concurrent relayed device token minting", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-cache-inflight-");
  const prevFetch = global.fetch;
  const fetchCalls = [];
  const issueStarted = createDeferred();
  const issueGate = createDeferred();

  global.fetch = async (urlStr, opts) => {
    fetchCalls.push({ url: String(urlStr), opts });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "access-token" }),
      };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      issueStarted.resolve();
      await issueGate.promise;
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "issued-device-token", device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);

    const firstReq = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const firstRes = createResponse();
    const firstSync = handler(firstReq, firstRes, new URL("http://127.0.0.1/functions/tokentracker-local-sync"));
    await issueStarted.promise;

    const secondReq = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const secondRes = createResponse();
    const secondSync = handler(secondReq, secondRes, new URL("http://127.0.0.1/functions/tokentracker-local-sync"));
    await new Promise((resolve) => setImmediate(resolve));
    issueGate.resolve();

    assert.equal(await firstSync, true);
    assert.equal(await secondSync, true);
    assert.equal(firstRes.statusCode, 200);
    assert.equal(secondRes.statusCode, 200);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.equal(calls[1].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")).length, 1);
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")).length, 1);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync scopes relayed device token cache by InsForge base URL", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-cache-base-url-");
  const prevFetch = global.fetch;
  const fetchCalls = [];
  // This build has no default cloud: a second instance is just another
  // explicitly named origin, and it must never share the minted token.
  const otherRoot = "https://other-instance.example";
  const tokensByRoot = new Map([
    ["https://cloud.example", "cloud-device-token"],
    [otherRoot, "other-device-token"],
  ]);

  global.fetch = async (urlStr, opts) => {
    const url = String(urlStr);
    fetchCalls.push({ url, opts });
    if (url === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "cloud-access-token" }),
      };
    }
    if (url === `${otherRoot}/api/auth/refresh?client_type=mobile`) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: "other-access-token" }),
      };
    }
    if (url.endsWith("/tokentracker-device-token-issue")) {
      const root = url.slice(0, -"/functions/tokentracker-device-token-issue".length);
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: tokensByRoot.get(root), device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);

    const firstReq = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const firstRes = createResponse();
    assert.equal(
      await handler(firstReq, firstRes, new URL("http://127.0.0.1/functions/tokentracker-local-sync")),
      true,
    );
    assert.equal(firstRes.statusCode, 200);

    const secondReq = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ insforgeBaseUrl: otherRoot }),
    });
    const secondRes = createResponse();
    assert.equal(
      await handler(secondReq, secondRes, new URL("http://127.0.0.1/functions/tokentracker-local-sync")),
      true,
    );
    assert.equal(secondRes.statusCode, 400);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "cloud-device-token");
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")).length, 1);
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/tokentracker-device-token-issue")).length, 1);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync remints relayed device token after active refresh token changes", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-cache-split-");
  const prevFetch = global.fetch;
  const fetchCalls = [];
  const issueTokens = ["issued-device-token-1", "issued-device-token-2"];

  function jsonProxyResponse(data) {
    const body = Buffer.from(JSON.stringify(data));
    return {
      ok: true,
      status: 200,
      headers: {
        entries: () => [["content-type", "application/json"]],
        get: (name) => (String(name).toLowerCase() === "content-type" ? "application/json" : null),
      },
      arrayBuffer: async () => body,
    };
  }

  global.fetch = async (urlStr, opts) => {
    const parsedBody = JSON.parse(String(opts.body || "{}"));
    fetchCalls.push({ url: String(urlStr), body: parsedBody });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      if (parsedBody.refresh_token === "refresh-xyz" && opts.credentials === "include") {
        return jsonProxyResponse({ accessToken: "proxy-access-token", refreshToken: "refresh-new" });
      }
      const suffix = parsedBody.refresh_token === "refresh-new" ? "2" : "1";
      return {
        ok: true,
        status: 200,
        json: async () => ({ accessToken: `access-token-${suffix}` }),
      };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      const token = issueTokens.shift();
      assert.ok(token, "unexpected extra device-token issue request");
      assert.match(opts.headers.Authorization, /^Bearer access-token-[12]$/);
      const body = JSON.parse(String(opts.body || "{}"));
      assert.equal(body.machine_id, "machine-abcdef12");
      return {
        ok: true,
        status: 200,
        json: async () => ({ token, device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);

    const firstSyncReq = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const firstSyncRes = createResponse();
    assert.equal(
      await handler(firstSyncReq, firstSyncRes, new URL("http://127.0.0.1/functions/tokentracker-local-sync")),
      true,
    );
    assert.equal(firstSyncRes.statusCode, 200);

    const refreshReq = createRequest({ method: "POST" });
    refreshReq[Symbol.asyncIterator] = async function* () {};
    const refreshRes = createResponse();
    assert.equal(
      await handler(refreshReq, refreshRes, new URL("http://127.0.0.1/api/auth/refresh")),
      true,
    );
    assert.equal(refreshRes.statusCode, 200, refreshRes.body.toString("utf8"));

    const secondSyncReq = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const secondSyncRes = createResponse();
    assert.equal(
      await handler(secondSyncReq, secondSyncRes, new URL("http://127.0.0.1/functions/tokentracker-local-sync")),
      true,
    );
    assert.equal(secondSyncRes.statusCode, 200);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token-1");
    assert.equal(calls[1].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token-2");
    assert.deepEqual(
      fetchCalls.filter((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")).map((c) => c.body.refresh_token),
      ["refresh-xyz", "refresh-xyz", "refresh-new"],
    );
    assert.equal(fetchCalls.filter((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")).length, 2);
    assert.equal(issueTokens.length, 0);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync non-drain request rejects an unproved explicit device token without relayed minting", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-explicit-token-");
  const prevFetch = global.fetch;

  global.fetch = async (urlStr) => {
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ deviceToken: "explicit-device-token" }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body.toString("utf8")).code, "auth_session_required");
    assert.equal(calls.length, 0);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync non-drain request falls back to local sync when relayed device token cannot be issued", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-auto-fail-");
  const prevFetch = global.fetch;

  global.fetch = async (urlStr) => {
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return { ok: true, status: 200, json: async () => ({ accessToken: "access-token" }) };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      return { ok: false, status: 502, json: async () => ({ error: "upstream unavailable" }) };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-2), [path.join(process.cwd(), "bin/tracker.js"), "sync"]);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, undefined);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync non-drain request skips relayed minting when cloud sync is disabled", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-cloud-off-", { cloudSyncEnabled: false });
  const prevFetch = global.fetch;

  global.fetch = async (urlStr) => {
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-2), [path.join(process.cwd(), "bin/tracker.js"), "sync"]);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, undefined);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync non-drain request skips relayed minting when refresh token is absent", async () => {
  const calls = [];
  const fixture = createRelayedLoginFixture("tt-local-sync-no-refresh-", { includeRefreshToken: false });
  const prevFetch = global.fetch;

  global.fetch = async (urlStr) => {
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(fixture.trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({}),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-2), [path.join(process.cwd(), "bin/tracker.js"), "sync"]);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, undefined);
  } finally {
    restore();
    global.fetch = prevFetch;
    fixture.restore();
  }
});

test("local sync drain request mints a device token from relayed login when none is provided", async () => {
  const calls = [];
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-sync-drain-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const prevFetch = global.fetch;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://cloud.example";

  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  bindTestInstance(trackerDir);
  fs.writeFileSync(
    path.join(trackerDir, "relay-cookies.json"),
    JSON.stringify({
      insforge_refresh_token: "insforge_refresh_token=refresh-xyz; Path=/; HttpOnly; SameSite=Lax",
    }),
  );

  const fetchCalls = [];
  global.fetch = async (urlStr, opts = {}) => {
    fetchCalls.push({ url: String(urlStr), opts });
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return { ok: true, status: 200, json: async () => ({ accessToken: "access-token" }) };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      assert.equal(opts.headers.Authorization, "Bearer access-token");
      const body = JSON.parse(String(opts.body || "{}"));
      assert.equal(body.machine_id, "machine-abcdef12");
      assert.equal(body.device_name, os.hostname().replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 128));
      assert.equal(
        body.platform,
        process.platform === "darwin" ? "MacIntel" :
          process.platform === "win32" ? "Win32" :
            process.platform === "linux" ? "Linux x86_64" :
              "web",
      );
      return {
        ok: true,
        status: 200,
        json: async () => ({ token: "issued-device-token", device_id: "device-id" }),
      };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ drain: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(-3), [path.join(process.cwd(), "bin/tracker.js"), "sync", "--drain"]);
    assert.equal(calls[0].options.env.TOKENTRACKER_DEVICE_TOKEN, "issued-device-token");
    assert.ok(fetchCalls.some((c) => c.url.endsWith("/api/auth/refresh?client_type=mobile")));
    assert.ok(fetchCalls.some((c) => c.url.endsWith("/functions/tokentracker-device-token-issue")));
  } finally {
    restore();
    global.fetch = prevFetch;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("local sync drain request fails when relayed device token cannot be issued", async () => {
  const calls = [];
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-local-sync-drain-fail-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  const prevBaseUrl = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const prevFetch = global.fetch;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.TOKENTRACKER_INSFORGE_BASE_URL = "https://cloud.example";

  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "cloud-sync-pref.json"), JSON.stringify({ enabled: true }));
  bindTestInstance(trackerDir);
  fs.writeFileSync(
    path.join(trackerDir, "relay-cookies.json"),
    JSON.stringify({
      insforge_refresh_token: "insforge_refresh_token=refresh-xyz; Path=/; HttpOnly; SameSite=Lax",
    }),
  );

  global.fetch = async (urlStr) => {
    if (String(urlStr) === "https://cloud.example/api/auth/refresh?client_type=mobile") {
      return { ok: true, status: 200, json: async () => ({ accessToken: "access-token" }) };
    }
    if (String(urlStr) === "https://cloud.example/functions/tokentracker-device-token-issue") {
      return { ok: false, status: 502, json: async () => ({ error: "upstream unavailable" }) };
    }
    throw new Error(`unexpected fetch ${urlStr}`);
  };

  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({
      queuePath: path.join(trackerDir, "queue.jsonl"),
    });
    const localAuthToken = await getLocalAuthToken(handler);
    const req = createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": localAuthToken },
      body: JSON.stringify({ drain: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 502);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unable to issue cloud device token for local sync",
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
    global.fetch = prevFetch;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevBaseUrl === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBaseUrl;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("local sync rejects requests without the local auth token", async () => {
  const calls = [];
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn(calls));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const req = createRequest({
      method: "POST",
      body: JSON.stringify({ deviceToken: "device-token" }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/tokentracker-local-sync"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      ok: false,
      error: "Unauthorized",
    });
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

test("auth bridge mutation requires the local auth token", async () => {
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn([]));

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(process.cwd(), "tmp-queue.jsonl") });
    const req = createRequest({
      method: "PUT",
      body: JSON.stringify({ native: true }),
    });
    const res = createResponse();

    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/api/auth-bridge/verifier"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), { error: "Unauthorized" });
  } finally {
    restore();
  }
});

test("usage-limits honors devin=1 only on locally authenticated requests", async () => {
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn([]));
  // Stub the aggregate seam so the handler never touches real credentials or
  // the network; only the forwarded selection flag is observed.
  const usageLimits = require("../src/lib/usage-limits");
  const originalGet = usageLimits.getUsageLimits;
  const originalReset = usageLimits.resetUsageLimitsCache;
  const forwarded = [];
  let aggregateCalls = 0;
  let cacheResets = 0;
  usageLimits.getUsageLimits = async (options) => {
    aggregateCalls += 1;
    forwarded.push(options);
    return { fetched_at: "2026-01-01T00:00:00Z", devin: { configured: false } };
  };
  usageLimits.resetUsageLimitsCache = () => {
    cacheResets += 1;
  };

  async function requestLimits({ devin, token, refresh, origin } = {}) {
    const params = new URLSearchParams();
    if (devin) params.set("devin", devin);
    if (refresh) params.set("refresh", refresh);
    const query = params.size ? `?${params}` : "";
    const headers = {};
    if (token) headers["x-tokentracker-local-auth"] = token;
    if (origin) headers.origin = origin;
    const req = createRequest({ method: "GET", headers });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL(`http://127.0.0.1/functions/tokentracker-usage-limits${query}`),
    );
    assert.equal(handled, true);
    return res;
  }

  const handler = mod.createLocalApiHandler({
    queuePath: path.join(process.cwd(), "tmp-queue.jsonl"),
  });
  try {
    const localAuthToken = await getLocalAuthToken(handler);

    // An explicit opt-in without local auth is rejected outright — before any
    // cache reset or aggregate work, so nothing downstream can misreport the
    // enabled client as a disabled provider.
    for (const token of [undefined, "wrong-token"]) {
      const res = await requestLimits({ devin: "1", refresh: "1", token });
      assert.equal(res.statusCode, 401, `devin=1 with token=${token} must 401`);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), { error: "Unauthorized" });
    }
    // The devin=true alias is the same opt-in: rejected without auth, and a
    // valid token from a non-loopback origin fails the check all the same.
    const trueUnauthed = await requestLimits({ devin: "true" });
    assert.equal(trueUnauthed.statusCode, 401, "devin=true without auth must 401");
    const badOrigin = await requestLimits({
      devin: "1",
      token: localAuthToken,
      origin: "https://evil.example",
    });
    assert.equal(badOrigin.statusCode, 401, "devin=1 from a foreign origin must 401");
    assert.equal(aggregateCalls, 0, "unauthorized opt-in reached the aggregate");
    assert.equal(cacheResets, 0, "unauthorized opt-in reset the limits cache");

    const ok = await requestLimits({ devin: "1", token: localAuthToken });
    assert.equal(ok.statusCode, 200);
    assert.equal(forwarded.at(-1).devinEnabled, true, "authenticated opt-in forwards enabled");

    const trueOk = await requestLimits({ devin: "true", token: localAuthToken });
    assert.equal(trueOk.statusCode, 200);
    assert.equal(forwarded.at(-1).devinEnabled, true, "devin=true with auth forwards enabled");

    // devin=0/false are absent opt-ins: no auth needed, provider stays off.
    for (const devin of ["0", "false"]) {
      const res = await requestLimits({ devin });
      assert.equal(res.statusCode, 200, `devin=${devin} must not require auth`);
      assert.equal(forwarded.at(-1).devinEnabled, false, `devin=${devin} stays off`);
    }

    // Ordinary requests — with or without local auth but no devin flag — keep
    // their previous behavior.
    for (const token of [localAuthToken, undefined]) {
      const res = await requestLimits({ token });
      assert.equal(res.statusCode, 200);
      assert.equal(forwarded.at(-1).devinEnabled, false, `token=${token} without opt-in stays off`);
    }
  } finally {
    usageLimits.getUsageLimits = originalGet;
    usageLimits.resetUsageLimitsCache = originalReset;
    restore();
  }
});

test("usage-limits honors hidden=<csv> only on locally authenticated requests", async () => {
  const { mod, restore } = loadLocalApiWithSpawn(createSuccessfulSpawn([]));
  // Same aggregate seam stub as the devin test above: only the forwarded
  // selection is observed, never real credentials or the network.
  const usageLimits = require("../src/lib/usage-limits");
  const originalGet = usageLimits.getUsageLimits;
  const originalReset = usageLimits.resetUsageLimitsCache;
  const forwarded = [];
  let aggregateCalls = 0;
  usageLimits.getUsageLimits = async (options) => {
    aggregateCalls += 1;
    forwarded.push(options);
    return { fetched_at: "2026-01-01T00:00:00Z", claude: { configured: false } };
  };

  async function requestLimits({ hidden, token } = {}) {
    const params = new URLSearchParams();
    if (hidden) params.set("hidden", hidden);
    const query = params.size ? `?${params}` : "";
    const headers = {};
    if (token) headers["x-tokentracker-local-auth"] = token;
    const req = createRequest({ method: "GET", headers });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL(`http://127.0.0.1/functions/tokentracker-usage-limits${query}`),
    );
    assert.equal(handled, true);
    return res;
  }

  const handler = mod.createLocalApiHandler({
    queuePath: path.join(process.cwd(), "tmp-queue.jsonl"),
  });
  try {
    const localAuthToken = await getLocalAuthToken(handler);

    // An explicit visibility gate without local auth is rejected outright —
    // letting an unauthenticated caller scope the fetch would let it pick
    // exactly which credentials to leave alone (#956).
    for (const token of [undefined, "wrong-token"]) {
      const res = await requestLimits({ hidden: "claude,codex", token });
      assert.equal(res.statusCode, 401, `hidden with token=${token} must 401`);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), { error: "Unauthorized" });
    }
    assert.equal(aggregateCalls, 0, "unauthorized hidden list reached the aggregate");

    // An authenticated gate forwards the normalized id list — sorted,
    // de-duplicated, unknown ids dropped.
    const ok = await requestLimits({ hidden: "zcode,claude,claude,not-a-provider", token: localAuthToken });
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(
      forwarded.at(-1).hiddenProviders,
      ["claude", "zcode"],
      "authenticated gate forwards the normalized hidden list",
    );

    // A hidden list of only unknown ids normalizes to nothing: the parameter
    // only ever narrows, so there is nothing to authenticate and the request
    // keeps its legacy fetch-everything behavior.
    const unknownOnly = await requestLimits({ hidden: "not-a-provider", token: undefined });
    assert.equal(unknownOnly.statusCode, 200, "unknown-only hidden list must not require auth");
    assert.equal(forwarded.at(-1).hiddenProviders, null, "unknown-only list forwards null");

    // No hidden parameter at all — the legacy contract is untouched.
    const plain = await requestLimits({ token: undefined });
    assert.equal(plain.statusCode, 200);
    assert.equal(forwarded.at(-1).hiddenProviders, null, "absent parameter forwards null");
  } finally {
    usageLimits.getUsageLimits = originalGet;
    usageLimits.resetUsageLimitsCache = originalReset;
    restore();
  }
});

test("qoder-cookie route saves a cookie only for an authenticated loopback POST", async () => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
  const token = await getLocalAuthToken(handler);
  const url = new URL("http://127.0.0.1/functions/tokentracker-qoder-cookie");

  // Wrong method is rejected before any credential work.
  const getRes = createResponse();
  await handler(createRequest({ method: "GET", headers: { "x-tokentracker-local-auth": token } }), getRes, url);
  assert.equal(getRes.statusCode, 405);

  // Unauthenticated POST is rejected.
  const anonRes = createResponse();
  await handler(createRequest({ method: "POST", body: JSON.stringify({ namespace: "cn", cookie: "qoder_session_cookie=x" }) }), anonRes, url);
  assert.equal(anonRes.statusCode, 401);

  // Authenticated POST writes the CN cookie file.
  const okRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ namespace: "cn", cookie: "qoder_session_cookie=abc; yunpk=1" }),
  }), okRes, url);
  assert.equal(okRes.statusCode, 200);
  const cnFile = path.join(process.env.HOME, ".tokentracker", "tracker", "qoder-cn-usage-cookie.txt");
  assert.equal(fs.readFileSync(cnFile, "utf8"), "qoder_session_cookie=abc; yunpk=1");

  // intl maps to the international file.
  const intlRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ namespace: "intl", cookie: "qoder_session_cookie=intl" }),
  }), intlRes, url);
  assert.equal(intlRes.statusCode, 200);
  assert.equal(fs.readFileSync(path.join(process.env.HOME, ".tokentracker", "tracker", "qoder-usage-cookie.txt"), "utf8"), "qoder_session_cookie=intl");

  // A malformed cookie is rejected without writing anything.
  const badRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ namespace: "cn", cookie: "no-equals-here" }),
  }), badRes, url);
  assert.equal(badRes.statusCode, 400);
});

test("opendesign-cookie route saves a cookie only for an authenticated loopback POST", async () => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
  const token = await getLocalAuthToken(handler);
  const url = new URL("http://127.0.0.1/functions/tokentracker-opendesign-cookie");

  // Wrong method is rejected before any credential work.
  const getRes = createResponse();
  await handler(createRequest({ method: "GET", headers: { "x-tokentracker-local-auth": token } }), getRes, url);
  assert.equal(getRes.statusCode, 405);

  // Unauthenticated POST is rejected.
  const anonRes = createResponse();
  await handler(createRequest({ method: "POST", body: JSON.stringify({ cookie: "session=x" }) }), anonRes, url);
  assert.equal(anonRes.statusCode, 401);

  // Authenticated POST writes the 0600 credentials file (never echoed back).
  const okRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ cookie: "Cookie: session=abc; other=1" }),
  }), okRes, url);
  assert.equal(okRes.statusCode, 200);
  const okBody = JSON.parse(okRes.body.toString("utf8"));
  assert.deepEqual(okBody, { saved: true });
  // Same root as minimax-credentials.json (the .tokentracker root, not the
  // tracker sub-tree the cookie files live in).
  const credFile = path.join(process.env.HOME, ".tokentracker", "opendesign-credentials.json");
  const stored = JSON.parse(fs.readFileSync(credFile, "utf8"));
  assert.equal(stored.cookie, "session=abc; other=1");

  // A malformed cookie is rejected with 400 (not a fake-success 200) — the
  // paste box keys its "Saved" state off the HTTP status.
  const badRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ cookie: "bare-token-no-equals" }),
  }), badRes, url);
  assert.equal(badRes.statusCode, 400);
  assert.deepEqual(JSON.parse(badRes.body.toString("utf8")), { error: "invalid_cookie" });
});

test("opencode-go-key route saves an API key only for an authenticated loopback POST", async () => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const { credentialsPath } = require("../src/lib/opencode-go-limits");
  const prevRoot = process.env.TOKENTRACKER_HOME;
  process.env.TOKENTRACKER_HOME = process.env.HOME;
  try {
    const handler = createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
    const token = await getLocalAuthToken(handler);
    const url = new URL("http://127.0.0.1/functions/tokentracker-opencode-go-key");

    // Wrong method is rejected before any credential work.
    const getRes = createResponse();
    await handler(createRequest({ method: "GET", headers: { "x-tokentracker-local-auth": token } }), getRes, url);
    assert.equal(getRes.statusCode, 405);

    // Unauthenticated POST is rejected.
    const anonRes = createResponse();
    await handler(createRequest({ method: "POST", body: JSON.stringify({ apiKey: "sk-go-key" }) }), anonRes, url);
    assert.equal(anonRes.statusCode, 401);

    // Authenticated POST writes the key file and never echoes the key back.
    const okRes = createResponse();
    await handler(createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": token },
      body: JSON.stringify({ apiKey: "  sk-go-key  " }),
    }), okRes, url);
    assert.equal(okRes.statusCode, 200);
    assert.deepEqual(JSON.parse(okRes.body.toString("utf8")), { saved: true });
    assert.equal(okRes.body.toString("utf8").includes("sk-go-key"), false);
    const stored = JSON.parse(fs.readFileSync(credentialsPath(process.env.HOME), "utf8"));
    assert.deepEqual(stored, { apiKey: "sk-go-key" });

    // A pasted shell line (not a bare key) is rejected with 400, so the paste
    // box never reports a fake success.
    const badRes = createResponse();
    await handler(createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": token },
      body: JSON.stringify({ apiKey: 'setx OPENCODE_GO_API_KEY "sk-go-key"' }),
    }), badRes, url);
    assert.equal(badRes.statusCode, 400);
    assert.deepEqual(JSON.parse(badRes.body.toString("utf8")), { error: "invalid_api_key" });

    // The same route takes a browser cookie for users who never created a key.
    const cookieRes = createResponse();
    await handler(createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": token },
      body: JSON.stringify({ cookie: "Cookie: auth=session-value; other=1" }),
    }), cookieRes, url);
    assert.equal(cookieRes.statusCode, 200);
    const withCookie = JSON.parse(fs.readFileSync(credentialsPath(process.env.HOME), "utf8"));
    // Saving the cookie keeps the key, so either path remains available.
    assert.equal(withCookie.apiKey, "sk-go-key");
    assert.equal(withCookie.authCookie, "auth=session-value; other=1");

    // A value that is not a cookie header is rejected instead of stored.
    const badCookieRes = createResponse();
    await handler(createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": token },
      body: JSON.stringify({ cookie: "not-a-cookie" }),
    }), badCookieRes, url);
    assert.equal(badCookieRes.statusCode, 400);
    assert.deepEqual(JSON.parse(badCookieRes.body.toString("utf8")), { error: "invalid_cookie" });

    // "Clear" forgets both, so a rejected key stops shadowing the cookie path.
    const clearRes = createResponse();
    await handler(createRequest({
      method: "POST",
      headers: { "x-tokentracker-local-auth": token },
      body: JSON.stringify({ clear: true }),
    }), clearRes, url);
    assert.equal(clearRes.statusCode, 200);
    assert.equal(fs.existsSync(credentialsPath(process.env.HOME)), false);
  } finally {
    if (prevRoot === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = prevRoot;
  }
});

test("mistral-cookie route saves a cookie only for an authenticated loopback POST", async () => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
  const token = await getLocalAuthToken(handler);
  const url = new URL("http://127.0.0.1/functions/tokentracker-mistral-cookie");

  const getRes = createResponse();
  await handler(createRequest({ method: "GET", headers: { "x-tokentracker-local-auth": token } }), getRes, url);
  assert.equal(getRes.statusCode, 405);

  const anonRes = createResponse();
  await handler(createRequest({ method: "POST", body: JSON.stringify({ cookie: "ory_session_x=1" }) }), anonRes, url);
  assert.equal(anonRes.statusCode, 401);

  const okRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ cookie: "Cookie: ory_session_mistralstaging=abc; csrftoken=xyz" }),
  }), okRes, url);
  assert.equal(okRes.statusCode, 200);
  assert.deepEqual(JSON.parse(okRes.body.toString("utf8")), { saved: true });
  const credFile = path.join(process.env.HOME, ".tokentracker", "mistral-credentials.json");
  const stored = JSON.parse(fs.readFileSync(credFile, "utf8"));
  assert.equal(stored.cookie, "ory_session_mistralstaging=abc; csrftoken=xyz");

  // A cookie without any ory_session_* pair is rejected with 400.
  const badRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ cookie: "session=abc" }),
  }), badRes, url);
  assert.equal(badRes.statusCode, 400);
  assert.deepEqual(JSON.parse(badRes.body.toString("utf8")), { error: "invalid_cookie" });
});

test("openai-credits route saves both credential fields only for an authenticated loopback POST", async () => {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
  const token = await getLocalAuthToken(handler);
  const url = new URL("http://127.0.0.1/functions/tokentracker-openai-credits-credentials");

  const getRes = createResponse();
  await handler(createRequest({ method: "GET", headers: { "x-tokentracker-local-auth": token } }), getRes, url);
  assert.equal(getRes.statusCode, 405);

  const anonRes = createResponse();
  await handler(createRequest({ method: "POST", body: JSON.stringify({ sessionBearer: "Bearer x", organization: "org" }) }), anonRes, url);
  assert.equal(anonRes.statusCode, 401);

  const okRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ sessionBearer: "Bearer sk-proj-session-token", organization: "org-demo-1" }),
  }), okRes, url);
  assert.equal(okRes.statusCode, 200);
  assert.deepEqual(JSON.parse(okRes.body.toString("utf8")), { saved: true });
  const credFile = path.join(process.env.HOME, ".tokentracker", "openai-credits-credentials.json");
  const stored = JSON.parse(fs.readFileSync(credFile, "utf8"));
  // The Bearer prefix is normalized away — the fetcher adds its own.
  assert.equal(stored.sessionBearer, "sk-proj-session-token");
  assert.equal(stored.organization, "org-demo-1");

  // A missing organization is rejected with 400, not a fake success.
  const badRes = createResponse();
  await handler(createRequest({
    method: "POST",
    headers: { "x-tokentracker-local-auth": token },
    body: JSON.stringify({ sessionBearer: "sk-proj-session-token", organization: "" }),
  }), badRes, url);
  assert.equal(badRes.statusCode, 400);
});
