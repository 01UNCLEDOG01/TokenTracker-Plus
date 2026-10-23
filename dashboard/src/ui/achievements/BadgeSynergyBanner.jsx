import React, { useState, useEffect } from "react";
import { Sparkles, Check, Moon, Compass, Wand2, ShieldCheck, Scale, Boxes, Coffee, Rocket, Crown } from "lucide-react";

export const TITLES_REGISTRY = [
  {
    id: "cyber_immortal",
    name: "赛博修仙者",
    en: "Cyber Immortal",
    desc: "在万籁俱寂的深夜，与 AI 一同入定悟道。",
    icon: Moon,
    check: (badgeMap) => (badgeMap.get("night_owl")?.tier || 0) >= 2 && (badgeMap.get("session_marathon")?.tier || 0) >= 2,
    reqText: "夜猫子(白银) + 连续会长会话(白银)",
  },
  {
    id: "fleet_admiral",
    name: "特遣舰队司令",
    en: "Fleet Admiral",
    desc: "多工具多智能体并发调度，一人即是一支特遣舰队。",
    icon: Compass,
    check: (badgeMap) => (badgeMap.get("swarm_commander")?.tier || 0) >= 1 && (badgeMap.get("multitool")?.tier || 0) >= 2,
    reqText: "特遣舰队司令(青铜) + 多面手(白银)",
  },
  {
    id: "frugal_archmage",
    name: "零元精算巨匠",
    en: "Frugal Archmage",
    desc: "将上下文结构压缩至极致，白嫖每一分可用算力。",
    icon: Wand2,
    check: (badgeMap) => (badgeMap.get("frugal_architect")?.tier || 0) >= 2 && (badgeMap.get("cache_miser")?.tier || 0) >= 1,
    reqText: "白嫖之光(白银) + 缓存精算师(青铜)",
  },
  {
    id: "openai_paladin",
    name: "奥特曼信徒",
    en: "OpenAI Paladin",
    desc: "执着于前沿 AGI 探索，笃信奥特曼灯塔的终极力量。",
    icon: ShieldCheck,
    check: (badgeMap) => (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 2 && (badgeMap.get("deep_thinker")?.tier || 0) >= 1,
    reqText: "奥特曼信徒(白银) + 深度思考(青铜)",
  },
  {
    id: "omniscient_architect",
    name: "全知全能架构师",
    en: "Omniscient Architect",
    desc: "通晓各大模型脾气与数十种开发工具的奇门遁甲。",
    icon: Boxes,
    check: (badgeMap) => (badgeMap.get("polyglot")?.tier || 0) >= 3 && (badgeMap.get("multitool")?.tier || 0) >= 3,
    reqText: "模型博学者(黄金) + 多面手(黄金)",
  },
  {
    id: "zen_master",
    name: "生活工作禅师",
    en: "Zen Master",
    desc: "周内高效输出，周末彻底拔电，AI 时代清醒的生活家。",
    icon: Coffee,
    check: (badgeMap) => (badgeMap.get("zen_balancer")?.tier || 0) >= 1 && (badgeMap.get("marathoner")?.tier || 0) >= 2,
    reqText: "工作生活禅(青铜) + 马拉松(白银)",
  },
  {
    id: "code_cannon_overlord",
    name: "极客代码巨炮",
    en: "Code Overlord",
    desc: "极简提示词输入，排山倒海的代码万行奔涌落地。",
    icon: Rocket,
    check: (badgeMap) => (badgeMap.get("code_cannon")?.tier || 0) >= 2 && (badgeMap.get("wordsmith")?.tier || 0) >= 2,
    reqText: "代码巨炮(白银) + 文字工匠(白银)",
  },
  {
    id: "grand_slam_legend",
    name: "大满贯传奇",
    en: "Grand Slam Legend",
    desc: "勋章架上钻石熠熠生辉，登峰造极的开发大师。",
    icon: Crown,
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
    <div className="mb-8 rounded-2xl border border-oai-gray-200/80 bg-gradient-to-br from-oai-white to-oai-gray-50/50 p-5 shadow-sm dark:border-oai-gray-800 dark:from-oai-gray-900 dark:to-oai-gray-950/70">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
              <Sparkles className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold text-oai-black dark:text-white">
              专属称号与成就羁绊
            </h3>
            <span className="rounded-full bg-oai-gray-100 px-2 py-0.5 text-xs font-medium text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
              已解锁 {unlockedTitles.length}/{TITLES_REGISTRY.length}
            </span>
          </div>
          <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            当特定徽章达到指定品阶时触发羁绊共鸣，解锁并佩戴你的极客专属称号。
          </p>
        </div>

        {activeTitle && (
          <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-3.5 py-2 dark:border-amber-400/20 dark:bg-amber-400/5">
            {React.createElement(activeTitle.icon, { className: "h-5 w-5 text-amber-500" })}
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                  当前佩戴
                </span>
              </div>
              <span className="text-sm font-bold text-oai-black dark:text-white">
                {activeTitle.name}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Title badges list */}
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4">
        {TITLES_REGISTRY.map((title) => {
          const isUnlocked = title.check(badgeMap);
          const isEquipped = isUnlocked && activeTitleId === title.id;

          return (
            <button
              key={title.id}
              type="button"
              disabled={!isUnlocked}
              onClick={() => handleSelectTitle(title.id)}
              className={`group relative flex flex-col justify-between rounded-xl border p-3 text-left transition-all ${
                isEquipped
                  ? "border-amber-500 bg-amber-500/10 shadow-sm dark:border-amber-400 dark:bg-amber-400/10"
                  : isUnlocked
                  ? "border-oai-gray-200 bg-white hover:border-amber-400/50 hover:shadow-sm dark:border-oai-gray-800 dark:bg-oai-gray-900/60 dark:hover:border-amber-500/40"
                  : "border-dashed border-oai-gray-200/60 bg-oai-gray-50/40 opacity-60 dark:border-oai-gray-800/60 dark:bg-oai-gray-950/40"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  {React.createElement(title.icon, { className: "h-4 w-4 " + (isEquipped ? "text-amber-500" : isUnlocked ? "text-amber-600 dark:text-amber-400" : "text-oai-gray-400") })}
                  {isEquipped ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white dark:bg-amber-400 dark:text-black">
                      <Check className="h-3 w-3" />
                    </span>
                  ) : isUnlocked ? (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      点击佩戴
                    </span>
                  ) : (
                    <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                      未达成
                    </span>
                  )}
                </div>

                <div className="mt-2 font-semibold text-sm text-oai-black dark:text-white">
                  {title.name}
                </div>
                <p className="mt-0.5 line-clamp-1 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                  {title.desc}
                </p>
              </div>

              <div className="mt-2.5 pt-2 border-t border-oai-gray-100 text-[10px] text-oai-gray-400 dark:border-oai-gray-800/80 dark:text-oai-gray-500">
                {title.reqText}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default BadgeSynergyBanner;
