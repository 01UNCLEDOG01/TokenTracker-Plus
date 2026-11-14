import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { BADGE_BY_ID } from "../ui/achievements/badge-catalog.js";
import { TITLES_REGISTRY } from "../ui/achievements/title-registry.js";
import { getLocalAchievements } from "../lib/api";
import { triggerAchievementNotification } from "../ui/achievements/SteamAchievementToast.jsx";
import { pollAchievements, pollLocalAchievements, useAchievements, useLocalAchievements } from "./use-achievements.js";

vi.mock("../lib/api", () => ({ getLocalAchievements: vi.fn() }));
vi.mock("../ui/achievements/SteamAchievementToast.jsx", () => ({
  triggerAchievementNotification: vi.fn(),
}));
vi.mock("../lib/copy", () => ({ copy: (key) => key }));

const BADGE_KEY = "tokentracker:achievement_tiers";
const TITLE_KEY = "tokentracker:title_resonance_tiers";

describe("achievement notification artwork", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("adds catalog artwork to an unlock payload", async () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 0 }));
    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 1 }] });

    await pollAchievements();

    expect(triggerAchievementNotification).toHaveBeenCalledWith(expect.objectContaining({
      badge: expect.objectContaining({ art: BADGE_BY_ID.get("kill_line").art }),
    }));
  });

  it("uses the title crest for a newly unlocked title", async () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ token_arbitrageur: 1, frugal_architect: 2 }));
    localStorage.setItem(TITLE_KEY, JSON.stringify({ frugal_archmage: { unlocked: false, tier: 0 } }));
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "token_arbitrageur", tier: 1 }, { id: "frugal_architect", tier: 2 }],
    });

    await pollAchievements();

    const title = TITLES_REGISTRY.find((item) => item.id === "frugal_archmage");
    expect(triggerAchievementNotification).toHaveBeenCalledWith(expect.objectContaining({
      badge: { id: title.id, art: title.art },
      isTierUp: false,
    }));
  });

  it("uses the same title crest for a resonance tier-up", async () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ token_arbitrageur: 2, frugal_architect: 2 }));
    localStorage.setItem(TITLE_KEY, JSON.stringify({ frugal_archmage: { unlocked: true, tier: 1 } }));
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "token_arbitrageur", tier: 2 }, { id: "frugal_architect", tier: 2 }],
    });

    await pollAchievements();

    const title = TITLES_REGISTRY.find((item) => item.id === "frugal_archmage");
    expect(triggerAchievementNotification).toHaveBeenCalledWith(expect.objectContaining({
      badge: { id: title.id, art: title.art },
      isTierUp: true,
      tier: 2,
    }));
  });

  it("records the first snapshot without firing notifications", async () => {
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "token_arbitrageur", tier: 2 }, { id: "frugal_architect", tier: 2 }],
    });

    await pollAchievements();

    expect(triggerAchievementNotification).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(TITLE_KEY)).frugal_archmage).toEqual({ unlocked: true, tier: 2 });
  });

  it("does not re-announce a badge that dips below its tier and climbs back", async () => {
    // kill_line rides the DeepSeek share, which wobbles around the 50% bronze
    // line — the exact shape behind the "same achievements keep unlocking" report.
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 0 }));
    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 1 }] });
    await pollAchievements();
    expect(triggerAchievementNotification).toHaveBeenCalledTimes(1);

    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 0 }] });
    await pollAchievements();
    expect(triggerAchievementNotification).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(BADGE_KEY)).kill_line).toBe(1); // high-water kept

    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 1 }] });
    await pollAchievements();
    expect(triggerAchievementNotification).toHaveBeenCalledTimes(1);
  });

  it("still announces a genuine tier-up after a dip", async () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 0 }));
    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 1 }] });
    await pollAchievements();

    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 0 }] });
    await pollAchievements();

    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 2 }] });
    await pollAchievements();

    expect(triggerAchievementNotification).toHaveBeenCalledTimes(2);
    expect(triggerAchievementNotification).toHaveBeenLastCalledWith(expect.objectContaining({
      isTierUp: true,
      tier: 2,
    }));
  });

  it("keeps the displayed tier at the high-water mark when the live reading dips", async () => {
    // Once unlocked, always unlocked: the page must not show a revoked badge
    // just because the live replay (share dilution, re-priced cost …) dipped.
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 2 }));
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "kill_line", tier: 1, thresholds: [50, 60, 70, 80], next_threshold: 60 }],
    });

    const result = await pollAchievements();

    const killLine = result.find((b) => b.id === "kill_line");
    expect(killLine.tier).toBe(2);
    // "Next tier" is re-derived from the floored tier so the detail modal
    // stays consistent with what the page shows.
    expect(killLine.next_threshold).toBe(70);
    expect(triggerAchievementNotification).not.toHaveBeenCalled();
    // Keep the server snapshot raw; first paint applies the current mark.
    const cached = JSON.parse(localStorage.getItem("tokentracker:cached_achievements"));
    expect(cached.find((b) => b.id === "kill_line").tier).toBe(1);
  });

  it("floors to diamond without a next threshold", async () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 4 }));
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "kill_line", tier: 2, thresholds: [50, 60, 70, 80], next_threshold: 70 }],
    });

    const result = await pollAchievements();

    const killLine = result.find((b) => b.id === "kill_line");
    expect(killLine.tier).toBe(4);
    expect(killLine.next_threshold).toBeNull();
  });

  it("leaves the payload untouched before any high-water snapshot exists", async () => {
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "kill_line", tier: 1, thresholds: [50, 60, 70, 80], next_threshold: 60 }],
    });

    const result = await pollAchievements();

    expect(result[0].tier).toBe(1);
    expect(result[0].next_threshold).toBe(60);
  });

  it("applies the high-water mark to an existing cache before the first response", () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 2 }));
    localStorage.setItem("tokentracker:cached_achievements", JSON.stringify([
      { id: "kill_line", tier: 0, metric_value: 20, thresholds: [50, 60, 70, 80], next_threshold: 50 },
    ]));
    getLocalAchievements.mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderHook(() => useAchievements());

    expect(result.current.achievements[0]).toMatchObject({ tier: 2, metric_value: 20, next_threshold: 70 });
    unmount();
  });

  it.each([1.5, 5, -1, "Infinity", "garbage"])("ignores a malformed stored tier %s", async (tier) => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: tier }));
    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 1 }] });

    expect((await pollAchievements())[0].tier).toBe(1);
  });

  it("treats an array-shaped tier record as a first observation", async () => {
    localStorage.setItem(BADGE_KEY, "[]");
    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 1 }] });

    expect((await pollAchievements())[0].tier).toBe(1);
    expect(triggerAchievementNotification).not.toHaveBeenCalled();
  });

  it("a remote raise lifts the wall silently; a local raise still toasts", async () => {
    // Both badges jump past the stored floor, but only the locally earned one
    // may toast — the remote raise came from another device (成就并集).
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 0, code_cannon: 0 }));
    getLocalAchievements.mockResolvedValue({
      achievements: [
        { id: "kill_line", tier: 2, remote_raised: true, local_tier: 0 },
        { id: "code_cannon", tier: 1 },
      ],
    });

    const achievements = await pollAchievements();

    expect(achievements.find((badge) => badge.id === "kill_line").tier).toBe(2);
    const badgeIds = triggerAchievementNotification.mock.calls.map((call) => call[0].badge.id);
    expect(badgeIds).toContain("code_cannon");
    expect(badgeIds).not.toContain("kill_line");
    // The high-water mark stores the merged tier, so the remote raise never
    // re-toasts on a later poll either.
    expect(JSON.parse(localStorage.getItem(BADGE_KEY))).toMatchObject({ kill_line: 2, code_cannon: 1 });
  });

  it("a remote raise does not toast for titles fed only by raised badges", async () => {
    // token_arbitrageur + frugal_architect feed frugal_archmage; both jumps are
    // remote, so the title lifts silently too.
    localStorage.setItem(BADGE_KEY, JSON.stringify({ token_arbitrageur: 0, frugal_architect: 0 }));
    localStorage.setItem(TITLE_KEY, JSON.stringify({ frugal_archmage: { unlocked: false, tier: 0 } }));
    getLocalAchievements.mockResolvedValue({
      achievements: [
        { id: "token_arbitrageur", tier: 1, remote_raised: true, local_tier: 0 },
        { id: "frugal_architect", tier: 2, remote_raised: true, local_tier: 0 },
      ],
    });

    await pollAchievements();

    expect(triggerAchievementNotification).not.toHaveBeenCalled();
    const stored = JSON.parse(localStorage.getItem(TITLE_KEY)).frugal_archmage;
    expect(stored.unlocked).toBe(true);
    expect(stored.tier).toBeGreaterThan(0);
  });
});

