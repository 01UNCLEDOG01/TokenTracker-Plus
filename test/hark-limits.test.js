const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, after } = require("node:test");
const {
  HARK_COOKIE_NAME,
  HARK_SUMMARY_URL,
  credentialsPath,
  normalizeHarkSessionToken,
  readCookie,
  writeCookieFile,
  clearCookieFile,
  harkDesktopCookieCandidates,
  readBinaryCookies,
  readHarkDesktopSession,
  parseHarkSummary,
  fetchHarkLimits,
} = require("../src/lib/hark-limits");

const TOKEN = "AiR0sEsh3tUqREjdg0dsF7c0dZ0bXxrE6VX8a3jvq4o.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789abcd";
// Reserved characters that percent-encoding actually rewrites (+ and /), so
// the encoded-spelling assertions cannot pass trivially.
const TOKEN_RESERVED = "AiR0sEsh3tUqREjdg0dsF7c0dZ0bXxrE6VX8a3jvq4o.aBcD+Ef/GhJkLmNoPqRsTuVwXyZ0123456789ab";

// Isolate the store: getTrackerRootDir prefers TOKENTRACKER_HOME, so a dev
// shell exporting it would otherwise receive synthetic tokens from this file.
const savedTrackerHome = process.env.TOKENTRACKER_HOME;
delete process.env.TOKENTRACKER_HOME;
const tempDirs = [];
after(() => {
  if (savedTrackerHome !== undefined) process.env.TOKENTRACKER_HOME = savedTrackerHome;
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { }
  }
});

// Synthetic contract fixtures, not a captured account. The free-plan shape is
// upstream-verified; the paid-plan fields (perFeature, unlimited, autoTopup)
// follow the client reconstruction upstream documented in TM #1431.
function summary() {
  return {
    plan: { id: "scale", name: "Hark Pro³", unlimited: false },
    meters: {
      harkTokens: {
        dailyUsed: 3000,
        dailyLimit: 10000,
        dailyResetsAt: "2026-11-14T00:00:00Z",
        poolUsed: "50000",
        poolLimit: 400000,
        poolResetsAt: 1767225600000,
      },
      perFeature: [
        { feature: "message", period: "day", countUsed: 12, countLimit: 100, harkUsed: 1500, harkLimit: 5000, resetsAt: "2026-11-14T00:00:00Z" },
        { feature: "web", period: "month", meter: "instances", countUsed: 1, countLimit: 50 },
        { feature: "search", period: "week", countUsed: 1, countLimit: 10 },
      ],
    },
    autoTopup: { enabled: true, spentThisPeriodMinor: 250 },
  };
}

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hark-test-"));
  tempDirs.push(dir);
  return dir;
}

function deps({
  body = summary(),
  status = 200,
  ok = true,
  cookie = TOKEN,
  env = {},
  desktopSession = { status: "unsupported", value: "" },
  reject,
} = {}) {
  const calls = [];
  const h = home();
  if (cookie) {
    const saved = writeCookieFile({ home: h, cookie });
    assert.deepEqual(saved, { saved: true });
  }
  return {
    home: h,
    env,
    nowMs: Date.parse("2026-11-13T00:00:00Z"),
    desktopSession,
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (reject) throw reject;
      if (!ok || status !== 200) {
        return { ok: false, status, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => structuredClone(body) };
    },
  };
}

