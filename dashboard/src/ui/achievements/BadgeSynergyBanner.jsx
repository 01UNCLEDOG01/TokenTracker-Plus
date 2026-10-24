import React, { useState, useEffect } from "react";
import { Sparkles, Check, Lock, ChevronRight } from "lucide-react";
import {
  TITLES_REGISTRY,
  getActiveTitleId,
  setActiveTitleId,
  EVENT_TITLE_CHANGED,
  STORAGE_ACTIVE_TITLE,
  getTitleResonance,
} from "./title-registry";

export { TITLES_REGISTRY, getTitleResonance };

export function BadgeSynergyBanner({ badges = [] }) {
  const [activeTitleId, setActiveIdState] = useState(getActiveTitleId);

  const badgeMap = new Map((badges || []).map((b) => [b.id, b]));
  const unlockedTitles = TITLES_REGISTRY.filter((t) => t.check(badgeMap));

  useEffect(() => {
    if (!activeTitleId && unlockedTitles.length > 0) {
      setActiveIdState(unlockedTitles[0].id);
      setActiveTitleId(unlockedTitles[0].id);
    }
  }, [unlockedTitles, activeTitleId]);

  useEffect(() => {
    const handleUpdate = (e) => {
      setActiveIdState(e?.detail ?? getActiveTitleId());
    };
    const handleStorage = (e) => {
      if (e.key === STORAGE_ACTIVE_TITLE) {
        setActiveIdState(e.newValue || "");
      }
    };
    window.addEventListener(EVENT_TITLE_CHANGED, handleUpdate);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(EVENT_TITLE_CHANGED, handleUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const handleSelectTitle = (id) => {
    setActiveIdState(id);
    setActiveTitleId(id);
  };

  const activeTitle = TITLES_REGISTRY.find(function (t) { return t.id === activeTitleId; }) || unlockedTitles[0] || null;
  const activeResonance = activeTitle ? getTitleResonance(activeTitle, badgeMap) : null;

  return (
    <div className="mb-10 rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-950 via-gray-900 to-black p-6 text-white shadow-2xl shadow-black/60 backdrop-blur-xl relative overflow-hidden antialiased">
      {/* Ambient background glow accents */}
      <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-amber-500/10 blur-3xl pointer-events-none" />
      <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl pointer-events-none" />

      {/* Header section with active title pedestal */}
      <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between border-b border-white/10 pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-lg shadow-amber-500/50">
              <Sparkles className="h-4 w-4 stroke-[2.5]" />
            </span>
            <h3 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              <span>极客称号殿堂 · 羁绊共鸣</span>
              <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                共鸣达成 {unlockedTitles.length}/{TITLES_REGISTRY.length}
              </span>
            </h3>
          </div>
          <p className="mt-1.5 text-xs text-gray-300 max-w-xl">
            当核心勋章达到指定品阶时触发羁绊共鸣，融合多维算力与工程习惯，加冕你的极客专属荣耀称号。
          </p>
        </div>

        {/* Active Title Showcase Card */}
        {activeTitle && (
          <div
            className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-3 shadow-2xl backdrop-blur-xl transition-all duration-300 ${
              activeTitle.theme.border
            } bg-gradient-to-r ${activeTitle.theme.bgGradient} ${activeTitle.theme.glow}`}
          >
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
              <img
                src={activeTitle.art}
                alt={activeTitle.name}
                className="h-14 w-14 rounded-full object-contain filter drop-shadow-lg"
              />
              <span
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${activeTitle.theme.accentDot} animate-ping`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-300">
                  ACTIVE TITLE · 当前佩戴
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-black/40 border border-white/20 text-white/90">
                  {activeTitle.tag}
                </span>
                {activeResonance?.unlocked && (
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded ${
                    activeResonance.tier === 4
                      ? "bg-cyan-500/20 text-cyan-300 border border-cyan-400/50"
                      : activeResonance.tier === 3
                      ? "bg-amber-500/20 text-amber-300 border border-amber-400/50"
                      : activeResonance.tier === 2
                      ? "bg-slate-700/50 text-slate-200 border border-slate-400/50"
                      : "bg-amber-900/40 text-amber-400 border border-amber-700/50"
                  }`}>
                    {activeResonance.label}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-xl font-black text-white tracking-tight truncate">
                {activeTitle.name}
                <span className="ml-2 text-xs font-mono font-medium text-amber-200/90 uppercase">
                  {activeTitle.en}
                </span>
              </div>
              <div className="text-[11px] text-gray-200 line-clamp-1">
                {activeTitle.desc}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Titles Grid with 3D Crest Medallions - Spacious 3-column responsive grid */}
      <div className="relative z-10 mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TITLES_REGISTRY.map((title) => {
          const isUnlocked = title.check(badgeMap);
          const isEquipped = isUnlocked && activeTitleId === title.id;
          const { theme } = title;
          const resonance = getTitleResonance(title, badgeMap);

          return (
            <button
              key={title.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => handleSelectTitle(title.id)}
              className={`group relative flex flex-col justify-between rounded-2xl border p-4.5 text-left transition-all duration-200 antialiased ${
                isEquipped
                  ? `${theme.border} bg-gradient-to-br ${theme.bgGradient} shadow-xl ${theme.glow} ring-1 ${theme.ring}`
                  : isUnlocked
                  ? resonance.tier === 4
                    ? "border-cyan-400/60 bg-white/[0.05] shadow-lg shadow-cyan-500/20 hover:border-cyan-300 hover:bg-white/[0.08] cursor-pointer"
                    : resonance.tier === 3
                    ? "border-amber-400/60 bg-white/[0.05] shadow-lg shadow-amber-500/20 hover:border-amber-300 hover:bg-white/[0.08] cursor-pointer"
                    : resonance.tier === 2
                    ? "border-slate-300/50 bg-white/[0.04] shadow-md shadow-slate-400/15 hover:border-slate-200 hover:bg-white/[0.08] cursor-pointer"
                    : "border-amber-700/40 bg-white/[0.04] hover:border-amber-500/70 hover:bg-white/[0.08] cursor-pointer"
                  : "border-white/5 bg-white/[0.02] opacity-60 cursor-not-allowed"
              }`}
            >
              <div>
                {/* Header row: Crest + Tag on left, Standardized Fixed-Width Button on right */}
                <div className="flex items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* 3D Crest Emblem */}
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center">
                      <img
                        src={title.art}
                        alt={title.name}
                        className={`h-11 w-11 rounded-full object-contain filter transition-transform group-hover:scale-105 ${
                          !isUnlocked ? "grayscale opacity-40" : theme.glow
                        }`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="inline-block rounded-md bg-amber-400/15 border border-amber-400/35 px-2 py-0.5 text-xs font-bold text-amber-300 truncate">
                        {title.tag}
                      </span>
                      {isUnlocked && (
                        <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-mono font-bold border truncate ${
                          resonance.tier === 4
                            ? "bg-cyan-500/20 text-cyan-200 border-cyan-400/70 shadow-sm shadow-cyan-400/30"
                            : resonance.tier === 3
                            ? "bg-amber-500/20 text-amber-200 border-amber-400/60"
                            : resonance.tier === 2
                            ? "bg-slate-700/50 text-slate-200 border-slate-400/60"
                            : "bg-amber-950/50 text-amber-300 border-amber-700/60"
                        }`}>
                          {resonance.label}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Standardized Pill Button: exactly 84px wide, never overflows or wraps */}
                  <div className="w-[84px] h-7.5 shrink-0 flex items-center justify-end">
                    {isEquipped ? (
                      <span className="w-[84px] h-7.5 inline-flex items-center justify-center rounded-full text-xs font-extrabold tracking-wide bg-gradient-to-r from-amber-400 to-amber-500 text-black shadow-md shadow-amber-500/30 border border-amber-300 whitespace-nowrap">
                        <Check className="h-3.5 w-3.5 stroke-[3] mr-1 shrink-0" />
                        <span>已佩戴</span>
                      </span>
                    ) : isUnlocked ? (
                      <span className="w-[84px] h-7.5 inline-flex items-center justify-center rounded-full text-xs font-bold tracking-wide bg-amber-500/15 group-hover:bg-amber-400 group-hover:text-black text-amber-300 border border-amber-500/40 group-hover:border-amber-300 shadow-sm transition-all duration-200 whitespace-nowrap">
                        <Sparkles className="h-3 w-3 mr-1 opacity-90 shrink-0" />
                        <span>佩戴</span>
                        <ChevronRight className="h-3 w-3 ml-0.5 shrink-0" />
                      </span>
                    ) : (
                      <span className="w-[84px] h-7.5 inline-flex items-center justify-center rounded-full text-xs font-medium text-slate-400 bg-white/[0.04] border border-white/10 whitespace-nowrap">
                        <Lock className="h-3 w-3 mr-1 shrink-0" />
                        <span>未解锁</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Title Name & English Subtitle: clean, spacious, zero blur */}
                <div className="mt-3 min-w-0">
                  <div className={`text-base sm:text-lg font-bold tracking-tight transition-colors truncate ${
                    isEquipped ? "text-white font-extrabold" : isUnlocked ? "text-white group-hover:text-amber-200" : "text-gray-300"
                  }`}>
                    {title.name}
                  </div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 truncate mt-0.5">
                    {title.en}
                  </div>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-300">
                  {title.desc}
                </p>

                {/* Miniature Badge Medallion Conduits */}
                <div className="mt-3.5 rounded-xl bg-black/50 p-2.5 border border-white/10">
                  {/* Conduit header */}
                  <div className="flex items-center justify-between text-[10px] font-mono font-medium text-slate-300 mb-2">
                    <span className="flex items-center gap-1 text-amber-300 font-semibold">
                      <span>{resonance.dimName}</span>
                    </span>
                    <span className={resonance.tier === 4 ? "text-cyan-300 font-bold" : resonance.tier === 3 ? "text-amber-300 font-bold" : resonance.tier === 2 ? "text-slate-200" : "text-amber-500"}>
                      {resonance.label}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 shrink-0">
                      {title.requiredBadges.map((req, rIdx) => {
                        const userBadge = badgeMap.get(req.id);
                        const currentTier = userBadge?.tier || 0;
                        const isMet = Boolean(req.tier <= currentTier);
                        const tierColor =
                          currentTier === 4
                            ? "border-cyan-400 shadow-md shadow-cyan-400/50"
                            : currentTier === 3
                            ? "border-yellow-400"
                            : currentTier === 2
                            ? "border-slate-300"
                            : currentTier === 1
                            ? "border-amber-600"
                            : "border-white/20 grayscale opacity-40";

                        return (
                          <div key={req.id} className="flex items-center gap-1.5">
                            {rIdx !== 0 && <span className="text-amber-400 text-xs font-bold">+</span>}
                            <div
                              className="relative group/mini"
                              title={`${req.name} (要求: ${
                                req.tier === 4 ? "钻石" : req.tier === 3 ? "黄金" : req.tier === 2 ? "白银" : "青铜"
                              })`}
                            >
                              <img
                                src={req.art}
                                alt={req.name}
                                className={`h-8 w-8 rounded-full border-2 object-contain bg-black/60 ${tierColor} transition-transform group-hover/mini:scale-110`}
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                }}
                              />
                              {isMet && (
                                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 text-[8px] font-bold text-black flex items-center justify-center border border-black">
                                  ✓
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="min-w-0 flex-1 text-[10px] text-slate-300 text-right line-clamp-1 border-l border-white/10 pl-2">
                      {title.reqText}
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default BadgeSynergyBanner;
