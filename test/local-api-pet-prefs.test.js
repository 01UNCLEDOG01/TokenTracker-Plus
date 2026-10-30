"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

const ENDPOINT = "/functions/tokentracker-pet-prefs";

// The endpoint resolves the prefs file from os.homedir() at request time, so
// every test points HOME/USERPROFILE at a sandbox — otherwise it would read and
// write this machine's real ~/.tokentracker/tracker/pet-prefs.json.
function withSandbox(run) {
  return async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-pet-prefs-"));
    const realHome = process.env.HOME;
    const realProfile = process.env.USERPROFILE;
    process.env.HOME = tmp;
    process.env.USERPROFILE = tmp;
    const handler = createLocalApiHandler({ queuePath: path.join(tmp, "queue.jsonl") });
    try {
      await run(handler);
    } finally {
      process.env.HOME = realHome;
      process.env.USERPROFILE = realProfile;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
}

function makeReq(method, body) {
  const stream = Readable.from(body ? [Buffer.from(body, "utf8")] : []);
  return Object.assign(stream, {
    method,
    url: ENDPOINT,
    headers: { host: "localhost" },
  });
}

async function call(handler, method, body) {
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(statusCode) {
      this.statusCode = statusCode;
    },
    end(push) {
      if (push) chunks.push(push);
    },
  };
  const url = new URL(`http://localhost${ENDPOINT}`);
  await handler(makeReq(method, body), res, url);
  const raw = chunks.join("");
  return { status: res.statusCode, body: raw ? JSON.parse(raw) : null };
}

function prefsFile() {
  return path.join(os.homedir(), ".tokentracker", "tracker", "pet-prefs.json");
}

test(
  "pet prefs round-trips the floating card row selection",
  withSandbox(async (handler) => {

    // Never written: the pet falls back to its default first-6 rows.
    const empty = await call(handler, "GET");
    assert.equal(empty.status, 200);
    assert.equal(empty.body.limitRows, null);

    const posted = await call(handler, "POST", JSON.stringify({
      limitRows: ["sensenova::general_5h", "antigravity::gemini_weekly"],
    }));
    assert.equal(posted.status, 200);
    assert.deepEqual(posted.body.limitRows, ["sensenova::general_5h", "antigravity::gemini_weekly"]);
    assert.equal(fs.existsSync(prefsFile()), true, "prefs persisted under the tracker dir");

    const read = await call(handler, "GET");
    assert.deepEqual(read.body.limitRows, ["sensenova::general_5h", "antigravity::gemini_weekly"]);
  }),
);

test(
  "pet prefs sanitizes junk, dedupes and caps at six rows",
  withSandbox(async (handler) => {
    const res = await call(handler, "POST", JSON.stringify({
      limitRows: [
        "sensenova::general_5h",
        "not-a-row",
        42,
        "sensenova::general_5h",
        "a::1",
        "b::2",
        "c::3",
        "d::4",
        "e::5",
        "f::6",
        "g::7",
      ],
    }));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.limitRows, ["sensenova::general_5h", "a::1", "b::2", "c::3", "d::4", "e::5"]);
  }),
);

test(
  "pet prefs rejects a malformed body with 400 and keeps the previous value",
  withSandbox(async (handler) => {
    await call(handler, "POST", JSON.stringify({ limitRows: ["sensenova::general_5h"] }));

    const res = await call(handler, "POST", "{not-json");
    assert.equal(res.status, 400);

    const after = await call(handler, "GET");
    assert.deepEqual(after.body.limitRows, ["sensenova::general_5h"]);
  }),
);

test(
  "pet prefs distinguishes 'never written' from 'user unchecked everything'",
  withSandbox(async (handler) => {
    await call(handler, "POST", JSON.stringify({ limitRows: ["sensenova::general-5h"] }));
    await call(handler, "POST", JSON.stringify({ limitRows: [] }));
    const after = await call(handler, "GET");
    // An existing file must read back as [] (drop stale rows) so the pet does
    // not keep serving a selection the user just cleared.
    assert.deepEqual(after.body.limitRows, []);
  }),
);

test(
  "pet prefs rejects cross-site writes but accepts same-origin ones",
  withSandbox(async (handler) => {
    const chunks = [];
    const url = new URL(`http://localhost${ENDPOINT}`);
    const make = (headers) => {
      const res = {
        statusCode: 200, setHeader() {},
        writeHead(status) { this.statusCode = status; },
        end(body) { if (body) chunks.push(body); },
      };
      return res;
    };
    const body = JSON.stringify({ limitRows: ["sensenova::general-5h"] });
    const foreign = Object.assign(Readable.from([Buffer.from(body)]), {
      method: "POST", url: ENDPOINT,
      headers: { host: "localhost:17680", origin: "https://evil.example", "content-type": "application/json" },
    });
    const resForeign = make(foreign);
    await handler(foreign, resForeign, url);
    assert.equal(resForeign.statusCode, 403);

    const local = Object.assign(Readable.from([Buffer.from(body)]), {
      method: "POST", url: ENDPOINT,
      headers: { host: "localhost:17680", origin: "http://localhost:17680", "content-type": "application/json" },
    });
    const resLocal = make(local);
    await handler(local, resLocal, url);
    assert.equal(resLocal.statusCode, 200);
    assert.deepEqual(JSON.parse(chunks.pop() || "{}").limitRows, ["sensenova::general-5h"]);
  }),
);