test("hark token normalization accepts bare, Cookie-header and encoded spellings, rejects junk", () => {
  // Bare token round-trips unchanged.
  assert.equal(normalizeHarkSessionToken(TOKEN), TOKEN);
  // "Cookie: " prefix and full header form extract the session token.
  assert.equal(normalizeHarkSessionToken(`Cookie: ${HARK_COOKIE_NAME}=${TOKEN}`), TOKEN);
  assert.equal(
    normalizeHarkSessionToken(`__Secure-hark.session_token=${TOKEN}; other=1`),
    TOKEN,
  );
  // A header with other cookies but no session token is rejected.
  assert.equal(normalizeHarkSessionToken("a=1; b=2"), "");
  // Percent-encoded spelling validates on the decoded value but keeps the
  // accepted spelling for the request (WebKit encodes the signature).
  const encoded = encodeURIComponent(TOKEN_RESERVED);
  assert.notEqual(encoded, TOKEN_RESERVED, "fixture must actually be encoded");
  assert.equal(normalizeHarkSessionToken(encoded), encoded);
  // Control characters, semicolons in a bare value and wrong shapes are out.
  assert.equal(normalizeHarkSessionToken("bad token\nvalue"), "");
  assert.equal(normalizeHarkSessionToken("short.frag"), "");
  assert.equal(normalizeHarkSessionToken(""), "");
});

test("hark writeCookieFile stores 0600 and rejects invalid tokens", () => {
  const h = home();
  assert.deepEqual(writeCookieFile({ home: h, cookie: "not a token" }), {
    saved: false,
    error: "invalid_cookie",
  });
  assert.deepEqual(writeCookieFile({ home: h, cookie: TOKEN }), { saved: true });
  const raw = fs.readFileSync(credentialsPath(h), "utf8");
  assert.deepEqual(JSON.parse(raw), { cookie: TOKEN });
  assert.equal(fs.statSync(credentialsPath(h)).mode & 0o777, 0o600);
});

test("hark readCookie precedence: file wins over env, invalid never falls through", () => {
  const h = home();
  // Nothing saved anywhere.
  assert.deepEqual(readCookie(h, {}), { cookie: "", source: null });
  // Env fallback works (either spelling of the variable).
  assert.deepEqual(readCookie(h, { TOKENTRACKER_HARK_COOKIE: TOKEN }), { cookie: TOKEN, source: "env" });
  assert.deepEqual(readCookie(h, { HARK_COOKIE: TOKEN }), { cookie: TOKEN, source: "env" });
  // An invalid env value is "configured but broken", not a silent miss.
  assert.deepEqual(readCookie(h, { HARK_COOKIE: "junk" }), { cookie: "", source: "env-invalid" });
  // A saved file wins over env.
  writeCookieFile({ home: h, cookie: TOKEN });
  assert.deepEqual(readCookie(h, { HARK_COOKIE: "junk" }), { cookie: TOKEN, source: "file" });
});

// Synthetic binarycookies bytes with the record layout TM verified against a
// real signed-in Hark.app store (48-byte record header, strings at 16/20/24/28).
function cookieRecord({ name, value, domain, path = "/" }) {
  const header = 48;
  const urlOffset = header;
  const nameOffset = urlOffset + Buffer.byteLength(domain) + 1;
  const pathOffset = nameOffset + Buffer.byteLength(name) + 1;
  const valueOffset = pathOffset + Buffer.byteLength(path) + 1;
  const end = valueOffset + Buffer.byteLength(value) + 1;
  const record = Buffer.alloc(end);
  record.writeUInt32LE(end, 0);
  record.writeUInt32LE(urlOffset, 16);
  record.writeUInt32LE(nameOffset, 20);
  record.writeUInt32LE(pathOffset, 24);
  record.writeUInt32LE(valueOffset, 28);
  record.write(domain, urlOffset);
  record.write(name, nameOffset);
  record.write(path, pathOffset);
  record.write(value, valueOffset);
  return record;
}

function cookiePage(records) {
  const encoded = records.map(cookieRecord);
  const table = 8 + encoded.length * 4;
  let cursor = table;
  const offsets = encoded.map((record) => {
    const at = cursor;
    cursor += record.length;
    return at;
  });
  const page = Buffer.alloc(cursor);
  page.writeUInt32BE(0x00000100, 0);
  page.writeUInt32LE(encoded.length, 4);
  offsets.forEach((at, index) => page.writeUInt32LE(at, 8 + index * 4));
  encoded.forEach((record, index) => record.copy(page, offsets[index]));
  return page;
}

