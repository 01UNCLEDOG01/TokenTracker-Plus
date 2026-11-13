// 自托管实例自签 CA 的自愈引导（2026-11-13 登录事故回归）
// 依赖 openssl 生成临时自签证书；没有 openssl 时跳过（CI 与本机均有）。
const assert = require("node:assert/strict");
const { test } = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { instanceFetch, discoverInstanceCa, readCachedInstanceCa, isPrivateHost } = require("../src/lib/instance-ca");

function hasOpenssl() {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeSelfSigned(dir) {
  const keyPath = path.join(dir, "key.pem");
  const certPath = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyPath, "-out", certPath,
    "-days", "2", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
    "-addext", "basicConstraints=critical,CA:TRUE",
    "-addext", "keyUsage=critical,digitalSignature,keyCertSign",
  ], { stdio: "ignore" });
  return { key: fs.readFileSync(keyPath, "utf8"), cert: fs.readFileSync(certPath, "utf8") };
}

function startServer(t) {
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-ca-"));
    const { key, cert } = makeSelfSigned(dir);
    const server = https.createServer({ key, cert }, (req, res) => {
      if (req.url === "/ca.crt") {
        res.writeHead(200, { "content-type": "application/x-pem-file" });
        res.end(cert);
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, path: req.url }));
    });
    server.listen(0, "127.0.0.1", () => {
      t.after(() => server.close());
      resolve({ port: server.address().port });
    });
  });
}

test("私有地址判定：只对局域网/回环做引导", () => {
  for (const host of ["127.0.0.1", "192.168.100.1", "10.1.2.3", "172.16.0.9", "172.31.255.254", "localhost", "nas.local"]) {
    assert.equal(isPrivateHost(host), true, `${host} 应视为私有`);
  }
  for (const host of ["github.com", "8.8.8.8", "172.32.0.1", "example.com"]) {
    assert.equal(isPrivateHost(host), false, `${host} 不应视为私有`);
  }
});

test("证书不受信任时自动从实例 /ca.crt 引导并缓存，重试成功", { skip: !hasOpenssl() }, async (t) => {
  const { port } = await startServer(t);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-home-"));
  const previousHome = process.env.TOKENTRACKER_HOME;
  const previousCa = process.env.NODE_EXTRA_CA_CERTS;
  process.env.TOKENTRACKER_HOME = home;
  delete process.env.NODE_EXTRA_CA_CERTS;
  t.after(() => {
    if (previousHome === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = previousHome;
    if (previousCa === undefined) delete process.env.NODE_EXTRA_CA_CERTS;
    else process.env.NODE_EXTRA_CA_CERTS = previousCa;
  });

  const baseUrl = `https://127.0.0.1:${port}`;
  // 引导前没有任何信任：普通 fetch 必须失败
  await assert.rejects(() => fetch(`${baseUrl}/api/auth/probe`), /fetch failed|self-signed|certificate/i);

  const res = await instanceFetch(`${baseUrl}/api/auth/probe`, {}, { baseUrl });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, path: "/api/auth/probe" });
  assert.match(readCachedInstanceCa("127.0.0.1") || "", /BEGIN CERTIFICATE/);
});

test("公网口不做 TOFU 引导", { skip: !hasOpenssl() }, async () => {
  assert.equal(await discoverInstanceCa("https://example.com"), null);
});

test("非证书类错误原样抛出，不吞成 200", { skip: !hasOpenssl() }, async (t) => {
  const { port } = await startServer(t);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-home2-"));
  const previousHome = process.env.TOKENTRACKER_HOME;
  process.env.TOKENTRACKER_HOME = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = previousHome;
  });
  // 端口上没人监听 → ECONNREFUSED，绝不能被引导逻辑吞掉
  await assert.rejects(
    () => instanceFetch(`https://127.0.0.1:${port + 1}/api/auth/probe`, {}, { baseUrl: `https://127.0.0.1:${port + 1}` }),
  );
});
