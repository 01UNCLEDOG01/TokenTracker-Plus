import React, { useEffect, useState, useRef } from "react";
import { Trophy, X, Sparkles, Award, Gem, TrendingUp, Layers } from "lucide-react";
import { playUnlockSound, playTierUpSound } from "../../lib/achievement-audio";

const TIER_META = {
  1: { en: "Bronze", zh: "青铜阶", border: "border-amber-600/80", bg: "from-amber-950/60 to-[#171a21]", tagBg: "bg-amber-900/60 text-amber-300 border-amber-600/50" },
  2: { en: "Silver", zh: "白银阶", border: "border-slate-300/80", bg: "from-slate-800/60 to-[#171a21]", tagBg: "bg-slate-700/60 text-slate-200 border-slate-400/50" },
  3: { en: "Gold", zh: "黄金阶", border: "border-yellow-400/90", bg: "from-yellow-950/60 to-[#171a21]", tagBg: "bg-amber-500/20 text-yellow-300 border-yellow-500/50" },
  4: { en: "Diamond", zh: "钻石阶", border: "border-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.5)]", bg: "from-cyan-950/60 to-[#171a21]", tagBg: "bg-cyan-500/20 text-cyan-300 border-cyan-400/50" },
};

// Global notification bus with Steam pacing queue
const listeners = new Set();
const queue = [];
let isProcessing = false;
let burstTotal = 0;
let burstIndex = 0;
let lastAudioTime = 0;

export function triggerAchievementNotification(item) {
  queue.push(item);
  if (!isProcessing) {
    burstTotal = queue.length;
    burstIndex = 0;
  } else {
    burstTotal++;
  }
  notifyNext();
}

function notifyNext() {
  if (isProcessing || queue.length === 0) return;
  const current = queue.shift();
  burstIndex++;
  isProcessing = true;

  const payload = {
    ...current,
    queueIndex: burstIndex,
    queueTotal: Math.max(burstTotal, burstIndex + queue.length),
    remainingCount: queue.length,
  };

  listeners.forEach((fn) => fn(payload));
}

function finishCurrent() {
  isProcessing = false;
  if (queue.length === 0) {
    burstTotal = 0;
    burstIndex = 0;
  }
  // Steam uses a 280ms transition gap between queued toasts
  setTimeout(() => {
    notifyNext();
  }, 280);
}

