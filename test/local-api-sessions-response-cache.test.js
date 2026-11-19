const test = require("node:test");
const assert = require("node:assert/strict");
const { setImmediate: yieldTurn } = require("node:timers/promises");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const analytics = require("../src/lib/session-analytics");
const disk = require("../src/lib/sessions-disk-cache");
const { createLocalApiHandler } = require("../src/lib/local-api");

test("requests during a session rebuild reuse the matching response and empty snapshots also rebuild", async () => {
  const original = { build: analytics.buildSessionAnalytics, list: analytics.listSessionsForBrowser, disk: disk.createSessionsDiskCache };
  let builds = 0, lists = 0, release;
  const pending = new Promise((resolve) => { release = resolve; });
  analytics.buildSessionAnalytics = async () => { builds++; await pending; return []; };
  analytics.listSessionsForBrowser = (...args) => { lists++; return original.list(...args); };
  disk.createSessionsDiskCache = () => ({
    async load() { return { schemaVersion: 1, savedAt: new Date().toISOString(), sessions: [] }; },
    async save() {},
  });
  // 2026-11-20: the fixture used to point at "D:/tt-owned-no-files" — a
  // never-exists sentinel on Windows, but a RELATIVE path on POSIX, so the
  // handler's mkdirSync(trackerDataDir) materialized a literal "D:" directory
  // in the repo root (invisible to git: only empty dirs inside). Cross-platform
  // fixture: a fresh per-run temp dir the handler may use, removed afterwards.
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tt-sessions-cache-"));
  try {
    const handler = createLocalApiHandler({ queuePath: path.join(dataRoot, "queue.jsonl"), trackerDataDir: dataRoot });
    const call = async () => {
      let body;
      const req = { method: "GET", headers: { host: "localhost" } };
      const res = { setHeader() {}, end(value) { body = value; } };
      await handler(req, res, new URL("http://localhost/functions/tokentracker-sessions"));
      return JSON.parse(body);
    };
    const first = await call();
    assert.equal(first.stale, true);
    assert.equal(first.available, false);
    await yieldTurn();
    assert.equal(builds, 1);
    assert.deepEqual(await call(), first);
    assert.equal(lists, 1, "no repeated merge/scope/map while the rebuild is pending");
    release();
    for (let i = 0; i < 50 && lists < 2; i++) await yieldTurn();
  } finally {
    release();
    analytics.buildSessionAnalytics = original.build;
    analytics.listSessionsForBrowser = original.list;
    disk.createSessionsDiskCache = original.disk;
    fs.rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
