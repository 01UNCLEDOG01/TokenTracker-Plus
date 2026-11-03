const { gzip } = require("node:zlib");
const { promisify } = require("node:util");
const compress = promisify(gzip);
const encoded = new WeakMap();

// Keep the representation with the L1 payload, not in a second unbounded cache.
// gzip runs on libuv's pool; concurrent requests share one encoding operation.
function acceptsGzip(encoding) {
  return String(encoding || "").split(",").some((entry) => {
    const [name, ...params] = entry.trim().toLowerCase().split(";");
    const quality = params.find((param) => param.trim().startsWith("q="));
    return name === "gzip" && (!quality || Number(quality.trim().slice(2)) > 0);
  });
}

async function writeSessionsResponse(req, res, payload) {
  let value = encoded.get(payload);
  if (!value) {
    value = { json: JSON.stringify(payload) };
    encoded.set(payload, value);
  }
  let body = value.json;
  let compressedBody = false;
  if (acceptsGzip(req.headers?.["accept-encoding"]) && Buffer.byteLength(body) >= 1024) {
    value.gzip ||= compress(body, { level: 1 }).catch(() => null);
    const compressed = await value.gzip;
    if (compressed) {
      body = compressed;
      compressedBody = true;
    }
  }
  if (res.destroyed || res.writableEnded) return;
  if (compressedBody) res.setHeader("Content-Encoding", "gzip");
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Vary", "Accept-Encoding");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  res.end(body);
}

module.exports = { writeSessionsResponse, acceptsGzip };
