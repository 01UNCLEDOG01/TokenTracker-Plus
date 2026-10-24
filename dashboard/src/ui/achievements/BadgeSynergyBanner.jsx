import React, { useState, useEffect } from "react";
import { Sparkles, Check, Lock, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import {
  TITLES_REGISTRY,
  getActiveTitleId,
  setActiveTitleId,
  EVENT_TITLE_CHANGED,
  STORAGE_ACTIVE_TITLE,
  getTitleResonance,
} from "./title-registry";
import { TitleDetailModal } from "./TitleDetailModal.jsx";

export { TITLES_REGISTRY, getTitleResonance };

const STAGGERED_TIERS = [1, 2, 3, 4, 1, 2, 3, 4, 3, 4, 4];

// The top title's identity is a spectrum; resonance decides how many hues it
// carries (bronze 3 → diamond 6). The palettes live in title-effects.css so
// this file carries no raw colours for the hardcode gate.
function spectrumTier(tier) {
  return String(Math.min(4, Math.max(1, Number(tier) || 1)));
}

export function getEffectiveTitleResonance(title, badgeMap, testMode, index) {
  if (!title) return { unlocked: false, tier: 0, label: "未激活", tierName: "未激活", dim: 2, dimName: "双星交汇" };
  if (testMode === 1 || testMode === 2 || testMode === 3 || testMode === 4) {
    const tier = testMode;
    const tierNames = ["未激活", "青铜", "白银", "黄金", "钻石"];
    const tierName = tierNames[tier] || "青铜";
    const dim = title.dimension || (title.requiredBadges?.length || 2);
    const dimName = title.bondName || (dim >= 5 ? "五星连珠" : dim === 4 ? "四象混元" : dim === 3 ? "三神交泰" : dim === 1 ? "至尊星冕" : "双星交汇");
    const label = tier === 4 ? `${tierName}共鸣 · MAX` : `${tierName}共鸣 · Lv.${tier}`;
    return { unlocked: true, tier, dim, dimName, tierName, label };
  }
  if (testMode === 5) {
    const tierIdx = typeof index === "number" ? index : 0;
    const tier = STAGGERED_TIERS[tierIdx % STAGGERED_TIERS.length];
    const tierNames = ["未激活", "青铜", "白银", "黄金", "钻石"];
    const tierName = tierNames[tier] || "青铜";
    const dim = title.dimension || (title.requiredBadges?.length || 2);
    const dimName = title.bondName || (dim >= 5 ? "五星连珠" : dim === 4 ? "四象混元" : dim === 3 ? "三神交泰" : dim === 1 ? "至尊星冕" : "双星交汇");
    const label = tier === 4 ? `${tierName}共鸣 · MAX` : `${tierName}共鸣 · Lv.${tier}`;
    return { unlocked: true, tier, dim, dimName, tierName, label };
  }
  return getTitleResonance(title, badgeMap);
}

export function BadgeSynergyBanner({ badges = [], resonanceTestMode = 0, onSelectBadge }) {
  const [activeTitleId, setActiveIdState] = useState(getActiveTitleId);
  const [gridOpen, setGridOpen] = useState(true);
  const [buildId] = useState(() => {
    try {
      const sources = [...document.querySelectorAll('script[type="module"]')]
        .map((el) => el.getAttribute("src") || "");
      const src = sources.find((value) => value.includes("/assets/main-"))
        || sources.find((value) => value.includes("/assets/"));
      return src ? src.split("/assets/")[1].slice(0, 8) : "";
    } catch {
      return "";
    }
  });
  const [detailTitle, setDetailTitle] = useState(null);

  const badgeMap = new Map((badges || []).map(function (b) { return [b.id, b]; }));
  const unlockedTitles = resonanceTestMode !== 0
    ? TITLES_REGISTRY
    : TITLES_REGISTRY.filter(function (t) { return t.check(badgeMap); });

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
  const activeResonance = activeTitle ? getEffectiveTitleResonance(activeTitle, badgeMap, resonanceTestMode, 0) : null;

  return (
    <div
      className="mb-10 rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-950 via-gray-900 to-black p-6 text-white shadow-2xl shadow-black/60 backdrop-blur-xl relative overflow-hidden antialiased"
      data-build={buildId || undefined}
    >
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
            <button
              type="button"
              onClick={() => setGridOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-expanded={gridOpen}
            >
              {gridOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {gridOpen ? "收起称号" : "展开称号"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-gray-300 max-w-xl">
            当核心勋章达到指定品阶时触发羁绊共鸣，融合多维算力与工程习惯，加冕你的极客专属荣耀称号。
          </p>
        </div>

        {/* Active Title Showcase Card */}
        {activeTitle && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => setDetailTitle({ title: activeTitle, resonance: activeResonance })}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDetailTitle({ title: activeTitle, resonance: activeResonance });
              }
            }}
            className={`flex cursor-pointer items-center gap-4 rounded-2xl border-2 px-5 py-3 shadow-2xl backdrop-blur-xl transition-all duration-300 hover:brightness-110 ${
              activeTitle.theme.border
            } bg-gradient-to-r ${activeTitle.theme.bgGradient} ${activeTitle.theme.glow}`}
          >
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
              <img
                src={activeTitle.art}
                alt={activeTitle.name}
                className={`h-14 w-14 rounded-full object-contain filter drop-shadow-lg ${activeTitle.theme.ring} ${
                  activeResonance?.tier >= 4
                    ? "ring-2 shadow-lg"
                    : activeResonance?.tier === 3
                    ? "ring-2 shadow-md"
                    : activeResonance?.tier === 2
                    ? "ring-2"
                    : "ring-1"
                } ${activeTitle.rainbow ? "title-rainbow" : ""}`}
                data-spectrum={activeTitle.rainbow ? spectrumTier(activeResonance?.tier) : undefined}
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
                  <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded bg-black/40 border border-white/20 text-white/90">
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
      {gridOpen && (
      <div className="relative z-10 mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TITLES_REGISTRY.map(function (title, index) {
          const resonance = getEffectiveTitleResonance(title, badgeMap, resonanceTestMode, index);
          const isUnlocked = resonanceTestMode !== 0 ? true : title.check(badgeMap);
          const isEquipped = isUnlocked && activeTitleId === title.id;
          const { theme } = title;

          return (
            <button
              key={title.id}
              type="button"
              onClick={() => setDetailTitle({ title, resonance })}
              data-spectrum={title.rainbow ? spectrumTier(resonance.tier) : undefined}
              className={`group relative flex flex-col justify-between rounded-2xl border p-4.5 text-left transition-all duration-200 antialiased ${
                isEquipped
                  ? `${theme.border} bg-gradient-to-br ${theme.bgGradient} ${theme.glow} ${theme.ring} ${
                      resonance.tier >= 4
                        ? "shadow-xl ring-2"
                        : resonance.tier === 3
                        ? "shadow-lg ring-2"
                        : resonance.tier === 2
                        ? "shadow-md ring-2"
                        : "ring-1"
                    } ${title.rainbow ? "title-rainbow" : ""}`
                  : isUnlocked
                  ? `${theme.border} bg-white/[0.05] hover:bg-white/[0.08] cursor-pointer ${theme.ring} ring-1 ${
                      resonance.tier >= 3 ? "shadow-lg" : resonance.tier === 2 ? "shadow-md" : "shadow-sm"
                    } ${title.rainbow ? "title-rainbow" : ""}`
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
                          !isUnlocked
                            ? "grayscale opacity-40"
                            : `${theme.ring} ${
                                resonance.tier >= 3 ? "ring-2 shadow-md" : resonance.tier === 2 ? "ring-2 shadow-sm" : "ring-1"
                              } ${title.rainbow ? "title-rainbow" : ""}`
                        }`}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="inline-block rounded-md bg-amber-400/15 border border-amber-400/35 px-2 py-0.5 text-xs font-bold text-amber-300 truncate">
                        {title.tag}
                      </span>
                      {isUnlocked && (
                        <span className="inline-block truncate rounded-md border border-white/20 bg-black/40 px-1.5 py-0.5 text-[10px] font-mono font-bold text-white/85">
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
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelectTitle(title.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.stopPropagation();
                            handleSelectTitle(title.id);
                          }
                        }}
                        className="w-[84px] h-7.5 inline-flex items-center justify-center rounded-full text-xs font-bold tracking-wide bg-amber-500/15 group-hover:bg-amber-400 group-hover:text-black text-amber-300 border border-amber-500/40 group-hover:border-amber-300 shadow-sm transition-all duration-200 whitespace-nowrap"
                      >
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
                      {title.requiredBadges.map(function (req, rIdx) {
                        const userBadge = badgeMap.get(req.id);
                        const userTier = userBadge ? (userBadge.tier || 0) : 0;
                        const currentTier = resonanceTestMode !== 0 ? resonance.tier : userTier;
                        const isMet = Boolean(req.tier <= currentTier);
                        const tierColor = isMet
                          ? "border-emerald-400/70"
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
      )}
      {detailTitle && (
        <TitleDetailModal
          title={detailTitle.title}
          resonance={
            detailTitle.title.rainbow
              ? { ...detailTitle.resonance, spectrumTier: spectrumTier(detailTitle.resonance.tier) }
              : detailTitle.resonance
          }
          badgeMap={badgeMap}
          onClose={() => setDetailTitle(null)}
          onSelectBadge={(id) => {
            // Keep the title sheet mounted underneath: closing the achievement
            // modal should return here, not to the wall.
            onSelectBadge?.(id);
          }}
        />
      )}
    </div>
  );
}

export default BadgeSynergyBanner;
