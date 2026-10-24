import React, { useState, useEffect } from "react";
import { Sparkles, Check, Lock, ChevronRight } from "lucide-react";
import {
  TITLES_REGISTRY,
  getActiveTitleId,
  setActiveTitleId,
  EVENT_TITLE_CHANGED,
  STORAGE_ACTIVE_TITLE,
} from "./title-registry";

export { TITLES_REGISTRY };

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

  const activeTitle = TITLES_REGISTRY.find((t) => t.id === activeTitleId) || unlockedTitles[0] || null;

  return (
    <div className="mb-10 rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-950 via-gray-900 to-black p-6 text-white shadow-2xl shadow-black/60 backdrop-blur-xl relative overflow-hidden">
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
          <p className="mt-1.5 text-xs text-gray-400 max-w-xl">
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
                className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ${activeTitle.theme.accentDot} animate-ping`}
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
              </div>
              <div className="mt-0.5 text-xl font-black text-white tracking-tight drop-shadow-lg truncate">
                {activeTitle.name}
                <span className="ml-2 text-xs font-mono font-medium text-amber-200/80 uppercase">
                  {activeTitle.en}
                </span>
              </div>
              <div className="text-[11px] text-gray-300 line-clamp-1">
                {activeTitle.desc}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Titles Grid with 3D Crest Medallions */}
      <div className="relative z-10 mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {TITLES_REGISTRY.map((title) => {
          const isUnlocked = title.check(badgeMap);
          const isEquipped = isUnlocked && activeTitleId === title.id;
          const { theme } = title;

          return (
            <button
              key={title.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => handleSelectTitle(title.id)}
              className={`group relative flex flex-col justify-between rounded-2xl border p-4 text-left transition-all duration-200 ${
                isEquipped
                  ? `${theme.border} bg-gradient-to-br ${theme.bgGradient} shadow-xl ${theme.glow} ring-1 ${theme.ring}`
                  : isUnlocked
                  ? "border-white/15 bg-white/[0.04] hover:border-amber-400/60 hover:bg-white/[0.08] hover:shadow-xl hover:shadow-black/50 cursor-pointer"
                  : "border-white/5 bg-white/[0.02] opacity-65 cursor-not-allowed"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    {/* 3D Crest Emblem */}
                    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center">
                      <img
                        src={title.art}
                        alt={title.name}
                        className={`h-9 w-9 rounded-full object-contain filter transition-transform group-hover:scale-105 ${
                          !isUnlocked ? "grayscale opacity-40" : theme.glow
                        }`}
                      />
                    </div>
                    <div>
                      <div className="text-[10px] font-mono uppercase text-gray-400">
                        {title.en}
                      </div>
                      <div className="text-[9px] font-bold text-amber-400/90">
                        {title.tag}
                      </div>
                    </div>
                  </div>

                  {isEquipped ? (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black tracking-wide bg-gradient-to-r from-amber-400 to-amber-600 text-black shadow-md shadow-amber-500/30 border border-amber-300">
                      <Check className="h-3.5 w-3.5 stroke-[3.5]" />
                      <span>已佩戴</span>
                    </span>
                  ) : isUnlocked ? (
                    <span className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold tracking-wide bg-amber-500/15 group-hover:bg-amber-400 group-hover:text-black text-amber-300 border border-amber-500/40 group-hover:border-amber-300 shadow-sm transition-all duration-200">
                      <Sparkles className="h-3 w-3 opacity-80" />
                      <span>佩戴</span>
                      <ChevronRight className="h-3 w-3 ml-0.5" />
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px] text-gray-500 font-medium">
                      <Lock className="h-3 w-3" />
                      <span>未解锁</span>
                    </span>
                  )}
                </div>

                <div className="mt-3.5 flex items-baseline justify-between gap-2">
                  <span className={`text-lg font-black tracking-tight drop-shadow-md transition-colors ${
                    isEquipped ? "text-white font-extrabold" : isUnlocked ? "text-white group-hover:text-amber-200" : "text-gray-300"
                  }`}>
                    {title.name}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-gray-400">
                  {title.desc}
                </p>

                {/* Miniature Badge Medallion Conduits */}
                <div className="mt-3.5 flex items-center gap-2 bg-black/40 rounded-xl p-2 border border-white/10">
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
                  <div className="min-w-0 flex-1 text-[10px] text-gray-400 line-clamp-1 border-l border-white/10 pl-2">
                    {title.reqText}
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
