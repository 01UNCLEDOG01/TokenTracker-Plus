import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalProfileIdentity } from "./LocalProfileIdentity.jsx";

// 只保留本组件消费的面：身份/资料 hook 用固定夹具替身。
vi.mock("../lib/copy", () => ({
  copy: (key) => LABELS[key] || key,
}));

const LABELS = {
  "localProfile.defaultName": "本机",
  "localProfile.openSettings": "打开设置",
  "localProfile.localIdFallback": "local-id",
  "settings.section.account": "账户",
  "nav.achievements": "成就",
};

vi.mock("../lib/local-profile", () => ({
  localIdShort: () => "abcd1234",
  resolveLocalDisplayName: () => "本机用户",
  useLocalMachineIdentity: () => ({ machineId: "m-1" }),
  useLocalProfile: () => ({ avatarDataUrl: null }),
}));

const ACTIVE_TITLE_KEY = "tokentracker:active_title";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname + location.search}</span>;
}

function renderIdentity(collapsed = false) {
  return render(
    <MemoryRouter>
      <LocalProfileIdentity collapsed={collapsed} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("LocalProfileIdentity click targets", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sends the name to settings → account", () => {
    renderIdentity();
    fireEvent.click(screen.getByText("本机用户"));
    expect(screen.getByTestId("location-probe").textContent).toBe("/settings?section=account");
  });

  it("sends the equipped title badge to achievements", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    renderIdentity();
    fireEvent.click(screen.getByText("零元购"));
    expect(screen.getByTestId("location-probe").textContent).toBe("/achievements");
  });

  it("keeps the collapsed avatar pointing at settings → account", () => {
    renderIdentity(true);
    fireEvent.click(screen.getByLabelText("打开设置"));
    expect(screen.getByTestId("location-probe").textContent).toBe("/settings?section=account");
  });

  it("pulses only the frame at top resonance, never the avatar image", () => {
    localStorage.setItem(ACTIVE_TITLE_KEY, "frugal_archmage");
    localStorage.setItem(
      "tokentracker:achievement_tiers",
      JSON.stringify({ token_arbitrageur: 4, frugal_architect: 4 }),
    );
    const { container } = renderIdentity();
    const frame = container.querySelector("[data-testid='local-profile-identity'] span[class*='ring-2']");
    expect(frame).not.toBeNull();
    expect(frame.className).not.toMatch(/animate-pulse/);
    const pulse = frame.querySelector("[aria-hidden][class*='animate-pulse']");
    expect(pulse).not.toBeNull();
    // 头像本体（首字母胶囊）不带脉冲类。
    const body = frame.querySelector("span[aria-hidden]");
    expect(body === pulse).toBe(false);
  });
});
