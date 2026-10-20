import { describe, expect, it } from "vitest";
import {
  currentBadgeIssueNumber,
  formatIssueNumber,
  resolveTierView,
} from "./BadgeDetailModal.jsx";

describe("achievement issue numbers", () => {
  it("formats issue numbers as six-digit mint numbers", () => {
    expect(formatIssueNumber(27)).toBe("000027");
    expect(formatIssueNumber(1_234_567)).toBe("1234567");
    expect(formatIssueNumber(0)).toBeNull();
    expect(formatIssueNumber("not-a-number")).toBeNull();
  });

  it("selects the current cloud tier and rejects local badge serials", () => {
    const badge = { serials: { bronze: 91, silver: 27 } };
    expect(currentBadgeIssueNumber(badge, { scope: "cloud" }, "silver")).toBe(27);
    expect(currentBadgeIssueNumber(badge, { scope: "local" }, "silver")).toBeNull();
    expect(currentBadgeIssueNumber({}, { scope: "cloud" }, "silver")).toBeNull();
  });
});

describe("tier preview", () => {
  const badge = {
    tier: 3,
    thresholds: [30, 90, 180, 365],
    achieved: { bronze: "2026-01-01T00:00:00Z", gold: "2026-03-02T00:00:00Z" },
  };

  it("previews the current tier with its threshold and date", () => {
    const view = resolveTierView(badge, 3);
    expect(view).toMatchObject({
      tier: 3,
      name: "gold",
      achieved: true,
      viewingCurrent: true,
      threshold: 180,
    });
    expect(view.date).toBe("2026-03-02T00:00:00Z");
  });

  it("previews earlier earned tiers without losing current-tier state", () => {
    const view = resolveTierView(badge, 1);
    expect(view).toMatchObject({
      tier: 1,
      name: "bronze",
      achieved: true,
      viewingCurrent: false,
      threshold: 30,
    });
    expect(view.date).toBe("2026-01-01T00:00:00Z");
  });

  it("previews unreached tiers as locked with their threshold", () => {
    expect(resolveTierView(badge, 4)).toMatchObject({
      tier: 4,
      name: "diamond",
      achieved: false,
      viewingCurrent: false,
      date: null,
      threshold: 365,
    });
  });

  it("clamps junk input, keeping 0 as the locked zero tier", () => {
    expect(resolveTierView(badge, 99)).toMatchObject({ tier: 4, achieved: false });
    expect(resolveTierView(badge, "nonsense")).toMatchObject({
      tier: 0,
      name: null,
      achieved: false,
      threshold: null,
    });
  });
});
