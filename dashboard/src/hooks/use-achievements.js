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
// 成就页「本机」页签的独立存储：水位与首屏缓存各一套，云端并集抬过的等级
// 绝不能漏进本机视图（新 key 从空起步，无旧形状要迁移）。
const LOCAL_TIERS_STORAGE_KEY = "tokentracker:achievement_tiers_local";
const LOCAL_ACHIEVEMENTS_CACHE_KEY = "tokentracker:cached_achievements_local";

function getCachedAchievements(cacheKey = ACHIEVEMENTS_CACHE_KEY, tiersKey = TIERS_STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return floorAchievementsAtHighWater({ achievements: parsed }, tiersKey);
    }
  } catch {
    // ignore
  }
  return null;
}

function readHighWaterTiers(tiersKey = TIERS_STORAGE_KEY) {
  try {
    const raw = localStorage.getItem(tiersKey);
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
function floorAchievementsAtHighWater(data, tiersKey = TIERS_STORAGE_KEY) {
  const achievements = Array.isArray(data?.achievements) ? data.achievements : [];
  const prevTiers = readHighWaterTiers(tiersKey);
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

// 旧服务端不认识 ?view=local 时会把并集墙原样吐回来——绝不能把它挂在
// 「本机」名下。降级：按 payload 自带的 local_tier 标记还原本机等级，解锁
// 时间退化为并集的最早值，进度条按本机等级重推下一档门槛。新服务端（view
// 生效）不会出现 remote_raised，此函数原样放行。
function downgradeMergedToLocal(badge) {
  if (!badge?.remote_raised) return badge;
  const localTier = Number(badge.local_tier);
  const tier = Number.isFinite(localTier) ? localTier : 0;
  const { remote_raised: _ignored, local_tier: _ignoredTier, ...rest } = badge;
  return {
    ...rest,
    tier,
    // The union payload's next_threshold points past the union tier — re-derive
    // it from the device's own tier or the 本机 progress bar aims at the wrong bar.
    next_threshold: Array.isArray(rest.thresholds)
      ? (tier >= rest.thresholds.length ? null : rest.thresholds[tier])
      : rest.next_threshold,
  };
}

/**
 * 成就页「本机」页签的取数：view=local 直取服务端合并前的纯本机墙。
 * 与 pollAchievements 的差异——不发解锁弹窗、不写共鸣标题、不碰云端并集的
 * 水位/缓存 key（弹窗与标题的判定只属于全量轮询；本机页签只是另一个口径的
 * 显示层）。水位同样按「解锁即永久」保留，但用的是本机自己的 key，所以云端
 * 并集抬过的等级不会漏进来。
 */
export async function pollLocalAchievements({ timeZone } = {}) {
  const tz = timeZone || getBrowserTimeZone();
  const data = await getLocalAchievements({
    timeZone: tz,
    tzOffsetMinutes: getBrowserTimeZoneOffsetMinutes(),
    view: "local",
  });
  // Cache the DOWNGRADED wall, never the raw response: an old server keeps
  // answering the union for as long as the hot-mirror window lasts, and the
  // next mount paints this cache before the fetch resolves.
  const downgraded = (Array.isArray(data?.achievements) ? data.achievements : []).map(downgradeMergedToLocal);
  const achievements = floorAchievementsAtHighWater(
    { achievements: downgraded },
    LOCAL_TIERS_STORAGE_KEY,
  );
  try {
    const prevTiers = readHighWaterTiers(LOCAL_TIERS_STORAGE_KEY);
    const highWaterTiers = {};
    for (const b of achievements) {
      if (b && b.id) highWaterTiers[b.id] = Math.max(b.tier || 0, prevTiers?.[b.id] || 0);
    }
    localStorage.setItem(LOCAL_TIERS_STORAGE_KEY, JSON.stringify(highWaterTiers));
    localStorage.setItem(LOCAL_ACHIEVEMENTS_CACHE_KEY, JSON.stringify(downgraded));
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
 * Shared status machine for the two achievements views (云端并集 / 本机).
 * Cache-first paint, never throws — the page renders the locked catalog on error.
 * The poller owns everything beyond fetching: the union poller also fires
 * toasts and persists title resonance; the local poller only floors + caches.
 */
function useAchievementsView({ enabled, poller, cacheKey, tiersKey }) {
  const [state, setState] = useState(() => {
    const cached = typeof window !== "undefined" ? getCachedAchievements(cacheKey, tiersKey) : null;
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
    poller({ timeZone })
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
  }, [enabled, timeZone, poller, cacheKey, tiersKey]);

  return state;
}

/**
 * 云端并集视图（默认）：本机计算 + 账号级并集合并后的墙。
 * Local achievements with real-time unlock detection and Steam audio-visual alerts.
 */
export function useAchievements({ enabled = true } = {}) {
  return useAchievementsView({
    enabled,
    poller: pollAchievements,
    cacheKey: ACHIEVEMENTS_CACHE_KEY,
    tiersKey: TIERS_STORAGE_KEY,
  });
}

/**
 * 本机视图：只显示这台设备自己挣到的等级、解锁时间与数值。
 */
export function useLocalAchievements({ enabled = true } = {}) {
  return useAchievementsView({
    enabled,
    poller: pollLocalAchievements,
    cacheKey: LOCAL_ACHIEVEMENTS_CACHE_KEY,
    tiersKey: LOCAL_TIERS_STORAGE_KEY,
  });
}

export default useAchievements;
