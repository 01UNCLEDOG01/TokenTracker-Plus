import { describe, expect, it } from "vitest";
import { shouldPromptLeaderboardLogin } from "./LeaderboardPage.jsx";

describe("shouldPromptLeaderboardLogin", () => {
  it("never prompts on a local-history wall", () => {
    expect(shouldPromptLeaderboardLogin({
      localHistory: true,
      authLoading: false,
      mockEnabled: false,
      cloudSignedIn: false,
    })).toBe(false);
  });

  it("keeps the cloud prompt for an account-backed wall", () => {
    expect(shouldPromptLeaderboardLogin({
      localHistory: false,
      authLoading: false,
      mockEnabled: false,
      cloudSignedIn: false,
    })).toBe(true);
  });

  it("waits while auth is hydrating, in mock mode, or once signed in", () => {
    const base = {
      localHistory: false,
      authLoading: false,
      mockEnabled: false,
      cloudSignedIn: false,
    };
    expect(shouldPromptLeaderboardLogin({ ...base, authLoading: true })).toBe(false);
    expect(shouldPromptLeaderboardLogin({ ...base, mockEnabled: true })).toBe(false);
    expect(shouldPromptLeaderboardLogin({ ...base, cloudSignedIn: true })).toBe(false);
  });
});
