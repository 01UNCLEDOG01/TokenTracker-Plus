import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";
import { LIMIT_PROVIDER_IDS, limitProviderIconKey, limitProviderName } from "../../../lib/limits-providers.js";
import { PROVIDER_LIMIT_SPECS } from "./usage-limits-provider-specs.js";

// Credential POSTs are loopback mutations; stub the auth helper like the Hark
// panel tests do — these tests are about the card, not the handshake.
vi.mock("../../../lib/local-api-auth", () => ({
  getLocalApiAuthHeaders: async () => ({ "x-tokentracker-local-auth": "test-token" }),
  clearLocalApiAuthToken: () => {},
}));

const okData = {
  configured: true,
  error: null,
  plan_label: "Today Pro",
  primary_window: { used_percent: 26, reset_at: "2026-11-26T23:56:13.712Z", percent_only: true },
  feature_windows: [
    { label: "Complex tasks", used_percent: 11, reset_at: "2026-11-26T23:56:13.712Z", percent_only: true },
    { label: "Scheduled Tasks", used_percent: 9, reset_at: "2026-11-26T23:56:13.712Z", percent_only: true },
  ],
  today_resets: 1,
};

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: String(text).length * 6 }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("UsageLimitsPanel Today card", () => {
  it("renders the plan label, percent bars, feature rows and resets line", () => {
    render(<UsageLimitsPanel order={["todayCn"]} displayMode="used" todayCn={okData} />);
    // 这条也是「provider 进入 dataById」的回归守卫：漏传 prop 会卡在未连接分支。
    expect(screen.getByRole("button", { name: /^Today Today Pro/ })).toBeInTheDocument();
    expect(screen.getByText("26%")).toBeInTheDocument();
    expect(screen.getByText("Complex tasks")).toBeInTheDocument();
    expect(screen.getByText("Scheduled Tasks")).toBeInTheDocument();
    expect(screen.getByText(/Quota resets left: 1/)).toBeInTheDocument();
  });

  it("shows the paste box when unconfigured (no auto discovery — encrypted desktop store)", () => {
    render(<UsageLimitsPanel order={["todayCn"]} displayMode="used" todayCn={{ configured: false, error: null }} />);
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste the Today session token/i)).toBeInTheDocument();
    expect(screen.getByText(/Today.s desktop app keeps its session in an encrypted store/i)).toBeInTheDocument();
  });

  it("keeps the paste box reachable on the error card (cookie expiry tells the user to re-paste)", () => {
    render(
      <UsageLimitsPanel
        order={["todayCn"]}
        displayMode="used"
        todayCn={{ configured: true, error: "Today session expired or unauthorized (paste a fresh cookie)" }}
      />,
    );
    expect(screen.getByText(/Today session expired or unauthorized/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Paste the Today session token/i)).toBeInTheDocument();
  });
});

// 2026-11-14 事故守卫：Today 的 lib/注册表都接好了，但面板组件签名与 dataById
// 漏了它——限额页有 API 数据却永远不渲染卡片。这里锁死「注册清单里的每个
// provider 都必须有展示规格、名称与图标」，这一类缺口不能再靠肉眼发现。
describe("limits provider registry coverage", () => {
  it("every registered provider has a display spec, a name and an icon key", () => {
    for (const id of LIMIT_PROVIDER_IDS) {
      expect(PROVIDER_LIMIT_SPECS[id], `provider ${id} 缺展示规格（限额页将不渲染）`).toBeTruthy();
      expect(limitProviderName(id), `provider ${id} 缺名称映射`).toBeTruthy();
      expect(limitProviderIconKey(id), `provider ${id} 缺图标键`).toBeTruthy();
    }
  });
});
