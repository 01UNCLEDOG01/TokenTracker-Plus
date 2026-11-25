// Server-side GitHub star fetch with an optional local token + a shared cache.
//
// The dashboard's Star pill used to call api.github.com anonymously from the
// webview: the unauthenticated budget is 60 requests/hour per IP (shared by
// everything unauthenticated from this machine), and once exhausted the count
// blanked out. All star reads now flow through this module on the local
// server instead:
//   - one cached request per TTL window for every webview surface combined;
//   - dropping a fine-grained token with public-repo read access into
//     ~/.tokentracker/github-token (or setting TOKENTRACKER_GITHUB_TOKEN)
//     raises the budget to 5,000 requests/hour under the token's account —
//     the token is read from local files only, never leaves this process and
//     is never included in the API response;
//   - a failed or rate-limited fetch serves the last known count instead of
//     blanking out.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO_SLUG = "01UNCLEDOG01/TokenTracker-Plus";
const FRESH_TTL_MS = 6 * 60 * 60 * 1000;

let memoryCache = null; // { stars, fetchedAt, source }

function tokenFilePath(home = os.homedir()) {
  return path.join(home, ".tokentracker", "github-token");
}

// File takes precedence, environment variable is the portable fallback.
// Re-read on every call — the route is TTL-gated, so this runs at most once
// per window and always honors an edited token file immediately.
function readLocalToken(home = os.homedir(), env = process.env) {
  const fromEnv = String(env.TOKENTRACKER_GITHUB_TOKEN || "").trim();
  if (fromEnv) return fromEnv;
  try {
    return fs.readFileSync(tokenFilePath(home), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function resetGithubStarsCacheForTest() {
  memoryCache = null;
}

/**
 * Returns { stars, fetchedAt, source, cached, stale } — or null when nothing
 * is known yet. `source` is "token" | "anonymous" | "cache". fetchImpl /
 * now / ttlMs / home / env are injectable for tests.
 */
async function fetchGithubStarsServer({
  fetchImpl = fetch,
  now = Date.now(),
  ttlMs = FRESH_TTL_MS,
  home = os.homedir(),
  env = process.env,
} = {}) {
  if (memoryCache && Number.isFinite(memoryCache.stars) && now - memoryCache.fetchedAt < ttlMs) {
    return { ...memoryCache, cached: true, stale: false };
  }
  const token = readLocalToken(home, env);
  const headers = {
    "User-Agent": "tokentracker-plus",
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${REPO_SLUG}`, { headers });
    const data = await res.json();
    if (data && typeof data.stargazers_count === "number" && data.stargazers_count >= 0) {
      memoryCache = {
        stars: data.stargazers_count,
        fetchedAt: now,
        source: token ? "token" : "anonymous",
      };
      return { ...memoryCache, cached: false, stale: false };
    }
  } catch {
    /* rate limit / network — serve the last known count below */
  }
  if (memoryCache) return { ...memoryCache, cached: true, stale: true };
  return null;
}

module.exports = {
  REPO_SLUG,
  FRESH_TTL_MS,
  tokenFilePath,
  readLocalToken,
  fetchGithubStarsServer,
  resetGithubStarsCacheForTest,
};
