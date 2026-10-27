const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { functionUrlFor, fetchFunctionResponse } = require("../src/lib/function-url");
const { fetchAccountFunction } = require("../src/lib/cloud-account");

test("an unconfigured runtime derives no function URL at all", () => {
  for (const empty of [undefined, null, "", "   ", "/"]) {
    assert.equal(functionUrlFor(empty, "tokentracker-ingest"), "");
  }
});

test("every configured instance keeps its own /functions/ route", () => {
  for (const base of [
    "http://localhost:7130", "https://custom.example/api", "https://other123.us-east.insforge.app",
    "https://srctyff5.us-east.insforge.app", "https://self-hosted.example/",
  ]) {
    assert.equal(functionUrlFor(base, "tokentracker-ingest"), `${base.replace(/\/$/, "")}/functions/tokentracker-ingest`);
  }
});

test("browser and CLI route derivation agree for unconfigured and configured backends", () => {
  const source = fs.readFileSync(path.join(__dirname, "../dashboard/src/lib/function-url.ts"), "utf8");
  const code = source.slice(0, source.indexOf("export async function fetchFunctionResponse"))
    .replace("export function", "function").replace("baseUrl: string, slug: string", "baseUrl, slug");
  const browserUrlFor = vm.runInNewContext(`${code}\nfunctionUrlFor;`);
  for (const base of ["", "http://localhost:7130", "https://custom.example/api", "https://other123.us-east.insforge.app", "https://custom.example/api/"]) {
    assert.equal(browserUrlFor(base, "tokentracker-ingest"), functionUrlFor(base, "tokentracker-ingest"));
  }
});

test("a failed function call is surfaced once and never replayed", async () => {
  for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH"]) {
    for (const status of [401, 403, 404, 429, 500, 502]) {
      let calls = 0;
      const res = await fetchFunctionResponse("https://custom.example/functions/one", { method },
        async () => { calls++; return { status }; });
      assert.equal(res.status, status);
      assert.equal(calls, 1, `${method} ${status} must not be retried anywhere else`);
    }
  }
  let calls = 0;
  await assert.rejects(
    fetchFunctionResponse("https://custom.example/functions/one", { method: "POST" }, async () => { calls++; throw new Error("timeout"); }),
    /timeout/,
  );
  assert.equal(calls, 1);
});

test("cloud account reads retain all parameters and credentials on the instance URL", async () => {
  let observed;
  const result = await fetchAccountFunction({
    baseUrl: "https://custom.example", anonKey: "public", accessToken: "fixture-token", slug: "tokentracker-account-summary",
    searchParams: new URLSearchParams("from=2026-10-01&to=2026-10-02&tz=Asia%2FSingapore&device_id=sample&account=1&refresh=1"),
    fetchImpl: async (url, init) => { observed = { url: new URL(url), init }; return { status: 200, ok: true, json: async () => ({ totals: { total_tokens: 7 } }) }; },
  });
  assert.equal(observed.url.origin, "https://custom.example");
  assert.equal(observed.url.pathname, "/functions/tokentracker-account-summary");
  assert.equal(observed.url.searchParams.get("tz"), "Asia/Singapore");
  assert.equal(observed.url.searchParams.get("device_id"), "sample");
  assert.equal(observed.url.searchParams.has("refresh"), false);
  assert.equal(observed.init.headers.Authorization, "Bearer fixture-token");
  assert.deepEqual(result, { totals: { total_tokens: 7 } });
});

test("an unconfigured cloud fails the account read instead of dialing a default host", async () => {
  await assert.rejects(fetchAccountFunction({
    baseUrl: null, anonKey: null, accessToken: "fixture-token", slug: "tokentracker-account-summary",
    fetchImpl: async () => { throw new Error("must not fetch"); },
  }), /no InsForge instance configured/);
});
