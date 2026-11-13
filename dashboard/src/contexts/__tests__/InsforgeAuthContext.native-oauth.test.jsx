import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AUTH_URL = "https://auth.example/authorize";
const currentClient = vi.fn(() => true);
const client = {
  auth: {
    signInWithOAuth: vi.fn(async () => ({ data: { url: AUTH_URL }, error: null })),
  },
};

vi.mock("../../lib/insforge-config", () => ({
  ensureInsforgeClient: async () => client,
  getOrCreateInsforgeClient: () => client,
  isCloudInsforgeConfigured: () => true,
  getInsforgeConfigurationError: () => null,
  getInsforgeConnectionHost: () => null,
  isOfficialInsforgeInstance: () => true,
  INSFORGE_INSTANCE_CHANGED_EVENT: "tt.insforgeInstanceChanged",
  isCurrentInsforgeClient: (...args) => currentClient(...args),
  shouldRestoreInsforgeSession: () => true,
  allowInsforgeSessionRestore: vi.fn(),
}));
vi.mock("../../lib/insforge-session-recovery.mjs", () => ({
  restoreInsforgeUser: async () => ({ data: { user: null }, error: null }),
}));
vi.mock("../../lib/local-api-auth", () => ({
  clearLocalApiAuthToken: vi.fn(),
}));

import { InsforgeAuthProvider, useInsforgeAuth } from "../InsforgeAuthContext.jsx";

async function renderAuth() {
  const wrapper = ({ children }) => <InsforgeAuthProvider>{children}</InsforgeAuthProvider>;
  const { result } = renderHook(() => useInsforgeAuth(), { wrapper });
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
}

async function signIn(result) {
  let outcome;
  await act(async () => {
    outcome = await result.current.signInWithOAuth("github");
  });
  return outcome;
}

describe("native OAuth sign-in", () => {
  let fetchMock;

  beforeEach(() => {
    window.localStorage.clear();
    currentClient.mockReturnValue(true);
    client.auth.signInWithOAuth.mockReset().mockResolvedValue({ data: { url: AUTH_URL }, error: null });
    fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.webkit;
    window.localStorage.clear();
  });

  it("uses the same native scheme on WKWebView embeds regardless of redirect override", async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { nativeOAuth: { postMessage } } };
    const result = await renderAuth();
    await act(async () => { await result.current.signInWithOAuth("github", "https://selfhost.example/auth/callback"); });
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github", redirectTo: "tokentracker://auth/callback", skipBrowserRedirect: true,
    });
    expect(postMessage).toHaveBeenCalledWith(AUTH_URL);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not open a URL if the selected backend changed while OAuth start awaited", async () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { nativeOAuth: { postMessage } } };
    const result = await renderAuth();
    client.auth.signInWithOAuth.mockImplementationOnce(async () => {
      currentClient.mockReturnValue(false);
      return { data: { url: AUTH_URL }, error: null };
    });
    expect((await signIn(result)).error).toBeTruthy();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("keeps browser redirects on the current browser origin", async () => {
    await signIn(await renderAuth());
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github", redirectTo: `${window.location.origin}/dashboard`,
    });
  });
});
