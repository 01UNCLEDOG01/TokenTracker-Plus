import { useState, useEffect } from "react";

/**
 * =========================================================================
 * 极客称号殿堂 · 羁绊共鸣开放设计架构 (Open Architecture Design)
 * =========================================================================
 * 1. 难度排序 (Difficulty order):
 *    - 称号按 `difficulty` 从易到难排序；分值 = 成员徽章所需品阶权重
 *      （青铜1/白银2/黄金4/钻石7）× 成员数，大满贯×10、领奖台×3；
 *      同分时成员多的排后。排序结果就是殿堂里的展示顺序。
 *    - 颜色是称号自己的身份色（identity），不随排序或共鸣改变；越难解锁的
 *      称号在设计时本就配了更炫的身份色，但不要用颜色反推难度。
 *
 * 2. 称号定死颜色，共鸣改变特效 (Fixed Title Identity, Dynamic Resonance VFX):
 *    - 每个称号拥有固定且专属的色彩基调与阵营身份（Brand/Title Identity Hue）；
 *      颜色只跟称号本身的难度阶位绑定，绝不随共鸣等级变化。
 *    - 羁绊共鸣（Resonance）决定的是光效的层级与能量形态：
 *      - 青铜共鸣 (Lv.1): 基础常态微芒，单层边线
 *      - 白银共鸣 (Lv.2): 银霜流光脉冲，双层反光高亮
 *      - 黄金共鸣 (Lv.3): 灿金能量光晕，外框呼吸脉动，星芒微溢
 *      - 钻石共鸣 (MAX) : 巅峰星冕全开，极光粒子爆发，双环流光超载！
 *    - 组件只消费 theme.ring / theme.glow，禁止按 tier 改色；tier 只叠加特效层。
 *
 * 3. 展示名 (Display names):
 *    - name 是卡片全称；shortName 用于侧栏、排行榜与徽章旁的最小空间；
 *      统一走 titleDisplayName(title) 取值，不要在组件里手写截断。
 * =========================================================================
 */

