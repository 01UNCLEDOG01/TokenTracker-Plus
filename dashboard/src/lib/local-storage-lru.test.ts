import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptOrphanCacheKeys, touchLocalStorageCacheKey } from "./local-storage-lru";

const INDEX = "tokentracker.test-cache-index";
const PREFIX = "tokentracker.testcache.";
const CAP = 4;

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("adoptOrphanCacheKeys", () => {
  it("adopts legacy keys into the index and evicts orphans before known entries", () => {
    // One known recent entry plus six legacy orphans; cap 4 → the newest
    // orphans (list tail) are evicted, the known entry survives.
    window.localStorage.setItem("legacy.entry", "1"); // different prefix: untouched
    window.localStorage.setItem(INDEX, JSON.stringify(["tokentracker.testcache.known"]));
    for (let i = 1; i <= 6; i++) {
      window.localStorage.setItem(`tokentracker.testcache.orphan${i}`, `v${i}`);
    }

    adoptOrphanCacheKeys(INDEX, PREFIX, CAP);

    const index = JSON.parse(window.localStorage.getItem(INDEX) ?? "[]");
    // known first (treated as most recent), orphans appended oldest-last:
    expect(index[0]).toBe("tokentracker.testcache.known");
    expect(index).toHaveLength(CAP);
    // Evicted = list tail: orphan5, orphan6, orphan4, orphan3 (in cap order).
    expect(window.localStorage.getItem("tokentracker.testcache.orphan5")).toBeNull();
    expect(window.localStorage.getItem("tokentracker.testcache.orphan6")).toBeNull();
    expect(index).toContain("tokentracker.testcache.known");
    expect(index).toContain("tokentracker.testcache.orphan1");
    expect(window.localStorage.getItem("legacy.entry")).toBe("1");
    expect(index).not.toContain("legacy.entry");
  });

  it("leaves storage alone when there are no orphans", () => {
    window.localStorage.setItem(INDEX, JSON.stringify(["tokentracker.testcache.a"]));
    window.localStorage.setItem("tokentracker.testcache.a", "1");

    adoptOrphanCacheKeys(INDEX, PREFIX, CAP);

    expect(JSON.parse(window.localStorage.getItem(INDEX) ?? "[]")).toEqual([
      "tokentracker.testcache.a",
    ]);
  });

  it("still converges when the index write itself hits the quota", () => {
    for (let i = 1; i <= 6; i++) {
      window.localStorage.setItem(`tokentracker.testcache.orphan${i}`, `v${i}`);
    }
    // Instance-level spyOn does not intercept (setupTests swaps the storage
    // instance) — spy Storage.prototype, matching real quota behavior.
    const setItemSpy = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    });

    expect(() => adoptOrphanCacheKeys(INDEX, PREFIX, CAP)).not.toThrow();
    // Index write failed, so nothing was evicted either (single atomic step).
    expect(window.localStorage.getItem("tokentracker.testcache.orphan1")).toBe("v1");
    setItemSpy.mockRestore();
  });

  it("composes with touchLocalStorageCacheKey: adopted index keeps bounding growth", () => {
    for (let i = 1; i <= 5; i++) {
      window.localStorage.setItem(`tokentracker.testcache.orphan${i}`, `v${i}`);
    }

    expect(adoptOrphanCacheKeys(INDEX, PREFIX, CAP)).toBe(true);
    touchLocalStorageCacheKey(INDEX, "tokentracker.testcache.fresh", CAP);

    const index = JSON.parse(window.localStorage.getItem(INDEX) ?? "[]");
    expect(index[0]).toBe("tokentracker.testcache.fresh");
    expect(index).toHaveLength(CAP);
    expect(window.localStorage.getItem("tokentracker.testcache.fresh")).toBeNull(); // touch only bookkeeps
  });

  it("reports convergence so callers stop retrying only after it lands", () => {
    // Nothing to adopt → converged immediately.
    expect(adoptOrphanCacheKeys(INDEX, PREFIX, CAP)).toBe(true);

    // Quota-blocked index write → not converged (caller must retry), even
    // though eviction already freed storage space.
    for (let i = 1; i <= 6; i++) {
      window.localStorage.setItem(`tokentracker.testcache.orphan${i}`, `v${i}`);
    }
    const setItemSpy = vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    });
    expect(adoptOrphanCacheKeys(INDEX, PREFIX, CAP)).toBe(false);
    setItemSpy.mockRestore();

    // With writes allowed again, the retry converges.
    expect(adoptOrphanCacheKeys(INDEX, PREFIX, CAP)).toBe(true);
    const index = JSON.parse(window.localStorage.getItem(INDEX) ?? "[]");
    expect(index).toHaveLength(CAP);
    expect(window.localStorage.getItem("tokentracker.testcache.orphan6")).toBeNull();
  });
});
