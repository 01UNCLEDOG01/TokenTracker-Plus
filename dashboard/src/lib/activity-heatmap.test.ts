import { describe, expect, it } from "vitest";
import { buildActivityHeatmap } from "./activity-heatmap";

describe("buildActivityHeatmap 7-level tier distribution", () => {
  it("emits levels 0 to 6 across varied usage values", () => {
    // Construct values that hit every percentile tier
    const dailyRows: Array<{ day: string; billable_total_tokens: number }> = [];
    // 100 days of ascending values
    for (let i = 1; i <= 100; i++) {
      const day = `2026-01-${String(i).padStart(2, "0")}`;
      // Map i=1..100 to exponential token counts from 1M to 5B
      const tokens = Math.round(1e6 * Math.pow(5000, (i - 1) / 99));
      dailyRows.push({ day, billable_total_tokens: tokens });
    }

    const heatmap = buildActivityHeatmap({
      dailyRows,
      weeks: 16,
      to: "2026-04-10",
      weekStartsOn: "sun",
    });

    const observedLevels = new Set<number>();
    for (const week of heatmap.weeks) {
      for (const cell of week) {
        if (cell && cell.value > 0) {
          observedLevels.add(cell.level);
        }
      }
    }

    // Must hit levels 1, 2, 3, 4, 5, 6
    expect(observedLevels.has(1)).toBe(true);
    expect(observedLevels.has(2)).toBe(true);
    expect(observedLevels.has(3)).toBe(true);
    expect(observedLevels.has(4)).toBe(true);
    expect(observedLevels.has(5)).toBe(true);
    expect(observedLevels.has(6)).toBe(true);
  });

  it("assigns level 0 for zero or missing tokens", () => {
    const heatmap = buildActivityHeatmap({
      dailyRows: [{ day: "2026-04-01", billable_total_tokens: 0 }],
      weeks: 2,
      to: "2026-04-02",
      weekStartsOn: "sun",
    });

    const zeroCell = heatmap.weeks.flat().find((c) => c?.day === "2026-04-01");
    expect(zeroCell?.level).toBe(0);
    expect(zeroCell?.value).toBe(0);
  });
});
