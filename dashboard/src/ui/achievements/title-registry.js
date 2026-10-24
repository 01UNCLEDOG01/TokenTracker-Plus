import { useState, useEffect } from "react";

export const TITLES_REGISTRY = [
  {
    id: "frugal_archmage",
    name: "零元精算巨匠",
    en: "Frugal Archmage",
    desc: "将上下文结构压缩至极致，白嫖每一分可用算力。",
    tag: "纯金算盘",
    art: "/achievements/titles/title-frugal-archmage.png?v=1",
    requiredBadges: [
      { id: "frugal_architect", name: "白嫖之光", tier: 2, art: "/achievements/frugal-architect.png?v=3" },
      { id: "cache_miser", name: "缓存精算师", tier: 1, art: "/achievements/cache-miser.png?v=3" },
    ],
    check: (badgeMap) => (badgeMap.get("frugal_architect")?.tier || 0) >= 2 && (badgeMap.get("cache_miser")?.tier || 0) >= 1,
    reqText: "白嫖之光(白银) + 缓存精算师(青铜)",
    theme: {
      text: "text-amber-300",
      bgGradient: "from-amber-950/80 via-slate-900 to-yellow-950/60",
      border: "border-amber-400/60",
      glow: "shadow-lg shadow-amber-500/40",
      pillClass: "bg-amber-950/70 text-amber-200 border-amber-400/50 shadow-amber-500/20",
      ring: "ring-amber-400/50",
      accentDot: "bg-amber-400",
    },
  },
  {
    id: "cyber_speedster",
    name: "极速先锋 · 赛博狂飙者",
    en: "Hyperspeed Pioneer",
    desc: "Google 海量 Flash 遇上马斯克 Grok 极速引擎，光速推流，指尖破空。",
    tag: "曲率引擎",
    dimension: 2,
    art: "/achievements/titles/title-cyber-speedster.png?v=3",
    requiredBadges: [
      { id: "north_america_doubao", name: "北美豆包", tier: 1, art: "/achievements/north-america-doubao.png?v=3" },
      { id: "hyperspeed_grok", name: "极速狂飙", tier: 1, art: "/achievements/hyperspeed-grok.png?v=3" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("north_america_doubao")?.tier || 0) >= 1 &&
      (badgeMap.get("hyperspeed_grok")?.tier || 0) >= 1,
    reqText: "北美豆包 + 极速狂飙 (全解锁)",
    theme: {
      text: "text-sky-300",
      bgGradient: "from-sky-950/80 via-blue-950/70 to-slate-950",
      border: "border-sky-400/60",
      glow: "shadow-lg shadow-sky-500/35",
      pillClass: "bg-sky-950/70 text-sky-200 border-sky-400/50 shadow-sky-500/20",
      ring: "ring-sky-400/50",
      accentDot: "bg-sky-400",
    },
  },
  {
    id: "zen_master",
    name: "生活工作禅师",
    en: "Zen Master",
    desc: "周内高效输出，周末彻底拔电，AI 时代清醒的生活家。",
    tag: "碧玉禅心",
    art: "/achievements/titles/title-zen-master.png?v=1",
    requiredBadges: [
      { id: "zen_balancer", name: "工作生活禅", tier: 1, art: "/achievements/zen-balancer.png?v=3" },
      { id: "marathoner", name: "马拉松", tier: 2, art: "/achievements/marathoner.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("zen_balancer")?.tier || 0) >= 1 && (badgeMap.get("marathoner")?.tier || 0) >= 2,
    reqText: "工作生活禅(青铜) + 马拉松(白银)",
    theme: {
      text: "text-emerald-300",
      bgGradient: "from-emerald-950/80 via-slate-900 to-green-950/60",
      border: "border-emerald-400/50",
      glow: "shadow-lg shadow-emerald-500/35",
      pillClass: "bg-emerald-950/70 text-emerald-200 border-emerald-400/40 shadow-emerald-500/20",
      ring: "ring-emerald-400/40",
      accentDot: "bg-emerald-400",
    },
  },
  {
    id: "fleet_admiral",
    name: "特遣舰队司令",
    en: "Fleet Admiral",
    desc: "多工具多智能体并发调度，一人即是一支特遣舰队。",
    tag: "星际舰队",
    art: "/achievements/titles/title-fleet-admiral.png?v=1",
    requiredBadges: [
      { id: "swarm_commander", name: "特遣舰队司令", tier: 1, art: "/achievements/swarm-commander.png?v=3" },
      { id: "multitool", name: "多面手", tier: 2, art: "/achievements/multitool.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("swarm_commander")?.tier || 0) >= 1 && (badgeMap.get("multitool")?.tier || 0) >= 2,
    reqText: "特遣舰队司令(青铜) + 多面手(白银)",
    theme: {
      text: "text-emerald-300",
      bgGradient: "from-emerald-950/80 via-slate-900 to-teal-950/60",
      border: "border-emerald-500/50",
      glow: "shadow-lg shadow-emerald-500/35",
      pillClass: "bg-emerald-950/70 text-emerald-200 border-emerald-500/40 shadow-emerald-500/20",
      ring: "ring-emerald-500/40",
      accentDot: "bg-emerald-400",
    },
  },
  {
    id: "openai_paladin",
    name: "奥特曼信徒",
    en: "OpenAI Paladin",
    desc: "执着于前沿 AGI 探索，笃信奥特曼灯塔的终极力量。",
    tag: "AGI圣殿",
    art: "/achievements/titles/title-openai-paladin.png?v=1",
    requiredBadges: [
      { id: "closed_source_loyalist", name: "奥特曼信徒", tier: 2, art: "/achievements/closed-source-loyalist.png?v=3" },
      { id: "deep_thinker", name: "深度思考", tier: 1, art: "/achievements/deep-thinker.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 2 && (badgeMap.get("deep_thinker")?.tier || 0) >= 1,
    reqText: "奥特曼信徒(白银) + 深度思考(青铜)",
    theme: {
      text: "text-teal-300",
      bgGradient: "from-teal-950/80 via-slate-900 to-emerald-950/60",
      border: "border-teal-400/50",
      glow: "shadow-lg shadow-teal-500/35",
      pillClass: "bg-teal-950/70 text-teal-200 border-teal-400/40 shadow-teal-500/20",
      ring: "ring-teal-400/40",
      accentDot: "bg-teal-400",
    },
  },
  {
    id: "code_cannon_overlord",
    name: "极客代码巨炮",
    en: "Code Overlord",
    desc: "极简提示词输入，排山倒海的代码万行奔涌落地。",
    tag: "烈焰重炮",
    art: "/achievements/titles/title-code-cannon.png?v=1",
    requiredBadges: [
      { id: "code_cannon", name: "代码巨炮", tier: 2, art: "/achievements/code-cannon.png?v=3" },
      { id: "wordsmith", name: "文字工匠", tier: 2, art: "/achievements/wordsmith.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("code_cannon")?.tier || 0) >= 2 && (badgeMap.get("wordsmith")?.tier || 0) >= 2,
    reqText: "代码巨炮(白银) + 文字工匠(白银)",
    theme: {
      text: "text-orange-300",
      bgGradient: "from-orange-950/80 via-slate-900 to-red-950/60",
      border: "border-orange-500/60",
      glow: "shadow-lg shadow-orange-500/45",
      pillClass: "bg-orange-950/70 text-orange-200 border-orange-500/50 shadow-orange-500/20",
      ring: "ring-orange-500/50",
      accentDot: "bg-orange-400",
    },
  },
  {
    id: "cyber_immortal",
    name: "赛博修仙者",
    en: "Cyber Immortal",
    desc: "在万籁俱寂的深夜，与 AI 一同入定悟道。",
    tag: "紫电青雷",
    art: "/achievements/titles/title-cyber-immortal.png?v=1",
    requiredBadges: [
      { id: "night_owl", name: "夜猫子", tier: 2, art: "/achievements/night-owl.png?v=7" },
      { id: "session_marathon", name: "连续会长会话", tier: 2, art: "/achievements/session-marathon.png?v=11" },
    ],
    check: (badgeMap) => (badgeMap.get("night_owl")?.tier || 0) >= 2 && (badgeMap.get("session_marathon")?.tier || 0) >= 2,
    reqText: "夜猫子(白银) + 连续会长会话(白银)",
    theme: {
      text: "text-purple-300",
      bgGradient: "from-purple-950/80 via-slate-900 to-violet-950/60",
      border: "border-purple-500/50",
      glow: "shadow-lg shadow-purple-500/35",
      pillClass: "bg-purple-950/70 text-purple-200 border-purple-500/40 shadow-purple-500/20",
      ring: "ring-purple-500/40",
      accentDot: "bg-purple-400",
    },
  },
  {
    id: "omniscient_architect",
    name: "全知全能架构师",
    en: "Omniscient Architect",
    desc: "通晓各大模型脾气与数十种开发工具的奇门遁甲。",
    tag: "全息星图",
    art: "/achievements/titles/title-omniscient-architect.png?v=1",
    requiredBadges: [
      { id: "polyglot", name: "模型博学者", tier: 3, art: "/achievements/polyglot.png?v=7" },
      { id: "multitool", name: "多面手", tier: 3, art: "/achievements/multitool.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("polyglot")?.tier || 0) >= 3 && (badgeMap.get("multitool")?.tier || 0) >= 3,
    reqText: "模型博学者(黄金) + 多面手(黄金)",
    theme: {
      text: "text-blue-300",
      bgGradient: "from-blue-950/80 via-slate-900 to-indigo-950/60",
      border: "border-blue-400/50",
      glow: "shadow-lg shadow-blue-500/40",
      pillClass: "bg-blue-950/70 text-blue-200 border-blue-400/40 shadow-blue-500/20",
      ring: "ring-blue-400/40",
      accentDot: "bg-blue-400",
    },
  },
  {
    id: "silicon_trinity",
    name: "诸神信使 · 硅谷三冠王",
    en: "Silicon Valley Trinity",
    desc: "同时御统 OpenAI、Anthropic 与 Google 三大海外神殿，金字塔尖的三冠王者。",
    tag: "三神交泰",
    dimension: 3,
    art: "/achievements/titles/title-silicon-trinity.png?v=3",
    requiredBadges: [
      { id: "closed_source_loyalist", name: "奥特曼信徒", tier: 1, art: "/achievements/closed-source-loyalist.png?v=3" },
      { id: "claude_survivor", name: "封号幸存者", tier: 1, art: "/achievements/claude-survivor.png?v=11" },
      { id: "north_america_doubao", name: "北美豆包", tier: 1, art: "/achievements/north-america-doubao.png?v=3" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 1 &&
      (badgeMap.get("claude_survivor")?.tier || 0) >= 1 &&
      (badgeMap.get("north_america_doubao")?.tier || 0) >= 1,
    reqText: "奥特曼信徒 + 封号幸存者 + 北美豆包 (全解锁)",
    theme: {
      text: "text-cyan-200",
      bgGradient: "from-teal-950/80 via-indigo-950/70 to-slate-950",
      border: "border-cyan-400/70",
      glow: "shadow-lg shadow-cyan-500/40",
      pillClass: "bg-gradient-to-r from-teal-950/80 to-cyan-950/80 text-cyan-200 border-cyan-400/60 shadow-cyan-500/30",
      ring: "ring-cyan-400/60",
      accentDot: "bg-cyan-400",
    },
  },
  {
    id: "cn_quad_masters",
    name: "九州极客 · 四象掌门",
    en: "Domestic Quad Titans",
    desc: "融汇中华 AI 最前沿四大家族算力，四象归一，开辟东方极客新天地。",
    tag: "四象混元",
    dimension: 4,
    art: "/achievements/titles/title-cn-quad-masters.png?v=3",
    requiredBadges: [
      { id: "wishing_well", name: "许愿池(DeepSeek)", tier: 1, art: "/achievements/wishing-well.png?v=11" },
      { id: "zhipu_sage", name: "智谱乾坤", tier: 1, art: "/achievements/zhipu-sage.png?v=3" },
      { id: "moonshot_voyager", name: "暗面行者", tier: 1, art: "/achievements/moonshot-voyager.png?v=3" },
      { id: "minimax_abyss", name: "海螺巨兽", tier: 1, art: "/achievements/minimax-abyss.png?v=3" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("wishing_well")?.tier || 0) >= 1 &&
      (badgeMap.get("zhipu_sage")?.tier || 0) >= 1 &&
      (badgeMap.get("moonshot_voyager")?.tier || 0) >= 1 &&
      (badgeMap.get("minimax_abyss")?.tier || 0) >= 1,
    reqText: "许愿池 + 智谱乾坤 + 暗面行者 + 海螺巨兽 (全解锁)",
    theme: {
      text: "text-amber-200",
      bgGradient: "from-amber-950/80 via-emerald-950/70 to-slate-950",
      border: "border-amber-400/70",
      glow: "shadow-lg shadow-amber-500/45",
      pillClass: "bg-gradient-to-r from-amber-950/80 to-emerald-950/80 text-amber-200 border-amber-400/60 shadow-amber-500/30",
      ring: "ring-amber-400/60",
      accentDot: "bg-amber-400",
    },
  },
  {
    id: "grand_slam_legend",
    name: "大满贯传奇",
    en: "Grand Slam Legend",
    desc: "勋章架上钻石熠熠生辉，登峰造极的开发大师。",
    tag: "至尊星冠",
    art: "/achievements/titles/title-grand-slam.png?v=1",
    requiredBadges: [
      { id: "grand_slam", name: "大满贯", tier: 1, art: "/achievements/grand-slam.png?v=11" },
    ],
    check: (badgeMap) => (badgeMap.get("grand_slam")?.tier || 0) >= 1,
    reqText: "大满贯徽章(解锁至少 5 枚钻石勋章)",
    theme: {
      text: "text-pink-300",
      bgGradient: "from-fuchsia-950/80 via-indigo-950/70 to-amber-950/60",
      border: "border-fuchsia-400/70",
      glow: "shadow-lg shadow-pink-500/40",
      pillClass: "bg-gradient-to-r from-fuchsia-950/80 to-amber-950/80 text-amber-200 border-fuchsia-400/60 shadow-fuchsia-500/30",
      ring: "ring-fuchsia-400/60",
      accentDot: "bg-fuchsia-400",
    },
  },
];

export const STORAGE_ACTIVE_TITLE = "tokentracker:active_title";
export const EVENT_TITLE_CHANGED = "tokentracker:title_changed";

export function getActiveTitleId() {
  try {
    return localStorage.getItem(STORAGE_ACTIVE_TITLE) || "";
  } catch {
    return "";
  }
}

export function setActiveTitleId(titleId) {
  try {
    if (titleId) {
      localStorage.setItem(STORAGE_ACTIVE_TITLE, titleId);
    } else {
      localStorage.removeItem(STORAGE_ACTIVE_TITLE);
    }
    window.dispatchEvent(new CustomEvent(EVENT_TITLE_CHANGED, { detail: titleId }));
  } catch {}
}

export function getTitleById(id) {
  if (!id) return null;
  return TITLES_REGISTRY.find((t) => t.id === id) || null;
}

/** React hook for subscribing to active equipped title changes across components */
export function useEquippedTitle() {
  const [activeId, setActiveId] = useState(getActiveTitleId);

  useEffect(() => {
    const handleUpdate = (e) => {
      setActiveId(e?.detail ?? getActiveTitleId());
    };
    const handleStorage = (e) => {
      if (e.key === STORAGE_ACTIVE_TITLE) {
        setActiveId(e.newValue || "");
      }
    };
    window.addEventListener(EVENT_TITLE_CHANGED, handleUpdate);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(EVENT_TITLE_CHANGED, handleUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return getTitleById(activeId);
}

/** Computes dynamic resonance tier (1 to 4) based on member badge tier levels */
export function getTitleResonance(title, badgeMap) {
  if (!title) return { unlocked: false, tier: 0, label: "未激活", tierName: "未激活", dim: 2, dimName: "双星交汇" };
  const isUnlocked = title.check(badgeMap);
  if (!isUnlocked) {
    const dim = title.dimension || (title.requiredBadges?.length || 2);
    const dimName = dim === 4 ? "四象混元" : dim === 3 ? "三神交泰" : dim === 1 ? "独步星河" : "双星交汇";
    return { unlocked: false, tier: 0, label: "未激活", tierName: "未激活", dim, dimName };
  }

  let resonanceTier = 1;
  if (title.id === "grand_slam_legend") {
    resonanceTier = badgeMap.get("grand_slam")?.tier || 1;
  } else {
    const tiers = (title.requiredBadges || []).map((req) => badgeMap.get(req.id)?.tier || 0);
    const minTier = Math.min(...tiers);
    resonanceTier = Math.max(1, Math.min(4, minTier));
  }

  const dim = title.dimension || (title.requiredBadges?.length || 2);
  const dimName = dim === 4 ? "四象混元" : dim === 3 ? "三神交泰" : dim === 1 ? "至尊星冕" : "双星交汇";

  const tierNames = ["未激活", "青铜", "白银", "黄金", "钻石"];
  const tierName = tierNames[resonanceTier] || "青铜";
  const label = resonanceTier === 4 ? `${tierName}共鸣 · MAX` : `${tierName}共鸣 · Lv.${resonanceTier}`;

  return {
    unlocked: true,
    tier: resonanceTier,
    dim,
    dimName,
    tierName,
    label,
  };
}

