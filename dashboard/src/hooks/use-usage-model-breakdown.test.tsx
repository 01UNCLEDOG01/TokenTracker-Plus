import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCloudUsageModelBreakdown } from "../lib/api";
import { useUsageModelBreakdown } from "./use-usage-model-breakdown";

vi.mock("../lib/api", () => ({
  fetchCloudUsageModelBreakdown: vi.fn(),
  getUsageModelBreakdown: vi.fn(),
}));
vi.mock("../lib/auth-token", () => ({
  isAccessTokenReady: () => true,
  resolveAuthAccessToken: async (token: any) => token || "test-token",
}));
vi.mock("../lib/mock-data", () => ({ isMockEnabled: () => false }));

describe("useUsageModelBreakdown", () => {
  beforeEach(() => {
    vi.mocked(fetchCloudUsageModelBreakdown).mockReset();
    window.localStorage.clear();
  });

  it("clears the previous range and ignores its late provider response", async () => {
    let resolveMonth: (value: any) => void = () => {};
    let resolveDay: (value: any) => void = () => {};
    vi.mocked(fetchCloudUsageModelBreakdown).mockImplementation(({ from }: any) =>
      new Promise((resolve) => {
        if (from === "2026-06-01") resolveMonth = resolve;
        else resolveDay = resolve;
      }),
    );

    const { result, rerender } = renderHook(
      ({ from, to }) =>
        useUsageModelBreakdown({
          baseUrl: "https://(removed)",
          from,
          to,
          cacheKey: "provider-race",
          timeZone: "UTC",
          accountView: true,
          accountAccessToken: "jwt-token",
        }),
      { initialProps: { from: "2026-06-01", to: "2026-06-30" } },
    );

    await waitFor(() => expect(fetchCloudUsageModelBreakdown).toHaveBeenCalledTimes(1));
    rerender({ from: "2026-06-30", to: "2026-06-30" });
    expect(result.current.breakdown).toBeNull();
    await waitFor(() => expect(fetchCloudUsageModelBreakdown).toHaveBeenCalledTimes(2));

    await act(async () => resolveDay({ sources: [{ source: "codex", totals: { total_tokens: 100 } }] }));
    await waitFor(() => expect(result.current.breakdown?.sources?.[0]?.totals?.total_tokens).toBe(100));

    await act(async () => resolveMonth({ sources: [{ source: "claude", totals: { total_tokens: 9_999 } }] }));
    expect(result.current.breakdown?.sources?.[0]?.source).toBe("codex");
    expect(result.current.breakdown?.sources?.[0]?.totals?.total_tokens).toBe(100);
    expect(result.current.loading).toBe(false);
  });

  it("never caches a fallback payload under the cloud scope and badges it", async () => {
    vi.mocked(fetchCloudUsageModelBreakdown).mockResolvedValue({
      sources: [{ source: "zcode", totals: { total_tokens: 120 } }],
      trae_estimate_applied: true,
      account_view_fallback: "transient-upstream",
    });

    const { result } = renderHook(() =>
      useUsageModelBreakdown({
        baseUrl: "https://(removed)",
        from: "2026-06-17",
        to: "2026-11-20",
        cacheKey: "fallback-no-cache",
        timeZone: "UTC",
        accountView: true,
        accountAccessToken: "jwt-token",
      }),
    );

    await waitFor(() => expect(result.current.breakdown).not.toBeNull());
    expect(result.current.accountFallback).toBe(true);
    // Poison guard: no cloud-scope cache entry may exist for this window.
    const keys = Object.keys(window.localStorage).filter((k) =>
      k.startsWith("tokentracker.modelBreakdown.fallback-no-cache.cloud."),
    );
    expect(keys).toEqual([]);
  });

  it("treats a poisoned cloud-scope cache entry as a miss", async () => {
    // First pass: a healthy cloud response writes a legit cloud-scope entry,
    // so the test's cache key is exactly what the hook itself produces.
    vi.mocked(fetchCloudUsageModelBreakdown).mockResolvedValueOnce({
      sources: [{ source: "claude", totals: { total_tokens: 1 } }],
      trae_estimate_applied: true,
    });
    const first = renderHook(() =>
      useUsageModelBreakdown({
        baseUrl: "https://(removed)",
        from: "2026-06-17",
        to: "2026-11-20",
        cacheKey: "poisoned",
        timeZone: "UTC",
        accountView: true,
        accountAccessToken: "jwt-token",
      }),
    );
    await waitFor(() => expect(first.result.current.breakdown).not.toBeNull());
    const poisonedKey = Object.keys(window.localStorage).find((k) =>
      k.startsWith("tokentracker.modelBreakdown.poisoned.cloud."),
    );
    expect(poisonedKey).toBeTruthy();
    if (!poisonedKey) throw new Error("cloud-scope cache entry was not written");
    first.unmount();

    // Poison that exact entry (what an older build wrote for a fallback).
    const poisonedRaw = window.localStorage.getItem(poisonedKey);
    expect(poisonedRaw).toBeTruthy();
    if (!poisonedRaw) throw new Error("cache entry vanished before poisoning");
    const stored = JSON.parse(poisonedRaw);
    stored.breakdown = {
      sources: [{ source: "zcode", totals: { total_tokens: 999 } }],
      trae_estimate_applied: true,
      account_view_fallback: "transient-upstream",
    };
    window.localStorage.setItem(poisonedKey, JSON.stringify(stored));

    // Second pass: the poisoned entry must be a miss — the fetch runs again
    // and the honest cloud data lands.
    vi.mocked(fetchCloudUsageModelBreakdown).mockResolvedValue({
      sources: [{ source: "claude", totals: { total_tokens: 12345 } }],
      trae_estimate_applied: true,
    });
    const { result } = renderHook(() =>
      useUsageModelBreakdown({
        baseUrl: "https://(removed)",
        from: "2026-06-17",
        to: "2026-11-20",
        cacheKey: "poisoned",
        timeZone: "UTC",
        accountView: true,
        accountAccessToken: "jwt-token",
      }),
    );
    await waitFor(() => expect(result.current.breakdown?.sources?.[0]?.totals?.total_tokens).toBe(12345));
    expect(result.current.accountFallback).toBe(false);
  });
});
