/**
 * 自托管实例的自签 CA 引导（2026-11-13）
 *
 * 背景：本机服务端把 /api/auth/* 用 Node 的 fetch 转发给自托管实例（如 J2900 的
 * https://192.168.100.1:17682）。Node 不读 Windows/macOS 的系统证书库，实例用的是
 * 自己签的 CA，于是只要进程启动时没有 NODE_EXTRA_CA_CERTS，所有转发都会以
 * "fetch failed" 结束——登录框只能显示一个没有 message 的 InsForgeError。
 * 2026-11-13 的真实事故：热更后由脚本（而非桌面图标）拉起应用，环境变量丢了，
 * 站主表现为"账号登录不了"。
 *
 * 修法（不依赖环境、不碰系统证书库）：
 * 1. 正常请求仍走 Node 默认信任链（环境变量里的 CA 继续生效）；
 * 2. 仅在"证书链不受信任"这一类错误上，向同一实例的 /ca.crt 取一次公开的 CA，
 *    校验形态后缓存到 ~/.tokentracker/tls/<host>.pem，并重试一次；
 * 3. 只对私有/回环地址做引导：公网实例必须靠系统或环境变量信任，避免 TOFU 被滥用。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const tls = require("node:tls");
const { Agent, request } = require("undici");

const TLS_TRUST_ERROR_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_SIGNATURE_FAILURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".lan")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d{1,3})\./);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

function caDir() {
  const home = process.env.TOKENTRACKER_HOME || path.join(os.homedir(), ".tokentracker");
  return path.join(home, "tls");
}

function caFileFor(hostname) {
  const safe = String(hostname || "")
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, "_");
  return path.join(caDir(), `${safe}.pem`);
}

/** 读缓存里该实例的 CA（没有就返回 null）。 */
function readCachedInstanceCa(hostname) {
  try {
    const value = fs.readFileSync(caFileFor(hostname), "utf8");
    return /BEGIN CERTIFICATE/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeCachedInstanceCa(hostname, pem) {
  try {
    fs.mkdirSync(caDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(caFileFor(hostname), pem, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function isTlsTrustError(error) {
  const seen = new Set();
  let current = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current.code && TLS_TRUST_ERROR_CODES.has(current.code)) return true;
    current = current.cause;
  }
  return false;
}

function parseHost(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return { hostname: url.hostname, origin: url.origin };
  } catch {
    return null;
  }
}

/**
 * 从实例自身的 /ca.crt 取公开 CA。
 * 该端点按仓库约定公开（新设备接入就是 `curl -k https://host/ca.crt`），
 * 这里用 rejectUnauthorized:false 只为取回这把公开证书本身。
 */
async function discoverInstanceCa(baseUrl) {
  const parsed = parseHost(baseUrl);
  if (!parsed || !isPrivateHost(parsed.hostname)) return null;
  const insecure = new Agent({ connect: { rejectUnauthorized: false } });
  try {
    // 注意：Node 的全局 fetch 不接受 dispatcher（UND_ERR_INVALID_ARG），只能走 undici.request。
    const res = await request(`${parsed.origin}/ca.crt`, {
      method: "GET",
      headers: { "user-agent": "tokentracker-instance-ca/1.0" },
      dispatcher: insecure,
      maxRedirections: 0,
      headersTimeout: 8000,
      bodyTimeout: 8000,
    });
    if (res.statusCode < 200 || res.statusCode >= 300) {
      await res.body.dump().catch(() => {});
      return null;
    }
    const chunks = [];
    for await (const chunk of res.body) chunks.push(chunk);
    const pem = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c)))).toString("utf8").trim();
    if (!/^-----BEGIN CERTIFICATE-----/.test(pem) || !/-----END CERTIFICATE-----$/.test(pem)) return null;
    // 只收真能构造出 X509 的内容，避免把错误页缓存成 CA。
    new crypto.X509Certificate(pem);
    writeCachedInstanceCa(parsed.hostname, pem);
    return pem;
  } catch {
    return null;
  } finally {
    await insecure.close().catch(() => {});
  }
}

function agentFor(caPem) {
  // 关键：显式给 ca 会覆盖默认根证书，所以把 Node 自带的公共根一起带上。
  const roots = Array.isArray(tls.rootCertificates) ? tls.rootCertificates : [];
  return new Agent({ connect: { ca: caPem ? [...roots, caPem] : roots } });
}

/**
 * 转发到实例的 fetch：默认用系统/环境信任链；遇到证书不受信任时自动引导 CA 并重试一次。
 * 其他错误原样抛出，调用方仍能拿到原始 message。
 */
function toHeaders(raw) {
  if (raw instanceof Headers) return raw;
  const headers = new Headers();
  for (const [key, value] of Object.entries(raw || {})) {
    if (Array.isArray(value)) for (const item of value) headers.append(key, String(item));
    else if (value !== undefined) headers.set(key, String(value));
  }
  return headers;
}

/**
 * 用 undici.request 重放（Node 的全局 fetch 不接受 dispatcher 选项，
 * 直接传会抛 UND_ERR_INVALID_ARG）。返回值补齐调用方用到的 Response 面：
 * status/ok/headers/arrayBuffer/text/json。
 */
async function requestWithCa(url, init, caPem) {
  const agent = agentFor(caPem);
  try {
    const target = typeof url === "string" ? url : url && url.url ? url.url : String(url);
    const hasBody = init && init.body !== undefined && init.body !== null;
    const res = await request(target, {
      method: (init && init.method) || "GET",
      headers: init && init.headers,
      body: hasBody ? init.body : undefined,
      dispatcher: agent,
      maxRedirections: 0,
    });
    const chunks = [];
    for await (const chunk of res.body) chunks.push(chunk);
    const buffer = Buffer.concat(chunks.map((c) => (Buffer.isBuffer(c) ? c : Buffer.from(c))));
    const headers = toHeaders(res.headers);
    return {
      status: res.statusCode,
      ok: res.statusCode >= 200 && res.statusCode < 300,
      headers,
      url: target,
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      text: async () => buffer.toString("utf8"),
      json: async () => JSON.parse(buffer.toString("utf8")),
    };
  } finally {
    await agent.close().catch(() => {});
  }
}

async function instanceFetch(url, init, { baseUrl } = {}) {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (!isTlsTrustError(error)) throw error;
    const target = baseUrl || (typeof url === "string" ? url : url && url.url) || "";
    const parsed = parseHost(target);
    if (!parsed) throw error;
    const cached = readCachedInstanceCa(parsed.hostname) || (await discoverInstanceCa(parsed.origin));
    if (!cached) throw error;
    return await requestWithCa(url, init, cached);
  }
}

module.exports = {
  instanceFetch,
  discoverInstanceCa,
  readCachedInstanceCa,
  isPrivateHost,
  isInstanceTlsTrustError: isTlsTrustError,
};
