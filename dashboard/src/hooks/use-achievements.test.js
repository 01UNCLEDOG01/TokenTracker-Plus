import { beforeEach, describe, expect, it, vi } from "vitest";
import { BADGE_BY_ID } from "../ui/achievements/badge-catalog.js";
import { TITLES_REGISTRY } from "../ui/achievements/title-registry.js";
import { getLocalAchievements } from "../lib/api";
import { triggerAchievementNotification } from "../ui/achievements/SteamAchievementToast.jsx";
import { pollAchievements } from "./use-achievements.js";

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
});
