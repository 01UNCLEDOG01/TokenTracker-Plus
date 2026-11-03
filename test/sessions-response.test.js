const test = require("node:test");
const assert = require("node:assert/strict");
const { gunzipSync } = require("node:zlib");
const { writeSessionsResponse } = require("../src/lib/sessions-response");

function response() {
  return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(body) { this.body = body; } };
}

test("concurrent compressed responses decode to the exact metadata and preserve privacy headers", async () => {
  const payload = { sessions: Array.from({ length: 300 }, (_, i) => ({ session_hash: String(i), title: "中文".repeat(10), tokens: i })) };
  const responses = [response(), response()];
  await Promise.all(responses.map((res) => writeSessionsResponse({ headers: { "accept-encoding": "br, gzip" } }, res, payload)));
  for (const res of responses) {
    assert.deepEqual(JSON.parse(gunzipSync(res.body)), payload);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(res.headers.Vary, "Accept-Encoding");
    assert.equal(res.headers["Content-Length"], res.body.length);
    assert.ok(res.body.length < JSON.stringify(payload).length / 5);
  }
  assert.equal(responses[0].body, responses[1].body);
});

test("identity clients and q=0 receive ordinary JSON", async () => {
  const payload = { value: "content".repeat(1000) };
  for (const encoding of [undefined, "br", "gzip;q=0", "gzip;q=0, br", "gzip;q=0.0"]) {
    const res = response();
    await writeSessionsResponse({ headers: { "accept-encoding": encoding } }, res, payload);
    assert.equal(res.headers["Content-Encoding"], undefined);
    assert.deepEqual(JSON.parse(res.body), payload);
  }
});