function cookBuffer(records) {
  const page = cookiePage(records);
  const header = Buffer.alloc(12);
  header.write("cook", 0, "ascii");
  header.writeUInt32BE(1, 4);
  header.writeUInt32BE(page.length, 8);
  return Buffer.concat([header, page]);
}

test("hark binarycookies parser reads the desktop store and reports unreadable shapes", () => {
  const buffer = cookBuffer([
    { domain: "hark.com", name: HARK_COOKIE_NAME, value: TOKEN },
    { domain: ".hark.com", name: "other", value: "x" },
  ]);
  const cookies = readBinaryCookies(buffer);
  const session = cookies.find((c) => c.name === HARK_COOKIE_NAME);
  assert.equal(session.value, TOKEN);
  // Bad magic / truncated stores throw (caller maps to "unreadable").
  assert.throws(() => readBinaryCookies(Buffer.from("nope")));
  assert.throws(() => readBinaryCookies(buffer.subarray(0, 10)));
});

test("hark desktop discovery: darwin-only, missing vs unreadable vs found", () => {
  // Non-darwin has no desktop discovery.
  assert.deepEqual(harkDesktopCookieCandidates({ platform: "win32" }), []);
  assert.equal(
    readHarkDesktopSession({ candidates: [], platform: "win32" }).status,
    "unsupported",
  );
  // Missing store → signed out (not an error).
  const missing = readHarkDesktopSession({
    candidates: [path.join(home(), "absent.binarycookies")],
  });
  assert.equal(missing.status, "missing");
  // Unreadable store → distinct status.
  const dir = home();
  const store = path.join(dir, "com.harklabs.hark.mac.binarycookies");
  fs.writeFileSync(store, "junk-not-a-cook-store");
  assert.equal(readHarkDesktopSession({ candidates: [store] }).status, "unreadable");
  // A real store with the session cookie → ok with the raw value.
  fs.writeFileSync(store, cookBuffer([{ domain: "hark.com", name: HARK_COOKIE_NAME, value: TOKEN }]));
  const found = readHarkDesktopSession({ candidates: [store] });
  assert.equal(found.status, "ok");
  assert.equal(found.value, TOKEN);
  // A store without the session cookie reads as signed out.
  fs.writeFileSync(store, cookBuffer([{ domain: "hark.com", name: "other", value: "x" }]));
  assert.equal(readHarkDesktopSession({ candidates: [store] }).status, "missing");
});

test("hark summary parsing maps daily/monthly pools, feature rows and top-up", () => {
  const parsed = parseHarkSummary(summary());
  assert.equal(parsed.planLabel, "Hark Pro 3");
  assert.equal(parsed.primary_window.limit, 10000);
  assert.equal(parsed.primary_window.used, 3000);
  assert.equal(parsed.primary_window.used_percent, 30);
  assert.equal(parsed.primary_window.limit_window_seconds, 86400);
  assert.equal(parsed.primary_window.reset_at, "2026-11-14T00:00:00.000Z");
  // Numeric epoch-ms reset timestamps normalize to ISO.
  assert.equal(parsed.secondary_window.reset_at, new Date(1767225600000).toISOString());
  // The instances meter and the week-period row are not allowances.
  assert.deepEqual(
    parsed.feature_windows.map((w) => w.label),
    ["Daily Messages", "Daily Messages tokens"],
  );
  assert.equal(parsed.feature_windows[0].limit, 100);
  assert.equal(parsed.feature_windows[1].limit, 5000);
  // Enabled auto top-up with positive minor units → USD amount.
  assert.equal(parsed.hark_topup, 2.5);
});

test("hark summary: unlimited plan drops meters but keeps the plan label", () => {
  const parsed = parseHarkSummary({
    plan: { id: "pro4", name: "Hark Pro⁴", unlimited: true },
    meters: {},
    autoTopup: { enabled: false, spentThisPeriodMinor: 0 },
  });
  assert.equal(parsed.planLabel, "Hark Pro 4");
  assert.equal(parsed.primary_window, null);
  assert.equal(parsed.secondary_window, null);
  assert.deepEqual(parsed.feature_windows, []);
  assert.equal(parsed.hark_topup, null);
});

