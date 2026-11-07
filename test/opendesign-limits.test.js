const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  OPENDESIGN_API,
  credentialsPath,
  normalizeOpendesignCookieHeader,
  readCookie,
  writeCookieFile,
  parseOpendesignUsage,
  planLabel,
  fetchOpendesignLimits,
} = require("../src/lib/opendesign-limits");

const COOKIE = "session=workspace-session; other=value";

function home() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "opendesign-test-"));
}

const WORKSPACE = { workspaceId: "workspace-a", workspaceName: "Design Studio", personalMembershipTier: "pro" };
// Synthetic contract fixtures, not a captured account.
const usage = () => ({
  workspaceId: "workspace-a",
  eligible: true,
  tier: "pro",
  windows: [
    { durationSeconds: 604800, usedCredits: "25", limitCredits: "100", resetsAt: "2026-11-09T00:00:00Z" },
    { durationSeconds: 18000, usedCredits: 0, limitCredits: 20 },
  ],
});

function deps(body = usage(), first = WORKSPACE, { cookie = COOKIE, status } = {}) {
  const calls = [];
  const h = home();
  if (cookie) {
    const saved = writeCookieFile({ home: h, cookie });
    assert.deepEqual(saved, { saved: true });
  }
  return {
    home: h,
    env: {},
    nowMs: Date.parse("2026-11-07T00:00:00Z"),
    calls,
    fetchImpl: async (url) => {
      calls.push(url);
      if (status) {
        const error = new Error(`HTTP ${status}`);
        error.statusCode = status;
        throw error;
      }
      return {
        ok: true,
        status: 200,
        json: async () => structuredClone(url.endsWith("/current") ? first : body),
      };
    },
  };
}

test("OpenDesign cookie normalization accepts opaque headers and rejects malformed input", () => {
  assert.equal(normalizeOpendesignCookieHeader("Cookie: a=one; b=two=="), "a=one; b=two==");
  assert.equal(normalizeOpendesignCookieHeader("a=x; b=y"), "a=x; b=y");
  for (const value of ["bare-token", "a=x\r\nb=y", "curl https://example.com", "a=x; invalid", 123, "", "   "]) {
    assert.equal(normalizeOpendesignCookieHeader(value), "", JSON.stringify(value));
  }
  // Repeated cookie names pass through (parent-path + workspace-path scoping).
  const repeated = "session=parent; session=workspace; other=v";
  assert.equal(normalizeOpendesignCookieHeader(repeated), repeated);
});

test("OpenDesign unconfigured vs unavailable: no cookie = configured:false, bad cookie = error", async () => {
  const none = await fetchOpendesignLimits({ home: home(), env: {} });
  assert.deepEqual(none, { configured: false, error: null });

  const bad = await fetchOpendesignLimits({
    home: home(),
    env: { OPENDESIGN_COOKIE: "not a cookie list" },
    fetchImpl: async () => { throw new Error("network must not be touched"); },
  });
  assert.equal(bad.configured, true);
  assert.match(bad.error, /not a valid Cookie header/i);
});

test("OpenDesign discovers workspace, selects windows by duration, maps to our shape", async () => {
  const d = deps();
  const result = await fetchOpendesignLimits(d);
  assert.equal(result.configured, true);
  assert.equal(result.error, undefined);
  assert.equal(result.workspace_id, "workspace-a");
  assert.equal(result.plan_name, "Pro");
  assert.deepEqual(d.calls, [
    OPENDESIGN_API + "current",
    OPENDESIGN_API + "workspace-a/billing/coding-plan-usage",
  ]);
  // 5h window: measured zero stays zero (used 0 / limit 20).
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.limit_window_seconds, 18000);
  assert.equal(result.primary_window.reset_at, null);
  // Weekly window: string credits are numbers, reset parses to ISO.
  assert.equal(result.secondary_window.used_percent, 25);
  assert.equal(result.secondary_window.reset_at, "2026-11-09T00:00:00.000Z");
  assert.equal(result.secondary_window.limit_window_seconds, 604800);
  // Allowance units exposed for the panel; not a currency balance.
  assert.deepEqual(result.opendesign_weekly_window, { used: 25, limit: 100, remaining: 75 });
});

