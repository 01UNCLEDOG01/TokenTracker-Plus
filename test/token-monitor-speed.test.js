"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  resolveTokenMonitorDbPath,
  normalizeSpeedPerformance,
  loadTokenMonitorSpeedMap,
  lookupTokenMonitorPerformance,
  resetTokenMonitorSpeedCacheForTests,
} = require("../src/lib/token-monitor-speed");

test.beforeEach(() => {
  resetTokenMonitorSpeedCacheForTests();
});

test("normalizeSpeedPerformance handles valid numbers and ignores invalid", () => {
  assert.equal(normalizeSpeedPerformance(0, 1000, 1), null);
  assert.equal(normalizeSpeedPerformance(100, 0, 1), null);
  assert.equal(normalizeSpeedPerformance(-10, 1000, 1), null);

  const perf = normalizeSpeedPerformance(300, 10000, 3);
  assert.equal(perf.estimated_output_tokens, 300);
  assert.equal(perf.estimated_duration_ms, 10000);
  assert.equal(perf.estimated_request_count, 3);
  assert.equal(perf.estimated_tokens_per_second, 30);
});

test("resolveTokenMonitorDbPath respects environment override", () => {
  const custom = path.join(os.tmpdir(), "custom-tm.sqlite");
  const resolved = resolveTokenMonitorDbPath({ env: { TOKENTRACKER_TOKEN_MONITOR_DB: custom } });
  assert.equal(resolved, path.resolve(custom));
});

test("loadTokenMonitorSpeedMap and lookup with mock SQLite db", (t) => {
  let DatabaseSync;
  try {
    DatabaseSync = require("node:sqlite").DatabaseSync;
  } catch {
    t.skip("node:sqlite not available");
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-tm-speed-"));
  t.after(() => {
    resetTokenMonitorSpeedCacheForTests();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  const dbPath = path.join(tmpDir, "session-usage-archive.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (session_key TEXT PRIMARY KEY, entry_json TEXT);
    INSERT INTO sessions VALUES (
      'dsh:session-test-123',
      '{"sessionId":"session-test-123","periods":{"allTime":{"timedOutputTokens":600,"timedDurationMs":10000,"messageCount":2}}}'
    );
    INSERT INTO sessions VALUES (
      'antigravity:ag-test-456',
      '{"sessionId":"ag-test-456","periods":{"today":{"timedOutputTokens":400,"timedDurationMs":5000,"messageCount":1}}}'
    );
    INSERT INTO sessions VALUES (
      'opencode:shared-id',
      '{"sessionId":"shared-id","periods":{"today":{"timedOutputTokens":100,"timedDurationMs":2000,"messageCount":1}}}'
    );
  `);
  db.close();

  const options = { env: { TOKENTRACKER_TOKEN_MONITOR_DB: dbPath } };
  const { byKey } = loadTokenMonitorSpeedMap(options);
  assert.equal(byKey.size, 3);

  const dshPerf = lookupTokenMonitorPerformance("dsh", "session-test-123", options);
  assert.ok(dshPerf);
  assert.equal(dshPerf.estimated_output_tokens, 600);
  assert.equal(dshPerf.estimated_duration_ms, 10000);
  assert.equal(dshPerf.estimated_tokens_per_second, 60);

  const agPerf = lookupTokenMonitorPerformance("antigravity", "ag-test-456", options);
  assert.ok(agPerf);
  assert.equal(agPerf.estimated_tokens_per_second, 80);

  // Scoped isolation: lookup with source="kimi" must not match "opencode:shared-id"
  assert.equal(lookupTokenMonitorPerformance("kimi", "shared-id", options), null);
  assert.ok(lookupTokenMonitorPerformance("opencode", "shared-id", options));

  // WAL sensitivity: touching -wal forces cache invalidation
  const walPath = `${dbPath}-wal`;
  fs.writeFileSync(walPath, "dummy-wal-update");
  const reloaded = loadTokenMonitorSpeedMap(options);
  assert.equal(reloaded.byKey.size, 3);
});
