import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  BadgeDetailBody,
  currentBadgeIssueNumber,
  formatIssueNumber,
  resolveCoinBackLines,
  resolveTierView,
} from "./BadgeDetailModal.jsx";

// The body renders raw copy keys — assertions match on keys, not translations.
vi.mock("../../lib/copy", () => ({
  copy: (key, params) => (params && params.tier ? `${key}:${params.tier}` : key),
}));

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

describe("coin back lines vs the union wall (站主 2026-11-14: 本机数值不得冒充云端依据)", () => {
  const base = {
    formattedIssueNumber: null,
    viewDate: "2026/9/23",
    name: "连胜火焰",
  };

  it("a locally earned current tier engraves the live reading", () => {
    const lines = resolveCoinBackLines({
      ...base,
      hiddenLocked: false,
      view: { tier: 2, achieved: true, viewingCurrent: true },
      valueText: "6",
      viewThresholdText: "7",
      previewedTierIsRemote: false,
    });
    expect(lines).toEqual(["achievements.modal.achieved_label", "6", "2026/9/23"]);
  });

  it("a union-raised current tier engraves the bar it met, never the local reading", () => {
    // The other device's exact earning value is not synced — the only ground
    // truth this machine has for its diamond is the 100-day threshold.
    const lines = resolveCoinBackLines({
      ...base,
      hiddenLocked: false,
      view: { tier: 4, achieved: true, viewingCurrent: true },
      valueText: "6",
      viewThresholdText: "100",
      previewedTierIsRemote: true,
    });
    expect(lines).toEqual(["achievements.modal.achieved_label", "100", "2026/9/23"]);
  });

  it("keeps the threshold behavior for previewed lower and locked tiers", () => {
    expect(resolveCoinBackLines({
      ...base,
      hiddenLocked: false,
      view: { tier: 1, achieved: true, viewingCurrent: false },
      valueText: "6",
      viewThresholdText: "3",
      previewedTierIsRemote: false,
    })[1]).toBe("3");
    expect(resolveCoinBackLines({
      ...base,
      hiddenLocked: false,
      view: { tier: 4, achieved: false, viewingCurrent: false },
      valueText: "6",
      viewThresholdText: "100",
      previewedTierIsRemote: false,
    })).toEqual(["achievements.modal.locked", "100", "连胜火焰"]);
  });
});

describe("badge detail body annotations", () => {
  const remoteStreak = {
    id: "streak",
    tier: 4,
    local_tier: 0,
    remote_raised: true,
    metric_value: 6,
    thresholds: [3, 7, 14, 100],
    achieved: { diamond: "2026-09-23T00:00:00Z" },
  };

  it("labels the reading as local and annotates the remote tier", () => {
    render(<BadgeDetailBody badge={remoteStreak} onClose={() => {}} />);

    expect(screen.getByText("achievements.modal.remote_tier_note")).toBeInTheDocument();
    expect(screen.getByText("achievements.modal.local_value_label")).toBeInTheDocument();
    expect(screen.queryByText("achievements.modal.value_label")).toBeNull();
  });

  it("keeps the plain labels for a badge this device earned itself", () => {
    render(
      <BadgeDetailBody
        badge={{
          id: "streak",
          tier: 2,
          metric_value: 6,
          thresholds: [3, 7, 14, 100],
          achieved: { bronze: "2026-11-09T00:00:00Z", silver: "2026-11-13T00:00:00Z" },
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("achievements.modal.value_label")).toBeInTheDocument();
    expect(screen.queryByText("achievements.modal.local_value_label")).toBeNull();
    expect(screen.queryByText("achievements.modal.remote_tier_note")).toBeNull();
  });

  it("drops the annotation when previewing a tier this device earned itself", () => {
    render(
      <BadgeDetailBody
        badge={{ ...remoteStreak, local_tier: 2, achieved: { diamond: "2026-09-23T00:00:00Z", silver: "2026-11-13T00:00:00Z" } }}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("achievements.modal.remote_tier_note")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "achievements.tier.silver" }));

    expect(screen.queryByText("achievements.modal.remote_tier_note")).toBeNull();
    // The reading stays labeled as local for as long as the badge is merged.
    expect(screen.getByText("achievements.modal.local_value_label")).toBeInTheDocument();
  });

  it("marks the next-tier progress as local for a union-raised badge below diamond", () => {
    render(
      <BadgeDetailBody
        badge={{
          id: "streak",
          tier: 2,
          local_tier: 0,
          remote_raised: true,
          metric_value: 6,
          thresholds: [3, 7, 14, 100],
          achieved: { bronze: "2026-11-09T00:00:00Z", silver: "2026-11-12T00:00:00Z" },
        }}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("achievements.modal.progress_to_next_local:achievements.tier.gold")).toBeInTheDocument();
    expect(screen.queryByText("achievements.modal.progress_to_next:achievements.tier.gold")).toBeNull();
  });
});
