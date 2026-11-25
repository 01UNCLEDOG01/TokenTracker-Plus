// GitHub star count for the Star pill, with layered fallbacks. Order:
//   1. local server route (/api/github-stars) — one shared cache + optional
//      local token (github-stars.js on the server), so the webviews never
//      burn the anonymous api.github.com budget themselves;
//   2. direct anonymous api.github.com fetch — covers servers older than the
//      route (self-hosted backends, stale bundles);
//   3. localStorage cache — survives rate limits and offline stretches; the
//      unauthenticated budget is 60 requests/hour per IP and a 403 used to
//      blank the count until the next successful fetch (owner report
//      2026-11-25).
// Both consumers (Sidebar StarPill, HeaderGithubStar) share this helper so
// the two surfaces stay in sync.

const STORAGE_KEY = "tt:github-stars";
const FRESH_TTL_MS = 6 * 60 * 60 * 1000;

export function readCachedGithubStars(storage = window.localStorage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Number.isInteger(parsed.stars) &&
      parsed.stars >= 0 &&
      Number.isFinite(parsed.fetchedAt)
    ) {
      return { stars: parsed.stars, fetchedAt: parsed.fetchedAt };
    }
  } catch {
    /* corrupted cache — treated as absent */
  }
  return null;
}

function writeCachedGithubStars(stars, now, storage = window.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ stars, fetchedAt: now }));
  } catch {
    /* storage unavailable (private mode) — cache is best-effort */
  }
}

async function fetchServerStars(fetchImpl) {
  try {
    const res = await fetchImpl("/api/github-stars");
    const data = await res.json();
    if (data && typeof data.stars === "number" && data.stars >= 0) {
      return data.stars;
    }
  } catch {
    /* server route missing or unreachable — try the direct fetch */
  }
  return null;
}

async function fetchDirectStars(repo, fetchImpl) {
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`);
    const data = await res.json();
    if (data && typeof data.stargazers_count === "number" && data.stargazers_count >= 0) {
      return data.stargazers_count;
    }
  } catch {
    /* rate limit / network — fall back to the cached count below */
  }
  return null;
}

/**
 * Returns the star count to display (never negative) or null when nothing is
 * known yet. `fetchImpl` / `storage` / `now` / `ttlMs` are injectable for
 * tests. `serverUrl` lets tests point the server route elsewhere; pass `""`
 * to skip the server layer entirely.
 */
export async function fetchGithubStarsCached(
  repo,
  {
    fetchImpl = fetch,
    storage = window.localStorage,
    now = Date.now(),
    ttlMs = FRESH_TTL_MS,
    serverUrl = "/api/github-stars",
  } = {},
) {
  const cached = readCachedGithubStars(storage);
  if (cached && now - cached.fetchedAt < ttlMs) return cached.stars;
  let stars = serverUrl ? await fetchServerStars(fetchImpl) : null;
  if (stars === null) stars = await fetchDirectStars(repo, fetchImpl);
  if (stars === null) return cached ? cached.stars : null;
  writeCachedGithubStars(stars, now, storage);
  return stars;
}
