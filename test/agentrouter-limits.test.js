"use strict";

// The AgentRouter.org provider reads the New API panel's /api/user/self with
// the user's access token plus the mandatory New-Api-User id header. Both
// headers are required — verified live 2026-10-22 (token alone answers
// "未提供 New-Api-User"; the pairing below returned the real balance).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchAgentRouterLimits } = require("../src/lib/agentrouter-limits");

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-agentrouter-"));
  fs.mkdirSync(path.join(home, ".tokentracker"), { recursive: true });
  return home;
}

function cleanup(home) {
  fs.rmSync(home, { recursive: true, force: true });
}

function credsFile(home) {
  return path.join(home, ".tokentracker", "agentrouter-credentials.json");
}

function writeCreds(home, creds) {
  fs.writeFileSync(credsFile(home), JSON.stringify(creds));
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function selfBody(overrides = {}) {
  return {
    success: true,
    message: "",
    data: {
      id: 451508,
      username: "github_451508",
      display_name: "UNCLEDOG",
      role: 1,
      status: 1,
      quota: 263015761,
      used_quota: 461984239,
      request_count: 3806,
      ...overrides,
    },
  };
}

test("stays invisible without a credentials file", async () => {
  const home = sandbox();
  try {
    const result = await fetchAgentRouterLimits({ home, fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("stays invisible when the user_id header value is missing", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { access_token: "tok" });
    const result = await fetchAgentRouterLimits({ home, fetchImpl: async () => { throw new Error("must not fetch"); } });
    assert.deepEqual(result, { configured: false, error: null });
  } finally {
    cleanup(home);
  }
});

test("sends both auth headers and converts quota units to USD", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { access_token: "tok", user_id: "451508" });
    const calls = [];
    const result = await fetchAgentRouterLimits({
      home,
      fetchImpl: async (url, options = {}) => {
        calls.push({ url, headers: options.headers || {} });
        return jsonResponse(selfBody());
      },
    });
    assert.equal(result.configured, true);
    assert.equal(result.error, undefined);
    // 263015761 / 500000 = 526.031522 — matches the panel's own dollar display.
    assert.equal(result.agentrouter_balance_usd, 526.031522);
    assert.equal(result.agentrouter_used_usd, 923.968478);
    assert.equal(result.agentrouter_requests, 3806);
    assert.equal(result.agentrouter_quota_units, 263015761);
    assert.equal(result.source, "provider-api");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.Authorization, "Bearer tok");
    assert.equal(calls[0].headers["New-Api-User"], "451508");
  } finally {
    cleanup(home);
  }
});

test("reports the panel's own message on a rejected token", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { access_token: "tok", user_id: "451508" });
    const result = await fetchAgentRouterLimits({
      home,
      fetchImpl: async () => jsonResponse({ success: false, message: "无权进行此操作，access token 无效" }),
    });
    assert.equal(result.configured, true);
    assert.match(result.error, /access token 无效/);
  } finally {
    cleanup(home);
  }
});

test("flags a disabled account instead of showing a balance", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { access_token: "tok", user_id: "451508" });
    const result = await fetchAgentRouterLimits({
      home,
      fetchImpl: async () => jsonResponse(selfBody({ status: 2 })),
    });
    assert.equal(result.configured, true);
    assert.match(result.error, /disabled/);
  } finally {
    cleanup(home);
  }
});

test("serves the last good snapshot when the panel blips", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { access_token: "tok", user_id: "451508" });
    fs.writeFileSync(path.join(home, ".tokentracker", "agentrouter-last-good.json"), JSON.stringify({
      agentrouter_balance_usd: 526.03,
      agentrouter_used_usd: 923.97,
      agentrouter_requests: 3806,
      agentrouter_quota_units: 263015761,
    }));
    const result = await fetchAgentRouterLimits({
      home,
      fetchImpl: async () => { throw new Error("network down"); },
    });
    assert.equal(result.configured, true);
    assert.equal(result.stale, true);
    assert.equal(result.agentrouter_balance_usd, 526.03);
  } finally {
    cleanup(home);
  }
});

test("surfaces the failure when the panel blips with nothing cached", async () => {
  const home = sandbox();
  try {
    writeCreds(home, { access_token: "tok", user_id: "451508" });
    const result = await fetchAgentRouterLimits({
      home,
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    });
    assert.equal(result.configured, true);
    assert.match(result.error, /HTTP 401/);
  } finally {
    cleanup(home);
  }
});
