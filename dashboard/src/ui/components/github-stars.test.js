import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGithubStarsCached, readCachedGithubStars } from "./github-stars.js";

const REPO = "01UNCLEDOG01/TokenTracker-Plus";

// Each test gets an isolated Map-backed storage, passed explicitly to the
// helper so the jsdom-global localStorage is never involved.
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe("fetchGithubStarsCached", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the fresh cached count without touching the network", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn();
    const now = 1_000_000;
    storage.setItem("tt:github-stars", JSON.stringify({ stars: 42, fetchedAt: now - 1000 }));
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now });
    expect(stars).toBe(42);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches when no cache exists and writes the result", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ stargazers_count: 7 }) }));
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 5_000 });
    expect(stars).toBe(7);
    expect(readCachedGithubStars(storage)).toEqual({ stars: 7, fetchedAt: 5_000 });
  });

  it("falls back to the cached count when the fetch rejects (rate limit / offline)", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    storage.setItem("tt:github-stars", JSON.stringify({ stars: 42, fetchedAt: 1_000_000 }));
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 9_000_000 });
    expect(stars).toBe(42);
  });

  it("falls back to the cached count on a rate-limit body without stargazers_count", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ message: "API rate limit exceeded" }) }));
    storage.setItem("tt:github-stars", JSON.stringify({ stars: 42, fetchedAt: 1_000_000 }));
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 9_000_000 });
    expect(stars).toBe(42);
  });

  it("refetches once the cache is older than the TTL and updates it", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => ({ json: async () => ({ stargazers_count: 99 }) }));
    storage.setItem("tt:github-stars", JSON.stringify({ stars: 42, fetchedAt: 0 }));
    const ttl = 6 * 60 * 60 * 1000;
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: ttl + 1, ttlMs: ttl });
    expect(stars).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCachedGithubStars(storage).stars).toBe(99);
  });

  it("returns null when nothing is cached and the fetch fails", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 1 });
    expect(stars).toBeNull();
  });
});
