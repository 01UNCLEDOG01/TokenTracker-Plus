"use strict";

// The gateway-fed limit cards (Trae secondary account / CodeArts / Cline Pass)
// read the local Agent2API gateway's account_usage_records — the same source
// the raccoon card uses, matched by account-id prefix with the freshest row
// winning. Tests build a real SQLite fixture via node:sqlite so the shared
// reader exercises its production path.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { fetchTraeLimits, fetchTraeMainLimits, fetchCodeartsLimits, fetchClinePassLimits } = require("../src/lib/gateway-limits");

const TRAE_ID = "trae-solo-4fc0b0ec01dfac776c2555fcca7e7f0859851e8c8f2504a1d8e38429b87e3dfe";
const TRAE_MAIN_ID = "trae-solo-1123d1cb75a5db58931ce004f9e1db1bcec17e5a65ec20f29ac11eb95b08c06a";
const CODEARTS_ID = "codearts-a827547aa241a4af2e8ad0ca2a36ef0e07debda7641aa87d2a07536ffded2039";
const CLINE_ID = "cline-pass-usr-01M4RVNGN12B3DRMD7Z9J2BEPZ";
const RACCOON_ID = "user-sample";

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tt-gateway-"));
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
}

function traeUsage() {
  return JSON.stringify({
    available: 1900,
    credits: [
      { name: "每月登录赠送", remain: 500, total: 500, used: 0, grantAt: 1790784000000, expireAt: 1793462399000 },
      { name: "签到奖励", remain: 100, total: 100, used: 0, grantAt: 1790933163000, expireAt: 1793611563000 },
      // The soonest expiry wins the nearest-expiry line.
      { name: "签到奖励", remain: 100, total: 100, used: 0, grantAt: 1791000000000, expireAt: 1792000000000 },
      // The seed grant carries no remain — it must not crash the shaping.
      { name: "免费" },
    ],
  });
}

function codeartsUsage() {
  return JSON.stringify({
    available: 9444.38,
    subscription: { planName: "Trial", resetDate: "2026-11-19" },
    raw: {
      statistics: {
        plan: "codearts.agent.individual.trial",
        reset_date: "2026-11-19",
        meters: [
          { name: "usageTokenChatMessages", label: "对话 token 额度", used_tokens: 6882326, used_percent: 0, allowance_tokens: 1, credit_remaining: null },
          { name: "usageTotalPackageCredit", label: "套餐积分", credit_remaining: 9444.38, credit_total: 9500, credit_used: 55.62 },
          { name: "usageBonusPackageCredit", label: "赠送积分", credit_remaining: 8944.38, credit_total: 9000, credit_used: 55.62 },
          { name: "usageBasicPackageCredit", label: "基础包积分", credit_remaining: 500, credit_total: 500, credit_used: 0 },
        ],
      },
    },
  });
}

function clineUsage() {
  return JSON.stringify({
    available: 0.5,
    unit: "credit",
    wallets: [{ type: "cline_credit", displayName: "Cline credit", balance: 0.5 }],
  });
}

test("trae: balance plus every live grant in expiry order; seed rows are ignored", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: TRAE_ID, usage: traeUsage(), updated_at: Date.now() - 60_000 }]);
    const result = await fetchTraeLimits({ home, nowMs: 1790000000000 });
    assert.equal(result.configured, true);
    assert.equal(result.trae_available_points, 1900);
    assert.equal(result.trae_nearest_points, 100);
    assert.equal(new Date(result.trae_nearest_expire_at).getTime(), 1792000000000);
    // One entry per batch, sorted by expiry, with the real per-batch pair the
    // card needs for a bar. The "免费" seed row has no remain/total.
    assert.deepEqual(result.trae_grants, [
      { name: "签到奖励", remain: 100, total: 100, expire_at: "2026-10-14T17:46:40.000Z" },
      { name: "每月登录赠送", remain: 500, total: 500, expire_at: "2026-10-31T15:59:59.000Z" },
      { name: "签到奖励", remain: 100, total: 100, expire_at: "2026-11-02T09:26:03.000Z" },
    ]);
    assert.equal(result.plan_name, null);
    assert.equal(result.stale, undefined);
  } finally {
    cleanup(home);
  }
});

