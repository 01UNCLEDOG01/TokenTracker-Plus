// GitHub star count with a local cache. The unauthenticated api.github.com
// budget is 60 requests/hour per IP, and a 403 (rate limit) or a network
// hiccup used to blank the Star pill count until the next successful fetch
// (owner report 2026-11-25: the count vanished right after the day's heavy
// API usage). Cache the last known count in localStorage and fall back to it
// whenever the fetch fails or the budget is exhausted; refetch at most once
// per TTL window. Both consumers (Sidebar StarPill, HeaderGithubStar) share
// this helper so the two surfaces stay in sync.

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

/**
 * Fetch the repo's star count through the cache. Returns the count to display
 * (never negative) or null when nothing is known yet. `fetchImpl` / `storage`
 * / `now` / `ttlMs` are injectable for tests.
 */
export async function fetchGithubStarsCached(
  repo,
  { fetchImpl = fetch, storage = window.localStorage, now = Date.now(), ttlMs = FRESH_TTL_MS } = {},
) {
  const cached = readCachedGithubStars(storage);
  if (cached && now - cached.fetchedAt < ttlMs) return cached.stars;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}`);
    const data = await res.json();
    if (data && typeof data.stargazers_count === "number" && data.stargazers_count >= 0) {
      writeCachedGithubStars(data.stargazers_count, now, storage);
      return data.stargazers_count;
    }
  } catch {
    /* rate limit / network — fall back to the cached count below */
  }
  return cached ? cached.stars : null;
}
