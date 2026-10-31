const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { fetchVyceAiLimits } = require("../src/lib/vyceai-limits");

const ME_PAYLOAD = {
  name: "gengxutang",
  balance: 60,
  totalSpent: 2.161502,
  totalRequests: 4,
  modelUsage: {
    "glm-5.3-flash": { inputTokens: 324161, outputTokens: 292, cost: 0 },
    "gpt-6-luna": { inputTokens: 1079309, outputTokens: 1442, cost: 2.161502 },
  },
};

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vyce-"));
}

function writeCredentials(home, apiKey) {
  const trackerDir = path.join(home, ".tokentracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "vyceai-credentials.json"), JSON.stringify({ api_key: apiKey }));
}

function lastGood(home) {
  return JSON.parse(
    fs.readFileSync(path.join(home, ".tokentracker", "vyceai-last-good.json"), "utf8"),
  );
}

test("with no credentials anywhere the provider stays invisible", async () => {
  const result = await fetchVyceAiLimits({ home: tempHome(), env: {} });
  assert.deepEqual(result, { configured: false, error: null });
});

test("manual credentials fetch the account aggregate and persist last-good", async () => {
  const home = tempHome();
  writeCredentials(home, "sk-test");
  const calls = [];
  const result = await fetchVyceAiLimits({
    home,
    env: {},
    fetchImpl: async (url, options) => {
      calls.push({ url, auth: options.headers.Authorization });
      return { ok: true, status: 200, json: async () => ME_PAYLOAD };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://vyceai.com/v1/me");
  assert.equal(calls[0].auth, "Bearer sk-test");
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.equal(result.vyceai_balance_usd, 60);
  assert.equal(result.vyceai_total_spent_usd, 2.161502);
  assert.equal(result.vyceai_requests, 4);
  assert.equal(result.vyceai_model_usage["gpt-6-luna"].inputTokens, 1079309);
  const good = lastGood(home);
  assert.equal(good.vyceai_balance_usd, 60);
  assert.equal(typeof good.captured_at, "string");
});

test("a failed fetch serves the last-good snapshot marked stale", async () => {
  const home = tempHome();
  writeCredentials(home, "sk-test");
  // Prime last-good with one successful call.
  await fetchVyceAiLimits({
    home,
    env: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ME_PAYLOAD }),
  });
  const stale = await fetchVyceAiLimits({
    home,
    env: {},
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(stale.configured, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.vyceai_balance_usd, 60);
});

test("an HTTP error without last-good reads as a configured error", async () => {
  const home = tempHome();
  writeCredentials(home, "sk-test");
  const result = await fetchVyceAiLimits({
    home,
    env: {},
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  });
  assert.equal(result.configured, true);
  assert.match(result.error, /HTTP 401/);
});

test("the codex config auto-discovery finds the vyceai bearer token", async () => {
  const home = tempHome();
  const codexHome = path.join(home, ".codex");
  fs.mkdirSync(codexHome, { recursive: true });
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      "model_provider = \"custom\"",
      "[model_providers.other]",
      "base_url = \"https://example.com/v1\"",
      "experimental_bearer_token = \"sk-wrong\"",
      "",
      "[model_providers.custom]",
      "base_url = \"https://vyceai.com/v1\"",
      "experimental_bearer_token = \"sk-f19bf-real\"",
      "",
    ].join("\n"),
  );
  const calls = [];
  const result = await fetchVyceAiLimits({
    home,
    env: { CODEX_HOME: codexHome },
    fetchImpl: async (url, options) => {
      calls.push(options.headers.Authorization);
      return { ok: true, status: 200, json: async () => ME_PAYLOAD };
    },
  });
  assert.equal(result.configured, true);
  assert.deepEqual(calls, ["Bearer sk-f19bf-real"]);
});
