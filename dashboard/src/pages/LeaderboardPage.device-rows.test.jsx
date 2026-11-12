import React from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLeaderboardPreloadContextKey,
  publishLeaderboardPreloadState,
  resetDashboardPreload,
} from "../lib/dashboard-preload.js";
import { getLeaderboard } from "../lib/api";
import { LeaderboardPage } from "./LeaderboardPage.jsx";

const insforgeAuthMock = vi.hoisted(() => ({
  signedIn: true,
  loading: false,
  // A profile display name makes the is_me identity override visible: without
  // the device-row guard it replaced every row's name with this account label.
  user: { id: "user-1", user_metadata: { display_name: "UNCLEDOG" } },
  getAccessToken: vi.fn(async () => "tok-test"),
}));

vi.mock("../lib/api", () => ({
  getLeaderboard: vi.fn(),
  refreshLeaderboard: vi.fn(),
  isLocalLeaderboardHost: () => false,
  getLeaderboardProfile: vi.fn(async () => null),
}));

vi.mock("../lib/cloud-sync", () => ({ runCloudUsageSyncNow: vi.fn(async () => {}) }));
vi.mock("../lib/config", () => ({ getLeaderboardBaseUrl: () => "https://edge.example" }));
vi.mock("../lib/mock-data", () => ({ isMockEnabled: () => false }));
vi.mock("../contexts/LoginModalContext.jsx", () => ({
  useLoginModal: () => ({ openLoginModal: vi.fn() }),
}));
vi.mock("../contexts/InsforgeAuthContext.jsx", () => ({
  useInsforgeAuth: () => insforgeAuthMock,
}));
vi.mock("../hooks/useCurrency.js", () => ({ useCurrency: () => ({ currency: "USD", rate: 1 }) }));
vi.mock("../hooks/use-community-stats.js", () => ({
  useCommunityStats: () => ({ status: "disabled", tokenFloor: null, totalEntries: null, top: [] }),
}));
vi.mock("../components/LeaderboardSkeleton.jsx", () => ({
  LeaderboardSkeleton: () => <div data-testid="leaderboard-skeleton" />,
}));
vi.mock("../components/LeaderboardAvatar.jsx", () => ({
  LeaderboardAvatar: ({ displayName }) => <span data-testid="avatar">{displayName}</span>,
}));
// Count badge strips per row instead of rendering the coin art.
vi.mock("../ui/achievements/BadgeMini.jsx", () => ({
  // Function expression + a precomputed boolean: the UI-hardcode scanner reads
  // an arrow body's "> 0 ?" as JSX text and flags it.
  BadgeMini: function BadgeMiniMock({ badges }) {
    const hasBadges = Boolean((badges || []).length);
    if (!hasBadges) return null;
    return <span data-testid="badge-mini" />;
  },
}));

const DEVICE_ROWS = [
  {
    rank: 1,
    user_id: "user-1",
    device_id: "8d5c5cec-6b7c-4e4d-a0b8-6fc9456512fb",
    display_name: "UNCLEDOG · PC-20231215YOKN",
    total_tokens: 78_088_050_047,
    estimated_cost_usd: 9946.19,
    is_me: true,
    badges: [{ id: "phoenix", tier: 2 }],
  },
  {
    rank: 2,
    user_id: "user-1",
    device_id: "e6f406f4-7c18-4847-8052-e7e13c343abd",
    display_name: "UNCLEDOG · Mac Mini M6",
    total_tokens: 1_953_215_199,
    estimated_cost_usd: 412.07,
    is_me: true,
    badges: [{ id: "phoenix", tier: 2 }],
  },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/leaderboard"]}>
      <LeaderboardPage auth={() => Promise.resolve("test-token")} signedIn sessionSoftExpired={false} />
    </MemoryRouter>,
  );
}

describe("LeaderboardPage per-device rows", () => {
  beforeEach(() => {
    resetDashboardPreload();
    getLeaderboard.mockReset();
    window.localStorage.clear();
    const contextKey = getLeaderboardPreloadContextKey({
      accessMode: "cloud",
      baseUrl: "https://edge.example",
      mockEnabled: false,
      userId: "user-1",
    });
    publishLeaderboardPreloadState(
      { entries: DEVICE_ROWS, me: null, page: 1, total_pages: 1, total_entries: 2, from: null, to: null, generated_at: null },
      { contextKey },
    );
    getLeaderboard.mockReturnValue(new Promise(() => {}));
  });

  it("keeps each device row's own name instead of collapsing both to the account label", () => {
    const { container } = renderPage();
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("UNCLEDOG · PC-20231215YOKN");
    expect(rows[1].textContent).toContain("UNCLEDOG · Mac Mini M6");
  });

  it("prices the two device rows separately", () => {
    const { container } = renderPage();
    const rows = [...container.querySelectorAll("tbody tr")];
    const costCells = rows.map((row) => row.querySelectorAll("td")[3]?.textContent || "");
    expect(costCells[0]).not.toEqual(costCells[1]);
  });

  it("renders the account's badges once, on its highest-ranked row", () => {
    renderPage();
    const strips = [...document.querySelectorAll('[data-testid="badge-mini"]')];
    // Desktop table + mobile list each render once, and only the account's
    // highest-ranked device row carries the (account-level) badge strip.
    expect(strips).toHaveLength(2);
  });
});
