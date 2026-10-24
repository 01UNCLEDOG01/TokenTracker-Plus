import { useEffect, useMemo, useState } from "react";
import { getLocalAchievements } from "../lib/api";
import { getBrowserTimeZone, getBrowserTimeZoneOffsetMinutes } from "../lib/timezone";
import { triggerAchievementNotification } from "../ui/achievements/SteamAchievementToast.jsx";
import { copy } from "../lib/copy";

const TIERS_STORAGE_KEY = "tokentracker:achievement_tiers";
const ACHIEVEMENTS_CACHE_KEY = "tokentracker:cached_achievements";

function getCachedAchievements() {
  try {
    const raw = localStorage.getItem(ACHIEVEMENTS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Poll local achievements, evaluate progression and trigger toasts on unlocks/tier-ups.
 */
export async function pollAchievements({ timeZone } = {}) {
  const tz = timeZone || getBrowserTimeZone();
  const data = await getLocalAchievements({ timeZone: tz, tzOffsetMinutes: getBrowserTimeZoneOffsetMinutes() });
  const achievements = Array.isArray(data?.achievements) ? data.achievements : [];

  try {
    const raw = localStorage.getItem(TIERS_STORAGE_KEY);
    const prevTiers = raw ? JSON.parse(raw) : null;
    const currentTiers = {};
    for (const b of achievements) {
      if (b && b.id) {
        currentTiers[b.id] = b.tier || 0;
      }
    }

    if (prevTiers) {
      for (const b of achievements) {
        const oldTier = prevTiers[b.id] || 0;
        const curTier = b.tier || 0;
        if (curTier > oldTier) {
          const nameKey = `achievements.badge.${b.id}.name`;
          const descKey = `achievements.badge.${b.id}.desc`;
          triggerAchievementNotification({
            badge: b,
            tier: curTier,
            isTierUp: oldTier >= 1,
            name: copy(nameKey) || b.id,
            desc: copy(descKey) || "",
          });
        }
      }
    }
    localStorage.setItem(TIERS_STORAGE_KEY, JSON.stringify(currentTiers));
    localStorage.setItem(ACHIEVEMENTS_CACHE_KEY, JSON.stringify(achievements));
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

    // Stagger initial check by 2.5s to ensure clean app startup
    const initialTimer = setTimeout(() => {
      if (cancelled) return;
      void runCheck();
      timer = setInterval(() => {
        if (cancelled) return;
        void runCheck();
      }, intervalMs);
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      if (timer) clearInterval(timer);
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
