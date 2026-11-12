import React from "react";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InsforgeUserHeaderControls } from "./InsforgeUserHeaderControls.jsx";

// 与 Sidebar.test.jsx 同款 mock 面：只留本组件消费的上下文。
vi.mock("../lib/copy", () => ({
  copy: (key) => LABELS[key] || key,
}));

const LABELS = {
  "header.auth.open_settings": "Open account settings",
  "header.auth.sign_in_aria": "Sign in",
};

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
});
