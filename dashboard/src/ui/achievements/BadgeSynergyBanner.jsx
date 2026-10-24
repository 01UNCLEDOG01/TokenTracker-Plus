import React, { useState, useEffect } from "react";
import { Sparkles, Check, Moon, Compass, Wand2, ShieldCheck, Scale, Boxes, Coffee, Rocket, Crown, Zap, Lock, ChevronRight } from "lucide-react";

export const TITLES_REGISTRY = [
  {
    id: "cyber_immortal",
    name: "赛博修仙者",
    en: "Cyber Immortal",
    desc: "在万籁俱寂的深夜，与 AI 一同入定悟道。",
    icon: Moon,
    requiredBadges: [
      { id: "night_owl", name: "夜猫子", tier: 2, art: "/achievements/night-owl.png?v=7" },
      { id: "session_marathon", name: "连续会长会话", tier: 2, art: "/achievements/session-marathon.png?v=11" },
    ],
    check: (badgeMap) => (badgeMap.get("night_owl")?.tier || 0) >= 2 && (badgeMap.get("session_marathon")?.tier || 0) >= 2,
    reqText: "夜猫子(白银) + 连续会长会话(白银)",
  },
  {
    id: "fleet_admiral",
    name: "特遣舰队司令",
    en: "Fleet Admiral",
    desc: "多工具多智能体并发调度，一人即是一支特遣舰队。",
    icon: Compass,
    requiredBadges: [
      { id: "swarm_commander", name: "特遣舰队司令", tier: 1, art: "/achievements/swarm-commander.png?v=2" },
      { id: "multitool", name: "多面手", tier: 2, art: "/achievements/multitool.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("swarm_commander")?.tier || 0) >= 1 && (badgeMap.get("multitool")?.tier || 0) >= 2,
    reqText: "特遣舰队司令(青铜) + 多面手(白银)",
  },
  {
    id: "frugal_archmage",
    name: "零元精算巨匠",
    en: "Frugal Archmage",
    desc: "将上下文结构压缩至极致，白嫖每一分可用算力。",
    icon: Wand2,
    requiredBadges: [
      { id: "frugal_architect", name: "白嫖之光", tier: 2, art: "/achievements/frugal-architect.png?v=2" },
      { id: "cache_miser", name: "缓存精算师", tier: 1, art: "/achievements/cache-miser.png?v=2" },
    ],
    check: (badgeMap) => (badgeMap.get("frugal_architect")?.tier || 0) >= 2 && (badgeMap.get("cache_miser")?.tier || 0) >= 1,
    reqText: "白嫖之光(白银) + 缓存精算师(青铜)",
  },
  {
    id: "openai_paladin",
    name: "奥特曼信徒",
    en: "OpenAI Paladin",
    desc: "执着于前沿 AGI 探索，笃信奥特曼灯塔的终极力量。",
    icon: ShieldCheck,
    requiredBadges: [
      { id: "closed_source_loyalist", name: "奥特曼信徒", tier: 2, art: "/achievements/closed-source-loyalist.png?v=2" },
      { id: "deep_thinker", name: "深度思考", tier: 1, art: "/achievements/deep-thinker.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 2 && (badgeMap.get("deep_thinker")?.tier || 0) >= 1,
    reqText: "奥特曼信徒(白银) + 深度思考(青铜)",
  },
  {
    id: "omniscient_architect",
    name: "全知全能架构师",
    en: "Omniscient Architect",
    desc: "通晓各大模型脾气与数十种开发工具的奇门遁甲。",
    icon: Boxes,
    requiredBadges: [
      { id: "polyglot", name: "模型博学者", tier: 3, art: "/achievements/polyglot.png?v=7" },
      { id: "multitool", name: "多面手", tier: 3, art: "/achievements/multitool.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("polyglot")?.tier || 0) >= 3 && (badgeMap.get("multitool")?.tier || 0) >= 3,
    reqText: "模型博学者(黄金) + 多面手(黄金)",
  },
  {
    id: "zen_master",
    name: "生活工作禅师",
    en: "Zen Master",
    desc: "周内高效输出，周末彻底拔电，AI 时代清醒的生活家。",
    icon: Scale,
    requiredBadges: [
      { id: "zen_balancer", name: "工作生活禅", tier: 1, art: "/achievements/zen-balancer.png?v=2" },
      { id: "marathoner", name: "马拉松", tier: 2, art: "/achievements/marathoner.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("zen_balancer")?.tier || 0) >= 1 && (badgeMap.get("marathoner")?.tier || 0) >= 2,
    reqText: "工作生活禅(青铜) + 马拉松(白银)",
  },
  {
    id: "code_cannon_overlord",
    name: "极客代码巨炮",
    en: "Code Overlord",
    desc: "极简提示词输入，排山倒海的代码万行奔涌落地。",
    icon: Rocket,
    requiredBadges: [
      { id: "code_cannon", name: "代码巨炮", tier: 2, art: "/achievements/code-cannon.png?v=2" },
      { id: "wordsmith", name: "文字工匠", tier: 2, art: "/achievements/wordsmith.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("code_cannon")?.tier || 0) >= 2 && (badgeMap.get("wordsmith")?.tier || 0) >= 2,
    reqText: "代码巨炮(白银) + 文字工匠(白银)",
  },
  {
    id: "grand_slam_legend",
    name: "大满贯传奇",
    en: "Grand Slam Legend",
    desc: "勋章架上钻石熠熠生辉，登峰造极的开发大师。",
    icon: Crown,
    requiredBadges: [
      { id: "grand_slam", name: "大满贯", tier: 1, art: "/achievements/grand-slam.png?v=11" },
    ],
    check: (badgeMap) => (badgeMap.get("grand_slam")?.tier || 0) >= 1,
    reqText: "大满贯徽章(解锁至少 3 枚钻石勋章)",
  },
];

const STORAGE_ACTIVE_TITLE = "tokentracker:active_title";

export function BadgeSynergyBanner({ badges = [] }) {
  const [activeTitleId, setActiveTitleId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_ACTIVE_TITLE) || "";
    } catch {
      return "";
    }
  });

  const badgeMap = new Map((badges || []).map((b) => [b.id, b]));
  const unlockedTitles = TITLES_REGISTRY.filter((t) => t.check(badgeMap));

  useEffect(() => {
    if (!activeTitleId && unlockedTitles.length > 0) {
      setActiveTitleId(unlockedTitles[0].id);
      try {
        localStorage.setItem(STORAGE_ACTIVE_TITLE, unlockedTitles[0].id);
      } catch {}
    }
  }, [unlockedTitles, activeTitleId]);

  const handleSelectTitle = (id) => {
    setActiveTitleId(id);
    try {
      localStorage.setItem(STORAGE_ACTIVE_TITLE, id);
    } catch {}
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
          <div className="flex items-center gap-4 rounded-2xl border-2 border-amber-400/80 bg-gradient-to-r from-amber-950/70 via-indigo-950/80 to-gray-900 px-5 py-3 shadow-xl shadow-amber-500/20">
            <div className="relative flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-lg">
              {React.createElement(activeTitle.icon, { className: "h-7 w-7 stroke-[2.2]" })}
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                  ACTIVE TITLE · 当前佩戴
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />
              </div>
              <div className="text-lg font-black text-white tracking-wide">
                {activeTitle.name}
                <span className="ml-2 text-xs font-mono font-medium text-amber-300/80 uppercase">
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

      {/* Titles Grid with Miniature Medallions */}
      <div className="relative z-10 mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {TITLES_REGISTRY.map((title) => {
          const isUnlocked = title.check(badgeMap);
          const isEquipped = isUnlocked && activeTitleId === title.id;

          return (
            <button
              key={title.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => handleSelectTitle(title.id)}
              className={`group relative flex flex-col justify-between rounded-2xl border p-4 text-left transition-all duration-200 ${
                isEquipped
                  ? "border-amber-400 bg-gradient-to-br from-amber-950/60 via-slate-900 to-gray-950 shadow-xl shadow-amber-500/20 ring-1 ring-amber-400/60"
                  : isUnlocked
                  ? "border-white/15 bg-white/[0.04] hover:border-amber-400/60 hover:bg-white/[0.08] hover:shadow-xl hover:shadow-black/50 cursor-pointer"
                  : "border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
                      isEquipped
                        ? "border-amber-400 bg-amber-400 text-black shadow-md"
                        : isUnlocked
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : "border-white/10 bg-white/5 text-gray-500"
                    }`}>
                      {React.createElement(title.icon, { className: "h-4 w-4" })}
                    </span>
                    <span className="text-[10px] font-mono uppercase text-gray-400">
                      {title.en}
                    </span>
                  </div>

                  {isEquipped ? (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-amber-300 bg-amber-400/20 border border-amber-400/40 px-2 py-0.5 rounded-full">
                      <Check className="h-3 w-3 stroke-[3]" />
                      <span>已佩戴</span>
                    </span>
                  ) : isUnlocked ? (
                    <span className="text-[11px] font-bold text-amber-400 group-hover:underline flex items-center">
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

                <div className="mt-3 font-bold text-base text-white group-hover:text-amber-200 transition-colors">
                  {title.name}
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
                      const tierColor = currentTier === 4 ? "border-cyan-400 shadow-md shadow-cyan-400/50" : currentTier === 3 ? "border-yellow-400" : currentTier === 2 ? "border-slate-300" : currentTier === 1 ? "border-amber-600" : "border-white/20 grayscale opacity-40";

                      return (
                        <div key={req.id} className="flex items-center gap-1.5">
                          {rIdx !== 0 && <span className="text-amber-400 text-xs font-bold">+</span>}
                          <div className="relative group/mini" title={`${req.name} (要求: ${req.tier === 4 ? "钻石" : req.tier === 3 ? "黄金" : req.tier === 2 ? "白银" : "青铜"})`}>
                            <img
                              src={req.art}
                              alt={req.name}
                              className={`h-8 w-8 rounded-full border-2 object-contain bg-black/60 ${tierColor} transition-transform group-hover/mini:scale-110`}
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
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
