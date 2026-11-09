const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeMistralCookieHeader,
  extractCsrfToken,
  writeCookieFile,
  parseMistralSubscription,
  parseMistralBudget,
  parseMistralCredits,
  parseMistralVibe,
  fetchMistralLimits,
} = require("../src/lib/mistral-limits");

function flightRow(chunk) {
  return `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`;
}

function budgetFixture(pct = 25, amount = 20) {
  return { usage_percentage: pct, initial_budget: amount, currency: "eur", reset_at: "2026-12-01T00:00:00Z" };
}

function subscriptionHtml(budgets) {
  return flightRow(`ignore"budget":${JSON.stringify(budgets)}trailing`);
}

function mockResponse({ ok = true, status = 200, headers = {}, text = "", json = null } = {}) {
  return {
    ok,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => json,
  };
}

function mockFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const route = routes.find((entry) => url.includes(entry.match));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return typeof route.response === "function" ? route.response(url, options) : route.response;
  };
  impl.calls = calls;
  return impl;
}

test("mistral cookie normalization requires an ory_session pair", () => {
  assert.equal(normalizeMistralCookieHeader("Cookie: ory_session_mistralstaging=abc; csrftoken=xyz"), "ory_session_mistralstaging=abc; csrftoken=xyz");
  assert.equal(normalizeMistralCookieHeader("session=abc"), "", "a cookie without an ory_session_* pair is invalid");
  assert.equal(normalizeMistralCookieHeader("bare-token-no-equals"), "");
  assert.equal(normalizeMistralCookieHeader("ory_session_x=1\ninject: 1"), "", "control characters are rejected");
  assert.equal(normalizeMistralCookieHeader(""), "");
});

test("extractCsrfToken picks the csrftoken pair", () => {
  assert.equal(extractCsrfToken("ory_session_x=1; csrftoken=tok123"), "tok123");
  assert.equal(extractCsrfToken("ory_session_x=1"), null);
});

test("writeCookieFile stores normalized values and rejects invalid ones", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mistral-"));
  const ok = writeCookieFile({ home, cookie: "Cookie: ory_session_mistralstaging=abc" });
  assert.deepEqual(ok, { saved: true });
  const file = path.join(home, ".tokentracker", "mistral-credentials.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored.cookie, "ory_session_mistralstaging=abc");
  // Windows has no POSIX mode bits; on POSIX the file must be 0600.
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  const bad = writeCookieFile({ home, cookie: "session=abc" });
  assert.deepEqual(bad, { saved: false, error: "invalid_cookie" });
});

test("mistral subscription parser reassembles flight chunks and rejects ambiguity", () => {
  const good = parseMistralSubscription(subscriptionHtml({ api_budget: budgetFixture(), vibe_budget: budgetFixture(10, 30) }));
  assert.ok(good?.api_budget, "the budget object is found inside the flight payload");
  assert.equal(good.api_budget.initial_budget, 20);

  // Binary payload segments (1:T<hex>,) are not JSON tree members.
  const html = `${flightRow("1:T5,AAAAA")}${subscriptionHtml({ api_budget: budgetFixture() })}`;
  assert.ok(parseMistralSubscription(html)?.api_budget);

  // The embedded JSON contains "])" — the push boundary must be found at
  // </script>, not at the first bracket pair inside the string.
  const bracketTrap = flightRow(`prefix("x])y")"budget":${JSON.stringify({ api_budget: budgetFixture() })}`);
  assert.ok(parseMistralSubscription(bracketTrap)?.api_budget, "]) inside the JSON does not truncate the chunk");

  // Two different budget objects mean the parse is ambiguous.
  const mixed = `${subscriptionHtml({ api_budget: budgetFixture() })}${subscriptionHtml({ api_budget: budgetFixture(99, 999) })}`;
  assert.equal(parseMistralSubscription(mixed), null);
  assert.equal(parseMistralSubscription(""), null);
  assert.equal(parseMistralSubscription("no budgets here"), null);
});

test("mistral budget and credits parsers enforce their contracts", () => {
  // Overage is real: 125% of a 20 EUR budget.
  const over = parseMistralBudget(budgetFixture(125, 20));
  assert.equal(over.used_percent, 125);
  assert.equal(over.used, 25);
  assert.equal(over.remaining, 0);
  assert.equal(over.currency, "EUR");
  assert.equal(over.reset_at, "2026-12-01T00:00:00.000Z");

  assert.equal(parseMistralBudget({ usage_percentage: -1, initial_budget: 20, currency: "eur" }), null);
  assert.equal(parseMistralBudget({ usage_percentage: 10, initial_budget: 0, currency: "eur" }), null);
  assert.equal(parseMistralBudget({ usage_percentage: 10, initial_budget: 20, currency: "euro" }), null);

  const credits = parseMistralCredits({ wallet_amount: 12, credit_notes_amount: 3, ongoing_usage_balance: 2, currency: "eur" });
  assert.equal(credits.remaining, 13);
  assert.equal(credits.currency, "EUR");
  // wallet_amount alone can be negative — the sum is the usable balance.
  assert.equal(parseMistralCredits({ wallet_amount: -15 }).remaining, -15);
  assert.equal(parseMistralCredits({ credit_notes_amount: 1 }), null, "wallet_amount is required");
  assert.equal(parseMistralVibe({ 0: { result: { data: { json: { usage_percentage: 40, reset_at: "2026-12-01T00:00:00Z" } } } } })?.used_percent, 40);
});