export function SteamAchievementContainer() {
  const [current, setCurrent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef(null);
  const remainingTimeRef = useRef(0);
  const startTimeRef = useRef(0);

  const startDismissTimer = (duration) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    remainingTimeRef.current = duration;
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        setCurrent(null);
        finishCurrent();
      }, 350);
    }, duration);
  };

  useEffect(() => {
    const handleNotification = (item) => {
      setCurrent(item);
      setVisible(true);
      setIsPaused(false);

      // Steam Audio Pacing: throttle sound in tight bursts (prevent cacophony)
      const now = Date.now();
      const shouldPlaySound = now - lastAudioTime > 1200 || item.queueIndex === 1;
      if (shouldPlaySound) {
        lastAudioTime = now;
        if (item.isTierUp) {
          playTierUpSound();
        } else {
          playUnlockSound();
        }
      }

      // Steam Burst Pacing:
      // Single unlock: 4500ms
      // 1-2 queued: 3200ms
      // >2 queued: 2200ms (fast-forward mode so multi-unlocks do not backlog forever)
      let duration = 4500;
      if (item.remainingCount > 2) {
        duration = 2200;
      } else if (item.remainingCount > 0) {
        duration = 3200;
      }

      startDismissTimer(duration);
    };

    listeners.add(handleNotification);
    return () => listeners.delete(handleNotification);
  }, []);

  const handleMouseEnter = () => {
    if (!visible || !current) return;
    setIsPaused(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      const elapsed = Date.now() - startTimeRef.current;
      remainingTimeRef.current = Math.max(1000, remainingTimeRef.current - elapsed);
    }
  };

  const handleMouseLeave = () => {
    if (!visible || !current) return;
    setIsPaused(false);
    startDismissTimer(remainingTimeRef.current || 2000);
  };

  const handleDismiss = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    setTimeout(() => {
      setCurrent(null);
      finishCurrent();
    }, 250);
  };

  if (!current) return null;

  const tier = Number(current.tier) || 1;
  const tierMeta = TIER_META[tier] || TIER_META[1];
  const isTierUp = Boolean(current.isTierUp);
  const hasQueue = Boolean(current.queueTotal && current.queueTotal !== 1);

  return (
    <div
      role="alert"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`fixed bottom-6 right-6 z-[9999] pointer-events-auto transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] transform ${
        visible ? "translate-y-0 opacity-100 scale-100" : "translate-y-8 opacity-0 scale-95"
      }`}
    >
      {/* 
        DISTINCT VISUAL 1: PROMOTION / TIER UP (PRISMATIC CELEBRATION FLARE)
      */}
      {isTierUp ? (
        <div className="relative flex w-[390px] max-w-[calc(100vw-3rem)] items-center gap-3.5 rounded-2xl border-2 border-cyan-400/80 bg-gradient-to-br from-[#131b2e] via-[#10141f] to-[#0d1017] p-4 text-white shadow-[0_16px_40px_rgba(0,0,0,0.85),0_0_30px_rgba(34,211,238,0.3)] backdrop-blur-xl">
          {/* Animated radiant top beam */}
          <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl bg-gradient-to-r from-cyan-400 via-purple-400 to-amber-300 animate-pulse" />

          {/* Left emblem with glowing promotion ring */}
          <div className="relative shrink-0">
            <div className={`flex h-16 w-16 items-center justify-center rounded-2xl border-2 ${tierMeta.border} bg-gradient-to-b ${tierMeta.bg} p-1 shadow-[0_0_20px_rgba(34,211,238,0.35)] overflow-hidden`}>
              {current.badge?.art ? (
                <img
                  src={current.badge.art}
                  alt={current.name || "Badge"}
                  className="h-full w-full object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]"
                  onError={(e) => {
                    e.currentTarget.style.display = "none";
                  }}
                />
              ) : (
                <Gem className="h-8 w-8 text-cyan-300" />
              )}
            </div>
            {/* Promotion trending arrow badge */}
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

              {/* Steam queue badge */}
              {hasQueue && (
                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-950/80 px-2 py-0.5 text-[10px] font-mono font-bold text-cyan-300 border border-cyan-500/40">
                  <Layers className="h-2.5 w-2.5" />
                  <span>{current.queueIndex}/{current.queueTotal}</span>
                </span>
              )}
            </div>

            <h4 className="mt-1 truncate text-base font-bold tracking-tight text-white">
              {current.name || current.badge?.id || "成就升阶"}
            </h4>

            <div className="mt-1.5 flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${tierMeta.tagBg}`}>
                {tier === 4 ? <Gem className="h-3 w-3" /> : <Award className="h-3 w-3" />}
                <span>晋阶至 {tierMeta.zh}</span>
              </span>
              <p className="truncate text-xs text-gray-300">
                {current.desc || "战绩辉煌，荣耀升级！"}
              </p>
            </div>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={handleDismiss}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        /* 
          DISTINCT VISUAL 2: UNLOCK (CLASSIC STEAM OBSIDIAN & AMBER GLOW)
        */
        <div className="relative flex w-[370px] max-w-[calc(100vw-3rem)] items-center gap-3.5 rounded-xl border border-[#384b60] bg-[#171a21]/95 p-3.5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.8)] backdrop-blur-md">
          {/* Steam-style top ambient glow line */}
          <div className="absolute inset-x-0 top-0 h-[2px] rounded-t-xl bg-gradient-to-r from-amber-500 via-yellow-300 to-amber-600" />

          {/* Left emblem avatar */}
          <div className="relative shrink-0">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 bg-[#1b2838] p-1 shadow-inner overflow-hidden">
              {current.badge?.art ? (
                <img
                  src={current.badge.art}
                  alt={current.name || "Badge"}
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

              {/* Steam queue badge */}
              {hasQueue && (
                <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-mono font-medium text-gray-300 border border-white/10">
                  <Layers className="h-2.5 w-2.5 text-amber-400" />
                  <span>{current.queueIndex}/{current.queueTotal}</span>
                </span>
              )}
            </div>

            <h4 className="mt-0.5 truncate text-sm font-semibold tracking-tight text-white">
              {current.name || current.badge?.id || "新成就达成"}
            </h4>

            <p className="mt-0.5 line-clamp-1 text-xs text-gray-300">
              {current.desc || `已达成 ${tierMeta.zh}！`}
            </p>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={handleDismiss}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-white/10 hover:text-white"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

export default SteamAchievementContainer;
