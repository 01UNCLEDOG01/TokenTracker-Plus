import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signedIn: true }));
const client = vi.hoisted(() => ({ auth: {
  signOut: vi.fn(async () => { state.signedIn = false; }),
  signInWithPassword: vi.fn(async () => { state.signedIn = true; return { data: { user: { id: "fixture-user" } } }; }),
  refreshSession: vi.fn(async () => ({ data: {} })),
  getCurrentUser: vi.fn(async () => ({ data: { user: state.signedIn ? { id: "fixture-user" } : null } })),
} }));
vi.mock("../../lib/insforge-config", () => ({
  getOrCreateInsforgeClient: () => client,
  isCloudInsforgeConfigured: () => true,
  getInsforgeConfigurationError: () => null,
  getInsforgeConnectionHost: () => null,
  getInsforgeRemoteUrl: () => "https://cloud.example",
  isOfficialInsforgeInstance: () => true,
  isCurrentInsforgeClient: (value) => value === client,
  shouldRestoreInsforgeSession: () => true,
  allowInsforgeSessionRestore: vi.fn(),
  INSFORGE_INSTANCE_CHANGED_EVENT: "tt.insforgeInstanceChanged",
}));
// 站主 2026-11-13：回焦补检（InsforgeAuthContext 的冷启动兜底）不得在用户
// 主动退出后把会话又恢复回来，用 alwaysUser 让恢复链永远"成功"来钉这条。
const restore = vi.hoisted(() => ({ alwaysUser: false }));
vi.mock("../../lib/insforge-session-recovery.mjs", () => ({
  restoreInsforgeUser: async () => (restore.alwaysUser
    ? { data: { user: { id: "fixture-user" } }, error: null }
    : client.auth.getCurrentUser()),
}));
vi.mock("../../lib/api", () => ({
  invalidateAccountResponseCache: vi.fn(),
  getPublicVisibility: async () => ({}),
}));
vi.mock("../../lib/local-api-auth", () => ({
  clearLocalApiAuthToken: vi.fn(),
  getLocalApiAuthHeaders: async () => ({}),
}));

import { InsforgeAuthProvider, useInsforgeAuth } from "../InsforgeAuthContext.jsx";
import { AccountViewProvider, useAccountView } from "../AccountViewContext.jsx";
import { getCloudSyncEnabled, getCloudUsageReady, getStoredDeviceSession,
  setStoredDeviceSession, setCloudUsageReady, emitCloudUsageSynced } from "../../lib/cloud-sync-prefs";

describe("sign-out sync preference", () => {
  beforeEach(() => {
    localStorage.clear();
    state.signedIn = true;
    restore.alwaysUser = false;
    vi.clearAllMocks();
  });

  for (const preference of ["1", "0", null]) it(`preserves saved preference ${preference} through sign-out and re-login`, async () => {
    if (preference !== null) localStorage.setItem("tokentracker_cloud_sync_enabled", preference);
    localStorage.setItem("tokentracker_cloud_sync_changed_at_ms", "123");
    setCloudUsageReady(true);
    setStoredDeviceSession({ token: "fixture-device-token", deviceId: "device", issuedAt: "fixture" });
    const wrapper = ({ children }) => <InsforgeAuthProvider>{children}</InsforgeAuthProvider>;
    const { result } = renderHook(() => useInsforgeAuth(), { wrapper });
    await waitFor(() => expect(result.current.signedIn).toBe(true));
    await act(async () => result.current.signOut());
    expect(result.current.signedIn).toBe(false);
    expect(localStorage.getItem("tokentracker_cloud_sync_enabled")).toBe(preference);
    expect(localStorage.getItem("tokentracker_cloud_sync_changed_at_ms")).toBe("123");
    expect(getCloudUsageReady()).toBe(false);
    expect(getStoredDeviceSession()).toBeNull();
    await act(async () => result.current.signInWithPassword({ email: "fixture@example.invalid", password: "fixture" }));
    expect(result.current.signedIn).toBe(true);
    expect(getCloudSyncEnabled()).toBe(preference === "1");
    expect(getCloudUsageReady()).toBe(false);
  });

  it("signs the user in on the next focus when the cold-start restore raced the server", async () => {
    // 首次恢复落空（服务还在起）→ 会话不该被钉成"未登录"，回焦要能补上。
    state.signedIn = false;
    const wrapper = ({ children }) => <InsforgeAuthProvider>{children}</InsforgeAuthProvider>;
    const { result } = renderHook(() => useInsforgeAuth(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.signedIn).toBe(false);
    restore.alwaysUser = true;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(result.current.signedIn).toBe(true);
  });

  it("does not sign the user back in after an explicit sign-out when the window regains focus", async () => {
    restore.alwaysUser = true;
    const wrapper = ({ children }) => <InsforgeAuthProvider>{children}</InsforgeAuthProvider>;
    const { result } = renderHook(() => useInsforgeAuth(), { wrapper });
    await waitFor(() => expect(result.current.signedIn).toBe(true));
    await act(async () => result.current.signOut());
    expect(result.current.signedIn).toBe(false);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    expect(result.current.signedIn).toBe(false);
  });

  it("keeps signed-out localhost in the local view with sync preference enabled", async () => {
    localStorage.setItem("tokentracker_cloud_sync_enabled", "1");
    setCloudUsageReady(true);
    const wrapper = ({ children }) => <InsforgeAuthProvider><AccountViewProvider>{children}</AccountViewProvider></InsforgeAuthProvider>;
    const { result } = renderHook(() => ({ auth: useInsforgeAuth(), view: useAccountView() }), { wrapper });
    await waitFor(() => expect(result.current.auth.signedIn).toBe(true));
    await act(async () => result.current.auth.signOut());
    expect(result.current.view.accountView).toBe(false);
    expect(result.current.view.resolving).toBe(false);
    expect(getCloudSyncEnabled()).toBe(true);
    await act(async () => result.current.auth.signInWithPassword({ email: "fixture@example.invalid", password: "fixture" }));
    expect(result.current.view.accountView).toBe(false);
    act(() => emitCloudUsageSynced());
    expect(result.current.view.accountView).toBe(true);
  });
});
