"use strict";

// The Raccoon (小浣熊) provider reads the local Agent2API gateway's
// account_usage_records snapshot — zero auth, no network. The tests build a
// real SQLite fixture with node:sqlite so the shared reader exercises the same
// path it takes in production (CLI first, node:sqlite fallback: both read the
// fixture file).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { fetchRaccoonLimits, DEFAULT_RACCOON_ACCOUNT_ID } = require("../src/lib/raccoon-limits");

const OWNER_ID = "user-sample";

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-raccoon-"));
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

function writeGatewayDb(home, rows) {
  const dbPath = path.join(home, ".agent2api", "agent2api.db");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE account_usage_records (account_id TEXT, usage TEXT, error TEXT, code TEXT, remaining REAL, unlimited INTEGER, last_success_at INTEGER, last_attempt_at INTEGER, updated_at INTEGER)");
  const insert = db.prepare("INSERT INTO account_usage_records (account_id, usage, error, last_success_at, updated_at) VALUES (?, ?, ?, ?, ?)");
  for (const row of rows) {
    insert.run(row.account_id, row.usage, row.error ?? null, row.last_success_at ?? null, row.updated_at ?? null);
  }
  db.close();
  return dbPath;
}

function ownerUsage() {
  return JSON.stringify({
    available: 10300,
    unit: "积分",
    wallets: [
      { type: "daily_points", displayName: "每日积分", balance: 1358 },
      { type: "monthly_points", displayName: "每月会员积分", balance: 0 },
      { type: "reward_points", displayName: "奖励积分", balance: 8942 },
      { type: "topup_points", displayName: "充值积分", balance: 0 },
    ],
    raw: { points: { available_points: 10300, daily_points: 1358, reward_points: 8942 } },
  });
}

test("stays invisible when the gateway db does not exist", async () => {
  const home = sandbox();
  try {
    const result = await fetchRaccoonLimits({ home });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("stays invisible when the owner's account row is absent", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: "user-848338", usage: ownerUsage() }]);
    const result = await fetchRaccoonLimits({ home });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("reads the owner's wallets from the gateway snapshot", async () => {
  const home = sandbox();
  try {
    // Pool accounts must not leak into the card: only the owner row is read.
    writeGatewayDb(home, [
      { account_id: "user-848338", usage: JSON.stringify({ available: 700, wallets: [{ type: "reward_points", displayName: "奖励积分", balance: 700 }] }) },
      { account_id: OWNER_ID, usage: ownerUsage(), updated_at: Date.now() - 60_000 },
    ]);
    const result = await fetchRaccoonLimits({ home });
    assert.equal(result.configured, true);
    assert.equal(result.error, undefined);
    assert.equal(result.plan_name, null);
    assert.equal(result.source, "local-database");
    assert.equal(result.raccoon_available_credits, 10300);
    assert.equal(result.raccoon_unit, "积分");
    assert.equal(result.raccoon_wallets.length, 4);
    assert.deepEqual(result.raccoon_wallets[0], { type: "daily_points", name: "每日积分", balance: 1358 });
    assert.deepEqual(result.raccoon_wallets[2], { type: "reward_points", name: "奖励积分", balance: 8942 });
    // The snapshot timestamp is exposed but NOT as cached_at: the gateway
    // sweeps every ~10 minutes, so the shared provenance pass must judge
    // freshness by the poll time, not the sweep time (which would flag the
    // card stale on every other cycle).
    assert.ok(result.raccoon_updated_at);
    assert.equal(result.cached_at, undefined);
    assert.equal(result.stale, undefined);
  } finally {
    cleanup(home);
  }
});

test("honours the account id override for a migrated owner", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [
      { account_id: OWNER_ID, usage: ownerUsage() },
      { account_id: "user-9999999", usage: JSON.stringify({ available: 42, unit: "积分", wallets: [{ type: "reward_points", displayName: "奖励积分", balance: 42 }] }) },
    ]);
    const result = await fetchRaccoonLimits({ home, env: { TOKENTRACKER_RACCOON_ACCOUNT_ID: "user-9999999" } });
    assert.equal(result.configured, true);
    assert.equal(result.raccoon_available_credits, 42);
  } finally {
    cleanup(home);
  }
});

test("falls back to the default account when the override is blank", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: OWNER_ID, usage: ownerUsage() }]);
    const result = await fetchRaccoonLimits({ home, env: { TOKENTRACKER_RACCOON_ACCOUNT_ID: "   " } });
    assert.equal(result.configured, true);
    assert.equal(result.raccoon_available_credits, 10300);
    assert.equal(DEFAULT_RACCOON_ACCOUNT_ID, "user-sample");
  } finally {
    cleanup(home);
  }
});

test("reports an error instead of zero when the snapshot is not JSON", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: OWNER_ID, usage: "{not json" }]);
    const result = await fetchRaccoonLimits({ home });
    assert.equal(result.configured, true);
    assert.match(result.error, /not valid JSON/);
  } finally {
    cleanup(home);
  }
});

test("reports an error when the snapshot carries no balances", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: OWNER_ID, usage: JSON.stringify({ foo: "bar" }) }]);
    const result = await fetchRaccoonLimits({ home });
    assert.equal(result.configured, true);
    assert.match(result.error, /no wallet balances/);
  } finally {
    cleanup(home);
  }
});

test("marks the card stale once the snapshot outlives the freshness window", async () => {
  const home = sandbox();
  try {
    const old = Date.now() - 7 * 3600 * 1000;
    writeGatewayDb(home, [{ account_id: OWNER_ID, usage: ownerUsage(), updated_at: old, last_success_at: old }]);
    const result = await fetchRaccoonLimits({ home });
    assert.equal(result.configured, true);
    assert.equal(result.stale, true);
    assert.equal(new Date(result.raccoon_updated_at).getTime(), old);
  } finally {
    cleanup(home);
  }
});

test("serves the last good snapshot when the db read throws", async () => {
  const home = sandbox();
  try {
    const dbPath = path.join(home, ".agent2api", "agent2api.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    // Not a SQLite file: both reader backends fail and the fetcher replays
    // the persisted snapshot as stale instead of erroring.
    fs.writeFileSync(dbPath, "this is not a database");
    fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".tokentracker", "raccoon-last-good.json"),
      JSON.stringify({
        raccoon_wallets: [{ type: "reward_points", name: "奖励积分", balance: 8942 }],
        raccoon_available_credits: 8942,
        raccoon_unit: "积分",
        raccoon_updated_at: "2026-10-21T16:48:12.314Z",
      }),
    );
    const result = await fetchRaccoonLimits({ home });
    assert.equal(result.configured, true);
    assert.equal(result.stale, true);
    assert.equal(result.raccoon_available_credits, 8942);
  } finally {
    cleanup(home);
  }
});

test("surfaces a read error on an unreadable db without a last-good snapshot", async () => {
  const home = sandbox();
  try {
    const dbPath = path.join(home, ".agent2api", "agent2api.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "this is not a database");
    const result = await fetchRaccoonLimits({ home });
    assert.equal(result.configured, true);
    assert.match(result.error, /not a database|unreadable/i);
  } finally {
    cleanup(home);
  }
});
