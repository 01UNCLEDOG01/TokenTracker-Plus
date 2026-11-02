import React from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountViewProvider, useAccountView, CLOUD_SYNC_CHANGE_EVENT } from "./AccountViewContext.jsx";
import { syncCloudSyncPrefToLocalServer } from "../lib/cloud-sync-prefs";

const authState = vi.hoisted(() => ({ enabled: true, signedIn: true, loading: false, user: { id: "user-A" } }));

vi.mock("./InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => authState,
}));

const prefState = vi.hoisted(() => ({ ready: false, localHost: true, sync: true }));

vi.mock("../lib/cloud-sync-prefs", () => ({
  CLOUD_USAGE_SYNCED_EVENT: "tt.cloudUsageSynced",
  getCloudSyncEnabled: () => prefState.sync,
  getCloudUsageReady: () => prefState.ready,
  isLocalDashboardHost: () => prefState.localHost,
  syncCloudSyncPrefToLocalServer: vi.fn(),
}));

describe("AccountViewProvider", () => {
  beforeEach(() => {
    prefState.ready = false;
    prefState.localHost = true;
    prefState.sync = true;
    Object.assign(authState, { enabled: true, signedIn: true, loading: false, user: { id: "user-A" } });
  });

  it("keeps the local view until the first cloud upload completes", () => {
    const wrapper = ({ children }) => <AccountViewProvider>{children}</AccountViewProvider>;
    const { result } = renderHook(() => useAccountView(), { wrapper });

    expect(result.current).toMatchObject({ accountView: false, revision: 0 });
    act(() => window.dispatchEvent(new Event("tt.cloudUsageSynced")));
    expect(result.current.accountView).toBe(true);
  });

  it("uses cloud immediately when a previous upload is ready", () => {
    prefState.ready = true;
    const wrapper = ({ children }) => <AccountViewProvider>{children}</AccountViewProvider>;
    const { result } = renderHook(() => useAccountView(), { wrapper });

    expect(result.current.accountView).toBe(true);
  });

  it("keeps public-host account reads on cloud", () => {
    prefState.localHost = false;
    const wrapper = ({ children }) => <AccountViewProvider>{children}</AccountViewProvider>;
    const { result } = renderHook(() => useAccountView(), { wrapper });

    expect(result.current.accountView).toBe(true);
  });

  it("switches read scope without changing the upload preference", () => {
    prefState.ready = true;
    const { result } = renderHook(() => useAccountView(), { wrapper: AccountViewProvider });
    const mirrors = vi.mocked(syncCloudSyncPrefToLocalServer).mock.calls.length;
    act(() => result.current.setScopeOverride("local"));
    expect(result.current.accountView).toBe(false);
    expect(result.current.revision).toBe(1);
    act(() => result.current.setScopeOverride("local"));
    expect(result.current.revision).toBe(1);
    expect(prefState.sync).toBe(true);
    expect(vi.mocked(syncCloudSyncPrefToLocalServer).mock.calls.length).toBe(mirrors);
  });

  it("drops an override when its cloud scope becomes unavailable", () => {
    prefState.ready = true;
    const { result } = renderHook(() => useAccountView(), { wrapper: AccountViewProvider });
    act(() => result.current.setScopeOverride("account"));
    prefState.sync = false;
    act(() => window.dispatchEvent(new Event(CLOUD_SYNC_CHANGE_EVENT)));
    expect(result.current.accountView).toBe(false);
    expect(result.current.scopeOverride).toBeNull();
    expect(result.current.canOverrideScope).toBe(false);
  });

  it("does not carry a comparison choice into another account", () => {
    prefState.ready = true;
    const { result, rerender } = renderHook(() => useAccountView(), { wrapper: AccountViewProvider });
    act(() => result.current.setScopeOverride("local"));
    authState.user = { id: "user-B" };
    rerender();
    expect(result.current.accountView).toBe(true);
    expect(result.current.scopeOverride).toBeNull();
  });
});