test("fetchMistralLimits reports not-configured without any network call", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mistral-nc-"));
  const fetchImpl = mockFetch([]);
  const result = await fetchMistralLimits({ home, fetchImpl });
  assert.deepEqual(result, { configured: false, error: null });
  assert.equal(fetchImpl.calls.length, 0);
});

test("fetchMistralLimits returns windows and balance from both sources", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mistral-ok-"));
  writeCookieFile({ home, cookie: "ory_session_mistralstaging=abc; csrftoken=tok" });
  const fetchImpl = mockFetch([
    {
      match: "/subscription",
      response: mockResponse({ text: subscriptionHtml({ api_budget: budgetFixture(25, 20), vibe_budget: budgetFixture(10, 30) }) }),
    },
    {
      match: "/api/billing/credits",
      response: mockResponse({ json: { wallet_amount: 12, credit_notes_amount: 3, ongoing_usage_balance: 2, currency: "eur" } }),
    },
  ]);
  const result = await fetchMistralLimits({ home, fetchImpl });
  assert.equal(result.configured, true);
  assert.equal(result.error, undefined, "no error key on success");
  assert.equal(result.primary_window.used_percent, 25);
  assert.equal(result.primary_window.limit, 20);
  assert.equal(result.secondary_window.limit, 30);
  assert.equal(result.mistral_balance, 13);
  assert.equal(result.mistral_currency, "EUR");
  assert.equal(result.source, "cookie-file");
});

test("fetchMistralLimits runs the percent-only vibe fallback when the page omits it", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mistral-fb-"));
  writeCookieFile({ home, cookie: "ory_session_mistralstaging=abc; csrftoken=tok" });
  const fetchImpl = mockFetch([
    {
      match: "/subscription",
      response: mockResponse({ text: subscriptionHtml({ api_budget: budgetFixture() }) }),
    },
    {
      match: "/api/billing/credits",
      response: mockResponse({ json: { wallet_amount: 5, currency: "eur" } }),
    },
    {
      match: "billing.vibeUsage",
      response: mockResponse({ json: { 0: { result: { data: { json: { usage_percentage: 40, reset_at: "2026-12-01T00:00:00Z" } } } } } }),
    },
  ]);
  const result = await fetchMistralLimits({ home, fetchImpl });
  assert.equal(result.secondary_window.used_percent, 40);
  assert.equal(result.secondary_window.limit, null, "the fallback never invents amounts");
});

test("fetchMistralLimits ranks unauthorized above rate limits and treats redirects as auth failures", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mistral-auth-"));
  writeCookieFile({ home, cookie: "ory_session_mistralstaging=abc" });
  const fetchImpl = mockFetch([
    { match: "/subscription", response: mockResponse({ ok: false, status: 401 }) },
    { match: "/api/billing/credits", response: mockResponse({ ok: false, status: 429 }) },
  ]);
  const result = await fetchMistralLimits({ home, fetchImpl });
  assert.equal(result.configured, true);
  assert.match(result.error, /session expired|unauthorized/i);

  const redirectFetch = mockFetch([
    { match: "/subscription", response: mockResponse({ ok: false, status: 302 }) },
    { match: "/api/billing/credits", response: mockResponse({ json: { wallet_amount: 1 } }) },
  ]);
  const redirected = await fetchMistralLimits({ home, fetchImpl: redirectFetch });
  assert.match(redirected.error, /session expired/i);

  const challengeFetch = mockFetch([
    {
      match: "/subscription",
      response: mockResponse({ ok: false, status: 403, headers: { "cf-mitigated": "challenge" } }),
    },
    { match: "/api/billing/credits", response: mockResponse({ ok: false, status: 500 }) },
  ]);
  const challenged = await fetchMistralLimits({ home, fetchImpl: challengeFetch });
  assert.match(challenged.error, /unavailable|challenge/i);
});

test("fetchMistralLimits flags an invalid stored cookie without fetching", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-mistral-bad-"));
  const file = path.join(home, ".tokentracker", "mistral-credentials.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cookie: "session=abc" }));
  const fetchImpl = mockFetch([]);
  const result = await fetchMistralLimits({ home, fetchImpl });
  assert.equal(result.configured, true);
  assert.match(result.error, /ory_session/);
  assert.equal(fetchImpl.calls.length, 0);
});
