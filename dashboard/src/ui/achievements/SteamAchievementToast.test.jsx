import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/achievement-audio", () => ({
  playUnlockSound: () => {},
  playTierUpSound: () => {},
}));

import {
  SteamAchievementContainer,
  triggerAchievementNotification,
} from "./SteamAchievementToast.jsx";

function fireResonance({ tier, isTierUp, desc }) {
  act(() => {
    triggerAchievementNotification({
      kind: "resonance",
      badge: { id: "synergy_resonance", art: "" },
      tier,
      isTierUp,
      name: `测试称号 ${tier}`,
      desc,
    });
  });
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("resonance level-up toast", () => {
  it("colors the tier pill by tier: silver reads silver, diamond reads cyan", () => {
    render(React.createElement(SteamAchievementContainer));
    fireResonance({ tier: 2, isTierUp: false });
    fireResonance({ tier: 4, isTierUp: true });

    // 两张卡同时在场，胶囊配色各按各的档位
    const pills = Array.from(document.querySelectorAll("span")).filter((el) =>
      /text-(slate-100|cyan-200)/.test(el.className),
    );
    expect(pills.length).toBe(2);
    expect(pills.some((el) => el.className.includes("text-slate-100"))).toBe(true);
    expect(pills.some((el) => el.className.includes("text-cyan-200"))).toBe(true);
  });

  it("does not render the description line (layout stays compact)", () => {
    render(React.createElement(SteamAchievementContainer));
    fireResonance({ tier: 3, isTierUp: true, desc: "UNIQUE-DESC-MUST-NOT-RENDER" });
    expect(screen.queryByText(/UNIQUE-DESC-MUST-NOT-RENDER/)).toBeNull();
  });

  it("the iridescent frame wrapper is present on resonance toasts", () => {
    render(React.createElement(SteamAchievementContainer));
    fireResonance({ tier: 3, isTierUp: true });
    const frame = document.querySelector(".bg-resonance-iridescent");
    expect(frame).not.toBeNull();
    expect(frame.className).toContain("animate-resonance-flow");
  });


  it("promotion and unlock toasts also drop the description line", () => {
    render(React.createElement(SteamAchievementContainer));
    act(() => {
      triggerAchievementNotification({
        badge: { id: "badge_a", art: "" },
        tier: 4,
        isTierUp: true,
        name: "晋级成就",
        desc: "PROMO-DESC-MUST-NOT-RENDER",
      });
    });
    act(() => {
      triggerAchievementNotification({
        badge: { id: "badge_b", art: "" },
        tier: 2,
        isTierUp: false,
        name: "解锁成就",
        desc: "UNLOCK-DESC-MUST-NOT-RENDER",
      });
    });
    expect(screen.queryByText(/PROMO-DESC-MUST-NOT-RENDER/)).toBeNull();
    expect(screen.queryByText(/UNLOCK-DESC-MUST-NOT-RENDER/)).toBeNull();
  });

  it("the promotion toast keeps its own cyan identity (must stay distinct)", () => {
    render(React.createElement(SteamAchievementContainer));
    act(() => {
      triggerAchievementNotification({
        badge: { id: "some_badge", art: "" },
        tier: 3,
        isTierUp: true,
        name: "普通成就",
      });
    });
    // 晋级弹窗走青色（cyan-400 系），与共鸣的炫彩框并存时依然可分
    expect(screen.getByText(/ACHIEVEMENT PROMOTED/)).not.toBeNull();
    expect(document.querySelector(".bg-resonance-iridescent")).toBeNull();
  });
});
