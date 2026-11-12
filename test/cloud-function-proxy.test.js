"use strict";

// The macOS WebView cannot reach a self-hosted instance whose certificate is
// signed by a private CA: WKWebView uses the macOS trust store, so browser ->
// instance function calls die with "Load failed" (leaderboard, avatar,
// account views). function-url.ts routes those calls through the local
// server, which holds the CA trust (NODE_EXTRA_CA_CERTS). These tests pin the
// proxy contract: slug validation, instance anon key injection, cookie
// stripping, query passthrough, and upstream status passthrough.

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { mkdtemp, rm } = require("node:fs/promises");

const { createLocalApiHandler } = require("../src/lib/local-api.js");
const { withHome } = require("./helpers/with-home");
const { publicAnonFor, bindPublicInstance } = require("./helpers/public-instance-fixture");

function listen(server, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

function request(url, { method = "GET", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function withProxyFixture(fn) {
  let restoreHome = () => {};
  const prevBase = process.env.TOKENTRACKER_INSFORGE_BASE_URL;
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "tt-cloud-proxy-"));

  const upstreamRequests = [];
  let upstreamStatus = 200;
  const upstreamBody = { entries: [], me: null };
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      upstreamRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(upstreamStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(upstreamBody));
    });
  });

  const local = http.createServer(async (req, res) => {
    const handler = createLocalApiHandler({ queuePath: path.join(tempHome, "queue.jsonl") });
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const handled = await handler(req, res, url);
    if (!handled) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    }
  });

  try {
    restoreHome = withHome(tempHome);
    const upAddr = await listen(upstream);
    process.env.TOKENTRACKER_INSFORGE_BASE_URL = `http://127.0.0.1:${upAddr.port}`;
    const anonKey = publicAnonFor("cloud-proxy");
    await bindPublicInstance(tempHome, process.env.TOKENTRACKER_INSFORGE_BASE_URL, anonKey);
    const localAddr = await listen(local);
    await fn({
      base: `http://127.0.0.1:${localAddr.port}`,
      anonKey,
      upstreamRequests,
      setUpstreamStatus: (status) => { upstreamStatus = status; },
    });
  } finally {
    await closeServer(local);
    await closeServer(upstream);
    await rm(tempHome, { recursive: true, force: true });
    restoreHome();
    if (prevBase === undefined) delete process.env.TOKENTRACKER_INSFORGE_BASE_URL;
    else process.env.TOKENTRACKER_INSFORGE_BASE_URL = prevBase;
  }
}

test("GET /api/cloud/functions/<slug> forwards to the instance with its anon key", async () => {
  await withProxyFixture(async ({ base, anonKey, upstreamRequests }) => {
    const resp = await request(
      `${base}/api/cloud/functions/tokentracker-leaderboard?period=total&limit=20&offset=0`,
      { headers: { cookie: "insforge_refresh_token=secret", accept: "application/json" } },
    );

    assert.equal(resp.statusCode, 200);
    assert.equal(upstreamRequests.length, 1);
    const forwarded = upstreamRequests[0];
    assert.equal(forwarded.url, "/functions/tokentracker-leaderboard?period=total&limit=20&offset=0");
    assert.equal(forwarded.headers.apikey, anonKey);
    // The browser's loopback cookies must never reach the instance.
    assert.equal(forwarded.headers.cookie, undefined);
  });
});

test("POST bodies and authorization reach the instance unchanged", async () => {
  await withProxyFixture(async ({ base, upstreamRequests }) => {
    const body = JSON.stringify({ user_id: "u-1" });
    const resp = await request(`${base}/api/cloud/functions/tokentracker-leaderboard`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user-jwt",
      },
      body,
    });

    assert.equal(resp.statusCode, 200);
    const forwarded = upstreamRequests[0];
    assert.equal(forwarded.method, "POST");
    assert.equal(forwarded.body, body);
    assert.equal(forwarded.headers.authorization, "Bearer user-jwt");
  });
});

test("a gated instance's 401 passes through instead of becoming a transport error", async () => {
  await withProxyFixture(async ({ base, setUpstreamStatus }) => {
    setUpstreamStatus(401);
    const resp = await request(`${base}/api/cloud/functions/tokentracker-leaderboard`);
    assert.equal(resp.statusCode, 401);
    assert.equal(resp.headers["x-tt-cloud-proxy"], "1");
  });
});

test("an invalid slug never reaches the instance", async () => {
  await withProxyFixture(async ({ base, upstreamRequests }) => {
    for (const slug of ["", "../admin", "tokentracker leaderboard", "a".repeat(90)]) {
      const resp = await request(`${base}/api/cloud/functions/${encodeURIComponent(slug)}`);
      assert.equal(resp.statusCode, 400, `slug ${JSON.stringify(slug)} must be rejected`);
    }
    assert.equal(upstreamRequests.length, 0);
  });
});