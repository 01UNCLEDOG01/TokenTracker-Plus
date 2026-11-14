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

const { fetchDeepSeekLimits, normalizeDeepseekWebToken } = require("../src/lib/deepseek-limits");

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

// —— TM #1442（2026-11-14）：可选控制台 web token 解锁本月 Search/Fetch 费用行 ——

function balanceBody() {
  return {
    is_available: true,
    balance_infos: [{ currency: "CNY", total_balance: "12.34", granted_balance: "2.00", topped_up_balance: "10.34" }],
  };
}


const WEB_TOKEN = "web-session-token-value";

test("normalizeDeepseekWebToken accepts bare/pasted tokens and rejects junk", () => {
  assert.equal(normalizeDeepseekWebToken(WEB_TOKEN), WEB_TOKEN);
  assert.equal(normalizeDeepseekWebToken("Bearer " + WEB_TOKEN), WEB_TOKEN);
  assert.equal(normalizeDeepseekWebToken("Authorization: Bearer " + WEB_TOKEN), WEB_TOKEN);
  assert.equal(normalizeDeepseekWebToken("not a token"), "");
  assert.equal(normalizeDeepseekWebToken(""), "");
});

function consoleBody({ withFees = true, shapeDrift = false, nowMs = Date.parse("2026-11-18T04:00:00.000Z") } = {}) {
  const buckets = (cost) => [{ cost }];
  const series = [
    { model: "server-tool-search", buckets: withFees ? buckets(0.4) : buckets(0) },
    { model: "tool-search", buckets: withFees ? buckets(0.6) : buckets(0) },
    { model: "server-tool-fetch", buckets: withFees ? buckets(1.5) : buckets(0) },
    { model: "deepseek-chat", buckets: buckets(99) },
  ];
  return {
    code: 0,
    data: {
      biz_code: 0,
      biz_data: shapeDrift
        ? { start: 1, end: 2, data: [] }
        : (() => {
            // 与实现同公式回显窗口（严格契约校验 start/end 必须一致）。
            const date = new Date(nowMs);
            const tz = -date.getTimezoneOffset() * 60;
            return {
              start: Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), 1) / 1000) - tz,
              end: Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1) / 1000) - tz,
              data: [{ currency: "CNY", series, function_series: [] }],
            };
          })(),
    },
  };
}

test("optional console fees ride along when the web token is present", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test", web_token: WEB_TOKEN }));
    const calls = [];
    const result = await fetchDeepSeekLimits({
      home,
      nowMs: Date.parse("2026-11-18T04:00:00.000Z"),
      fetchImpl: async (url) => {
        calls.push(String(url));
        if (String(url).includes("platform.deepseek.com")) {
          assert.match(String(url), /start=/);
          assert.match(String(url), /end=/);
          assert.match(String(url), /tz=/);
          return jsonResponse(consoleBody({ nowMs: Date.parse("2026-11-18T04:00:00.000Z") }));
        }
        return jsonResponse(balanceBody());
      },
    });
    assert.equal(result.configured, true);
    assert.equal(result.deepseek_total_balance, 12.34);
    // 搜索 0.4+0.6=1.0；抓取 1.5；无关模型（deepseek-chat 99）不计入。
    assert.equal(result.deepseek_search_spend, 1);
    assert.equal(result.deepseek_fetch_spend, 1.5);
  } finally { cleanup(home); }
});

test("no web token → balance only, no console call", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test" }));
    let consoleCalled = false;
    const result = await fetchDeepSeekLimits({
      home,
      fetchImpl: async (url) => {
        if (String(url).includes("platform.deepseek.com")) { consoleCalled = true; return jsonResponse({}); }
        return jsonResponse(balanceBody());
      },
    });
    assert.equal(result.configured, true);
    assert.equal(result.deepseek_search_spend, undefined);
    assert.equal(consoleCalled, false);
  } finally { cleanup(home); }
});

test("console failure/shape drift never sinks the balance", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test", web_token: WEB_TOKEN }));
    for (const respond of [
      async () => ({ ok: false, status: 500, json: async () => ({}) }),
      async () => jsonResponse(consoleBody({ shapeDrift: true })),
      async () => { throw new Error("network down"); },
    ]) {
      const result = await fetchDeepSeekLimits({
        home,
        fetchImpl: async (url) => {
          if (String(url).includes("platform.deepseek.com")) return await respond();
          return jsonResponse(balanceBody());
        },
      });
      assert.equal(result.configured, true);
      assert.equal(result.deepseek_total_balance, 12.34);
      assert.equal(result.deepseek_search_spend, undefined);
      assert.equal(result.deepseek_fetch_spend, undefined);
    }
  } finally { cleanup(home); }
});

test("zero-fee months render no fees line", async () => {
  const home = sandbox();
  try {
    fs.writeFileSync(credsFile(home), JSON.stringify({ api_key: "sk-test", web_token: WEB_TOKEN }));
    const result = await fetchDeepSeekLimits({
      home,
      nowMs: Date.parse("2026-11-18T04:00:00.000Z"),
      fetchImpl: async (url) => {
        if (String(url).includes("platform.deepseek.com")) return jsonResponse(consoleBody({ withFees: false }));
        return jsonResponse(balanceBody());
      },
    });
    assert.equal(result.deepseek_search_spend, undefined);
    assert.equal(result.deepseek_fetch_spend, undefined);
  } finally { cleanup(home); }
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