test("hark summary: changed shapes are malformed, not partially rendered", () => {
  // Missing plan/meters entirely.
  assert.deepEqual(parseHarkSummary({}), { malformed: true });
  // Non-unlimited plan without a daily or pool ceiling.
  assert.deepEqual(
    parseHarkSummary({ plan: { id: "free", unlimited: false }, meters: {} }),
    { malformed: true },
  );
  // Negative used against a real ceiling.
  const bad = summary();
  bad.meters.harkTokens.dailyUsed = -5;
  assert.deepEqual(parseHarkSummary(bad), { malformed: true });
  // Zero-limit feature rows are dropped, not fatal.
  const zeroRow = summary();
  zeroRow.meters.perFeature = [{ feature: "message", period: "day", countUsed: 0, countLimit: 0 }];
  const parsedZero = parseHarkSummary(zeroRow);
  assert.deepEqual(parsedZero.feature_windows, []);
  // Disabled or zero top-up stays null; enabled-with-zero too.
  const noTopup = summary();
  noTopup.autoTopup = { enabled: false, spentThisPeriodMinor: 500 };
  assert.equal(parseHarkSummary(noTopup).hark_topup, null);
  noTopup.autoTopup = { enabled: true, spentThisPeriodMinor: 0 };
  assert.equal(parseHarkSummary(noTopup).hark_topup, null);
});

test("hark fetch: nothing configured stays not-configured on any platform", async () => {
  const d = deps({ cookie: "" });
  const result = await fetchHarkLimits(d);
  assert.equal(result.configured, false);
  assert.equal(result.error, null);
  assert.deepEqual(d.calls, []);
});

test("hark fetch: saved cookie wins over the desktop session and drives the request", async () => {
  const d = deps({
    desktopSession: { status: "ok", value: "desktop.token.value.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb" },
  });
  const result = await fetchHarkLimits(d);
  assert.equal(result.configured, true);
  assert.equal(result.error, null);
  assert.equal(d.calls.length, 1);
  assert.equal(d.calls[0].url, HARK_SUMMARY_URL);
  // The request forwards the accepted spelling in a single session cookie.
  assert.equal(d.calls[0].options.headers.Cookie, `${HARK_COOKIE_NAME}=${TOKEN}`);
  assert.equal(d.calls[0].options.credentials, "omit");
  assert.equal(result.plan_name, "Hark Pro 3");
  assert.equal(result.source, "cookie-file");
  assert.equal(result.primary_window.limit, 10000);
  assert.equal(result.hark_topup, 2.5);
});

test("hark fetch: env cookie wins over desktop; desktop session fills in when nothing is saved", async () => {
  const envCall = deps({
    cookie: "",
    env: { HARK_COOKIE: TOKEN },
    desktopSession: { status: "ok", value: "unused" },
  });
  const envResult = await fetchHarkLimits(envCall);
  assert.equal(envResult.source, "env-cookie");

  const desktopCall = deps({
    cookie: "",
    desktopSession: { status: "ok", value: TOKEN },
  });
  const desktopResult = await fetchHarkLimits(desktopCall);
  assert.equal(desktopResult.source, "desktop-session");
  assert.equal(desktopCall.calls.length, 1);
  // A percent-encoded desktop value is forwarded in its accepted spelling.
  const encodedCall = deps({
    cookie: "",
    desktopSession: { status: "ok", value: encodeURIComponent(TOKEN_RESERVED) },
  });
  await fetchHarkLimits(encodedCall);
  assert.equal(
    encodedCall.calls[0].options.headers.Cookie,
    `${HARK_COOKIE_NAME}=${encodeURIComponent(TOKEN_RESERVED)}`,
  );
  // An unreadable desktop store is an error, not a silent not-configured.
  const badCall = deps({ cookie: "", desktopSession: { status: "unreadable", value: "" } });
  const badResult = await fetchHarkLimits(badCall);
  assert.equal(badResult.configured, true);
  assert.equal(badResult.error, "Hark cookie store could not be read");
  assert.deepEqual(badCall.calls, []);
});

