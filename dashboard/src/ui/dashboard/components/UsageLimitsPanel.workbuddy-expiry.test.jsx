import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { copy } from "../../../lib/copy";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("keeps WorkBuddy expiration details in both reward hover cards with Beijing dates and fractional credits", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ font: "", measureText: (text) => ({ width: String(text).length * 6 }) });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ limitRows: [] }) })));
  const limits = { configured: true, reward_window: {
    used_percent: 20, used_credits: 200, limit_credits: 1000, remaining_credits: 800,
    expiring_credits: 300.75, expiring_at: "2026-11-04T17:00:00Z",
  } };
  const { container } = render(<UsageLimitsPanel order={["workbuddy", "workbuddyAi"]} workbuddy={limits} workbuddyAi={limits} />);
  expect(container.querySelector("[data-limit-window-note]")).toBeNull();
  const note = copy("limits.workbuddy.expiring_note", { credits: "300.75", date: "2026-11-05" });
  expect(screen.getAllByRole("tooltip").filter((node) => node.textContent.includes(note))).toHaveLength(2);
});
