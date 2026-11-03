const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { serveStaticFile } = require("../src/lib/static-server");
const { precompressDashboard } = require("../scripts/precompress-dashboard.cjs");

test("built assets negotiate gzip; absent sidecars and q=0 preserve original bytes", async () => {
  const dir = path.resolve(__dirname, "../dashboard/dist");
  await precompressDashboard(dir);
  const entries = await fs.readdir(path.join(dir, "assets"));
  const name = entries.find((entry) => entry.endsWith(".js") && entries.includes(entry + ".gz"));
  assert.ok(name, "the normal dashboard build must produce JavaScript assets");
  const source = await fs.readFile(path.join(dir, "assets", name), "utf8");
  const originalOpen = fs.open;
  let hideSidecar = false;
  fs.open = async (target, ...args) => {
    if (hideSidecar && String(target).endsWith(".gz")) throw Object.assign(new Error("missing sidecar"), { code: "ENOENT" });
    return originalOpen(target, ...args);
  };
  const server = http.createServer(async (req, res) => {
    if (!await serveStaticFile(dir, req.url, res, { acceptEncoding: req.headers["accept-encoding"] })) res.writeHead(404).end();
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    for (const [encoding, compressed, hide] of [["gzip", true, false], ["gzip;q=0", false, false], ["gzip", false, true]]) {
      hideSidecar = hide;
      const res = await fetch(base + "/assets/" + name, { headers: { "Accept-Encoding": encoding } });
      assert.equal(await res.text(), source);
      assert.equal(res.headers.get("content-type"), "application/javascript; charset=utf-8");
      assert.equal(res.headers.get("vary"), "Accept-Encoding");
      assert.equal(res.headers.get("content-encoding"), compressed ? "gzip" : null);
      assert.ok(res.headers.get("cache-control").includes("immutable"));
      if (compressed) assert.ok(Number(res.headers.get("content-length")) < Buffer.byteLength(source));
    }
  } finally {
    fs.open = originalOpen;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
