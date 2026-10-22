import { afterEach, describe, expect, it, vi } from "vitest";
import { getLeaderboard, isLocalLeaderboardHost } from "./api";

const ANON_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln";
const RUNTIME = {
  baseUrl: "http://127.0.0.1:17681",
  anonKey: ANON_KEY,
  localHistory: true,
};

afterEach(() => {
  delete (window as any).__TOKENTRACKER_RUNTIME_CONFIG__;
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

describe("local leaderboard routing", () => {
  it("requires the CLI's localHistory capability, not just localhost", () => {
    expect(isLocalLeaderboardHost()).toBe(false);
    (window as any).__TOKENTRACKER_RUNTIME_CONFIG__ = RUNTIME;
    expect(isLocalLeaderboardHost()).toBe(true);
  });

  it("reads the local history endpoint from a CLI-served page", async () => {
    (window as any).__TOKENTRACKER_RUNTIME_CONFIG__ = RUNTIME;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(
      JSON.stringify({ entries: [], total_entries: 0, source: "local" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const data = await getLeaderboard({ period: "week", limit: 20, offset: 0 });

    expect(data.source).toBe("local");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://localhost");
    expect(url.pathname).toBe("/functions/tokentracker-leaderboard");
    expect(url.searchParams.get("period")).toBe("week");
    expect(url.searchParams.get("limit")).toBe("20");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.origin).toBe(window.location.origin);
  });
});
