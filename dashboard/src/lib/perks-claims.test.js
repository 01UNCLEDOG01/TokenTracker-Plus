import { describe, it, expect } from "vitest";
import {
  getPerkClaimDay, nextPerkClaimDayDelay, getPerkClaimCycles, getPerkClaimDate,
  isPerkClaimed, normalizePerkClaims, migrateLegacyPerkClaims, togglePerkClaim,
} from "./perks-claims.mjs";
import zh from "../content/i18n/zh/core.json";
import zhTw from "../content/i18n/zh-TW/core.json";
import ja from "../content/i18n/ja/core.json";
import ko from "../content/i18n/ko/core.json";
import de from "../content/i18n/de/core.json";

const mixed = { id: "mixed", category: ["daily_claim", "monthly_claim"] };
const once = { id: "once", category: ["permanent_free"] };

describe("perk claim calendar and state", () => {
  it("uses Beijing day boundaries and calculates the next midnight", () => {
    const before = Date.parse("2026-10-31T15:59:59.000Z");
    expect(getPerkClaimDay(before)).toBe("2026-10-31");
    expect(nextPerkClaimDayDelay(before)).toBe(1_000);
    expect(getPerkClaimDay(before + 1_000)).toBe("2026-11-01");
    expect(nextPerkClaimDayDelay(before + 1_000)).toBe(86_400_000);
    expect(getPerkClaimDay(Date.parse("2026-12-31T16:00:00Z"))).toBe("2027-01-01");
    expect(getPerkClaimDay(Date.parse("2024-02-29T16:00:00Z"))).toBe("2024-03-01");
  });
  it("resets daily and monthly independently; one-time records stay claimed", () => {
    const claims = { mixed: { daily: "2026-11-03", monthly: "2026-11-01" }, once: { once: "2026-10-01" } };
    expect(getPerkClaimCycles(mixed)).toEqual(["daily", "monthly"]);
    expect(isPerkClaimed(mixed, claims, "2026-11-03")).toBe(true);
    expect(getPerkClaimDate(mixed, claims, "daily", "2026-11-04")).toBeNull();
    expect(getPerkClaimDate(mixed, claims, "monthly", "2026-11-30")).toBe("2026-11-01");
    expect(getPerkClaimDate(mixed, claims, "monthly", "2026-12-01")).toBeNull();
    expect(isPerkClaimed(mixed, claims, "2026-11-04", "monthly_claim")).toBe(true);
    expect(isPerkClaimed(once, claims, "2027-01-01")).toBe(true);
  });
  it("ignores malformed and future records instead of hiding reminders", () => {
    const raw = { schema: 2, providers: { mixed: { daily: "2026-02-30", monthly: "2026-11-20" }, unknown: { once: "2026-11-01" } } };
    const claims = normalizePerkClaims(raw, [mixed, once]);
    expect(claims).toEqual({ mixed: { monthly: "2026-11-20" } });
    expect(isPerkClaimed(mixed, claims, "2026-11-03", "monthly_claim")).toBe(false);
    expect(normalizePerkClaims({ schema: 1, providers: raw.providers }, [mixed])).toEqual({});
    expect(normalizePerkClaims([], [mixed])).toEqual({});
  });
  it("migrates only recognized dated entries without changing the input", () => {
    const legacy = { mixed: "2026-11-01", once: "2026-10-01", unknown: "2026-11-01" };
    expect(migrateLegacyPerkClaims(legacy, [mixed, once])).toEqual({ mixed: { daily: "2026-11-01", monthly: "2026-11-01" }, once: { once: "2026-10-01" } });
    expect(legacy.mixed).toBe("2026-11-01");
  });
  it("toggle overwrites stale cycles and keeps the other period immutable", () => {
    const old = { mixed: { daily: "2026-11-02", monthly: "2026-11-01" } };
    const next = togglePerkClaim(old, mixed, "daily", "2026-11-03");
    expect(next.mixed).toEqual({ daily: "2026-11-03", monthly: "2026-11-01" });
    expect(old.mixed.daily).toBe("2026-11-02");
    expect(togglePerkClaim(next, mixed, "daily", "2026-11-03").mixed).toEqual({ monthly: "2026-11-01" });
    expect(() => togglePerkClaim(old, mixed, "once", "2026-11-03")).toThrow(TypeError);
  });
  it("defines new reminder labels in every shipped translation registry", () => {
    for (const locale of [zh, zhTw, ja, ko, de]) {
      for (const key of ["perks.claim.daily_mark", "perks.claim.daily_claimed", "perks.claim.monthly_mark", "perks.claim.monthly_claimed"]) {
        expect(locale[key]).toBeTypeOf("string");
        expect(locale[key].length).toBeGreaterThan(0);
        if (key.endsWith("_claimed")) expect(locale[key]).toContain("{{date}}");
      }
    }
  });
});
