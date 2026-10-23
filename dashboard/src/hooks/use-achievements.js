import { useEffect, useMemo, useState } from "react";
import { getLocalAchievements } from "../lib/api";
import { getBrowserTimeZone, getBrowserTimeZoneOffsetMinutes } from "../lib/timezone";
import { triggerAchievementNotification } from "../ui/achievements/SteamAchievementToast.jsx";
import { copy } from "../lib/copy";

const TIERS_STORAGE_KEY = "tokentracker:achievement_tiers";

/**
 * Local achievements with real-time unlock detection and Steam audio-visual alerts.
 * Status machine, never throws — the achievements page renders the locked catalog on error.
 */
export function useAchievements({ enabled = true } = {}) {
  const [state, setState] = useState({ status: "loading", achievements: [], error: null });
  const timeZone = useMemo(() => getBrowserTimeZone(), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "disabled", achievements: [], error: null });
      return undefined;
    }
    let cancelled = false;
    setState((prev) => ({ ...prev, status: "loading" }));
    getLocalAchievements({ timeZone, tzOffsetMinutes: getBrowserTimeZoneOffsetMinutes() })
      .then((data) => {
        if (cancelled) return;
        const achievements = Array.isArray(data?.achievements) ? data.achievements : [];
        setState({
          status: "ready",
          achievements,
          error: null,
        });

        // Detect new unlocks and promotions
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
        } catch {
          // Safe handling for storage restrictions
        }
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
