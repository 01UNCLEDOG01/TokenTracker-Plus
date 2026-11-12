import { useEffect, useMemo, useState } from "react";
import { getLocalAchievements } from "../lib/api";
import { getBrowserTimeZone, getBrowserTimeZoneOffsetMinutes } from "../lib/timezone";
import { triggerAchievementNotification } from "../ui/achievements/SteamAchievementToast.jsx";
import { BADGE_BY_ID } from "../ui/achievements/badge-catalog.js";
import { TITLES_REGISTRY, getTitleResonance } from "../ui/achievements/title-registry.js";
import { copy } from "../lib/copy";

const TIERS_STORAGE_KEY = "tokentracker:achievement_tiers";
const TITLE_RESONANCE_STORAGE_KEY = "tokentracker:title_resonance_tiers";
const ACHIEVEMENTS_CACHE_KEY = "tokentracker:cached_achievements";

function getCachedAchievements() {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return floorAchievementsAtHighWater({ achievements: parsed });
    }
  } catch {
    // ignore
  }
  return null;
}

function readHighWaterTiers() {
  try {
    const raw = localStorage.getItem(TIERS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).filter(([, tier]) =>
      Number.isInteger(tier) && tier >= 0 && tier <= 4,
    ));
  } catch {
    return null;
  }
}

// Once unlocked, always unlocked. The server recomputes every badge from the
// live queue on each poll, so share badges (kill_line / heart_model) and
// re-priced cost badges legitimately dip below a tier the user has already
// seen. The 2026-10-27 high-water mark only stopped toasts from re-firing;
// the page still rendered the dipped reading, which looked like a revoked
// achievement. Floor every displayed tier at the best tier this browser has
// ever observed — toasts stay honest because max(live, highWater) > highWater
// is exactly "the live reading climbed above the mark".
function floorAchievementsAtHighWater(data) {
  const achievements = Array.isArray(data?.achievements) ? data.achievements : [];
  const prevTiers = readHighWaterTiers();
  if (!prevTiers) return achievements;
  return achievements.map((badge) => {
    if (!badge?.id) return badge;
    const highWater = prevTiers[badge.id] || 0;
    const tier = badge.tier || 0;
    if (highWater <= tier) return badge;
    return {
      ...badge,
      tier: highWater,
      // Re-derive from the floored tier so the detail modal's "next tier"
      // matches what the page shows, not the dipped live reading.
      next_threshold: Array.isArray(badge.thresholds)
        ? (highWater >= badge.thresholds.length ? null : badge.thresholds[highWater])
        : badge.next_threshold,
    };
  });
}

/**
 * Poll local achievements, evaluate progression and trigger toasts on unlocks/tier-ups.
 */
