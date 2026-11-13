import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsforgeUserHeaderControls } from "./InsforgeUserHeaderControls.jsx";

// 与 Sidebar.test.jsx 同款 mock 面：只留本组件消费的上下文。
vi.mock("../lib/copy", () => ({
  copy: (key) => LABELS[key] || key,
}));

const LABELS = {
  "header.auth.open_settings": "Open account settings",
  "header.auth.sign_in_aria": "Sign in",
  "settings.section.account": "Account",
  "nav.achievements": "Achievements",
};

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname + location.search}</span>;
}

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("../lib/native-bridge.js", () => ({
  isNativeApp: () => false,
}));

vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => ({
    enabled: true,
    loading: false,
    signedIn: true,
    user: { user_metadata: {} },
    displayName: "站主",
    customAvatarUrl: "data:image/png;base64,iVBORw0KGgo=",
  }),
}));

vi.mock("../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));

const ACTIVE_TITLE_KEY = "tokentracker:active_title";

function renderSidebar(collapsed = false) {
  return render(
    <MemoryRouter>
      <InsforgeUserHeaderControls variant="sidebar" collapsed={collapsed} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("InsforgeUserHeaderControls sidebar identity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows the equipped title pill and avatar medallion in the sidebar", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    const { container } = renderSidebar();
    expect(screen.getByText("站主")).toBeInTheDocument();
    expect(screen.getByText("零元购")).toBeInTheDocument();
    expect(container.querySelector('img[alt="零元购"]')).toBeInTheDocument();
  });

  it("hides the title when nothing is equipped (machine-id-free legacy look)", () => {
    renderSidebar();
    expect(screen.getByText("站主")).toBeInTheDocument();
    expect(screen.queryByText("零元购")).toBeNull();
  });

  it("collapses to avatar with medallion, hiding name and pill (parity with local identity)", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    const { container } = renderSidebar(true);
    expect(screen.queryByText("站主")).toBeNull();
    expect(screen.queryByText("零元购")).toBeNull();
    expect(container.querySelector('img[alt="零元购"]')).toBeInTheDocument();
  });

  it("routes the avatar/name to settings → account (not the appearance tab)", () => {
    renderSidebar();
    fireEvent.click(screen.getByText("站主"));
    expect(screen.getByTestId("location-probe").textContent).toBe("/settings?section=account");
  });

  it("routes the equipped title badge to the achievements page", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    renderSidebar();
    fireEvent.click(screen.getByText("零元购"));
    expect(screen.getByTestId("location-probe").textContent).toBe("/achievements");
  });

  it("routes the collapsed avatar to settings → account", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    renderSidebar(true);
    fireEvent.click(screen.getByLabelText("Open account settings"));
    expect(screen.getByTestId("location-probe").textContent).toBe("/settings?section=account");
  });

  it("gives the equipped avatar a resonance frame driven by the title", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    const { container } = renderSidebar();
    const avatar = container.querySelector('img[alt=""]');
    expect(avatar).not.toBeNull();
    // 环挂在外层容器上，头像图片本身不再带 ring。
    expect(avatar.parentElement.className).toMatch(/ring-2/);
  });

  it("pulses the frame only at top resonance — never the avatar image itself", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    localStorage.setItem(
      "tokentracker:achievement_tiers",
      JSON.stringify({ token_arbitrageur: 4, frugal_architect: 4 }),
    );
    const { container } = renderSidebar();
    const avatar = container.querySelector('img[alt=""]');
    const frame = avatar.parentElement;
    // 头像本体（图片）不带 opacity 动画。
    expect(avatar.className).not.toMatch(/animate-pulse/);
    expect(avatar.className).not.toMatch(/opacity-/);
    // 脉冲在独立叠层上。
    const pulse = frame.querySelector('[aria-hidden].animate-pulse');
    expect(pulse).not.toBeNull();
    expect(pulse.className).toMatch(/rounded-full/);
  });

});
