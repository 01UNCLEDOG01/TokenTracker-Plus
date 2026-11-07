import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSessionInsights,
  getUsageSummary,
  invalidateLocalUsageResponseCache,
  invalidateSessionInsightsCache,
} from "./api";

describe("usage GET request coalescing", () => {
  afterEach(() => {
    invalidateSessionInsightsCache();
    invalidateLocalUsageResponseCache();
    vi.unstubAllGlobals();
  });

  // The local usage cache (30s TTL, invalidated by triggerLocalSync) now sits
  // in front of the aggregate GETs: re-selecting a period the user just viewed
  // must not re-pay the server's full-scan aggregation. The coalescing contract
  // becomes: identical in-flight requests share one fetch, the settled result
  // is reused until invalidated, and invalidation forces the refetch.
  it("shares an identical in-flight request and reuses the settled result until invalidated", async () => {
    let resolveFirst: ((value: Response) => void) | null = null;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ totals: { total_tokens: 2 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const params = { from: "2026-07-01", to: "2026-07-14", timeZone: "UTC" };
    const first = getUsageSummary(params);
    const duplicate = getUsageSummary(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirst!(new Response(JSON.stringify({ totals: { total_tokens: 1 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { totals: { total_tokens: 1 } },
      { totals: { total_tokens: 1 } },
    ]);

    // Still within the TTL: the settled aggregate is reused, no second fetch.
    await expect(getUsageSummary(params)).resolves.toEqual({ totals: { total_tokens: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A sync/manual refresh invalidates the cache and fetches fresh.
    invalidateLocalUsageResponseCache();
    await expect(getUsageSummary(params)).resolves.toEqual({ totals: { total_tokens: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses settled session insights by date range until invalidated", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: { sessions: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: { sessions: 2 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: { sessions: 3 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const july = { from: "2026-07-01", to: "2026-07-31" };
    await expect(getSessionInsights(july)).resolves.toEqual({ summary: { sessions: 1 } });
    await expect(getSessionInsights(july)).resolves.toEqual({ summary: { sessions: 1 } });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(getSessionInsights({ from: "2026-07-13", to: "2026-07-19" }))
      .resolves.toEqual({ summary: { sessions: 2 } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    invalidateSessionInsightsCache();
    await expect(getSessionInsights(july)).resolves.toEqual({ summary: { sessions: 3 } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
