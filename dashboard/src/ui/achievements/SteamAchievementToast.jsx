import React, { useEffect, useState, useRef, useCallback } from "react";
import { Trophy, X, Sparkles, Award, Gem, TrendingUp, Layers, Link2 } from "lucide-react";
import { playUnlockSound, playTierUpSound } from "../../lib/achievement-audio";
import { copy } from "../../lib/copy";

const TIER_META = {
  1: { en: "Bronze", zh: "青铜阶", border: "border-amber-600/80", bg: "from-amber-950/60 to-[#171a21]", tagBg: "bg-amber-900/60 text-amber-300 border-amber-600/50" },
  2: { en: "Silver", zh: "白银阶", border: "border-slate-300/80", bg: "from-slate-800/60 to-[#171a21]", tagBg: "bg-slate-700/60 text-slate-200 border-slate-400/50" },
  3: { en: "Gold", zh: "黄金阶", border: "border-yellow-400/90", bg: "from-yellow-950/60 to-[#171a21]", tagBg: "bg-amber-500/20 text-yellow-300 border-yellow-500/50" },
  4: { en: "Diamond", zh: "钻石阶", border: "border-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.5)]", bg: "from-cyan-950/60 to-[#171a21]", tagBg: "bg-cyan-500/20 text-cyan-300 border-cyan-400/50" },
};

// Global notification bus
const listeners = new Set();
let toastUidCounter = 0;
let lastAudioTime = 0;

/** Trigger an achievement unlock or tier-up notification */
export function triggerAchievementNotification(item) {
  const uid = ++toastUidCounter;
  const payload = {
    ...item,
    uid,
    timestamp: Date.now(),
  };

  listeners.forEach((fn) => fn(payload));


}

const MAX_CONCURRENT_TOASTS = 3;

/**
 * Individual Steam Toast Card with independent lifecycle, hover-pause, and animations
 */
