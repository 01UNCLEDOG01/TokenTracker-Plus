'use strict';
// Server-side GitHub star fetch (src/lib/github-stars.js): optional local
// token raises the api.github.com budget, a shared cache serves every webview
// surface through one request per TTL window, and failures serve the last
// known count instead of blanking the pill.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  fetchGithubStarsServer,
  resetGithubStarsCacheForTest,
  readLocalToken,
  tokenFilePath,
  REPO_SLUG,
} = require('../src/lib/github-stars');

function makeHarness() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-ghstars-'));
  fs.mkdirSync(path.join(home, '.tokentracker'), { recursive: true });
  const env = {};
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, headers: options?.headers || {} });
    return {
      json: async () => ({ stargazers_count: 123 }),
    };
  };
  return {
    home,
    env,
    calls,
    fetchImpl,
    cleanup() {
      fs.rmSync(home, { recursive: true, maxRetries: 3 });
    },
  };
}

test('anonymous fetch when no token exists: no Authorization header, response cached', async () => {
  resetGithubStarsCacheForTest();
  const t = makeHarness();
  try {
    const info = await fetchGithubStarsServer({ fetchImpl: t.fetchImpl, now: 1_000, home: t.home, env: t.env });
    assert.equal(info.stars, 123);
    assert.equal(info.source, 'anonymous');
    assert.equal(info.cached, false);
    assert.equal(t.calls[0].url, `https://api.github.com/repos/${REPO_SLUG}`);
    assert.equal(t.calls[0].headers.Authorization, undefined);
    // TTL window: second call serves the cache without a network hit.
    const info2 = await fetchGithubStarsServer({ fetchImpl: t.fetchImpl, now: 2_000, home: t.home, env: t.env });
    assert.equal(info2.cached, true);
    assert.equal(t.calls.length, 1);
  } finally {
    t.cleanup();
  }
});

test('token file raises an Authorization header and marks the source', async () => {
  resetGithubStarsCacheForTest();
  const t = makeHarness();
  try {
    fs.writeFileSync(path.join(t.home, '.tokentracker', 'github-token'), 'ghp_test_token_123\n', 'utf8');
    const info = await fetchGithubStarsServer({ fetchImpl: t.fetchImpl, now: 1_000, home: t.home, env: t.env });
    assert.equal(info.source, 'token');
    assert.equal(t.calls[0].headers.Authorization, 'Bearer ghp_test_token_123');
  } finally {
    t.cleanup();
  }
});

test('TOKENTRACKER_GITHUB_TOKEN env takes precedence and wins over the file', async () => {
  resetGithubStarsCacheForTest();
  const t = makeHarness();
  try {
    fs.writeFileSync(path.join(t.home, '.tokentracker', 'github-token'), 'file-token', 'utf8');
    t.env.TOKENTRACKER_GITHUB_TOKEN = 'env-token';
    assert.equal(readLocalToken(t.home, t.env), 'env-token');
    assert.equal(readLocalToken(t.home, {}), 'file-token');
    assert.equal(readLocalToken(t.home, {}), 'file-token', 'second read stays consistent');
    assert.equal(tokenFilePath(t.home), path.join(t.home, '.tokentracker', 'github-token'));
  } finally {
    t.cleanup();
  }
});

test('failed fetch serves the last known count marked stale', async () => {
  resetGithubStarsCacheForTest();
  const t = makeHarness();
  try {
    const failing = async () => {
      throw new TypeError('rate limited');
    };
    await fetchGithubStarsServer({ fetchImpl: t.fetchImpl, now: 1_000, home: t.home, env: t.env });
    const stale = await fetchGithubStarsServer({
      fetchImpl: failing,
      now: 7 * 60 * 60 * 1000,
      ttlMs: 6 * 60 * 60 * 1000,
      home: t.home,
      env: t.env,
    });
    assert.equal(stale.stars, 123);
    assert.equal(stale.stale, true);
    // Nothing cached at all + failing fetch → null (route answers "unavailable").
    resetGithubStarsCacheForTest();
    const none = await fetchGithubStarsServer({ fetchImpl: failing, now: 1_000, home: t.home, env: t.env });
    assert.equal(none, null);
  } finally {
    t.cleanup();
  }
});

test('empty token file behaves as anonymous (no bogus Authorization header)', async () => {
  resetGithubStarsCacheForTest();
  const t = makeHarness();
  try {
    fs.writeFileSync(path.join(t.home, '.tokentracker', 'github-token'), '   \n', 'utf8');
    const info = await fetchGithubStarsServer({ fetchImpl: t.fetchImpl, now: 1_000, home: t.home, env: t.env });
    assert.equal(info.source, 'anonymous');
    assert.equal(t.calls[0].headers.Authorization, undefined);
  } finally {
    t.cleanup();
  }
});
