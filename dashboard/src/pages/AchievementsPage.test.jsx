import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";

vi.mock("../hooks/use-achievements.js", () => ({
  useAchievements: () => ({
    status: "ready",
    error: null,
    achievements: [{ id: "project_hopper", tier: 2, metric_value: 7 }],
  }),
}));

vi.mock("../ui/achievements/AchievementsSection.jsx", () => ({
  AchievementsSection: ({ achievements }) => (
    <div data-testid="local-wall" data-count={achievements.length} />
  ),
}));

import AchievementsPage from "./AchievementsPage.jsx";

describe("AchievementsPage local-only wall", () => {
  it("renders the locally computed wall without a sign-in gate", () => {
    render(<AchievementsPage />);

    expect(screen.getByTestId("local-wall")).toHaveAttribute("data-count", "1");
    expect(screen.getByText(copy("achievements.page.local_note"))).toBeInTheDocument();
    expect(screen.queryByText(copy("achievements.signin.prompt"))).toBeNull();
    // 1 earned out of the 31-badge catalog, all counted from local data.
    expect(screen.getByText("/31")).toBeInTheDocument();
  });
});
