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

  it("prefers the local server route and caches its result", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe("/api/github-stars");
      return { json: async () => ({ stars: 7, fetchedAt: 5_000, source: "token" }) };
    });
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 5_000 });
    expect(stars).toBe(7);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(readCachedGithubStars(storage).stars).toBe(7);
  });

  it("falls back to the direct anonymous fetch when the server route fails", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async (url) => {
      if (url === "/api/github-stars") throw new TypeError("server unreachable");
      expect(url).toBe(`https://api.github.com/repos/${REPO}`);
      return { json: async () => ({ stargazers_count: 8 }) };
    });
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 5_000 });
    expect(stars).toBe(8);
  });

  it("falls back to the cached count when both layers fail", async () => {
    const storage = makeStorage();
    storage.setItem("tt:github-stars", JSON.stringify({ stars: 42, fetchedAt: 1_000_000 }));
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 9_000_000 });
    expect(stars).toBe(42);
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

  it("returns null when nothing is cached and every layer fails", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 1 });
    expect(stars).toBeNull();
  });

  it("serverUrl=\"\" skips the server layer (older backends)", async () => {
    const storage = makeStorage();
    const fetchImpl = vi.fn(async (url) => {
      expect(url).toBe(`https://api.github.com/repos/${REPO}`);
      return { json: async () => ({ stargazers_count: 8 }) };
    });
    const stars = await fetchGithubStarsCached(REPO, { fetchImpl, storage, now: 5_000, serverUrl: "" });
    expect(stars).toBe(8);
  });
});
