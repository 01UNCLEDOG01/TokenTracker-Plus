import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { copy } from "../../../lib/copy";
import { UsageLimitsPanel } from "./UsageLimitsPanel.jsx";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// 三态用量门禁（2026-11-22）：「源断供」黄字只挂对应卡的展开区（站主拍板
// 撤页面级横幅）——展开才显示、折叠不显示、无映射的源不显示。
const qoderCnData = {
  configured: true,
  primary_window: {
    limit_credits: 1000,
    used_credits: 640,
    remaining_credits: 360,
    used_percent: 64,
  },
};

const gap = {
  source: "qoder-cn",
  last_usage_day: "2026-11-02",
  last_activity_day: "2026-11-21",
  window_days: 3,
  window_activity_day_count: 1,
  baseline_day_count: 80,
};

function renderPanel({ gaps = [gap], expand = false } = {}) {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    font: "",
    measureText: (text) => ({ width: String(text).length * 6 }),
  });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ limitRows: [] }) })));
  const { container } = render(
    <UsageLimitsPanel order={["qoderCn"]} qoderCn={qoderCnData} usageGaps={gaps} />,
  );
  if (expand) {
    const header = container.querySelector('[role="button"][aria-expanded="false"]');
    if (header) fireEvent.click(header);
  }
  return container;
}

it("keeps the usage gap note hidden while the card is collapsed", () => {
  const container = renderPanel();
  expect(container.querySelector("[data-usage-gap-note]")).toBeNull();
});

it("shows the usage gap note in the card's expanded area with an MM-DD date", () => {
  const container = renderPanel({ expand: true });
  const note = container.querySelector("[data-usage-gap-note]");
  expect(note).not.toBeNull();
  expect(note.textContent).toBe(copy("limits.card.usage_gap", { date: "11-02" }));
});

it("shows no note for a session source without a matching card", () => {
  const container = renderPanel({ gaps: [{ ...gap, source: "dsh" }], expand: true });
  expect(container.querySelector("[data-usage-gap-note]")).toBeNull();
});