function SteamToastCard({ toast, onDismiss, totalQueued }) {
  const [visible, setVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef(null);
  const remainingTimeRef = useRef(0);
  const startTimeRef = useRef(0);

  const startDismissTimer = useCallback((duration) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingTimeRef.current = duration;
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        onDismiss(toast.uid);
      }, 280);
    }, duration);
  }, [onDismiss, toast.uid]);

  useEffect(() => {
    // Mount animation trigger
    const raf = requestAnimationFrame(() => {
      setVisible(true);
    });

    // Pacing duration based on queued backlog
    let duration = 4500;
    if (totalQueued > 2) {
      duration = 2600;
    } else if (totalQueued > 0) {
      duration = 3400;
    }

    startDismissTimer(duration);

    return () => {
      cancelAnimationFrame(raf);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [startDismissTimer, totalQueued]);

  const handleMouseEnter = () => {
    setIsPaused(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(1200, remainingTimeRef.current - elapsed);
    }
  };

  const handleMouseLeave = () => {
    setIsPaused(false);
    startDismissTimer(remainingTimeRef.current || 2000);
  };

  const handleManualDismiss = (e) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(() => {
      onDismiss(toast.uid);
    }, 220);
  };

  const tier = Number(toast.tier) || 1;
  const tierMeta = TIER_META[tier] || TIER_META[1];
  const isTierUp = Boolean(toast.isTierUp);
  // Title-resonance toasts get their own visual language (iridescent frame),
  // not the achievement promotion flare.
  const isResonance = toast.kind === "resonance";
  // 共鸣档位胶囊：颜色随青铜/白银/黄金/钻石变化（金=琥珀、钻=青，
  // 与成就页其他档位色一致）；文字仍是档位名。
  const RESONANCE_TIER_PILL = {
    1: "border-amber-800/60 bg-amber-900/20 text-amber-200",
    2: "border-slate-300/50 bg-slate-300/10 text-slate-100",
    3: "border-amber-400/60 bg-amber-400/20 text-amber-200",
    4: "border-cyan-300/60 bg-cyan-400/20 text-cyan-200",
  };

  return (
    <div
      role="alert"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`pointer-events-auto transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${
        visible
          ? "translate-y-0 opacity-100 scale-100"
          : "translate-y-6 opacity-0 scale-95"
      }`}
    >
      {/* DISTINCT VISUAL 0: TITLE RESONANCE (IRIDESCENT FRAME + VIOLET LINK-UP FLOW) */}
      {isResonance ? (
        <div className="relative w-[390px] max-w-[calc(100vw-3rem)] rounded-2xl p-[2px] bg-resonance-iridescent bg-[length:300%_100%] animate-resonance-flow shadow-resonance-card">
          <div className="relative flex items-center gap-3.5 overflow-hidden rounded-[14px] bg-gradient-to-br from-[#1a1230] via-[#14101f] to-[#0d1017] p-4 text-white backdrop-blur-xl">
          {/* Flowing resonance beam — hue slides along the top edge */}
          <div className="absolute inset-x-0 top-0 h-[3px] bg-resonance-beam bg-[length:200%_100%] animate-resonance-flow" />

          {/* Left emblem with resonance link ring */}
          <div className="relative shrink-0">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl p-[1.5px] bg-resonance-iridescent bg-[length:300%_100%] animate-resonance-flow overflow-hidden">
            <div className="flex h-full w-full items-center justify-center rounded-[10px] bg-black p-[3px] overflow-hidden">
              {toast.badge?.art ? (
                <img
                  src={toast.badge.art}
                  alt={toast.name || "Title"}
                  className="h-full w-full object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <Link2 className="h-8 w-8 text-white/70" />
              )}
            </div>
            </div>
            {/* Resonance link marker */}
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#1a1230] text-white border-2 border-[#14101f] shadow-lg">
              <Link2 className="h-3.5 w-3.5 stroke-[3]" />
            </span>
          </div>

          {/* Middle text content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-white/70" />
                <span className="text-[11px] font-black uppercase tracking-wider text-white/80">
                  {copy("achievements.resonance.toast_badge")}
                </span>
              </div>
            </div>

            <h4 className="mt-1 truncate text-base font-bold tracking-tight text-white">
              {toast.name || copy("achievements.resonance.toast_name_fallback")}
            </h4>

            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${RESONANCE_TIER_PILL[tier] || "border-white/20 bg-white/10 text-white/80"}`}>
                <Layers className="h-3 w-3" />
                <span>
                  {copy(
                    isTierUp
                      ? "achievements.resonance.toast_tier_up"
                      : "achievements.resonance.toast_unlocked",
                    { tier: tierMeta.zh },
                  )}
                </span>
              </span>
            </div>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={handleManualDismiss}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
        </div>
      ) : isTierUp ? (
        <div className="relative flex w-[390px] max-w-[calc(100vw-3rem)] items-center gap-3.5 overflow-hidden rounded-2xl border-2 border-cyan-400/80 bg-gradient-to-br from-[#131b2e] via-[#10141f] to-[#0d1017] p-4 text-white shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_30px_rgba(34,211,238,0.3)] backdrop-blur-xl">
          {/* Animated radiant top beam — same cyan family as the border, faded
              ends so the line melts into the rounded corners instead of
              overshooting them. */}
          <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-cyan-400/30 via-cyan-300 to-cyan-400/30 animate-pulse" />

          {/* Left emblem with glowing promotion ring */}
          <div className="relative shrink-0">
            <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border-2 ${tierMeta.border} bg-gradient-to-b ${tierMeta.bg} p-1 shadow-[0_0_20px_rgba(34,211,238,0.35)] overflow-hidden`}>
              {toast.badge?.art ? (
                <img
                  src={toast.badge.art}
                  alt={toast.name || "Badge"}
                  className="h-full w-full object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <Gem className="h-8 w-8 text-cyan-300" />
              )}
            </div>
            {/* Promotion trending arrow marker */}
            <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-cyan-500 text-black border-2 border-[#10141f] shadow-lg">
              <TrendingUp className="h-3.5 w-3.5 stroke-[3]" />
            </span>
          </div>

          {/* Middle text content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-[11px] font-black uppercase tracking-wider text-cyan-400">
                  ACHIEVEMENT PROMOTED · 勋章晋阶
                </span>
              </div>
            </div>

            <h4 className="mt-1 truncate text-base font-bold tracking-tight text-white">
              {toast.name || toast.badge?.id || "成就升阶"}
            </h4>

            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${tierMeta.tagBg}`}>
                {tier === 4 ? <Gem className="h-3 w-3" /> : <Award className="h-3 w-3" />}
                <span>晋阶至 {tierMeta.zh}</span>
              </span>
            </div>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={handleManualDismiss}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        /* DISTINCT VISUAL 2: UNLOCK (CLASSIC STEAM OBSIDIAN & AMBER GLOW) */
        <div className="relative flex w-[370px] max-w-[calc(100vw-3rem)] items-center gap-3.5 overflow-hidden rounded-xl border border-[#384b60] bg-[#171a21]/95 p-3.5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.8)] backdrop-blur-md">
          {/* Steam-style top ambient glow line */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-600" />

          {/* Left emblem avatar */}
          <div className="relative shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 bg-[#1b2838] p-1 shadow-inner overflow-hidden">
              {toast.badge?.art ? (
                <img
                  src={toast.badge.art}
                  alt={toast.name || "Badge"}
                  className="h-full w-full object-contain filter drop-shadow"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <Trophy className="h-7 w-7 text-yellow-300" />
              )}
            </div>
            {/* Small tier badge marker */}
            <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#1b2838] border border-white/20 shadow">
              <Award className="h-3 w-3 text-amber-400" />
            </span>
          </div>

          {/* Middle text content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5">
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  ACHIEVEMENT UNLOCKED · 成就解锁
                </span>
              </div>
            </div>

            <h4 className="mt-0.5 truncate text-sm font-semibold tracking-tight text-white">
              {toast.name || toast.badge?.id || "新成就达成"}
            </h4>


          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={handleManualDismiss}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Steam Achievement Toast Notification Container:
 * Accurately implements Steam's concurrent stacking system.
 * Up to 3 active toasts stack vertically in the bottom-right corner.
 * Subsequent toasts queue and smoothly slide into place as previous toasts dismiss.
 */
export function SteamAchievementContainer() {
  const [activeToasts, setActiveToasts] = useState([]);
  const queueRef = useRef([]);

  const dismissToast = useCallback((uid) => {
    setActiveToasts((prev) => {
      const nextActive = prev.filter((t) => t.uid !== uid);
      // If we have room and there are queued items, pop the next item into active
      if (MAX_CONCURRENT_TOASTS > nextActive.length && queueRef.current.length > 0) {
        const nextItem = queueRef.current.shift();
        return [...nextActive, nextItem];
      }
      return nextActive;
    });
  }, []);

  useEffect(() => {
    const handleNotification = (item) => {
      // Audio pacing: Throttle sounds so rapid bursts do not clash/clip
      const now = Date.now();
      if (now - lastAudioTime > 1000) {
        lastAudioTime = now;
        if (item.isTierUp) {
          playTierUpSound();
        } else {
          playUnlockSound();
        }
      }

      setActiveToasts((prev) => {
        if (MAX_CONCURRENT_TOASTS > prev.length) {
          return [...prev, item];
        } else {
          // Exceeds max concurrent: push to backlog queue
          queueRef.current.push(item);
          return prev;
        }
      });
    };

    listeners.add(handleNotification);
    return () => listeners.delete(handleNotification);
  }, []);

  if (activeToasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Steam Achievement Notifications"
      className="fixed bottom-6 right-6 z-[9999] pointer-events-none flex flex-col-reverse gap-3 items-end"
    >
      {activeToasts.map((toast) => (
        <SteamToastCard
          key={toast.uid}
          toast={toast}
          onDismiss={dismissToast}
          totalQueued={queueRef.current.length}
        />
      ))}
    </div>
  );
}

export default SteamAchievementContainer;