test("trae: drops expired, zero, and total-less grants from the batch list", async () => {
  const home = sandbox();
  const nowMs = 1790000000000;
  try {
    const usage = JSON.stringify({
      available: 80,
      credits: [
        { name: "expired", remain: 50, total: 50, expireAt: nowMs - 1 },
        { name: "no-total", remain: 5, expireAt: nowMs + 1000 },
        { name: "zero", remain: 0, total: 100, expireAt: nowMs + 2000 },
        { name: "live", remain: 25, total: 100, expireAt: nowMs + 3000 },
      ],
    });
    writeGatewayDb(home, [{ account_id: TRAE_ID, usage, updated_at: Date.now() - 60_000 }]);
    const result = await fetchTraeLimits({ home, nowMs });
    assert.equal(result.trae_available_points, 80);
    assert.deepEqual(result.trae_grants, [
      { name: "live", remain: 25, total: 100, expire_at: new Date(nowMs + 3000).toISOString() },
    ]);
    assert.equal(result.trae_nearest_points, 25);
    assert.equal(new Date(result.trae_nearest_expire_at).getTime(), nowMs + 3000);
  } finally {
    cleanup(home);
  }
});

test("trae: omits the expiry line when no live grant carries an expiry", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: TRAE_ID, usage: JSON.stringify({ available: 7, credits: [{ name: "免费" }] }) }]);
    const result = await fetchTraeLimits({ home });
    assert.equal(result.trae_available_points, 7);
    assert.equal(result.trae_nearest_expire_at, undefined);
  } finally {
    cleanup(home);
  }
});

test("codearts: plan label, buckets and reset date survive the shaping", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: CODEARTS_ID, usage: codeartsUsage(), updated_at: Date.now() - 60_000 }]);
    const result = await fetchCodeartsLimits({ home });
    assert.equal(result.configured, true);
    assert.equal(result.plan_name, "Trial");
    assert.equal(result.codearts_available_credits, 9444.38);
    assert.deepEqual(result.codearts_package, { remaining: 9444.38, total: 9500 });
    assert.deepEqual(result.codearts_bonus, { remaining: 8944.38, total: 9000 });
    assert.deepEqual(result.codearts_basic, { remaining: 500, total: 500 });
    assert.equal(result.codearts_reset_date, "2026-11-19");
    assert.equal(result.codearts_tokens_used, 6882326);
  } finally {
    cleanup(home);
  }
});

test("cline: wallets shape and the staleness flag for an aged snapshot", async () => {
  const home = sandbox();
  try {
    const old = Date.now() - 9 * 86400 * 1000;
    writeGatewayDb(home, [{ account_id: CLINE_ID, usage: clineUsage(), updated_at: old }]);
    const result = await fetchClinePassLimits({ home });
    assert.equal(result.configured, true);
    assert.equal(result.stale, true);
    assert.equal(result.cline_available_credits, 0.5);
    assert.deepEqual(result.cline_wallets, [{ name: "Cline credit", balance: 0.5 }]);
  } finally {
    cleanup(home);
  }
});

test("each Trae card pins its own account id instead of racing on freshness", async () => {
  const home = sandbox();
  try {
    // Both rows share the trae-solo- prefix. Prefix+freshest matching used to
    // make the two cards swap identities whenever the other account swept
    // first; each card must read only its pinned id.
    writeGatewayDb(home, [
      { account_id: TRAE_ID, usage: JSON.stringify({ available: 111 }), updated_at: Date.now() - 3 * 3600 * 1000 },
      { account_id: TRAE_MAIN_ID, usage: JSON.stringify({ available: 222 }), updated_at: Date.now() - 60_000 },
    ]);
    assert.equal((await fetchTraeLimits({ home })).trae_available_points, 111);
    assert.equal((await fetchTraeMainLimits({ home })).trae_available_points, 222);
  } finally {
    cleanup(home);
  }
});

test("raccoon-shaped pool accounts are not matched by the gateway cards", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: RACCOON_ID, usage: JSON.stringify({ available: 10300 }) }]);
    assert.equal(await fetchTraeLimits({ home }), null);
    assert.equal(await fetchCodeartsLimits({ home }), null);
    assert.equal(await fetchClinePassLimits({ home }), null);
  } finally {
    cleanup(home);
  }
});

test("absent account rows leave the providers invisible", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: RACCOON_ID, usage: "{}" }]);
    assert.equal(await fetchTraeLimits({ home }), null);
  } finally {
    cleanup(home);
  }
});

test("surfaces an error when the matched snapshot is not JSON", async () => {
  const home = sandbox();
  try {
    writeGatewayDb(home, [{ account_id: TRAE_ID, usage: "{nope", updated_at: Date.now() }]);
    const result = await fetchTraeLimits({ home });
    assert.equal(result.configured, true);
    assert.match(result.error, /not valid JSON/);
  } finally {
    cleanup(home);
  }
});
