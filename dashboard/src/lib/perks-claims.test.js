import { describe, it, expect } from "vitest";
import {
  getPerkClaimDay, nextPerkClaimDayDelay, getPerkClaimCycles, getPerkClaimDate,
  getPerkClaimStreak, isPerkClaimed, normalizePerkClaims, migrateLegacyPerkClaims,
  togglePerkClaim, PERKS_CLAIMS_KEY, PERKS_LEGACY_CLAIMS_KEY, PERKS_V1_CLAIMS_KEY,
} from "./perks-claims.mjs";
import zh from "../content/i18n/zh/core.json";
import zhTw from "../content/i18n/zh-TW/core.json";
import ja from "../content/i18n/ja/core.json";
import ko from "../content/i18n/ko/core.json";
import de from "../content/i18n/de/core.json";

const mixed = { id: "mixed", category: ["daily_claim", "monthly_claim"] };
const once = { id: "once", category: ["permanent_free"] };

describe("perk claim calendar and state (schema 3: {last, count})", () => {
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
    const claims = {
      mixed: { daily: { last: "2026-11-03", count: 4 }, monthly: { last: "2026-11-01", count: 2 } },
      once: { once: { last: "2026-10-01", count: 1 } },
    };
    expect(getPerkClaimCycles(mixed)).toEqual(["daily", "monthly"]);
    expect(isPerkClaimed(mixed, claims, "2026-11-03")).toBe(true);
    expect(getPerkClaimDate(mixed, claims, "daily", "2026-11-04")).toBeNull();
    expect(getPerkClaimDate(mixed, claims, "monthly", "2026-11-30")).toBe("2026-11-01");
    expect(getPerkClaimDate(mixed, claims, "monthly", "2026-12-01")).toBeNull();
    expect(isPerkClaimed(mixed, claims, "2026-11-04", "monthly_claim")).toBe(true);
    expect(isPerkClaimed(once, claims, "2027-01-01")).toBe(true);
    expect(getPerkClaimStreak(mixed, claims, "daily")).toBe(4);
    expect(getPerkClaimStreak(once, claims, "once")).toBe(1);
    expect(getPerkClaimStreak(mixed, claims, "once")).toBe(0);
  });
  it("ignores malformed and future records instead of hiding reminders", () => {
    const raw = { schema: 3, providers: { mixed: { daily: { last: "2026-02-30", count: 3 }, monthly: { last: "2026-11-20", count: 1 } }, unknown: { once: { last: "2026-11-01", count: 1 } } } };
    const claims = normalizePerkClaims(raw, [mixed, once]);
    // A corrupt `last` is dropped as a reminder, but the lifetime count
    // survives as an unclaimed entry — brightness never regresses.
    expect(claims).toEqual({ mixed: { daily: { count: 3 }, monthly: { last: "2026-11-20", count: 1 } } });
    expect(isPerkClaimed(mixed, claims, "2026-11-03", "monthly_claim")).toBe(false);
    expect(normalizePerkClaims({ schema: 2, providers: raw.providers }, [mixed])).toEqual({});
    expect(normalizePerkClaims([], [mixed])).toEqual({});
  });
  it("migrates v2 string entries and v1 whole-card entries into {last, count:1}", () => {
    const v2 = { schema: 2, providers: { mixed: { daily: "2026-11-01", monthly: "2026-11-01" }, once: { once: "2026-10-01" } } };
    expect(migrateLegacyPerkClaims(v2, [mixed, once])).toEqual({
      mixed: { daily: { last: "2026-11-01", count: 1 }, monthly: { last: "2026-11-01", count: 1 } },
      once: { once: { last: "2026-10-01", count: 1 } },
    });
    const v1 = { mixed: "2026-11-01", once: "2026-10-01", unknown: "2026-11-01" };
    expect(migrateLegacyPerkClaims(v1, [mixed, once])).toEqual({
      mixed: { daily: { last: "2026-11-01", count: 1 }, monthly: { last: "2026-11-01", count: 1 } },
      once: { once: { last: "2026-10-01", count: 1 } },
    });
    expect(v1.mixed).toBe("2026-11-01");
    expect(PERKS_LEGACY_CLAIMS_KEY).toContain("v2");
    expect(PERKS_V1_CLAIMS_KEY).toContain("v1");
    expect(PERKS_CLAIMS_KEY).toContain("v3");
  });
  it("toggle counts lifetime claims and never regresses the streak on unclaim", () => {
    const empty = {};
    // First claim: count 1.
    const first = togglePerkClaim(empty, mixed, "daily", "2026-11-01");
    expect(first.mixed.daily).toEqual({ last: "2026-11-01", count: 1 });
    // Next day re-claim: count 2.
    const second = togglePerkClaim(first, mixed, "daily", "2026-11-02");
    expect(second.mixed.daily).toEqual({ last: "2026-11-02", count: 2 });
    // Unclaim drops `last` but keeps the lifetime count.
    const unclaimed = togglePerkClaim(second, mixed, "daily", "2026-11-02");
    expect(unclaimed.mixed.daily).toEqual({ count: 2 });
    expect(getPerkClaimStreak(mixed, unclaimed, "daily")).toBe(2);
    expect(getPerkClaimDate(mixed, unclaimed, "daily", "2026-11-02")).toBeNull();
    // Re-claim after unclaim continues the count (3), not a reset.
    const reclaimed = togglePerkClaim(unclaimed, mixed, "daily", "2026-11-02");
    expect(reclaimed.mixed.daily).toEqual({ last: "2026-11-02", count: 3 });
    // The other period stays untouched.
    expect(reclaimed.mixed.monthly).toBeUndefined();
    expect(() => togglePerkClaim(empty, mixed, "once", "2026-11-03")).toThrow(TypeError);
  });
  it("defines reminder and album labels in every shipped translation registry", () => {
    for (const locale of [zh, zhTw, ja, ko, de]) {
      for (const key of [
        "perks.claim.daily_mark", "perks.claim.daily_claimed", "perks.claim.monthly_mark", "perks.claim.monthly_claimed",
        "perks.view.list", "perks.view.album", "perks.album.prev", "perks.album.next", "perks.album.hint",
      ]) {
        expect(locale[key]).toBeTypeOf("string");
        expect(locale[key].length).toBeGreaterThan(0);
        if (key.endsWith("_claimed")) expect(locale[key]).toContain("{{date}}");
      }
      expect(locale["perks.album.page"]).toContain("{{page}}");
    }
  });
});
