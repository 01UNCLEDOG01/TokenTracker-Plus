"use strict";

// The DeepSeek provider reads /user/balance with the user's own API key. The
// per-day model-usage endpoint (10-16 recon's /user/balance/models) answers
// 404 for API keys on every path variant (2026-10-22), so this card is
// balance-only: an empty wallet (is_available:false, 0.00) is a valid reading,
// not an error.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchDeepSeekLimits } = require("../src/lib/deepseek-limits");

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-deepseek-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function credsFile(home) {
  return path.join(home, ".tokentracker", "deepseek-credentials.json");
}

test("stays invisible without a credentials file", async () => {
  const home = sandbox();
  try {
    const result = await fetchDeepSeekLimits({ home, fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("ignores a credentials file without an api_key", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ something: "else" }));
    const result = await fetchDeepSeekLimits({ home, fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("reads the CNY balance row and the availability flag", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test" }));
    const result = await fetchDeepSeekLimits({
      home,
      // Exactly what the live endpoint answered on 2026-10-22 for an empty account.
      fetchImpl: async () => jsonResponse({
        is_available: false,
        balance_infos: [{ currency: "CNY", total_balance: "0.00", granted_balance: "0.00", topped_up_balance: "0.00" }],
      }),
    });
    assert.equal(result.configured, true);
    assert.equal(result.error, undefined);
    assert.equal(result.deepseek_currency, "CNY");
    assert.equal(result.deepseek_total_balance, 0);
    assert.equal(result.deepseek_granted_balance, 0);
    assert.equal(result.deepseek_available, false);
    assert.equal(result.plan_name, null);
    assert.equal(result.source, "provider-api");
  } finally {
    cleanup(home);
  }
});

test("prefers the CNY row when several currencies ever appear", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test" }));
    const result = await fetchDeepSeekLimits({
      home,
      fetchImpl: async () => jsonResponse({
        is_available: true,
        balance_infos: [
          { currency: "USD", total_balance: "1.00", granted_balance: "0.00" },
          { currency: "CNY", total_balance: "42.50", granted_balance: "10.00" },
        ],
      }),
    });
    assert.equal(result.deepseek_currency, "CNY");
    assert.equal(result.deepseek_total_balance, 42.5);
    assert.equal(result.deepseek_available, true);
  } finally {
    cleanup(home);
  }
});

test("serves the last good snapshot when the endpoint blips", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test" }));
    fs.writeFileSync(path.join(home, ".tokentracker", "deepseek-last-good.json"), JSON.stringify({
      deepseek_currency: "CNY",
      deepseek_total_balance: 12.34,
      deepseek_granted_balance: 2,
      deepseek_available: true,
    }));
    const result = await fetchDeepSeekLimits({
      home,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.equal(result.configured, true);
    assert.equal(result.stale, true);
    assert.equal(result.deepseek_total_balance, 12.34);
  } finally {
    cleanup(home);
  }
});

test("surfaces the failure when the endpoint blips with nothing cached", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test" }));
    const result = await fetchDeepSeekLimits({
      home,
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    assert.equal(result.configured, true);
    assert.match(result.error, /HTTP 401/);
  } finally {
    cleanup(home);
  }
});
