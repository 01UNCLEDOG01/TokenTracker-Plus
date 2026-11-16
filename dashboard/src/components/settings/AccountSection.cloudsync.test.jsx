import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { copy } from "../../lib/copy";

// 云同步开关渲染守卫（2026-11-16）：设置重构把渲染层删了、useCloudSyncControl
// 成死代码，本机宿主下两端都没有任何 UI 能开同步（mac 新装永远不上传）。
// 开关恢复进账号区后，这里锁三条：本地宿主可见、宿主门禁隐藏、错误态带重试。
const hookState = { settings: {} };
vi.mock("./useAccountProfileSettings.js", () => ({
  useAccountProfileSettings: () => hookState.settings,
}));

import { AccountSection } from "./AccountSection.jsx";

const baseSettings = {
  enabled: true,
  signedIn: true,
  email: "owner@example.com",
  userId: "user-1",
  signOut: () => {},
  name: { customDisplayName: "", displayName: "Owner" },
  publicProfileOn: false,
  profileLoading: false,
  profileSaving: false,
  publicProfileAvailable: true,
  handlePublicProfileToggle: () => {},
};

function cloudSettings(overrides = {}) {
  return {
    ...baseSettings,
    showLocalCloudSync: true,
    cloudSyncOn: false,
    cloudSyncPending: false,
    cloudSyncError: null,
    handleCloudSyncToggle: () => {},
    handleCloudSyncRetry: () => {},
    handleCloudSyncDisable: () => {},
    ...overrides,
  };
}

describe("AccountSection 云同步开关（站主 2026-11-16：两端都找不到开关）", () => {
  afterEach(() => {
    hookState.settings = {};
  });

  it("已登录的本机宿主渲染开关（关态提示 off hint）", () => {
    hookState.settings = cloudSettings();
    render(<AccountSection />);
    expect(screen.getByText(copy("settings.account.cloudSync"))).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: copy("settings.account.cloudSync") });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(copy("settings.account.cloudSyncOffHint"))).toBeInTheDocument();
  });

  it("开态提示 on hint；宿主门禁 showLocalCloudSync=false 时整个不渲染", () => {
    hookState.settings = cloudSettings({ cloudSyncOn: true });
    const view = render(<AccountSection />);
    expect(screen.getByText(copy("settings.account.cloudSyncOnHint"))).toBeInTheDocument();
    view.unmount();

    hookState.settings = cloudSettings({ showLocalCloudSync: false });
    render(<AccountSection />);
    expect(screen.queryByText(copy("settings.account.cloudSync"))).not.toBeInTheDocument();
  });

  it("同步出错时显示错误与重试按钮", () => {
    hookState.settings = cloudSettings({ cloudSyncOn: true, cloudSyncError: "boom" });
    render(<AccountSection />);
    expect(screen.getByText(copy("settings.account.cloudSyncError"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: copy("settings.account.cloudSyncRetry") })).toBeInTheDocument();
  });

  it("未登录时账号区整体退到登录入口，开关不渲染", () => {
    hookState.settings = { ...cloudSettings(), signedIn: false };
    render(<AccountSection />);
    expect(screen.queryByText(copy("settings.account.cloudSync"))).not.toBeInTheDocument();
  });
});
