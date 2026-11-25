const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const {
  normalizeGeminiWebCookie,
  readGeminiWebCookie,
  writeGeminiWebCookie,
  clearGeminiWebCookie,
  fetchGeminiWebQuota,
} = require("../src/lib/gemini-web-quota");
const { fetchGeminiLimits } = require("../src/lib/usage-limits");

function usageBody({ fiveHour = 0.2, weekly = 0.21 } = {}) {
  const nowMs = Date.now();
  return {
    data: {
      viewer: {
        rpcs: {
          getUsageInfo: {
            subscriptionTier: "TIER1",
            pools: [
              {
                poolType: "GXU_FIVE_HOURLY",
                percentageUsed: fiveHour,
                gxu: { windowRefreshesAt: new Date(nowMs + 5 * 60 * 60 * 1000).toISOString() },
              },
              {
                poolType: "GXU_WEEKLY",
                percentageUsed: weekly,
                gxu: { windowRefreshesAt: new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString() },
              },
            ],
          },
        },
      },
    },
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => `)]}'\n${JSON.stringify(body)}`,
  };
}

describe("Gemini web cookie storage", () => {
  it("normalizes a Cookie header and rejects control characters or malformed pairs", () => {
    assert.equal(normalizeGeminiWebCookie(" SID=abc ; __Secure-1PSID=def "), "SID=abc; __Secure-1PSID=def");
    assert.equal(normalizeGeminiWebCookie("Cookie: SID=abc; NID=def"), "SID=abc; NID=def");
    assert.equal(normalizeGeminiWebCookie("SID=abc\nInjected=1"), null);
    assert.equal(normalizeGeminiWebCookie("not-a-cookie"), null);
    assert.equal(normalizeGeminiWebCookie(""), null);
  });

  it("writes, reads and clears the local cookie file without echoing it", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-web-cookie-"));
    try {
      assert.equal(writeGeminiWebCookie({ home, cookie: "SID=abc; NID=def" }).saved, true);
      assert.deepEqual(readGeminiWebCookie({ home, env: {} }), {
        cookie: "SID=abc; NID=def",
        source: "file",
        error: null,
      });
      assert.equal(clearGeminiWebCookie({ home, env: {} }).saved, true);
      assert.equal(readGeminiWebCookie({ home, env: {} }).cookie, null);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Gemini web GraphQL quota", () => {
  it("reads the five-hour and weekly pools directly from the usage endpoint", async () => {
    let seen;
    const result = await fetchGeminiWebQuota({
      cookie: "SID=abc; NID=def",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return response([usageBody()]);
      },
    });
    assert.match(seen.url, /GEMINI_WEB_GRAPHQL\/executeQuery/);
    assert.match(seen.url, /GXU_FIVE_HOURLY|GEMINI_USAGE_SETTINGS_UPGRADE_BANNER/);
    assert.equal(seen.init.headers.Cookie, "SID=abc; NID=def");
    assert.equal(seen.init.redirect, "manual");
    assert.equal(result.source, "gemini-web-graphql");
    assert.equal(result.primary_window.used_percent, 20);
    assert.equal(result.primary_window.limit_window_seconds, 18000);
    assert.equal(result.secondary_window.used_percent, 21);
    assert.equal(result.secondary_window.limit_window_seconds, 604800);
    assert.equal(result.account_plan, null);
  });

  it("preserves a reported zero instead of treating it as missing", async () => {
    const result = await fetchGeminiWebQuota({
      cookie: "SID=abc",
      fetchImpl: async () => response([usageBody({ fiveHour: 0, weekly: 0 })]),
    });
    assert.equal(result.primary_window.used_percent, 0);
    assert.equal(result.secondary_window.used_percent, 0);
  });

  it("surfaces an actionable expiry without leaking the cookie", async () => {
    await assert.rejects(
      fetchGeminiWebQuota({ cookie: "SID=super-secret", fetchImpl: async () => response({}, 401) }),
      (error) => error.code === "AUTH_EXPIRED" && !error.message.includes("super-secret"),
    );
  });

  it("prefers the configured web cookie over the Windows UIA fallback and caches it", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-web-integration-"));
    try {
      writeGeminiWebCookie({ home, cookie: "SID=abc" });
      const live = await fetchGeminiLimits({
        home,
        env: {},
        platform: "win32",
        desktopReader: async () => { throw new Error("UIA must not run when a web cookie is configured"); },
        fetchImpl: async () => response([usageBody()]),
      });
      assert.equal(live.source, "gemini-web-graphql");
      assert.equal(live.credential_source, "file");
      assert.equal(live.primary_window.used_percent, 20);

      const stale = await fetchGeminiLimits({
        home,
        env: {},
        platform: "win32",
        desktopReader: async () => { throw new Error("UIA must not run when a web cookie is configured"); },
        fetchImpl: async () => response({}, 503),
      });
      assert.equal(stale.source, "gemini-web-cache");
      assert.equal(stale.stale, true);
      assert.equal(stale.primary_window.used_percent, 20);

      const disk = JSON.parse(fs.readFileSync(path.join(home, ".tokentracker", "tracker", "gemini-usage-limits-cache.json"), "utf8"));
      assert.match(disk.gemini.identity, /^gemini-web:[a-f0-9]{64}$/);
      assert.equal(disk.gemini.identity.includes("SID=abc"), false);

      writeGeminiWebCookie({ home, cookie: "SID=switched-account" });
      const switched = await fetchGeminiLimits({
        home,
        env: {},
        platform: "win32",
        desktopReader: async () => { throw new Error("UIA must not run when a web cookie is configured"); },
        fetchImpl: async () => response({}, 503),
      });
      assert.equal(switched.source, "gemini-web-graphql");
      assert.notEqual(switched.stale, true, "a changed cookie must not inherit the previous account cache");

      const expired = await fetchGeminiLimits({
        home,
        env: {},
        platform: "win32",
        desktopReader: async () => { throw new Error("UIA must not run when a web cookie is configured"); },
        fetchImpl: async () => response({}, 401),
      });
      assert.equal(expired.auth_error, true);
      assert.match(expired.error, /session expired/i);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
