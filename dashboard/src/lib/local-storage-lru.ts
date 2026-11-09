// Bounded LRU bookkeeping for the localStorage response caches used by the
// usage/trend hooks. Cache keys embed from/to/tz/device, so every period or
// device switch mints a new key; without an index they accumulate forever in
// long-lived installs (native WebViews). The index stores keys most-recent
// first; entries past the cap are evicted on each touch.
export function touchLocalStorageCacheKey(
  indexKey: string,
  storageKey: string,
  maxEntries: number,
): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(indexKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string" && k !== indexKey)
      : [];
    const next = [storageKey, ...list.filter((k) => k !== storageKey)];
    const evicted = next.splice(maxEntries);
    for (const key of evicted) window.localStorage.removeItem(key);
    window.localStorage.setItem(indexKey, JSON.stringify(next));
  } catch {
    // Bookkeeping must never break the cache path (quota/private mode).
  }
}

// One-shot adoption of legacy cache keys minted before a hook was wired into
// the LRU (or before the index existed at all). Without this, a full storage
// stays full forever: the LRU above only evicts keys it already knows, and
// the orphans it never learned about keep eating the quota until even tiny
// writes (e.g. the pet limit-row snapshot) fail. Orphans are treated as the
// oldest entries (appended last) so real recent entries survive the cap.
//
// Returns true once the prefix has converged (no orphans left, or adoption
// completed) and false when adoption could not finish — e.g. the index write
// hit the quota. Callers keep retrying on false: eviction already freed space
// this round, so the next round's index write fits.
export function adoptOrphanCacheKeys(
  indexKey: string,
  prefix: string,
  maxEntries: number,
): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(indexKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    const known = Array.isArray(parsed)
      ? parsed.filter((k): k is string => typeof k === "string" && k !== indexKey)
      : [];
    const orphans: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(prefix) && !known.includes(key)) orphans.push(key);
    }
    if (!orphans.length) return true;
    const next = [...known, ...orphans];
    const evicted = next.splice(maxEntries);
    for (const key of evicted) window.localStorage.removeItem(key);
    window.localStorage.setItem(indexKey, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
