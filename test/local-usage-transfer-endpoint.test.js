"use strict";

// Endpoint-level E2E for /functions/tokentracker-local-usage against a queue
// larger than the 5MB snapshot cap — the shape that used to die with
// ERR_STRING_TOO_LONG (540MB real-world queue, 2026-11-10). Sandboxed through
// TOKENTRACKER_HOME; the real ~/.tokentracker is never touched.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

const ENDPOINT = "/functions/tokentracker-local-usage";

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

const { PassThrough } = require("node:stream");

function createResponse() {
  // Real duplex stream so gzip.pipe(res) works for export_full; a tee collects
  // everything (JSON responses and binary streams alike) for assertions.
  const chunks = [];
  const res = new PassThrough();
  res.on("data", (c) => chunks.push(c));
  res.statusCode = null;
  res.setHeader = () => {};
  res.writeHead = function (statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers;
    return this;
  };
  res.bodyBuffer = null;
  res.on("end", () => {
    res.bodyBuffer = Buffer.concat(chunks);
  });
  return res;
}

async function callApi(handler, { method, headers = {}, body, path: endpoint }) {
  const url = new URL(`http://127.0.0.1:7680${endpoint}`);
  const req = createRequest({ method, headers: { host: "127.0.0.1:7680", ...headers }, body });
  const res = createResponse();
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  if (res.bodyBuffer == null) await new Promise((resolve) => res.once("end", resolve));
  const buffer = res.bodyBuffer ?? Buffer.alloc(0);
  const text = buffer.toString("utf8");
  let bodyJson = null;
  try {
    bodyJson = text.length ? JSON.parse(text) : null;
  } catch {
    bodyJson = null; // binary response (export_full gzip)
  }
  return { status: res.statusCode, body: bodyJson, buffer };
}

async function fetchAuthToken(handler) {
  const { status, body } = await callApi(handler, { method: "GET", path: "/api/local-auth" });
  assert.equal(status, 200);
  return body.token;
}

const hourAt = (i) => new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString();
const rowOf = (i) => ({ source: "codex", model: "gpt-5.6-sol", hour_start: hourAt(i), total_tokens: i });

