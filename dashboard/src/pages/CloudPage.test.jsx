import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CloudPage, probeInstanceHealth } from "./CloudPage.jsx";
import zhCore from "../content/i18n/zh/core.json";
import zhDashboard from "../content/i18n/zh/dashboard.json";
import { getCopyLocale } from "../lib/copy";

vi.mock("../lib/copy", () => ({
  copy: vi.fn((key) => zhCore[key] || zhDashboard[key] || key),
  getCopyLocale: vi.fn(() => "zh"),
}));

const authState = { user: null };
vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => authState,
}));

const configState = { baseUrl: "https://192.168.100.1:17682" };
vi.mock("../lib/insforge-config", () => ({
  getInsforgeConfiguration: () => configState,
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <CloudPage />
    </MemoryRouter>,
  );
}

describe("CloudPage", () => {
  beforeEach(() => {
    getCopyLocale.mockReturnValue("zh");
    authState.user = null;
    configState.baseUrl = "https://192.168.100.1:17682";
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 200 })));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("连接后端时展示实例地址、登录账号与三张卡（部署说明/多设备）", async () => {
    authState.user = { email: "uncledog@local.test" };
    renderPage();

    expect(screen.getByText("云服务")).toBeInTheDocument();
    expect(screen.getByText("https://192.168.100.1:17682")).toBeInTheDocument();
    expect(screen.getByText("uncledog@local.test")).toBeInTheDocument();
    // 三卡：状态卡 + 自部署说明 + 局域网多设备
    expect(screen.getByText("自部署说明")).toBeInTheDocument();
    expect(screen.getByText("局域网多设备接入")).toBeInTheDocument();
    // 部署步骤入口链到 /self-host
    const cta = screen.getByText("查看部署步骤").closest("a");
    expect(cta).toHaveAttribute("href", "/self-host");
    // 探测（250ms 防抖）完成后状态落为已连接
    await waitFor(() => expect(screen.getByText("已连接自托管后端")).toBeInTheDocument());
  });

  it("未登录显示未登录占位，不硬编账号", async () => {
    renderPage();
    expect(screen.getByText("未登录")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("已连接自托管后端")).toBeInTheDocument());
  });

  it("后端链路断开（网络异常）时给出可达性提示而非假装健康", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    renderPage();
    await waitFor(() => expect(screen.getByText("暂时无法连接后端")).toBeInTheDocument());
    expect(screen.getByText(/自签证书已被信任/)).toBeInTheDocument();
  });

  it("server 明确回答未配置后端（409）同样视为不可达", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ status: 409 })));
    renderPage();
    await waitFor(() => expect(screen.getByText("暂时无法连接后端")).toBeInTheDocument());
  });

  it("本地模式（无 baseUrl）不发起探测，直接显示本地模式并引导部署", () => {
    configState.baseUrl = "";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderPage();
    expect(screen.getByText("本地模式（未连接后端）")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("probeInstanceHealth：走同源 /api/auth/public-config，任何响应均可达但 409（未配置后端）不可达", async () => {
    const ok = await probeInstanceHealth(() => Promise.resolve({ status: 404 }));
    expect(ok).toBe(true);
    const ok200 = await probeInstanceHealth(() => Promise.resolve({ status: 200 }));
    expect(ok200).toBe(true);
    const notConfigured = await probeInstanceHealth(() => Promise.resolve({ status: 409 }));
    expect(notConfigured).toBe(false);
    const down = await probeInstanceHealth(() => Promise.reject(new Error("refused")));
    expect(down).toBe(false);
    const seen = vi.fn(() => Promise.resolve({ status: 200 }));
    await probeInstanceHealth(seen);
    expect(seen).toHaveBeenCalledWith("/api/auth/public-config", { cache: "no-store" });
  });
});
