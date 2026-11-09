const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeSessionBearer,
  normalizeOrganization,
  writeCredentialsFile,
  parseBalance,
  fetchOpenaiCreditsLimits,
} = require("../src/lib/openai-credits-limits");

const NOW_MS = 1_800_000_000_000; // 2027-01-15, after the fixture's 2e9 expiry.

function creditSummaryFixture() {
  return {
    object: "credit_summary",
    total_granted: 124,
    total_used: 24,
    total_available: 100,
    total_paid_available: 0,
    grants: {
      data: [
        { grant_amount: 100, used_amount: 0, effective_at: 1, expires_at: 2000000000 },
        { grant_amount: 24, used_amount: 24, effective_at: 1, expires_at: null },
      ],
    },
  };
}

function mockResponse({ ok = true, status = 200, json = null } = {}) {
  return { ok, status, json: async () => json };
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

test("session bearer normalization strips the Bearer prefix and rejects whitespace", () => {
  assert.equal(normalizeSessionBearer("Bearer sk-proj-session-token"), "sk-proj-session-token");
  assert.equal(normalizeSessionBearer("sk-proj-session-token"), "sk-proj-session-token");
  assert.equal(normalizeSessionBearer("sk-proj token"), "", "whitespace would break the header");
  assert.equal(normalizeSessionBearer("sk-proj\ninject"), "");
  assert.equal(normalizeOrganization("org-demo-1"), "org-demo-1");
  assert.equal(normalizeOrganization("org demo"), "");
});

test("writeCredentialsFile stores both fields and rejects incomplete ones", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-oai-"));
  const ok = writeCredentialsFile({ home, sessionBearer: "Bearer sk-proj-session-token", organization: "org-demo-1" });
  assert.deepEqual(ok, { saved: true });
  const file = path.join(home, ".tokentracker", "openai-credits-credentials.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(stored.sessionBearer, "sk-proj-session-token", "the Bearer prefix is normalized away");
  assert.equal(stored.organization, "org-demo-1");
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  }
  assert.deepEqual(
    writeCredentialsFile({ home, sessionBearer: "sk-proj-session-token", organization: "" }),
    { saved: false, error: "invalid_credentials" },
  );
});

test("parseBalance meters only when grants reconcile with total_available", () => {
  const good = parseBalance(creditSummaryFixture(), NOW_MS);
  assert.equal(good.available, 100);
  // Active grants: 100 (expiry 2e9 s is in the future) + 0 left from the 24.
  assert.equal(good.meterTotal, 100);
  assert.equal(good.expiresAt, new Date(2_000_000_000_000).toISOString());
  assert.equal(good.primaryError, undefined);

  // A stale grant list that no longer sums to total_available must not
  // invent a meter limit: the display falls back to balance-only.
  const stale = creditSummaryFixture();
  stale.grants.data[0].grant_amount = 40;
  const parsed = parseBalance(stale, NOW_MS);
  assert.equal(parsed.available, 100);
  assert.equal(parsed.meterTotal, null);

  // paid funds present (total_paid_available > 0) also disable the meter.
  const paid = parseBalance({ ...creditSummaryFixture(), total_paid_available: 5 }, NOW_MS);
  assert.equal(paid.meterTotal, null);
});

test("parseBalance excludes scheduled, held, and expired grants", () => {
  const data = creditSummaryFixture();
  data.grants.data = [
    { grant_amount: 50, used_amount: 0, expires_at: 2000000000 },
    { grant_amount: 50, used_amount: 0, expires_at: 2000000000, is_scheduled: true },
    { grant_amount: 50, used_amount: 0, expires_at: 2000000000, is_held_for_prepaid_transition: true },
    { grant_amount: 50, used_amount: 0, expires_at: 1, "expired already": undefined },
    { grant_amount: 25, used_amount: 0, expires_at: null },
  ];
  const parsed = parseBalance(data, NOW_MS);
  // 50 (unexpired) + 25 (never expires); the expired 50 drops out.
  assert.equal(parsed.usableGrants.reduce((sum, grant) => sum + grant.remaining, 0), 75);
  assert.equal(parsed.expiresAt, new Date(2_000_000_000_000).toISOString());
});

test("parseBalance rejects non-credit_summary payloads and bad totals", () => {
  assert.ok(parseBalance({ object: "something_else" }, NOW_MS).error);
  assert.ok(parseBalance({ object: "credit_summary", total_available: "100" }, NOW_MS).error);
  assert.ok(parseBalance({ object: "credit_summary", total_available: -1 }, NOW_MS).error);
  assert.ok(parseBalance(null, NOW_MS).error);
});

test("fetchOpenaiCreditsLimits reports not-configured without any network call", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-oai-nc-"));
  const fetchImpl = mockFetch([]);
  const result = await fetchOpenaiCreditsLimits({ home, fetchImpl });
  assert.deepEqual(result, { configured: false, error: null });
  assert.equal(fetchImpl.calls.length, 0);
});

test("fetchOpenaiCreditsLimits sends both headers and renders the reconciled meter", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-oai-ok-"));
  writeCredentialsFile({ home, sessionBearer: "sk-proj-session-token", organization: "org-demo-1" });
  const fetchImpl = mockFetch([
    { match: "credit_grants", response: mockResponse({ json: creditSummaryFixture() }) },
  ]);
  const result = await fetchOpenaiCreditsLimits({ home, fetchImpl });
  assert.equal(result.configured, true);
  assert.equal(result.openai_credits_available, 100);
  assert.equal(result.openai_credits_currency, "USD");
  assert.equal(result.primary_window.limit, 100);
  assert.equal(result.primary_window.used, 0);
  assert.equal(result.primary_window.reset_at, new Date(2_000_000_000_000).toISOString());
  const call = fetchImpl.calls[0];
  assert.equal(call.options.headers.Authorization, "Bearer sk-proj-session-token");
  assert.equal(call.options.headers["OpenAI-Organization"], "org-demo-1");
});

test("fetchOpenaiCreditsLimits falls back to balance-only when grants do not reconcile", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-oai-stale-"));
  writeCredentialsFile({ home, sessionBearer: "sk-proj-session-token", organization: "org-demo-1" });
  const stale = creditSummaryFixture();
  stale.grants.data[0].grant_amount = 40;
  const fetchImpl = mockFetch([{ match: "credit_grants", response: mockResponse({ json: stale }) }]);
  const result = await fetchOpenaiCreditsLimits({ home, fetchImpl });
  assert.equal(result.primary_window, null, "no invented meter total");
  assert.equal(result.openai_credits_available, 100);
});

test("fetchOpenaiCreditsLimits maps HTTP statuses to provider errors", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-oai-http-"));
  writeCredentialsFile({ home, sessionBearer: "sk-proj-session-token", organization: "org-demo-1" });
  const cases = [
    [{ match: "credit_grants", response: mockResponse({ ok: false, status: 401 }) }, /session expired|unauthorized/i],
    [{ match: "credit_grants", response: mockResponse({ ok: false, status: 403 }) }, /session expired|unauthorized/i],
    [{ match: "credit_grants", response: mockResponse({ ok: false, status: 429 }) }, /rate limited/i],
    [{ match: "credit_grants", response: mockResponse({ ok: false, status: 500 }) }, /HTTP 500/],
    [{ match: "credit_grants", response: mockResponse({ json: { object: "nope" } }) }, /credit_summary/],
  ];
  for (const [route, pattern] of cases) {
    const result = await fetchOpenaiCreditsLimits({ home, fetchImpl: mockFetch([route]) });
    assert.equal(result.configured, true);
    assert.match(result.error, pattern);
  }
});
