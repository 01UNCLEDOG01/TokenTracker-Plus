import { describe, expect, it } from "vitest";
import { getCopyLocale, setCopyLocale } from "./copy";
import { ZH_CN_LOCALE } from "./locale";
import {
  formatCompactTokens,
  buildPetLimitSummary,
  buildPetLimitSummaries,
  buildQuipPool,
  formatPetLimitSummary,
  petLabels,
} from "./pet-quips.js";

describe("desktop pet limit dialogue", () => {
  it("lists every used provider window that is not full", () => {
    const limits = {
      claude: {
        configured: true,
        error: null,
        five_hour: { utilization: 61, resets_at: "2099-01-01T00:00:00Z" },
      },
      codex: {
        configured: true,
        error: null,
        primary_window: { used_percent: 87, reset_at: 4102444800 },
      },
      cursor: {
        configured: true,
        error: null,
        primary_window: { used_percent: 0, reset_at: 4102444800 },
        tertiary_window: { used_percent: 100, reset_at: 4102444800 },
      },
    };

    const readings = buildPetLimitSummaries(limits);
    expect(readings.map(({ provider, window }) => `${provider} ${window}`)).toEqual([
      "Codex 5h",
      "Claude 5h",
    ]);

    const reading = buildPetLimitSummary(limits);

    expect(reading).toMatchObject({ provider: "Codex", window: "5h", usedPercent: 87 });
    expect(formatPetLimitSummary("zh-CN", reading)).toContain("Codex 5h · 接近上限");
    expect(formatPetLimitSummary("en", reading)).toContain(" · in ");
    expect(formatPetLimitSummary("en", reading)).not.toContain("↻");
    const atLimit = formatPetLimitSummary("en", { ...reading, usedPercent: 100 });
    expect(atLimit).toContain("Codex 5h · at limit");
    expect(atLimit).not.toMatch(/\d+%/);
  });

  it("names ZCode windows by plan kind and start-plan bucket labels", () => {
    const zcodeStart = {
      configured: true,
      error: null,
      plan_kind: "start-plan",
      primary_window: { used_percent: 40, reset_at: "2099-01-01T00:00:00Z" },
      buckets: [
        { label: "GLM-5.3", window: { used_percent: 40, reset_at: "2099-01-01T00:00:00Z" } },
        { label: "GLM-5.3-Flash · ZCode Weekend Build", window: { used_percent: 20, reset_at: "2099-01-03T00:00:00Z" } },
      ],
    };
    expect(buildPetLimitSummaries({ zcode: zcodeStart }).map(({ window }) => window)).toEqual([
      "GLM-5.3",
      "GLM-5.3-Flash · ZCode Weekend Build",
    ]);

    const zcodeCoding = {
      configured: true,
      error: null,
      plan_kind: "coding-plan",
      primary_window: { used_percent: 30, reset_at: "2099-01-01T00:00:00Z" },
    };
    expect(buildPetLimitSummaries({ zcode: zcodeCoding }).map(({ window }) => window)).toEqual(["5h"]);
  });

  it("surfaces Command Code 5h/weekly windows when they are partially used", () => {
    const limits = {
      commandCode: {
        configured: true,
        error: null,
        primary_window: { used_percent: 42, reset_at: "2099-01-01T00:00:00Z" },
        secondary_window: { used_percent: 3, reset_at: "2099-01-02T00:00:00Z" },
      },
      // A configured-but-empty provider contributes no pet line.
      opencodeGo: { configured: true, error: null, primary_window: { used_percent: 0, reset_at: 0 } },
    };

    const readings = buildPetLimitSummaries(limits);
    expect(readings.map(({ provider, window }) => `${provider} ${window}`)).toEqual([
      "Command Code 5h",
      "Command Code Weekly",
    ]);
  });

  it("resolves Command Code labels through the copy registry per locale (review 594)", () => {
    const prevLocale = getCopyLocale();
    try {
      setCopyLocale(ZH_CN_LOCALE);
      const limits = {
        commandCode: {
          configured: true,
          error: null,
          primary_window: { used_percent: 42, reset_at: "2099-01-01T00:00:00Z" },
          secondary_window: { used_percent: 3, reset_at: "2099-01-02T00:00:00Z" },
        },
      };

      const readings = buildPetLimitSummaries(limits);
      // The provider name stays the brand; the weekly window must come from
      // the zh-CN registry (每周), not a hardcoded English literal.
      expect(readings.map(({ provider, window }) => `${provider} ${window}`)).toEqual([
        "Command Code 5h",
        "Command Code 每周",
      ]);
    } finally {
      setCopyLocale(prevLocale);
    }
  });

  it("surfaces Devin daily/weekly windows with localized labels", () => {
    const prevLocale = getCopyLocale();
    try {
      setCopyLocale(ZH_CN_LOCALE);
      const limits = {
        devin: {
          configured: true,
          error: null,
          primary_window: { used_percent: 60, reset_at: "2099-01-01T00:00:00Z" },
          secondary_window: { used_percent: 10, reset_at: "2099-01-02T00:00:00Z" },
        },
      };

      const readings = buildPetLimitSummaries(limits);
      expect(readings.map(({ provider, window }) => `${provider} ${window}`)).toEqual([
        "Devin 每日",
        "Devin 每周",
      ]);
    } finally {
      setCopyLocale(prevLocale);
    }
  });

  it("pins the owner's four rows to the top and shows a reset bucket at 0%", () => {
    const limits = {
      antigravity: {
        configured: true,
        error: null,
        // Pinned order: Gemini weekly → Gemini 5h → Claude weekly. The
        // freshly reset 5h bucket has no window at all yet — it must still
        // appear as 0% instead of silently dropping off the card.
        primary_window: { used_percent: 62, reset_at: "2099-01-03T00:00:00Z" },
        secondary_window: { used_percent: 8, reset_at: "2099-01-02T00:00:00Z" },
        tertiary_window: { used_percent: 30, reset_at: "2099-01-01T00:00:00Z" },
        quaternary_window: null,
      },
      apigoto: {
        configured: true,
        error: null,
        primary_window: { used_percent: 98, reset_at: "2099-01-04T00:00:00Z" },
      },
      // Higher urgency than every pinned row, but unpinned: sorts after them.
      cursor: {
        configured: true,
        error: null,
        primary_window: { used_percent: 99, reset_at: "2099-01-05T00:00:00Z" },
      },
    };

    const readings = buildPetLimitSummaries(limits);
    expect(readings.map(({ provider, window, usedPercent }) => `${provider} ${window} ${usedPercent}`)).toEqual([
      "Antigravity Gemini weekly 30",
      "Antigravity Gemini 5h 0",
      "Antigravity Claude weekly 62",
      "APIGOTO weekly 98",
      "Cursor Plan 99",
      "Antigravity Claude 5h 8",
    ]);
  });

  it("keeps SenseNova's Flash-Lite rows on the card even at 0%", () => {
    const limits = {
      sensenova: {
        configured: true,
        error: null,
        // General pool carries usage in both windows; the card deliberately
        // does not show it (only the Flash-Lite pair rides along).
        primary_window: { used_percent: 12, reset_at: "2099-01-01T00:00:00Z" },
        secondary_window: { used_percent: 34, reset_at: "2099-01-02T00:00:00Z" },
        // Flash-Lite pool: the pinned pair the owner watches, both untouched.
        tertiary_window: { used_percent: 0, reset_at: "2099-01-01T00:00:00Z" },
        quaternary_window: null,
      },
    };

    const readings = buildPetLimitSummaries(limits);
    expect(readings.map(({ provider, window, usedPercent }) => `${provider} ${window} ${usedPercent}`)).toEqual([
      "SenseNova Flash-Lite 5h 0",
      "SenseNova Flash-Lite weekly 0",
    ]);
  });

  it("keeps the pinned pairs pinned when their labels are localized", () => {
    const prevLocale = getCopyLocale();
    try {
      // The card prints the localized label, but pinned matching runs on the
      // stable window key — a translated label must never unpin a row (the
      // SenseNova weekly row used to fall off in Chinese for exactly that).
      setCopyLocale(ZH_CN_LOCALE);
      const limits = {
        antigravity: {
          configured: true,
          error: null,
          primary_window: { used_percent: 62, reset_at: "2099-01-03T00:00:00Z" },
          tertiary_window: { used_percent: 30, reset_at: "2099-01-01T00:00:00Z" },
        },
        sensenova: {
          configured: true,
          error: null,
          tertiary_window: { used_percent: 0, reset_at: "2099-01-01T00:00:00Z" },
          quaternary_window: null,
        },
      };

      const readings = buildPetLimitSummaries(limits);
      expect(readings.map(({ provider, window }) => `${provider} ${window}`)).toEqual([
        "Antigravity Gemini weekly",
        "Antigravity Gemini 5h",
        "Antigravity Claude weekly",
        "SenseNova Flash-Lite 5h",
        "SenseNova Flash-Lite 周",
      ]);
    } finally {
      setCopyLocale(prevLocale);
    }
  });

  it("caps the card at six rows so the pinned dashboard keeps every slot", () => {
    const pinned = (provider, window) => ({ configured: true, error: null, [window]: { used_percent: 5, reset_at: "2099-01-01T00:00:00Z" } });
    const limits = {
      antigravity: { configured: true, error: null,
        primary_window: { used_percent: 62, reset_at: "2099-01-03T00:00:00Z" },
        quaternary_window: { used_percent: 23, reset_at: "2099-01-02T00:00:00Z" },
        tertiary_window: { used_percent: 30, reset_at: "2099-01-01T00:00:00Z" } },
      apigoto: pinned("apigoto", "primary_window"),
      sensenova: { configured: true, error: null,
        tertiary_window: { used_percent: 0, reset_at: "2099-01-01T00:00:00Z" },
        quaternary_window: { used_percent: 0, reset_at: "2099-01-02T00:00:00Z" } },
      // Louder than every pinned row, but the six pinned slots take the card.
      cursor: { configured: true, error: null, primary_window: { used_percent: 99, reset_at: "2099-01-05T00:00:00Z" } },
    };

    const readings = buildPetLimitSummaries(limits);
    expect(readings).toHaveLength(6);
    expect(readings.map(({ provider }) => provider)).toEqual([
      "Antigravity", "Antigravity", "Antigravity", "APIGOTO", "SenseNova", "SenseNova",
    ]);
    expect(readings.some(({ provider }) => provider === "Cursor")).toBe(false);
  });

  it("adds the limit line to the tap conversation without replacing token quips", () => {
    const pool = buildQuipPool("en", {
      tokens: 1200,
      tokensText: "1.2K",
      costText: "$0.12",
      costValue: 0.12,
      limitText: "Codex 5h · near limit · in 2h",
    });

    expect(pool).toContain("Codex 5h · near limit · in 2h");
    expect(pool.some((line) => line.includes("1.2K"))).toBe(true);
  });
});

describe("desktop pet bubble labels", () => {
  it("has a localized label for usage no model is attributed to", () => {
    for (const locale of ["en", "zh-CN", "zh-TW", "ja", "ko"]) {
      expect(petLabels(locale).newUsage, locale).toBeTruthy();
    }
    expect(petLabels("en").newUsage).toBe("New usage");
  });
});

describe("formatCompactTokens unit system", () => {
  it("keeps K/M/B by default and switches to 万/亿 for the chinese unit system", () => {
    expect(formatCompactTokens(12_345)).toBe("12.3K");
    expect(formatCompactTokens(12_345, { unitSystem: "english" })).toBe("12.3K");
    expect(formatCompactTokens(12_345, { unitSystem: "chinese" })).toBe("1.2万");
    expect(formatCompactTokens(123_456_789, { unitSystem: "chinese" })).toBe("1.2亿");
  });

  it("threads the unit system into rolling-total quips", () => {
    const pool = buildQuipPool("en", { last7dTokens: 123_456_789, unitSystem: "chinese" });
    expect(pool.some((line) => line.includes("1.2亿"))).toBe(true);
    expect(pool.some((line) => line.includes("123.5M"))).toBe(false);
  });
});
