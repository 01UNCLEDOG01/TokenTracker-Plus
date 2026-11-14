import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { BADGE_CATALOG } from "../ui/achievements/badge-catalog.js";

// Wall states the hook mocks hand back. Cloud (default scope) carries the
// account union — one badge this device earned plus one raised from another
// device; the local wall only knows the device's own badge.
const states = vi.hoisted(() => ({
  achievements: { status: "ready", error: null, achievements: [] },
  local: { status: "ready", error: null, achievements: [] },
}));

vi.mock("../hooks/use-achievements.js", () => ({
  useAchievements: () => states.achievements,
  useLocalAchievements: () => states.local,
}));

vi.mock("../ui/achievements/AchievementsSection.jsx", () => ({
  AchievementsSection: ({ achievements }) => (
    <div data-testid="local-wall" data-count={achievements.length} />
  ),
}));

vi.mock("../ui/achievements/BadgeSynergyBanner.jsx", () => ({
  BadgeSynergyBanner: () => <div data-testid="synergy" />,
}));

vi.mock("../ui/achievements/AchievementShareModal.jsx", () => ({
  AchievementShareModal: () => null,
}));

import AchievementsPage from "./AchievementsPage.jsx";

beforeEach(() => {
  states.achievements = {
    status: "ready",
    error: null,
    achievements: [
      { id: "project_hopper", tier: 2, metric_value: 7 },
      { id: "code_cannon", tier: 1, remote_raised: true, local_tier: 0, metric_value: 3 },
    ],
  };
  states.local = {
    status: "ready",
    error: null,
    achievements: [{ id: "project_hopper", tier: 2, metric_value: 7 }],
  };
});

// The scope chips are the page's only aria-pressed buttons, so pressed-state
// queries isolate them without relying on translated labels.
const activeTab = () => screen.getAllByRole("button", { pressed: true })[0];
const inactiveTab = () => screen.getAllByRole("button", { pressed: false })[0];

describe("AchievementsPage local/cloud scopes (站主 2026-11-14 拍板)", () => {
  it("opens on the cloud union wall by default, with both scope buttons present", () => {
    render(<AchievementsPage />);

    expect(screen.getByText(copy("achievements.page.cloud_note"))).toBeInTheDocument();
    expect(screen.queryByText(copy("achievements.page.local_note"))).toBeNull();
    // The union wall: both badges earned (one of them on another device).
    expect(screen.getByTestId("local-wall")).toHaveAttribute("data-count", "2");
    expect(screen.getByText(`/${BADGE_CATALOG.length}`)).toBeInTheDocument();

    expect(activeTab()).toHaveTextContent(copy("achievements.page.scope_cloud"));
    expect(inactiveTab()).toHaveTextContent(copy("achievements.page.scope_local"));
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("switches to the device's own wall without a sign-in gate", () => {
    render(<AchievementsPage />);

    fireEvent.click(inactiveTab());

    expect(screen.getByText(copy("achievements.page.local_note"))).toBeInTheDocument();
    expect(screen.queryByText(copy("achievements.page.cloud_note"))).toBeNull();
    expect(screen.getByTestId("local-wall")).toHaveAttribute("data-count", "1");
    expect(activeTab()).toHaveTextContent(copy("achievements.page.scope_local"));
    expect(inactiveTab()).toHaveTextContent(copy("achievements.page.scope_cloud"));
  });

  it("shows each tab's earned count once its wall is ready", () => {
    render(<AchievementsPage />);

    expect(activeTab()).toHaveTextContent("2");
    expect(inactiveTab()).toHaveTextContent("1");
  });

  it("hides a scope's count while that wall is still loading", () => {
    // Loading preserves the fetched achievements in the real hook — make the
    // ready-gate load-bearing by keeping a countable wall behind the gate.
    states.local = {
      status: "loading",
      error: null,
      achievements: [{ id: "project_hopper", tier: 2, metric_value: 7 }],
    };
    render(<AchievementsPage />);

    expect(inactiveTab()).not.toHaveTextContent("1");
  });
});