test("export streams a >5MB queue, pages it fully, and the snapshot imports on a fresh machine", async () => {
  const rows = 60000; // ~6MB of queue lines: over the snapshot cap, under body limits
  const sourceHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-transfer-e2e-src-"));
  const targetHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-transfer-e2e-dst-"));
  await fs.promises.mkdir(path.join(sourceHome, "tracker"), { recursive: true });
  await fs.promises.mkdir(path.join(targetHome, "tracker"), { recursive: true });
  await fs.promises.writeFile(
    path.join(sourceHome, "tracker", "queue.jsonl"),
    Array.from({ length: rows }, (_, i) => JSON.stringify(rowOf(i))).join("\n") + "\n",
  );

  const prevHome = process.env.TOKENTRACKER_HOME;
  process.env.TOKENTRACKER_HOME = sourceHome;
  const handler = createLocalApiHandler({ queuePath: path.join(sourceHome, "tracker", "queue.jsonl") });

  try {
    const token = await fetchAuthToken(handler);
    const authHeaders = { "x-tokentracker-local-auth": token, "content-type": "application/json" };

    // GET stats used to die with ERR_STRING_TOO_LONG before the streaming fix.
    const stats = await callApi(handler, { method: "GET", headers: authHeaders, path: ENDPOINT });
    assert.equal(stats.status, 200);
    assert.equal(stats.body.rows, rows);
    assert.equal(stats.body.bytes, fs.statSync(path.join(sourceHome, "tracker", "queue.jsonl")).size);

    // First batch: truncated to the newest rows that fit the 5MB cap.
    const first = await callApi(handler, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "export" }),
      path: ENDPOINT,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.truncated, true);
    assert.equal(first.body.total_rows, rows);
    assert.ok(first.body.snapshot.rows.length < rows);
    assert.ok(first.body.bytes <= 5 * 1024 * 1024);
    assert.ok(resBodyLength(first) <= first.body.bytes + 1024);
    assert.equal(first.body.snapshot.window.to, hourAt(rows - 1));

    // Page backwards until the queue is covered; the union must reach every row.
    const covered = new Map();
    const record = (batch) => {
      for (const row of batch.snapshot.rows) covered.set(transfer_key(row), (covered.get(transfer_key(row)) || 0) + 1);
    };
    let batch = first.body;
    let rounds = 1;
    record(batch);
    while (batch.truncated) {
      const before = batch.snapshot.window.from;
      const next = await callApi(handler, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "export", before }),
        path: ENDPOINT,
      });
      assert.equal(next.status, 200);
      rounds += 1;
      assert.ok(rounds < 100, "pagination terminates");
      if (!next.body.snapshot.rows.length) break;
      record(next.body);
      if (!next.body.truncated || next.body.snapshot.window.from >= before) {
        batch = { truncated: false };
        break;
      }
      batch = next.body;
    }
    assert.equal(covered.size, rows, "pagination reaches every queued row");
    assert.ok(rounds >= 2, "an oversized queue needs multiple batches");

    // Import the first batch on a fresh machine, then again (dedup by key).
    process.env.TOKENTRACKER_HOME = targetHome;
    const targetHandler = createLocalApiHandler({ queuePath: path.join(targetHome, "tracker", "queue.jsonl") });
    const targetToken = await fetchAuthToken(targetHandler);
    const targetHeaders = { "x-tokentracker-local-auth": targetToken, "content-type": "application/json" };

    const preview = await callApi(targetHandler, {
      method: "POST",
      headers: targetHeaders,
      body: JSON.stringify({ action: "preview", snapshot: first.body.snapshot }),
      path: ENDPOINT,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.fresh, first.body.snapshot.rows.length);
    assert.equal(preview.body.duplicate, 0);

    const imported = await callApi(targetHandler, {
      method: "POST",
      headers: targetHeaders,
      body: JSON.stringify({ action: "import", snapshot: first.body.snapshot, token: preview.body.token }),
      path: ENDPOINT,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.imported, first.body.snapshot.rows.length);
    const targetLines = fs.readFileSync(path.join(targetHome, "tracker", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(targetLines.length, first.body.snapshot.rows.length);

    const previewAgain = await callApi(targetHandler, {
      method: "POST",
      headers: targetHeaders,
      body: JSON.stringify({ action: "preview", snapshot: first.body.snapshot }),
      path: ENDPOINT,
    });
    assert.equal(previewAgain.body.fresh, 0);
    assert.equal(previewAgain.body.duplicate, first.body.snapshot.rows.length);
  } finally {
    if (prevHome === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = prevHome;
    await fs.promises.rm(sourceHome, { recursive: true, force: true });
    await fs.promises.rm(targetHome, { recursive: true, force: true });
  }
});

function transfer_key(row) {
  return `${String(row.source).toLowerCase()}|${row.model}|${row.hour_start}`;
}

function resBodyLength(response) {
  return Buffer.byteLength(JSON.stringify(response.body));
}

test("export_full streams one gzipped whole-queue backup and imports via raw gzip uploads", async () => {
  const rows = 20000; // small enough for a fast test, big enough to prove streaming
  const sourceHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-fullbak-src-"));
  const targetHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-fullbak-dst-"));
  await fs.promises.mkdir(path.join(sourceHome, "tracker"), { recursive: true });
  await fs.promises.writeFile(
    path.join(sourceHome, "tracker", "queue.jsonl"),
    Array.from({ length: rows }, (_, i) => JSON.stringify(rowOf(i))).join("\n") + "\n",
  );

  const prevHome = process.env.TOKENTRACKER_HOME;
  process.env.TOKENTRACKER_HOME = sourceHome;
  const handler = createLocalApiHandler({ queuePath: path.join(sourceHome, "tracker", "queue.jsonl") });

  try {
    const token = await fetchAuthToken(handler);
    const authHeaders = { "x-tokentracker-local-auth": token, "content-type": "application/json" };

    // Whole-queue export: the response body IS the gzip backup.
    const exported = await callApi(handler, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ action: "export_full" }),
      path: ENDPOINT,
    });
    assert.equal(exported.status, 200);
    assert.ok(exported.buffer.length > 100, "binary gzip payload delivered");
    const { gunzipSync } = require("node:zlib");
    const plain = gunzipSync(exported.buffer);
    const lines = plain.toString("utf8").trim().split("\n");
    const header = JSON.parse(lines[0]);
    assert.equal(header.kind, "tokentracker-local-usage");
    assert.equal(header.version, 2);
    assert.equal(header.format, "ndjson-gzip");
    const trailer = JSON.parse(lines[lines.length - 1]);
    assert.equal(trailer.trailer, true);
    assert.equal(trailer.total_rows, rows);
    assert.equal(lines.length - 2, rows, "one row per line between header and trailer");

    // Machine A refuses its own backup — switch to the fresh target first.
    await assert.rejects(
      () => {
        process.env.TOKENTRACKER_HOME = sourceHome;
        return transfer_module.previewFullBackup(exported.buffer);
      },
      (error) => error.code === "self_import",
    );

    // Target machine: preview → import → re-import, all with raw gzip bodies.
    process.env.TOKENTRACKER_HOME = targetHome;
    const targetHandler = createLocalApiHandler({ queuePath: path.join(targetHome, "tracker", "queue.jsonl") });
    const targetToken = await fetchAuthToken(targetHandler);
    const gzHeaders = {
      "x-tokentracker-local-auth": targetToken,
      "content-type": "application/gzip",
      "content-length": exported.buffer.length,
    };

    const preview = await callApi(targetHandler, {
      method: "POST",
      headers: { ...gzHeaders, "x-tokentracker-backup-action": "preview_full" },
      body: exported.buffer,
      path: ENDPOINT,
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.format, "ndjson-gzip");
    assert.equal(preview.body.fresh, rows);
    assert.equal(preview.body.duplicate, 0);

    const imported = await callApi(targetHandler, {
      method: "POST",
      headers: {
        ...gzHeaders,
        "x-tokentracker-backup-action": "import_full",
        "x-tokentracker-import-token": preview.body.token,
      },
      body: exported.buffer,
      path: ENDPOINT,
    });
    assert.equal(imported.status, 200);
    assert.equal(imported.body.imported, rows);
    const targetLines = fs.readFileSync(path.join(targetHome, "tracker", "queue.jsonl"), "utf8").trim().split("\n");
    assert.equal(targetLines.length, rows);

    const previewAgain = await callApi(targetHandler, {
      method: "POST",
      headers: { ...gzHeaders, "x-tokentracker-backup-action": "preview_full" },
      body: exported.buffer,
      path: ENDPOINT,
    });
    assert.equal(previewAgain.body.fresh, 0);
    assert.equal(previewAgain.body.duplicate, rows);
  } finally {
    if (prevHome === undefined) delete process.env.TOKENTRACKER_HOME;
    else process.env.TOKENTRACKER_HOME = prevHome;
    await fs.promises.rm(sourceHome, { recursive: true, force: true });
    await fs.promises.rm(targetHome, { recursive: true, force: true });
  }
});

const transfer_module = require("../src/lib/local-usage-transfer");
