const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { signToken, verifyToken, verifyAccessToken, handleAuthRequest } = require("../scripts/self-host/local-auth.cjs");

function backendAuthFixture() {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/self-host/local-backend.cjs"), "utf8");
  // Exercise the actual request dispatch without booting a database or loading
  // workers. The auth implementation is irrelevant to the pre-dispatch limit.
  const start = source.indexOf("  // The handlers read configuration through Deno.env.get.");
  const end = source.indexOf("  // Loopback by default.", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  let now = 1_000_000;
  const secret = "isolated-test-secret";
  vm.runInNewContext(source.slice(start, end), {
    http: { createServer(callback) { handler = callback; } },
    process: { env: {} }, globalThis: {}, URL, Request, Response, Date: { now: () => now },
    env: {}, port: 1234, privateFunctions: [], db: {}, secret, verifyToken, verifyAccessToken,
    handlers: { "tokentracker-leaderboard": async () => new Response("{}") },
    handleAuthRequest: async ({ url, send }) => {
      if (!url.pathname.startsWith("/api/auth/")) return false;
      send(200, { ok: true });
      return true;
    },
  });
  return {
    advance: (ms) => { now += ms; },
    token: (payload) => signToken(payload, secret),
    async request(ip = "127.0.0.1", forwarded = "", { url = "/api/auth/public-config", token } = {}) {
      const req = {
        method: "GET", url, headers: { "x-forwarded-for": forwarded, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        socket: { remoteAddress: ip }, async *[Symbol.asyncIterator]() {},
      };
      let status;
      const res = { writeHead(value) { status = value; }, end() {} };
      await handler(req, res);
      return status;
    },
  };
}

test("self-host auth limits persist across requests and cannot be bypassed with forwarded headers", async () => {
  const fixture = backendAuthFixture();
  for (let i = 0; i < 60; i += 1) assert.equal(await fixture.request("127.0.0.1", `forged-${i}`), 200);
  assert.equal(await fixture.request("127.0.0.1", "another-forged-ip"), 429);
  assert.equal(await fixture.request("127.0.0.2"), 200);
  fixture.advance(5 * 60 * 1000);
  assert.equal(await fixture.request(), 200);
});

test("self-host private dispatch rejects public anon keys and refresh tokens as access credentials", async () => {
  const fixture = backendAuthFixture();
  const access = { sub: "11111111-1111-4111-8111-111111111111", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 };
  const url = "/functions/tokentracker-leaderboard";
  for (const payload of [{ ...access, role: "anon" }, { ...access, typ: "refresh" }, { ...access, exp: undefined }, { ...access, exp: 1 }]) {
    assert.equal(await fixture.request(undefined, undefined, { url, token: fixture.token(payload) }), 401);
  }
  assert.equal(await fixture.request(undefined, undefined, { url, token: fixture.token(access) }), 200);
});

test("self-host profile reads and password changes require a current authenticated access token", async () => {
  const secret = "profile-test-secret";
  const access = { sub: "11111111-1111-4111-8111-111111111111", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 };
  for (const method of ["GET", "PATCH"]) {
    for (const payload of [{ ...access, role: "anon" }, { ...access, typ: "refresh" }, { ...access, exp: undefined }, { ...access, exp: 1 }]) {
      let status;
      await handleAuthRequest({
        req: { method, headers: { authorization: `Bearer ${signToken(payload, secret)}` } },
        url: new URL("http://localhost/api/auth/profiles/current"), raw: JSON.stringify({ password: "valid-password" }),
        db: { query() { throw new Error("unauthorized request reached the database"); } }, secret,
        send(value) { status = value; },
      });
      assert.equal(status, 401);
    }
  }
  assert.equal(verifyAccessToken(signToken(access, secret), secret).sub, access.sub);
});

test("self-host auth bounds IP buckets and reclaims them after the time window", async () => {
  const fixture = backendAuthFixture();
  for (let i = 0; i < 1024; i += 1) assert.equal(await fixture.request(`ip-${i}`), 200);
  assert.equal(await fixture.request("overflow"), 429);
  fixture.advance(5 * 60 * 1000);
  assert.equal(await fixture.request("overflow"), 200);
});
