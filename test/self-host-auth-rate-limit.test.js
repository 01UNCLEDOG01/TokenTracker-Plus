const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { signToken, verifyToken, verifyAccessToken, handleAuthRequest, hashPassword, verifyPassword } = require("../scripts/self-host/local-auth.cjs");
const { PGlite } = require("@electric-sql/pglite");

function backendAuthFixture({ accountExists = true } = {}) {
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
    process: { env: {} }, globalThis: {}, URL, Request, Response, Buffer, Date: { now: () => now },
    serverCredential: "fixture-server-credential",
    env: {}, port: 1234, privateFunctions: [], db: { query: async () => ({ rows: accountExists ? [{ id: "11111111-1111-4111-8111-111111111111" }] : [] }) }, secret, verifyToken, verifyAccessToken,
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
    async request(ip = "127.0.0.1", forwarded = "", { url = "/api/auth/public-config", token, chunks = [], onRead } = {}) {
      const req = {
        method: "GET", url, headers: { "x-forwarded-for": forwarded, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        socket: { remoteAddress: ip }, resume() {}, async *[Symbol.asyncIterator]() { onRead?.(); yield* chunks; },
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

test("self-host private dispatch rejects a still-signed token after its account is deleted", async () => {
  const fixture = backendAuthFixture({ accountExists: false });
  const token = fixture.token({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(await fixture.request(undefined, undefined, { url: "/functions/tokentracker-leaderboard", token }), 401);
});

test("self-host password changes cannot claim success for a deleted account", async () => {
  const secret = "deleted-profile-test";
  const token = signToken({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  let status;
  await handleAuthRequest({
    req: { method: "PATCH", headers: { authorization: `Bearer ${token}` } },
    url: new URL("http://localhost/api/auth/profiles/current"), raw: JSON.stringify({ password: "valid-password" }),
    db: { query: async () => ({ rows: [] }) }, secret, send(value) { status = value; },
  });
  assert.equal(status, 401);
});

test("self-host password updates work against real SQL and stop after account deletion", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, password_hash text)");
  const id = "11111111-1111-4111-8111-111111111111";
  await db.query("INSERT INTO auth.users VALUES($1,$2,$3)", [id, "fixture@example.invalid", hashPassword("original-password")]);
  const secret = "real-sql-profile-test";
  const token = signToken({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  async function update() {
    let status;
    await handleAuthRequest({
      req: { method: "PATCH", headers: { authorization: `Bearer ${token}` } },
      url: new URL("http://localhost/api/auth/profiles/current"), raw: JSON.stringify({ password: "updated-password" }),
      db, secret, send(value) { status = value; },
    });
    return status;
  }
  assert.equal(await update(), 200);
  const row = (await db.query("SELECT password_hash FROM auth.users WHERE id=$1", [id])).rows[0];
  assert.equal(verifyPassword("updated-password", row.password_hash), true);
  await db.query("DELETE FROM auth.users WHERE id=$1", [id]);
  assert.equal(await update(), 401);
});

test("self-host auth bounds IP buckets and reclaims them after the time window", async () => {
  const fixture = backendAuthFixture();
  for (let i = 0; i < 1024; i += 1) assert.equal(await fixture.request(`ip-${i}`), 200);
  assert.equal(await fixture.request("overflow"), 429);
  fixture.advance(5 * 60 * 1000);
  assert.equal(await fixture.request("overflow"), 200);
});

test("self-host rejects oversized bodies before dispatching auth or database work", async () => {
  const fixture = backendAuthFixture();
  assert.equal(await fixture.request(undefined, undefined, { chunks: [Buffer.alloc(64 * 1024 + 1)] }), 413);
  assert.equal(await fixture.request(undefined, undefined, { url: "/api/database/rpc/example", chunks: [Buffer.alloc(6 * 1024 * 1024 + 1)] }), 413);
});

test("self-host rejects rate-limited auth before consuming its request body", async () => {
  const fixture = backendAuthFixture();
  for (let i = 0; i < 60; i += 1) await fixture.request();
  assert.equal(await fixture.request(undefined, undefined, { onRead() { throw new Error("rate-limited body was consumed"); } }), 429);
});