const TITLES_UNSORTED = [
  // 零元购 (Rank 1: 质朴古铜 · 初入门径)
  {
    id: "frugal_archmage",
    difficulty: 3.2,
    name: "零元购",
    en: "Zero-Cost Cart",
    desc: "羊毛宗师与白嫖之光双修，把每一次调用都过成零元购。",
    tag: "质朴古铜",
    art: "/achievements/titles/title-frugal-archmage.png?v=5",
    requiredBadges: [
      { id: "token_arbitrageur", name: "羊毛宗师", tier: 1, art: "/achievements/token-arbitrageur.png?v=6" },
      { id: "frugal_architect", name: "白嫖之光", tier: 2, art: "/achievements/frugal-architect.png?v=6" },
    ],
    check: (badgeMap) => (badgeMap.get("token_arbitrageur")?.tier || 0) >= 1 && (badgeMap.get("frugal_architect")?.tier || 0) >= 2,
    reqText: "羊毛宗师(青铜) + 白嫖之光(白银)",
    theme: {
      text: "text-amber-200",
      bgGradient: "from-stone-900/90 via-zinc-950 to-black",
      border: "border-stone-500/60",
      glow: "shadow-lg shadow-stone-600/30",
      pillClass: "bg-stone-900/80 text-amber-200 border-stone-500/50 shadow-stone-600/20",
      ring: "ring-stone-400/50",
      accentDot: "bg-amber-400",
    },
  },
  // 极速先锋 · 赛博狂飙者 (Rank 2: 晴空天蓝 · 晨曦微风)
  {
    id: "cyber_speedster",
    difficulty: 2.0,
    name: "极速先锋 · 赛博狂飙者",
    shortName: "赛博狂飙者",
    en: "Hyperspeed Pioneer",
    desc: "Google 海量 Flash 遇上马斯克 Grok 极速引擎，光速推流，指尖破空。",
    tag: "曲率引擎",
    dimension: 2,
    art: "/achievements/titles/title-cyber-speedster.png?v=5",
    requiredBadges: [
      { id: "north_america_doubao", name: "北美豆包", tier: 1, art: "/achievements/north-america-doubao.png?v=6" },
      { id: "hyperspeed_grok", name: "极速狂飙", tier: 1, art: "/achievements/hyperspeed-grok.png?v=6" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("north_america_doubao")?.tier || 0) >= 1 &&
      (badgeMap.get("hyperspeed_grok")?.tier || 0) >= 1,
    reqText: "北美豆包 + 极速狂飙 (全解锁)",
    theme: {
      text: "text-sky-300",
      bgGradient: "from-sky-950/80 via-blue-950/70 to-black",
      border: "border-sky-500/60",
      glow: "shadow-lg shadow-sky-500/35",
      pillClass: "bg-sky-950/80 text-sky-200 border-sky-400/50 shadow-sky-500/20",
      ring: "ring-sky-400/50",
      accentDot: "bg-sky-400",
    },
  },
  // 生活禅者 (Rank 3: 雅致竹青翡翠 · 碧玉禅心)
  {
    id: "zen_master",
    difficulty: 3.1,
    name: "生活禅师",
    en: "Zen Master",
    desc: "周内高效输出，周末彻底拔电，AI 时代清醒的生活家。",
    tag: "碧玉禅心",
    art: "/achievements/titles/title-zen-master.png?v=5",
    requiredBadges: [
      { id: "zen_balancer", name: "小确幸", tier: 1, art: "/achievements/zen-balancer.png?v=6" },
      { id: "marathoner", name: "马拉松", tier: 2, art: "/achievements/marathoner.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("zen_balancer")?.tier || 0) >= 1 && (badgeMap.get("marathoner")?.tier || 0) >= 2,
    reqText: "小确幸(青铜) + 马拉松(白银)",
    theme: {
      text: "text-emerald-300",
      bgGradient: "from-emerald-950/80 via-slate-900 to-black",
      border: "border-emerald-500/60",
      glow: "shadow-lg shadow-emerald-500/35",
      pillClass: "bg-emerald-950/80 text-emerald-200 border-emerald-400/40 shadow-emerald-500/20",
      ring: "ring-emerald-400/40",
      accentDot: "bg-emerald-400",
    },
  },
  // 一人公司 OPC (Rank 4: 深洋碧青 · 一人军团)
  {
    id: "fleet_admiral",
    difficulty: 7.3,
    name: "一人公司",
    en: "One Person Company",
    desc: "个人 + AI 驱动完整业务：工具、模型、分身与全天候节奏全部由一个人调度。",
    tag: "OPC",
    bondName: "一人军团",
    dimension: 5,
    art: "/achievements/titles/title-one-person-company.png?v=1",
    requiredBadges: [
      { id: "swarm_commander", name: "管理者", tier: 1, art: "/achievements/swarm-commander.png?v=7" },
      { id: "multitool", name: "多面手", tier: 1, art: "/achievements/multitool.png?v=7" },
      { id: "polyglot", name: "模型通", tier: 1, art: "/achievements/polyglot.png?v=7" },
      { id: "multitool_day", name: "分身有术", tier: 1, art: "/achievements/multitool-day.png?v=11" },
      { id: "around_the_clock", name: "昼夜不息", tier: 1, art: "/achievements/around-the-clock.png?v=11" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("swarm_commander")?.tier || 0) >= 1 &&
      (badgeMap.get("multitool")?.tier || 0) >= 1 &&
      (badgeMap.get("polyglot")?.tier || 0) >= 1 &&
      (badgeMap.get("multitool_day")?.tier || 0) >= 1 &&
      (badgeMap.get("around_the_clock")?.tier || 0) >= 1,
    reqText: "管理者 + 多面手 + 模型通 + 分身有术 + 昼夜不息 (全解锁)",
    theme: {
      text: "text-teal-300",
      bgGradient: "from-teal-950/80 via-slate-900 to-black",
      border: "border-teal-500/60",
      glow: "shadow-lg shadow-teal-500/35",
      pillClass: "bg-teal-950/80 text-teal-200 border-teal-400/40 shadow-teal-500/20",
      ring: "ring-teal-400/40",
      accentDot: "bg-teal-400",
    },
  },
  // 极客代码巨炮 (Rank 5: 炽烈熔火 · 算力炽焰)
  {
    id: "code_cannon_overlord",
    difficulty: 4.0,
    name: "极客代码巨炮",
    en: "Code Overlord",
    desc: "极简提示词输入，排山倒海的代码万行奔涌落地。",
    tag: "烈焰重炮",
    art: "/achievements/titles/title-code-cannon.png?v=5",
    requiredBadges: [
      { id: "code_cannon", name: "火力覆盖", tier: 2, art: "/achievements/code-cannon.png?v=6" },
      { id: "wordsmith", name: "文字工匠", tier: 2, art: "/achievements/wordsmith.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("code_cannon")?.tier || 0) >= 2 && (badgeMap.get("wordsmith")?.tier || 0) >= 2,
    reqText: "火力覆盖(白银) + 文字工匠(白银)",
    theme: {
      text: "text-rose-300",
      bgGradient: "from-rose-950/80 via-zinc-950 to-black",
      border: "border-rose-500/60",
      glow: "shadow-lg shadow-rose-500/40",
      pillClass: "bg-rose-950/80 text-rose-200 border-rose-500/50 shadow-rose-500/20",
      ring: "ring-rose-500/50",
      accentDot: "bg-rose-400",
    },
  },
  // 天选牛马 (Rank 6: 铁灰牛马 · 四件套全开)
  {
    id: "chosen_drudge",
    difficulty: 5.1,
    name: "天选牛马",
    en: "Chosen Drudge",
    desc: "分身、早鸟、周末与连胜四件套全开——天选的牛马，AI 时代的劳模。",
    tag: "铁灰缰绳",
    bondName: "天选四件套",
    dimension: 4,
    art: "/achievements/titles/title-chosen-drudge.png?v=1",
    requiredBadges: [
      { id: "multitool_day", name: "分身有术", tier: 1, art: "/achievements/multitool-day.png?v=11" },
      { id: "early_bird", name: "早鸟", tier: 1, art: "/achievements/early-bird.png?v=11" },
      { id: "weekend_warrior", name: "周末战士", tier: 1, art: "/achievements/weekend-warrior.png?v=7" },
      { id: "streak", name: "连胜火焰", tier: 1, art: "/achievements/streak.png?v=7" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("multitool_day")?.tier || 0) >= 1 &&
      (badgeMap.get("early_bird")?.tier || 0) >= 1 &&
      (badgeMap.get("weekend_warrior")?.tier || 0) >= 1 &&
      (badgeMap.get("streak")?.tier || 0) >= 1,
    reqText: "分身有术 + 早鸟 + 周末战士 + 连胜火焰 (全解锁)",
    theme: {
      text: "text-zinc-200",
      bgGradient: "from-zinc-800/90 via-slate-900 to-black",
      border: "border-zinc-500/60",
      glow: "shadow-lg shadow-zinc-500/35",
      pillClass: "bg-zinc-900/80 text-zinc-200 border-zinc-500/50 shadow-zinc-500/20",
      ring: "ring-zinc-400/50",
      accentDot: "bg-zinc-300",
    },
  },
  // 赛博修仙者 (Rank 7: 幽夜紫电 · 夜战定道)
  {
    id: "cyber_immortal",
    difficulty: 4.1,
    name: "赛博修仙者",
    en: "Cyber Immortal",
    desc: "在万籁俱寂的深夜，与 AI 一同入定悟道。",
    tag: "紫电青雷",
    art: "/achievements/titles/title-cyber-immortal.png?v=5",
    requiredBadges: [
      { id: "night_owl", name: "夜猫子", tier: 2, art: "/achievements/night-owl.png?v=7" },
      { id: "session_marathon", name: "时之沙", tier: 2, art: "/achievements/session-marathon.png?v=11" },
    ],
    check: (badgeMap) => (badgeMap.get("night_owl")?.tier || 0) >= 2 && (badgeMap.get("session_marathon")?.tier || 0) >= 2,
    reqText: "夜猫子(白银) + 时之沙(白银)",
    theme: {
      text: "text-purple-300",
      bgGradient: "from-purple-950/80 via-slate-900 to-black",
      border: "border-purple-500/60",
      glow: "shadow-lg shadow-purple-500/40",
      pillClass: "bg-purple-950/80 text-purple-200 border-purple-500/40 shadow-purple-500/20",
      ring: "ring-purple-400/50",
      accentDot: "bg-purple-400",
    },
  },
  // 神之信徒 (Rank 8: 圣堂深蓝 · 纯血庄严)
  {
    id: "openai_paladin",
    difficulty: 3.0,
    name: "神之信徒",
    en: "Divine Devotee",
    desc: "执着于前沿 AGI 探索，笃信奥特曼灯塔的终极力量。",
    tag: "AGI圣殿",
    art: "/achievements/titles/title-openai-paladin.png?v=5",
    requiredBadges: [
      { id: "closed_source_loyalist", name: "神说要有光", tier: 2, art: "/achievements/closed-source-loyalist.png?v=6" },
      { id: "deep_thinker", name: "深度思考", tier: 1, art: "/achievements/deep-thinker.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 2 && (badgeMap.get("deep_thinker")?.tier || 0) >= 1,
    reqText: "神说要有光(白银) + 深度思考(青铜)",
    theme: {
      text: "text-indigo-300",
      bgGradient: "from-indigo-950/80 via-blue-950/70 to-black",
      border: "border-indigo-500/60",
      glow: "shadow-lg shadow-indigo-500/40",
      pillClass: "bg-indigo-950/80 text-indigo-200 border-indigo-400/50 shadow-indigo-500/20",
      ring: "ring-indigo-400/50",
      accentDot: "bg-indigo-400",
    },
  },
  // 冯诺依曼派 (Rank 9: 冷银电路 · 体系结构)
  {
    id: "von_neumann",
    difficulty: 5.2,
    name: "冯诺依曼派",
    en: "Von Neumann School",
    desc: "终端、缓存、重构、深思四线贯通，用体系结构的方法调度一切算力。",
    tag: "体系结构",
    bondName: "体系结构",
    dimension: 4,
    art: "/achievements/titles/title-von-neumann.png?v=1",
    requiredBadges: [
      { id: "terminal_purist", name: "终端原教旨主义", tier: 1, art: "/achievements/terminal-purist.png?v=6" },
      { id: "cache_miser", name: "缓存精算师", tier: 1, art: "/achievements/cache-miser.png?v=6" },
      { id: "refactor_titan", name: "重构巨匠", tier: 1, art: "/achievements/refactor-titan.png?v=6" },
      { id: "deep_thinker", name: "深思者", tier: 1, art: "/achievements/deep-thinker.png?v=7" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("terminal_purist")?.tier || 0) >= 1 &&
      (badgeMap.get("cache_miser")?.tier || 0) >= 1 &&
      (badgeMap.get("refactor_titan")?.tier || 0) >= 1 &&
      (badgeMap.get("deep_thinker")?.tier || 0) >= 1,
    reqText: "终端原教旨主义 + 缓存精算师 + 重构巨匠 + 深思者 (全解锁)",
    theme: {
      text: "text-cyan-200",
      bgGradient: "from-slate-900/90 via-cyan-950/60 to-black",
      border: "border-cyan-400/60",
      glow: "shadow-lg shadow-cyan-400/40",
      pillClass: "bg-cyan-950/80 text-cyan-100 border-cyan-400/50 shadow-cyan-400/25",
      ring: "ring-cyan-300/50",
      accentDot: "bg-cyan-300",
    },
  },
  // 全知全能架构师 (Rank 10: 璀璨琉璃金 · 睿智博学)
  {
    id: "omniscient_architect",
    difficulty: 8.0,
    name: "全知全能架构师",
    en: "Omniscient Architect",
    desc: "通晓各大模型脾气与数十种开发工具的奇门遁甲。",
    tag: "全息星图",
    art: "/achievements/titles/title-omniscient-architect.png?v=5",
    requiredBadges: [
      { id: "polyglot", name: "模型博学者", tier: 3, art: "/achievements/polyglot.png?v=7" },
      { id: "multitool", name: "多面手", tier: 3, art: "/achievements/multitool.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("polyglot")?.tier || 0) >= 3 && (badgeMap.get("multitool")?.tier || 0) >= 3,
    reqText: "模型博学者(黄金) + 多面手(黄金)",
    theme: {
      text: "text-yellow-300",
      bgGradient: "from-yellow-950/80 via-amber-950/70 to-black",
      border: "border-yellow-500/60",
      glow: "shadow-lg shadow-yellow-500/40",
      pillClass: "bg-yellow-950/80 text-yellow-200 border-yellow-400/50 shadow-yellow-500/20",
      ring: "ring-yellow-400/50",
      accentDot: "bg-yellow-400",
    },
  },
  // 诸神信使 · 硅谷三巨头 (Rank 11: 霓虹极光紫 · 闭源巅峰)
  {
    id: "silicon_trinity",
    difficulty: 3.5,
    name: "诸神信使 · 硅谷三巨头",
    shortName: "诸神信使",
    en: "Silicon Valley Trinity",
    desc: "同时御统 OpenAI、Anthropic 与 Google 三大海外神殿，金字塔尖的三冠王者。",
    tag: "三神交泰",
    dimension: 3,
    art: "/achievements/titles/title-silicon-trinity.png?v=5",
    requiredBadges: [
      { id: "closed_source_loyalist", name: "神说要有光", tier: 1, art: "/achievements/closed-source-loyalist.png?v=6" },
      { id: "claude_survivor", name: "封号幸存者", tier: 1, art: "/achievements/claude-survivor.png?v=14" },
      { id: "north_america_doubao", name: "北美豆包", tier: 1, art: "/achievements/north-america-doubao.png?v=6" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 1 &&
      (badgeMap.get("claude_survivor")?.tier || 0) >= 1 &&
      (badgeMap.get("north_america_doubao")?.tier || 0) >= 1,
    reqText: "神说要有光 + 封号幸存者 + 北美豆包 (全解锁)",
    theme: {
      text: "text-fuchsia-300",
      bgGradient: "from-fuchsia-950/80 via-purple-950/70 to-black",
      border: "border-fuchsia-500/60",
      glow: "shadow-lg shadow-fuchsia-500/45",
      pillClass: "bg-gradient-to-r from-fuchsia-950/80 to-purple-950/80 text-fuchsia-200 border-fuchsia-400/60 shadow-fuchsia-500/30",
      ring: "ring-fuchsia-400/60",
      accentDot: "bg-fuchsia-400",
    },
  },
  // 九州极客 · 四象掌门 (Rank 12: 华夏赤金 · 四象归一)
  {
    id: "cn_quad_masters",
    difficulty: 5.3,
    name: "九州极客 · 四象掌门",
    shortName: "四象掌门",
    en: "Domestic Quad Titans",
    desc: "融汇中华 AI 最前沿四大家族算力，四象归一，开辟东方极客新天地。",
    tag: "四象混元",
    dimension: 4,
    art: "/achievements/titles/title-cn-quad-masters.png?v=5",
    requiredBadges: [
      { id: "wishing_well", name: "许愿池(DeepSeek)", tier: 1, art: "/achievements/wishing-well.png?v=11" },
      { id: "zhipu_sage", name: "智谱乾坤", tier: 1, art: "/achievements/zhipu-sage.png?v=7" },
      { id: "moonshot_voyager", name: "暗面行者", tier: 1, art: "/achievements/moonshot-voyager.png?v=7" },
      { id: "minimax_abyss", name: "海螺巨兽", tier: 1, art: "/achievements/minimax-abyss.png?v=8" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("wishing_well")?.tier || 0) >= 1 &&
      (badgeMap.get("zhipu_sage")?.tier || 0) >= 1 &&
      (badgeMap.get("moonshot_voyager")?.tier || 0) >= 1 &&
      (badgeMap.get("minimax_abyss")?.tier || 0) >= 1,
    reqText: "许愿池 + 智谱乾坤 + 暗面行者 + 海螺巨兽 (全解锁)",
    theme: {
      text: "text-orange-300",
      bgGradient: "from-orange-950/80 via-red-950/70 to-black",
      border: "border-orange-500/70",
      glow: "shadow-lg shadow-orange-500/45",
      pillClass: "bg-gradient-to-r from-orange-950/80 to-red-950/80 text-orange-200 border-orange-500/60 shadow-orange-500/30",
      ring: "ring-orange-400/60",
      accentDot: "bg-orange-400",
    },
  },
  // 机械降神 (Rank 13: 全光谱神机 · 至高王座)
  {
    id: "grand_slam_legend",
    difficulty: 13.0,
    name: "机械降神",
    en: "Deus Ex Machina",
    desc: "勋章架上钻石熠熠生辉，且站在本机排行榜顶端——神机天降，登峰造极。",
    tag: "神机天降",
    bondName: "神机天降",
    dimension: 2,
    rainbow: true,
    art: "/achievements/titles/title-grand-slam.png?v=5",
    requiredBadges: [
      { id: "grand_slam", name: "大满贯", tier: 1, art: "/achievements/grand-slam.png?v=11" },
      { id: "podium", name: "领奖台", tier: 1, art: "/achievements/podium.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("grand_slam")?.tier || 0) >= 1 && (badgeMap.get("podium")?.tier || 0) >= 1,
    reqText: "大满贯徽章 + 领奖台 (全解锁)",
    theme: {
      text: "text-cyan-200",
      bgGradient: "from-cyan-950/90 via-purple-950/80 to-amber-950/70",
      border: "border-cyan-400/80",
      glow: "shadow-xl shadow-cyan-400/50",
      pillClass: "bg-gradient-to-r from-cyan-950/80 via-purple-950/80 to-amber-950/80 text-cyan-200 border-cyan-400/70 shadow-cyan-500/30",
      ring: "ring-cyan-300/70",
      accentDot: "bg-cyan-300",
    },
  },
];
// Ranked by required-tier weight (bronze 1 / silver 2 / gold 4 / diamond 7),
// multiplied by member count, with grand_slam ×10 and podium ×3 for the meta
// badges. Ties break toward the title with more members. Colours are each
// title's own identity and deliberately do not move with the rank.
export const TITLES_REGISTRY = [...TITLES_UNSORTED].sort((a, b) => a.difficulty - b.difficulty);

export const STORAGE_ACTIVE_TITLE = "tokentracker:active_title";
export const EVENT_TITLE_CHANGED = "tokentracker:title_changed";

/** Short form for the sidebar, leaderboard and badges; never hand-truncate. */
export function titleDisplayName(title) {
  if (!title) return "";
  return title.shortName || title.name;
}

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
      if (e.key === STORAGE_ACTIVE_TITLE) setActiveId(e.newValue || "");
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

/** Bond name shown in the resonance ribbon; per-title override wins. */
export function getTitleBondName(title) {
  if (!title) return "";
  if (title.bondName) return title.bondName;
  const dim = title.dimension || (title.requiredBadges?.length || 2);
  if (dim >= 5) return "五星连珠";
  if (dim === 4) return "四象混元";
  if (dim === 3) return "三神交泰";
  if (dim === 1) return "至尊星冕";
  return "双星交汇";
}

/** Computes dynamic resonance tier (1 to 4) based on member badge tier levels */
export function getTitleResonance(title, badgeMap) {
  const dim = title ? (title.dimension || (title.requiredBadges?.length || 2)) : 2;
  const dimName = title ? getTitleBondName(title) : "双星交汇";
  if (!title) return { unlocked: false, tier: 0, label: "未激活", tierName: "未激活", dim, dimName };
  const isUnlocked = title.check(badgeMap);
  if (!isUnlocked) {
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