export async function pollAchievements({ timeZone } = {}) {
  const tz = timeZone || getBrowserTimeZone();
  const data = await getLocalAchievements({ timeZone: tz, tzOffsetMinutes: getBrowserTimeZoneOffsetMinutes() });
  const achievements = floorAchievementsAtHighWater(data);

  try {
    const prevTiers = readHighWaterTiers();

    if (prevTiers) {
      for (const b of achievements) {
        const oldTier = prevTiers[b.id] || 0;
        const curTier = b.tier || 0;
        // remote_raised: the tier came from the account union (another device
        // earned it) — lift the wall silently. Toasts only fire for movement
        // this device earned itself; otherwise the first sync after signing in
        // would replay the other machine's whole history as toasts.
        if (curTier > oldTier && !b.remote_raised) {
          const nameKey = `achievements.badge.${b.id}.name`;
          const descKey = `achievements.badge.${b.id}.desc`;
          triggerAchievementNotification({
            badge: { ...b, art: b.art || BADGE_BY_ID.get(b.id)?.art },
            tier: curTier,
            isTierUp: oldTier >= 1,
            name: copy(nameKey) || b.id,
            desc: copy(descKey) || "",
          });
        }
      }
    }
    // Persist a high-water mark, not the latest reading. Share- and streak-based
    // badges (kill_line, heart_model, streak, zen_balancer …) legitimately drop
    // when the underlying ratio moves, and storing the dipped value made every
    // rebound look like a fresh unlock. Apply the mark at read time for both
    // live responses and the first-paint cache; keep the cached snapshot raw.
    const highWaterTiers = {};
    for (const b of achievements) {
      if (b && b.id) highWaterTiers[b.id] = Math.max(b.tier || 0, prevTiers?.[b.id] || 0);
    }
    const previousTitles = JSON.parse(localStorage.getItem(TITLE_RESONANCE_STORAGE_KEY) || "null");
    const badgeMap = new Map(achievements.map((badge) => [badge.id, { id: badge.id, tier: badge.tier || 0 }]));
    // Titles persist from the merged wall (badgeMap), but the toast decision
    // runs on locally earned tiers only — a remote raise must lift the title
    // silently, exactly like the badges that feed it.
    const toastBadgeMap = new Map(achievements.map((badge) => [badge.id, {
      id: badge.id,
      tier: badge.remote_raised ? Math.max(badge.local_tier || 0, prevTiers?.[badge.id] || 0) : (badge.tier || 0),
    }]));
    const currentTitleTiers = {};
    for (const title of TITLES_REGISTRY) {
      const resonance = getTitleResonance(title, badgeMap);
      const unlocked = Boolean(resonance.unlocked);
      const tier = unlocked ? resonance.tier : 0;
      const previous = previousTitles?.[title.id];
      // Same reasoning as the badge tiers: keep the best state ever seen.
      currentTitleTiers[title.id] = {
        unlocked: unlocked || Boolean(previous?.unlocked),
        tier: Math.max(tier, previous?.tier || 0),
      };
      const toastResonance = getTitleResonance(title, toastBadgeMap);
      const toastUnlocked = Boolean(toastResonance.unlocked);
      const toastTier = toastUnlocked ? toastResonance.tier : 0;
      if (previousTitles && toastUnlocked && (!previous?.unlocked || toastTier > (previous.tier || 0))) {
        triggerAchievementNotification({
          badge: { id: title.id, art: title.art },
          tier: toastTier || 1,
          isTierUp: Boolean(previous?.unlocked),
          // Own visual language (violet link-up) — must not reuse the
          // achievement promotion flare.
          kind: "resonance",
          name: title.name,
          desc: previous?.unlocked ? `共鸣提升至 ${resonance.label}` : title.desc,
        });
      }
    }
    localStorage.setItem(TITLE_RESONANCE_STORAGE_KEY, JSON.stringify(currentTitleTiers));
    localStorage.setItem(TIERS_STORAGE_KEY, JSON.stringify(highWaterTiers));
    localStorage.setItem(ACHIEVEMENTS_CACHE_KEY, JSON.stringify(data.achievements));
  } catch {
    // Safe handling for storage restrictions
  }

  return achievements;
}

/**
 * Background watcher mounted globally in AppLayout/App.
 * Periodically polls achievements every intervalMs (default 60s) so toasts
 * pop up anywhere in the app without requiring visits to the Achievements page.
 */
export function useAchievementWatcher({ intervalMs = 60000, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    let timer = null;
    let cancelled = false;

    const runCheck = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        await pollAchievements();
      } catch {
        // Silently ignore background poll errors
      }
    };

    // Fast initial check on app startup (400ms delay)
    const initialTimer = setTimeout(() => {
      if (cancelled) return;
      void runCheck();
      timer = setInterval(() => {
        if (cancelled) return;
        void runCheck();
      }, intervalMs);
    }, 400);

    // Instant check when user opens the panel or brings window into focus
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void runCheck();
      }
    };
    const onFocus = () => {
      void runCheck();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs]);
}

/**
 * Local achievements with real-time unlock detection and Steam audio-visual alerts.
 * Status machine, never throws — the achievements page renders the locked catalog on error.
 */
export function useAchievements({ enabled = true } = {}) {
  const [state, setState] = useState(() => {
    const cached = typeof window !== "undefined" ? getCachedAchievements() : null;
    if (cached) {
      return { status: "ready", achievements: cached, error: null };
    }
    return { status: "loading", achievements: [], error: null };
  });
  const timeZone = useMemo(() => getBrowserTimeZone(), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "disabled", achievements: [], error: null });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading" }));
    pollAchievements({ timeZone })
      .then((achievements) => {
        if (cancelled) return;
        setState({
          status: "ready",
          achievements,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ status: "error", achievements: [], error });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, timeZone]);

  return state;
}

export default useAchievements;
