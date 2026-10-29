const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { beforeEach, test } = require("node:test");
const { createLocalApiHandler } = require("../src/lib/local-api");
const { isAllowedLoopbackHostHeader } = require("../src/lib/loopback-host");

// 审计 2026-10-25 第一批安全止血（P0-1 / P0-2 / S1 / S2）的回归测试。

beforeEach((t) => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-authz-hardening-"));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  // local-usage 的业务层假定队列文件存在（生产里 app 启动即建）——补齐生产形态。
  const trackerDir = path.join(tmpHome, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "queue.jsonl"), "");
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
    setHeader() {},
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

function createHandler() {
  return createLocalApiHandler({ queuePath: path.join(process.env.HOME, "queue.jsonl") });
}

async function getLocalAuthToken(handler, headers = {}) {
  const req = createRequest({ method: "GET", headers });
  const res = createResponse();
  const handled = await handler(req, res, new URL("http://127.0.0.1:7680/api/local-auth"));
  assert.equal(handled, true);
  return { status: res.statusCode, token: res.statusCode === 200 ? JSON.parse(res.body.toString("utf8")).token : null };
}

const LOCAL_USAGE_URL = new URL("http://127.0.0.1:7680/functions/tokentracker-local-usage");

async function callLocalUsage(handler, { method = "GET", headers = {}, body } = {}) {
  const req = createRequest({ method, headers, body });
  const res = createResponse();
  const handled = await handler(req, res, LOCAL_USAGE_URL);
  assert.equal(handled, true);
  return res;
}

test("isAllowedLoopbackHostHeader accepts loopback host:port pairs and rejects everything else", () => {
  assert.equal(isAllowedLoopbackHostHeader("127.0.0.1:7680", 7680), true);
  assert.equal(isAllowedLoopbackHostHeader("localhost:7680", 7680), true);
  assert.equal(isAllowedLoopbackHostHeader("[::1]:7680", 7680), true);
  assert.equal(isAllowedLoopbackHostHeader("LOCALHOST:7680", 7680), true);
  assert.equal(isAllowedLoopbackHostHeader("127.0.0.1:7680", null), true);
  assert.equal(isAllowedLoopbackHostHeader("127.0.0.1:9999", 7680), false);
  assert.equal(isAllowedLoopbackHostHeader("127.0.0.1", 7680), false);
  assert.equal(isAllowedLoopbackHostHeader("evil.com:7680", 7680), false);
  assert.equal(isAllowedLoopbackHostHeader("", 7680), false);
  assert.equal(isAllowedLoopbackHostHeader(undefined, 7680), false);
  assert.equal(isAllowedLoopbackHostHeader("[::1]", 7680), false);
  assert.equal(isAllowedLoopbackHostHeader("rebinded.example:7680", 7680), false);
});

test("P0-1 gate helper keeps a rebinded Host out even with the right port", () => {
  // rebinding 的实际形态：域名解析到 127.0.0.1，但 Host 头里仍是攻击者域名。
  assert.equal(isAllowedLoopbackHostHeader("attacker.example:7680", 7680), false);
});

test("S1: /api/local-auth answers loopback clients but not cross-site pages", async () => {
  const handler = createHandler();

  // C# 壳形态：无 Origin / Sec-Fetch-Site 头 → 放行并发放令牌。
  const shell = await getLocalAuthToken(handler);
  assert.equal(shell.status, 200);
  assert.ok(shell.token.length > 0);

  // 同源 dashboard 形态：host:port 与 Origin 一致 → 放行。
  const sameOrigin = await getLocalAuthToken(handler, {
    host: "127.0.0.1:7680",
    origin: "http://127.0.0.1:7680",
    "sec-fetch-site": "same-origin",
  });
  assert.equal(sameOrigin.status, 200);

  // 跨站 fetch → 拒。
  const crossSite = await getLocalAuthToken(handler, {
    host: "127.0.0.1:7680",
    origin: "http://127.0.0.1:7680",
    "sec-fetch-site": "cross-site",
  });
  assert.equal(crossSite.status, 401);

  // 外域 Origin → 拒。
  const foreign = await getLocalAuthToken(handler, {
    host: "127.0.0.1:7680",
    origin: "http://evil.example:7680",
  });
  assert.equal(foreign.status, 401);

  // S2：同主机不同端口（如 :5173 dev server）也是跨源 → 拒。
  const wrongPort = await getLocalAuthToken(handler, {
    host: "127.0.0.1:7680",
    origin: "http://127.0.0.1:5173",
  });
  assert.equal(wrongPort.status, 401);

  // 端口一致但主机名写法不同（localhost vs 127.0.0.1）→ 按审计口径放行（只比端口）。
  const mixedHostNames = await getLocalAuthToken(handler, {
    host: "127.0.0.1:7680",
    origin: "http://localhost:7680",
  });
  assert.equal(mixedHostNames.status, 200);
});

test("P0-2: local-usage export/import/describe all require the mutation token", async () => {
  const handler = createHandler();

  const anonGet = await callLocalUsage(handler);
  assert.equal(anonGet.statusCode, 401);

  const anonExport = await callLocalUsage(handler, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "export" }),
  });
  assert.equal(anonExport.statusCode, 401);

  const anonImport = await callLocalUsage(handler, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "import", snapshot: {} }),
  });
  assert.equal(anonImport.statusCode, 401);

  const { token } = await getLocalAuthToken(handler);
  assert.ok(token);

  // 无 Origin 的令牌调用（脚本/壳形态）→ 通过鉴权，业务层正常应答。
  const tokenGet = await callLocalUsage(handler, {
    headers: { "x-tokentracker-local-auth": token },
  });
  assert.equal(tokenGet.statusCode, 200);

  // 令牌 + 跨站 → 拒。
  const crossSite = await callLocalUsage(handler, {
    headers: { "x-tokentracker-local-auth": token, "sec-fetch-site": "cross-site" },
  });
  assert.equal(crossSite.statusCode, 401);

  // 令牌 + 同源 → 正常应答。
  const sameOrigin = await callLocalUsage(handler, {
    headers: {
      "x-tokentracker-local-auth": token,
      host: "127.0.0.1:7680",
      origin: "http://127.0.0.1:7680",
    },
  });
  assert.equal(sameOrigin.statusCode, 200);

  // 令牌 + S2 端口不匹配的 Origin → 拒。
  const wrongPort = await callLocalUsage(handler, {
    headers: {
      "x-tokentracker-local-auth": token,
      host: "127.0.0.1:7680",
      origin: "http://127.0.0.1:5173",
    },
  });
  assert.equal(wrongPort.statusCode, 401);
});