describe("local scope view (成就页「本机」页签)", () => {
  const LOCAL_BADGE_KEY = "tokentracker:achievement_tiers_local";
  const LOCAL_CACHE_KEY = "tokentracker:cached_achievements_local";

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("fetches with view=local and never fires toasts, titles, or union writes", async () => {
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 0 }));
    localStorage.setItem(TITLE_KEY, JSON.stringify({ frugal_archmage: { unlocked: false, tier: 0 } }));
    // A server that honors view=local answers with the pure device wall —
    // the union's remote_raised markers never appear in it (that downgrade
    // path has its own test below).
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "kill_line", tier: 2 }],
    });

    const result = await pollLocalAchievements();

    expect(getLocalAchievements).toHaveBeenCalledWith(expect.objectContaining({ view: "local" }));
    expect(result[0].tier).toBe(2);
    expect(triggerAchievementNotification).not.toHaveBeenCalled();
    // Titles and the union's high-water mark belong to the union poller alone.
    expect(localStorage.getItem(TITLE_KEY)).toBe(JSON.stringify({ frugal_archmage: { unlocked: false, tier: 0 } }));
    expect(localStorage.getItem(BADGE_KEY)).toBe(JSON.stringify({ kill_line: 0 }));
  });

  it("downgrades a union payload that an old server returned for view=local", async () => {
    // A server without ?view=local support answers the union wall; the local
    // tab must never show it under a 本机 label — derive the device tiers from
    // the payload's own local_tier markers instead.
    getLocalAchievements.mockResolvedValue({
      achievements: [{
        id: "kill_line",
        tier: 2,
        remote_raised: true,
        local_tier: 0,
        next_threshold: 60,
        thresholds: [50, 60, 70, 80],
      }],
    });

    const result = await pollLocalAchievements();

    expect(result[0].tier).toBe(0);
    expect(result[0].remote_raised).toBeUndefined();
    expect(result[0].local_tier).toBeUndefined();
    // The union's next_threshold pointed past the union tier; the device wall
    // aims at its OWN next bar (bronze → 50), not the union's (silver → 60).
    expect(result[0].next_threshold).toBe(50);
  });

  it("caches the downgraded wall, so an old server's union never repaints as 本机", async () => {
    // Regression for the adversarial-review P1: during the hot-mirror window
    // (new dashboard + not-yet-restarted server) every poll stores the raw
    // response; the next mount paints the cache before the fetch resolves.
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "kill_line", tier: 4, remote_raised: true, local_tier: 0 }],
    });
    await pollLocalAchievements();

    getLocalAchievements.mockReturnValue(new Promise(() => {}));
    const { result, unmount } = renderHook(() => useLocalAchievements());

    expect(result.current.achievements[0]).toMatchObject({ tier: 0 });
    expect(result.current.achievements[0].remote_raised).toBeUndefined();
    unmount();
  });

  it("keeps its own high-water mark, separate from the union's", async () => {
    // The union wall saw diamond (another device); this device only earned silver.
    localStorage.setItem(BADGE_KEY, JSON.stringify({ kill_line: 4 }));
    getLocalAchievements.mockResolvedValue({ achievements: [{ id: "kill_line", tier: 2 }] });

    expect((await pollLocalAchievements())[0].tier).toBe(2);
    expect(JSON.parse(localStorage.getItem(LOCAL_BADGE_KEY)).kill_line).toBe(2);

    // A dip in this device's own reading still floors at the local mark —
    // "once unlocked, always unlocked" applies to the local scope too.
    getLocalAchievements.mockResolvedValue({
      achievements: [{ id: "kill_line", tier: 1, thresholds: [50, 60, 70, 80] }],
    });
    expect((await pollLocalAchievements())[0]).toMatchObject({ tier: 2, next_threshold: 70 });
  });

  it("paints from the local cache before the first response", () => {
    localStorage.setItem(LOCAL_BADGE_KEY, JSON.stringify({ kill_line: 2 }));
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify([
      { id: "kill_line", tier: 1, metric_value: 20, thresholds: [50, 60, 70, 80], next_threshold: 60 },
    ]));
    getLocalAchievements.mockReturnValue(new Promise(() => {}));

    const { result, unmount } = renderHook(() => useLocalAchievements());

    expect(result.current.achievements[0]).toMatchObject({ tier: 2, metric_value: 20, next_threshold: 70 });
    unmount();
  });
});