test("hark fetch: a corrupt credentials file is an error, not a fallback", async () => {
  const h = home();
  fs.mkdirSync(path.dirname(credentialsPath(h)), { recursive: true });
  fs.writeFileSync(credentialsPath(h), '{"cookie": "trunc');
  const d = {
    home: h,
    env: {},
    nowMs: 0,
    desktopSession: { status: "ok", value: TOKEN },
    calls: [],
    fetchImpl: async (url, options) => {
      d.calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({}) };
    },
  };
  const result = await fetchHarkLimits(d);
  assert.equal(result.configured, true);
  assert.equal(result.error, "Hark credentials file could not be read");
  // The unreadable saved value must not silently fall through to desktop.
  assert.deepEqual(d.calls, []);
  // readCookie reports the same distinction directly.
  assert.deepEqual(readCookie(h, {}), { cookie: "", source: "file-unreadable" });
  // Clearing restores discovery: no cookie, and the file is gone.
  assert.deepEqual(clearCookieFile({ home: h }), { saved: true, cleared: true });
  assert.deepEqual(readCookie(h, {}), { cookie: "", source: null });
});

test("hark fetch: an invalid saved value surfaces an error instead of falling through", async () => {
  const h = home();
  fs.mkdirSync(path.dirname(credentialsPath(h)), { recursive: true });
  fs.writeFileSync(credentialsPath(h), JSON.stringify({ cookie: "junk" }));
  const d = {
    home: h,
    env: {},
    nowMs: 0,
    desktopSession: { status: "ok", value: TOKEN },
    calls: [],
    fetchImpl: async (url) => {
      d.calls.push(url);
      return { ok: true, status: 200, json: async () => ({}) };
    },
  };
  const result = await fetchHarkLimits(d);
  assert.equal(result.configured, true);
  assert.match(result.error, /not a valid session token/);
  assert.deepEqual(d.calls, []);
});

test("hark fetch maps HTTP and transport failures to honest errors", async () => {
  const unauthorized = await fetchHarkLimits(deps({ ok: false, status: 401 }));
  assert.equal(unauthorized.error, "Hark session expired or unauthorized");
  const forbidden = await fetchHarkLimits(deps({ ok: false, status: 403 }));
  assert.equal(forbidden.error, "Hark session expired or unauthorized");
  const limited = await fetchHarkLimits(deps({ ok: false, status: 429 }));
  assert.equal(limited.error, "Hark quota fetch rate limited");
  const serverError = await fetchHarkLimits(deps({ ok: false, status: 500 }));
  assert.match(serverError.error, /HTTP 500/);
  const timedOut = await fetchHarkLimits(deps({ reject: Object.assign(new Error("aborted"), { name: "TimeoutError" }) }));
  assert.equal(timedOut.error, "Hark quota fetch timed out");
  const failed = await fetchHarkLimits(deps({ reject: new Error("ECONNRESET") }));
  assert.match(failed.error, /ECONNRESET/);
  // A 200 with a changed shape is malformed, not silently empty.
  const malformed = await fetchHarkLimits(deps({ body: { unexpected: true } }));
  assert.equal(malformed.error, "Hark billing summary is malformed or lacks quota windows");
  // A 200 whose body is not JSON at all is its own error, not a crash.
  const notJson = await fetchHarkLimits({
    home: (() => { const h = home(); writeCookieFile({ home: h, cookie: TOKEN }); return h; })(),
    env: {},
    nowMs: 0,
    desktopSession: { status: "unsupported", value: "" },
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } }),
  });
  assert.equal(notJson.error, "Hark billing summary returned malformed JSON");
});