test("OpenDesign rejects wrong-type, partial and malformed quota responses", async () => {
  const cases = [
    null, [], {},
    { ...usage(), eligible: false },
    { ...usage(), eligible: "true" },
    { ...usage(), windows: [] },
    { ...usage(), windows: [{ durationSeconds: 42, usedCredits: 0, limitCredits: 100 }] },
    // Missing workspaceId entirely.
    { eligible: true, tier: "pro", windows: usage().windows },
  ];
  for (const field of ["usedCredits", "limitCredits"]) {
    for (const value of [null, undefined, true, [], {}, "", "NaN", -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const body = usage();
      body.windows[0][field] = value;
      cases.push(body);
    }
  }
  const duplicate = usage();
  duplicate.windows.push(duplicate.windows[0]);
  cases.push(duplicate);
  const zeroLimit = usage();
  zeroLimit.windows[0].limitCredits = 0;
  cases.push(zeroLimit);
  for (const body of cases) {
    // The workspace lookup itself succeeds (a valid id is served); only the
    // usage payload is malformed, so the "current" response must match any
    // workspaceId the body claims.
    const first = body && typeof body === "object" && !Array.isArray(body) && typeof body.workspaceId === "string" && body.workspaceId
      ? { ...WORKSPACE, workspaceId: body.workspaceId }
      : WORKSPACE;
    const d = deps(body, first);
    const result = await fetchOpendesignLimits(d);
    assert.equal(result.configured, true);
    assert.ok(result.error, JSON.stringify(body));
    assert.equal(result.primary_window, undefined);
  }
  // A usage payload that answers a different workspace than the one we
  // asked about must not be trusted either.
  const mismatched = deps(
    { ...usage(), workspaceId: "workspace-b" },
    WORKSPACE,
  );
  const mismatchResult = await fetchOpendesignLimits(mismatched);
  assert.match(mismatchResult.error, /malformed/i);
});

test("OpenDesign does not invent reset dates", async () => {
  const body = usage();
  body.windows[0].resetsAt = "not-a-date";
  const d = deps(body);
  const result = await fetchOpendesignLimits(d);
  assert.equal(result.secondary_window.reset_at, null);
});

test("OpenDesign credential file round-trip: write 0600, read back, env fallback", async () => {
  const h = home();
  const result = writeCookieFile({ home: h, cookie: `Cookie: ${COOKIE}` });
  assert.deepEqual(result, { saved: true });
  const stored = JSON.parse(fs.readFileSync(credentialsPath(h), "utf8"));
  assert.equal(stored.cookie, COOKIE);
  const read = readCookie(h, {});
  assert.deepEqual(read, { cookie: COOKIE, source: "file" });
  // POSIX only: Windows ignores the mode bits and reports 666.
  if (process.platform !== "win32") {
    const mode = fs.statSync(credentialsPath(h)).mode & 0o777;
    assert.ok((mode & 0o077) === 0, `file mode ${mode.toString(8)} must not be group/world readable`);
  }

  // Malformed values never reach the disk.
  assert.deepEqual(writeCookieFile({ home: home(), cookie: "bare-token" }), { saved: false, error: "invalid_cookie" });

  // Env fallback when no file exists.
  const envRead = readCookie(home(), { TOKENTRACKER_OPENDESIGN_COOKIE: COOKIE });
  assert.deepEqual(envRead, { cookie: COOKIE, source: "env" });
  assert.deepEqual(readCookie(home(), {}), { cookie: "", source: null });
});

test("OpenDesign HTTP failure classification: 401 vs other, no network hang", async () => {
  const unauthorized = await fetchOpendesignLimits(deps(usage(), WORKSPACE, { status: 401 }));
  assert.match(unauthorized.error, /expired or unauthorized/i);

  const serverError = await fetchOpendesignLimits(deps(usage(), WORKSPACE, { status: 500 }));
  assert.match(serverError.error, /HTTP 500/);

  const rateLimited = await fetchOpendesignLimits(deps(usage(), WORKSPACE, { status: 429 }));
  assert.match(rateLimited.error, /HTTP 429/);
});

test("OpenDesign plan label combines distinct tiers, dedupes case", () => {
  assert.equal(planLabel("pro", "pro"), "Pro");
  assert.equal(planLabel("max", ""), "Max");
  assert.equal(planLabel("", "ultra"), "Ultra");
  assert.equal(planLabel("pro", "team"), "Pro Team");
  assert.equal(planLabel("", ""), null);
});
