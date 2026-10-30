"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  fetchMinimaxLimits,
  credentialsPath,
  normalizeRegion,
  normalizeBillingMode,
} = require("../src/lib/minimax-limits");

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-minimax-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

function writeCreds(home, value) {
  fs.writeFileSync(credentialsPath(home), JSON.stringify(value));
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const TOKEN_PLAN = {
  base_resp: { status_code: 0, status_msg: "success" },
  data: {
    model_remains: [
      {
        model_name: "general",
        current_interval_remaining_percent: "72",
        current_interval_status: 1,
        end_time: 1793330000000,
        current_weekly_remaining_percent: "58",
        current_weekly_status: 1,
        weekly_end_time: 1793900000000,
      },
    ],
  },
};

test("normalizes region and billing mode", () => {
  assert.equal(normalizeRegion("cn"), "cn");
  assert.equal(normalizeRegion("minimax.io"), "en");
  assert.equal(normalizeRegion(""), "auto");
  assert.equal(normalizeBillingMode("API"), "api");
  assert.equal(normalizeBillingMode(""), "token-plan");
});

test("stays invisible without a key", async () => {
  const home = sandbox();
  try {
    const result = await fetchMinimaxLimits({
      home,
      fetchImpl: async () => { throw new Error("must not fetch"); },
    });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("reads the CN token-plan 5h + weekly windows", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { api_key: "sk-test", region: "cn", billing_mode: "token-plan" });
    const calls = [];
    const result = await fetchMinimaxLimits({
      home,
      fetchImpl: async (url, options) => {
        calls.push({ url, headers: options.headers });
        return jsonResponse(TOKEN_PLAN);
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://api.minimaxi.com/v1/token_plan/remains");
    assert.equal(calls[0].headers.Authorization, "Bearer sk-test");
    assert.equal(result.configured, true);
    assert.equal(result.plan_name, "Token Plan");
    assert.equal(result.primary_window.used_percent, 28);
    assert.equal(result.primary_window.remaining_percent, 72);
    assert.equal(result.primary_window.limit_window_seconds, 5 * 60 * 60);
    assert.equal(result.secondary_window.used_percent, 42);
    assert.equal(result.secondary_window.limit_window_seconds, 7 * 24 * 60 * 60);
    assert.equal(result.primary_window.reset_at, new Date(1793330000000).toISOString());
  } finally {
    cleanup(home);
  }
});

test("supports the API balance mode", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { api_key: "sk-test", region: "cn", billing_mode: "api" });
    const result = await fetchMinimaxLimits({
      home,
      fetchImpl: async (url) => {
        assert.equal(url, "https://api.minimaxi.com/account/query_balance");
        return jsonResponse({ available_amount: 12.34 });
      },
    });
    assert.equal(result.configured, true);
    assert.equal(result.plan_name, "Pay-as-you-go");
    assert.equal(result.minimax_billing_mode, "api");
    assert.equal(result.minimax_balance, 12.34);
    assert.equal(result.minimax_currency, "CNY");
  } finally {
    cleanup(home);
  }
});

test("falls back to the English region when auto probing a CN 401", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { api_key: "sk-test", region: "auto", billing_mode: "token-plan" });
    const urls = [];
    const result = await fetchMinimaxLimits({
      home,
      fetchImpl: async (url) => {
        urls.push(url);
        if (url.includes("minimaxi.com")) return jsonResponse({ base_resp: { status_code: 1004, status_msg: "log in again" } });
        return jsonResponse(TOKEN_PLAN);
      },
    });
    assert.equal(result.configured, true);
    assert.equal(result.region, "en");
    assert.ok(urls.some((url) => url.includes("api.minimax.io")));
  } finally {
    cleanup(home);
  }
});

test("surfaces an error instead of a fake zero window", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { api_key: "sk-test", region: "cn" });
    const result = await fetchMinimaxLimits({
      home,
      fetchImpl: async () => jsonResponse({ data: { model_remains: [] } }),
    });
    assert.equal(result.configured, true);
    assert.match(result.error, /no quota windows/i);
  } finally {
    cleanup(home);
  }
});
