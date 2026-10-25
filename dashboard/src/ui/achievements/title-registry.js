import { useState, useEffect } from "react";
import { copy } from "../../lib/copy";
import { badgeCopyKey } from "./badge-catalog";

/**
 * =========================================================================
 * 极客称号殿堂 · 羁绊共鸣开放设计架构 (Open Architecture Design)
 * =========================================================================
 * 1. 难度排序 (Difficulty order):
 *    - 称号按 `difficulty` 从易到难排序；分值 = 达到全部成员要求所需的
 *      「日历下界」取对数：2 + 11·ln(1+月数)/ln(31)，封顶 13。月数按公开
 *      速率折算（Gartner 25% 组织 $200–500/人/月、Anthropic Claude Code
 *      $13/人/活跃日，混合价 ≈$1/MTok → 约 300M tokens/月；单厂商按 25%
 *      份额）。刻意不用站主本机分布，那等于把自己的用量当成所有人的尺子。
 *    - 时间类成员直接取阈值天数；计数类成员（模型数/工具数/平台数）按公开
 *      可得性折算。公式是唯一真值，禁止手工微调：改排序必须先改下界。
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
    difficulty: 5.1,
    name: "零元购",
    en: "Zero-Cost Haul",
    desc: "淘金客与白嫖之光双修，把每一次调用都过成零元购。",
    tag: "质朴古铜",
    art: "/achievements/titles/title-frugal-archmage.png?v=5",
    requiredBadges: [
      { id: "token_arbitrageur", name: "淘金客", tier: 1, art: "/achievements/token-arbitrageur.png?v=10" },
      { id: "frugal_architect", name: "白嫖之光", tier: 2, art: "/achievements/frugal-architect.png?v=7" },
    ],
    check: (badgeMap) => (badgeMap.get("token_arbitrageur")?.tier || 0) >= 1 && (badgeMap.get("frugal_architect")?.tier || 0) >= 2,
    reqText: "淘金客(青铜) + 白嫖之光(白银)",
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
    difficulty: 3.6,
    name: "极速先锋 · 赛博狂飙者",
    shortName: "赛博狂飙者",
    en: "Hyperspeed Pioneer",
    desc: "Google 海量 Flash 遇上马斯克 Grok 极速引擎，Flash 仙人全力推流，指尖破空。",
    tag: "曲率引擎",
    dimension: 3,
    bondName: "曲率先锋",
    art: "/achievements/titles/title-cyber-speedster.png?v=5",
    requiredBadges: [
      { id: "north_america_doubao", name: "双子宝石", tier: 1, art: "/achievements/north-america-doubao.png?v=7" },
      { id: "hyperspeed_grok", name: "极速狂飙", tier: 1, art: "/achievements/hyperspeed-grok.png?v=9" },
      { id: "flash_immortal", name: "Flash 仙人", tier: 1, art: "/achievements/flash-immortal.png?v=9" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("north_america_doubao")?.tier || 0) >= 1 &&
      (badgeMap.get("hyperspeed_grok")?.tier || 0) >= 1 &&
      (badgeMap.get("flash_immortal")?.tier || 0) >= 1,
    reqText: "双子宝石 + 极速狂飙 + Flash 仙人 (全解锁)",
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
  // 生活禅者 (Rank 3: 素心冷银 · 素心禅意)
  {
    id: "zen_master",
    difficulty: 4.2,
    name: "生活禅师",
    en: "Zen Master",
    desc: "周内高效输出，周末彻底拔电，AI 时代清醒的生活家。",
    tag: "素心禅意",
    art: "/achievements/titles/title-zen-master.png?v=5",
    requiredBadges: [
      { id: "zen_balancer", name: "小确幸", tier: 1, art: "/achievements/zen-balancer.png?v=7" },
      { id: "marathoner", name: "马拉松", tier: 2, art: "/achievements/marathoner.png?v=8" },
    ],
    check: (badgeMap) => (badgeMap.get("zen_balancer")?.tier || 0) >= 1 && (badgeMap.get("marathoner")?.tier || 0) >= 2,
    reqText: "小确幸(青铜) + 马拉松(白银)",
    theme: {
      text: "text-neutral-200",
      bgGradient: "from-neutral-900/85 via-slate-950 to-black",
      border: "border-neutral-400/60",
      glow: "shadow-lg shadow-neutral-400/30",
      pillClass: "bg-neutral-900/80 text-neutral-200 border-neutral-400/50 shadow-neutral-400/20",
      ring: "ring-neutral-300/50",
      accentDot: "bg-neutral-300",
    },
  },
  // 一人公司 OPC (Rank 4: 深洋碧青 · 一人军团)
  {
    id: "fleet_admiral",
    difficulty: 6.4,
    name: "一人公司",
    en: "One-Person Company",
    desc: "个人 + AI 驱动完整业务：工具、模型、分身与全天候节奏全部由一个人调度。",
    tag: "OPC",
    bondName: "一人军团",
    dimension: 5,
    art: "/achievements/titles/title-one-person-company.png?v=1",
    requiredBadges: [
      { id: "swarm_commander", name: "管理者", tier: 1, art: "/achievements/swarm-commander.png?v=8" },
      { id: "multitool", name: "多面手", tier: 1, art: "/achievements/multitool.png?v=8" },
      { id: "polyglot", name: "模型通", tier: 1, art: "/achievements/polyglot.png?v=8" },
      { id: "multitool_day", name: "分身有术", tier: 1, art: "/achievements/multitool-day.png?v=12" },
      { id: "around_the_clock", name: "昼夜不息", tier: 1, art: "/achievements/around-the-clock.png?v=12" },
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
    difficulty: 2.2,
    name: "极客代码巨炮",
    en: "Code Overlord",
    desc: "一小时的代码输出与生涯累计输出同列巅峰——你写几行，它落一万行。",
    tag: "烈焰重炮",
    art: "/achievements/titles/title-code-cannon.png?v=5",
    requiredBadges: [
      { id: "code_cannon", name: "火力覆盖", tier: 2, art: "/achievements/code-cannon.png?v=7" },
      { id: "wordsmith", name: "妙笔生花", tier: 2, art: "/achievements/wordsmith.png?v=8" },
    ],
    check: (badgeMap) => (badgeMap.get("code_cannon")?.tier || 0) >= 2 && (badgeMap.get("wordsmith")?.tier || 0) >= 2,
    reqText: "火力覆盖(白银) + 妙笔生花(白银)",
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
    difficulty: 2.5,
    name: "天选牛马",
    en: "Chosen Drudge",
    desc: "分身、早鸟、周末与连胜四件套全开——天选的牛马，AI 时代的劳模。",
    tag: "铁灰缰绳",
    bondName: "天选四件套",
    dimension: 4,
    art: "/achievements/titles/title-chosen-drudge.png?v=1",
    requiredBadges: [
      { id: "multitool_day", name: "分身有术", tier: 1, art: "/achievements/multitool-day.png?v=12" },
      { id: "early_bird", name: "早鸟", tier: 1, art: "/achievements/early-bird.png?v=12" },
      { id: "weekend_warrior", name: "周末战士", tier: 1, art: "/achievements/weekend-warrior.png?v=8" },
      { id: "streak", name: "连胜火焰", tier: 1, art: "/achievements/streak.png?v=8" },
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
    difficulty: 3.1,
    name: "赛博修仙者",
    en: "Cyber Immortal",
    desc: "深夜入定，晨曦吐纳，昼夜通脉，与 AI 一同修成赛博大圆满。",
    tag: "紫电青雷",
    dimension: 4,
    bondName: "大道圆满",
    art: "/achievements/titles/title-cyber-immortal.png?v=5",
    requiredBadges: [
      { id: "night_owl", name: "夜猫子", tier: 2, art: "/achievements/night-owl.png?v=8" },
      { id: "session_marathon", name: "时之沙", tier: 2, art: "/achievements/session-marathon.png?v=12" },
      { id: "early_bird", name: "早鸟", tier: 1, art: "/achievements/early-bird.png?v=12" },
      { id: "around_the_clock", name: "昼夜不息", tier: 1, art: "/achievements/around-the-clock.png?v=12" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("night_owl")?.tier || 0) >= 2 &&
      (badgeMap.get("session_marathon")?.tier || 0) >= 2 &&
      (badgeMap.get("early_bird")?.tier || 0) >= 1 &&
      (badgeMap.get("around_the_clock")?.tier || 0) >= 1,
    reqText: "夜猫子(白银) + 时之沙(白银) + 早鸟(青铜) + 昼夜不息(青铜)",
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
    difficulty: 4.7,
    name: "神之信徒",
    en: "Divine Devotee",
    desc: "OpenAI 家族与思考算力的双线并行——你追的是那束只往下照的光。",
    tag: "AGI圣殿",
    art: "/achievements/titles/title-openai-paladin.png?v=5",
    requiredBadges: [
      { id: "closed_source_loyalist", name: "神说要有光", tier: 2, art: "/achievements/closed-source-loyalist.png?v=7" },
      { id: "deep_thinker", name: "深思者", tier: 1, art: "/achievements/deep-thinker.png?v=8" },
    ],
    check: (badgeMap) => (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 2 && (badgeMap.get("deep_thinker")?.tier || 0) >= 1,
    reqText: "神说要有光(白银) + 深思者(青铜)",
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
    difficulty: 3.2,
    name: "冯诺依曼派",
    en: "Von Neumann School",
    desc: "终端、缓存、重构、深思四线贯通，用体系结构的方法调度一切算力。",
    tag: "体系结构",
    bondName: "体系结构",
    dimension: 4,
    art: "/achievements/titles/title-von-neumann.png?v=1",
    requiredBadges: [
      { id: "terminal_purist", name: "终端原教旨主义", tier: 1, art: "/achievements/terminal-purist.png?v=7" },
      { id: "cache_miser", name: "缓存精算师", tier: 1, art: "/achievements/cache-miser.png?v=7" },
      { id: "refactor_titan", name: "重构巨匠", tier: 1, art: "/achievements/refactor-titan.png?v=7" },
      { id: "deep_thinker", name: "深思者", tier: 1, art: "/achievements/deep-thinker.png?v=8" },
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
    difficulty: 10.2,
    name: "全知全能架构师",
    shortName: "全域架构师",
    en: "Omniscient Architect",
    desc: "八十款模型与二十款开发工具尽在掌中——每个模型的脾气和单价你都报得出来。",
    tag: "全息星图",
    art: "/achievements/titles/title-omniscient-architect.png?v=5",
    requiredBadges: [
      { id: "polyglot", name: "模型通", tier: 4, art: "/achievements/polyglot.png?v=8" },
      { id: "multitool", name: "多面手", tier: 4, art: "/achievements/multitool.png?v=8" },
    ],
    check: (badgeMap) => (badgeMap.get("polyglot")?.tier || 0) >= 4 && (badgeMap.get("multitool")?.tier || 0) >= 4,
    reqText: "模型通(钻石) + 多面手(钻石)",
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
    difficulty: 2.4,
    name: "诸神信使 · 硅谷三巨头",
    shortName: "诸神信使",
    en: "Silicon Valley Trinity",
    desc: "同时御统 OpenAI、Anthropic 与 Google 三大海外神殿，金字塔尖的三冠王者。",
    tag: "三神交泰",
    dimension: 3,
    art: "/achievements/titles/title-silicon-trinity.png?v=5",
    requiredBadges: [
      { id: "closed_source_loyalist", name: "神说要有光", tier: 1, art: "/achievements/closed-source-loyalist.png?v=7" },
      { id: "claude_survivor", name: "封号幸存者", tier: 1, art: "/achievements/claude-survivor.png?v=17" },
      { id: "north_america_doubao", name: "双子宝石", tier: 1, art: "/achievements/north-america-doubao.png?v=7" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("closed_source_loyalist")?.tier || 0) >= 1 &&
      (badgeMap.get("claude_survivor")?.tier || 0) >= 1 &&
      (badgeMap.get("north_america_doubao")?.tier || 0) >= 1,
    reqText: "神说要有光 + 封号幸存者 + 双子宝石 (全解锁)",
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
    difficulty: 2.4,
    name: "九州极客 · 四象掌门",
    shortName: "四象掌门",
    en: "Domestic Quad Titans",
    desc: "融汇中华 AI 最前沿四大家族算力，四象归一，开辟东方极客新天地。",
    tag: "四象混元",
    dimension: 4,
    art: "/achievements/titles/title-cn-quad-masters.png?v=5",
    requiredBadges: [
      { id: "wishing_well", name: "许愿池", tier: 1, art: "/achievements/wishing-well.png?v=16" },
      { id: "zhipu_sage", name: "智谱乾坤", tier: 1, art: "/achievements/zhipu-sage.png?v=11" },
      { id: "moonshot_voyager", name: "暗面行者", tier: 1, art: "/achievements/moonshot-voyager.png?v=10" },
      { id: "minimax_abyss", name: "海螺巨兽", tier: 1, art: "/achievements/minimax-abyss.png?v=11" },
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
  // 中国人能飞 (Rank ?: 青龙腾飞 · 龙腾三界)
  {
    id: "chinese_can_fly",
    difficulty: 8.5,
    name: "中国人能飞",
    shortName: "中国人能飞",
    en: "Chinese Can Fly",
    desc: "龙的传人越过斩杀线，借 Flash 之力一飞冲天。",
    tag: "龙腾三界",
    dimension: 3,
    bondName: "三龙腾飞",
    art: "/achievements/titles/title-chinese-can-fly.png?v=1",
    requiredBadges: [
      { id: "dragon_heir", name: "龙的传人", tier: 3, art: "/achievements/dragon-heir.png?v=3" },
      { id: "kill_line", name: "斩杀线", tier: 1, art: "/achievements/kill-line.png?v=4" },
      { id: "flash_immortal", name: "Flash 仙人", tier: 2, art: "/achievements/flash-immortal.png?v=9" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("dragon_heir")?.tier || 0) >= 3 &&
      (badgeMap.get("kill_line")?.tier || 0) >= 1 &&
      (badgeMap.get("flash_immortal")?.tier || 0) >= 2,
    reqText: "龙的传人(黄金) + 斩杀线(青铜) + Flash 仙人(白银)",
    theme: {
      text: "text-green-200",
      bgGradient: "from-green-950/85 via-emerald-950/55 to-black",
      border: "border-green-400/70",
      glow: "shadow-lg shadow-green-500/45",
      pillClass: "bg-gradient-to-r from-green-950/80 to-emerald-950/80 text-green-200 border-green-400/60 shadow-green-500/30",
      ring: "ring-green-300/60",
      accentDot: "bg-green-400",
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
      { id: "grand_slam", name: "大满贯", tier: 1, art: "/achievements/grand-slam.png?v=12" },
      { id: "podium", name: "领奖台", tier: 1, art: "/achievements/podium.png?v=8" },
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
  // 四方饕餮 · 老吃家 (四星连珠 · 电商外卖四大巨头调侃)
  {
    id: "connoisseur_eater",
    difficulty: 2.4,
    name: "四方饕餮 · 老吃家",
    shortName: "老吃家",
    en: "Cyber Gourmet Connoisseur",
    desc: "通义宗师、灵动音符、你是我兄弟、小馋猫——四家的自研模型都在你账上点过菜，赛博老吃家只认菜单不认菜系。",
    tag: "四方食神",
    dimension: 4,
    bondName: "四方饕餮",
    art: "/achievements/titles/title-connoisseur-eater.png?v=1",
    requiredBadges: [
      { id: "qwen_dynasty", name: "通义宗师", tier: 1, art: "/achievements/qwen-dynasty.png?v=10" },
      { id: "seedance_master", name: "灵动音符", tier: 1, art: "/achievements/seedance-master.png?v=10" },
      { id: "jd_joy_brother", name: "你是我兄弟", tier: 1, art: "/achievements/jd-joy-brother.png?v=6" },
      { id: "meituan_longcat", name: "小馋猫", tier: 1, art: "/achievements/meituan-longcat.png?v=6" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("qwen_dynasty")?.tier || 0) >= 1 &&
      (badgeMap.get("seedance_master")?.tier || 0) >= 1 &&
      (badgeMap.get("jd_joy_brother")?.tier || 0) >= 1 &&
      (badgeMap.get("meituan_longcat")?.tier || 0) >= 1,
    reqText: "通义宗师 + 灵动音符 + 你是我兄弟 + 小馋猫 (全解锁)",
    theme: {
      text: "text-amber-300",
      bgGradient: "from-amber-950/85 via-orange-950/75 to-black",
      border: "border-amber-500/60",
      glow: "shadow-lg shadow-amber-500/30",
      pillClass: "bg-amber-900/80 text-amber-200 border-amber-500/50 shadow-amber-500/20",
      ring: "ring-amber-400/60",
      accentDot: "bg-amber-400",
    },
  },
  // 九鼎经纬 · 产业巨擘 (五星连珠 · 国内五大工业级自研基座)
  {
    id: "industrial_giant",
    difficulty: 2.4,
    name: "九鼎经纬 · 产业巨擘",
    shortName: "产业巨擘",
    en: "Industrial Titan of Nine Cauldrons",
    desc: "通义、豆包、混元、言犀、LongCat 国内五大工业级自研基座五星连珠，掌控横跨数字与实体产业的核心算力命脉。",
    tag: "五岳擎天",
    dimension: 5,
    bondName: "五岳擎天",
    art: "/achievements/titles/title-industrial-giant.png?v=1",
    requiredBadges: [
      { id: "qwen_dynasty", name: "通义宗师", tier: 1, art: "/achievements/qwen-dynasty.png?v=10" },
      { id: "seedance_master", name: "灵动音符", tier: 1, art: "/achievements/seedance-master.png?v=10" },
      { id: "hunyuan_master", name: "混元归一", tier: 1, art: "/achievements/hunyuan-master.png?v=5" },
      { id: "jd_joy_brother", name: "你是我兄弟", tier: 1, art: "/achievements/jd-joy-brother.png?v=6" },
      { id: "meituan_longcat", name: "小馋猫", tier: 1, art: "/achievements/meituan-longcat.png?v=6" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("qwen_dynasty")?.tier || 0) >= 1 &&
      (badgeMap.get("seedance_master")?.tier || 0) >= 1 &&
      (badgeMap.get("hunyuan_master")?.tier || 0) >= 1 &&
      (badgeMap.get("jd_joy_brother")?.tier || 0) >= 1 &&
      (badgeMap.get("meituan_longcat")?.tier || 0) >= 1,
    reqText: "通义宗师 + 灵动音符 + 混元归一 + 你是我兄弟 + 小馋猫 (五大厂全解锁)",
    theme: {
      text: "text-emerald-300",
      bgGradient: "from-emerald-950/85 via-teal-950/75 to-black",
      border: "border-emerald-500/60",
      glow: "shadow-lg shadow-emerald-500/30",
      pillClass: "bg-emerald-900/80 text-emerald-200 border-emerald-500/50 shadow-emerald-500/20",
      ring: "ring-emerald-400/60",
      accentDot: "bg-emerald-400",
    },
  },

  // 盗火者 (Rank: 青柠星火 · 薪火相传) —— 与闭源侧「神说要有光 / 神之信徒」对位
  {
    id: "fire_bringer",
    difficulty: 9.7,
    name: "盗火者",
    en: "Fire-Bringer",
    desc: "DeepSeek、千问、智谱三条开放权重血脉与公地同燃，再借一阵法国西风——神把光收回神殿时，你把火种留在自己机器上。",
    tag: "薪火相传",
    bondName: "薪火相传",
    dimension: 5,
    art: "/achievements/titles/title-fire-bringer.png?v=2",
    requiredBadges: [
      { id: "open_weights_spark", name: "公地", tier: 3, art: "/achievements/open-weights-spark.png?v=4" },
      { id: "wishing_well", name: "许愿池", tier: 2, art: "/achievements/wishing-well.png?v=16" },
      { id: "qwen_dynasty", name: "通义宗师", tier: 2, art: "/achievements/qwen-dynasty.png?v=10" },
      { id: "zhipu_sage", name: "智谱乾坤", tier: 2, art: "/achievements/zhipu-sage.png?v=11" },
      { id: "mistral_westwind", name: "西风烈", tier: 1, art: "/achievements/mistral-westwind.png?v=2" },
    ],
    check: (badgeMap) =>
      (badgeMap.get("open_weights_spark")?.tier || 0) >= 3 &&
      (badgeMap.get("wishing_well")?.tier || 0) >= 2 &&
      (badgeMap.get("qwen_dynasty")?.tier || 0) >= 2 &&
      (badgeMap.get("zhipu_sage")?.tier || 0) >= 2 &&
      (badgeMap.get("mistral_westwind")?.tier || 0) >= 1,
    reqText: "火种(黄金) + 许愿池(白银) + 通义宗师(白银) + 智谱乾坤(白银) + 西风烈(青铜)",
    theme: {
      text: "text-lime-200",
      bgGradient: "from-lime-950/85 via-green-950/60 to-black",
      border: "border-lime-400/70",
      glow: "shadow-lg shadow-lime-500/40",
      pillClass: "bg-gradient-to-r from-lime-950/80 to-green-950/80 text-lime-200 border-lime-400/60 shadow-lime-500/30",
      ring: "ring-lime-300/60",
      accentDot: "bg-lime-400",
    },
  },
];
// Sorted by the public-rate calendar floor described at the top of this file
// (2 + 11·ln(1+months)/ln(31), capped at 13). Colours are each title's own
// identity and deliberately do not move with the rank.
export const TITLES_REGISTRY = [...TITLES_UNSORTED].sort((a, b) => a.difficulty - b.difficulty);

export const STORAGE_ACTIVE_TITLE = "tokentracker:active_title";
export const EVENT_TITLE_CHANGED = "tokentracker:title_changed";

/** Short form for the sidebar, leaderboard and badges; never hand-truncate. */
const TIER_SLUG = { 1: "bronze", 2: "silver", 3: "gold", 4: "diamond" };

/** Localized title copy; the registry literal is the last resort. */
export function titleText(title, slot) {
  if (!title) return "";
  const key = `achievements.title.${title.id}.${slot}`;
  const localized = copy(key);
  return localized && localized !== key ? localized : title[slot] || "";
}

/** Members + required tier, composed from badge copy so renames never desync. */
export function titleRequirementText(title) {
  const members = title?.requiredBadges;
  if (!members || members.length === 0) return titleText(title, "reqText");
  return members
    .map((req) => {
      const nameKey = badgeCopyKey(req.id, "name");
      const name = copy(nameKey);
      const tierKey = `achievements.tier.${TIER_SLUG[req.tier] || "bronze"}`;
      const tier = copy(tierKey);
      return `${name && name !== nameKey ? name : req.name}(${tier && tier !== tierKey ? tier : ""})`;
    })
    .join(" + ");
}

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
  const [badgeTiers, setBadgeTiers] = useState(() => {
    try {
      const raw = localStorage.getItem("tokentracker:achievement_tiers");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const handleUpdate = (e) => {
      setActiveId(e?.detail ?? getActiveTitleId());
    };
    const handleStorage = (e) => {
      if (e.key === STORAGE_ACTIVE_TITLE) setActiveId(e.newValue || "");
      if (e.key === "tokentracker:achievement_tiers") {
        try {
          setBadgeTiers(e.newValue ? JSON.parse(e.newValue) : {});
        } catch {}
      }
    };
    window.addEventListener(EVENT_TITLE_CHANGED, handleUpdate);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(EVENT_TITLE_CHANGED, handleUpdate);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const title = getTitleById(activeId);
  if (!title) return null;

  const badgeMap = new Map(Object.entries(badgeTiers).map(([id, tier]) => [id, { id, tier }]));
  const resonance = getTitleResonance(title, badgeMap);
  return { ...title, resonance, resonanceTier: resonance?.tier || 1 };
}

/** Bond name shown in the resonance ribbon; per-title override wins. */
export function resonanceLabel(tier) {
  const slug = TIER_SLUG[tier] || "bronze";
  const tierLabel = localized(`achievements.tier.${slug}`, "青铜");
  const key = tier === 4 ? "achievements.resonance.max" : "achievements.resonance.label";
  const text = copy(key, { tier: tierLabel, level: tier });
  return text && text !== key ? text : tier === 4 ? `${tierLabel}共鸣 · MAX` : `${tierLabel}共鸣 · Lv.${tier}`;
}

function localized(key, fallback) {
  const text = copy(key);
  return text && text !== key ? text : fallback;
}

export function getTitleBondName(title) {
  if (!title) return "";
  if (title.bondName) {
    return localized(`achievements.bond.title.${title.id}`, title.bondName);
  }
  const dim = title.dimension || (title.requiredBadges?.length || 2);
  const fallback =
    dim >= 5 ? "五星连珠" : dim === 4 ? "四象混元" : dim === 3 ? "三神交泰" : dim === 1 ? "至尊星冕" : "双星交汇";
  return localized(`achievements.bond.dim.${Math.min(5, Math.max(1, dim))}`, fallback);
}

/** Computes dynamic resonance tier (1 to 4) based on member badge tier levels */
export function getTitleResonance(title, badgeMap) {
  const dim = title ? (title.dimension || (title.requiredBadges?.length || 2)) : 2;
  const dimName = title ? getTitleBondName(title) : "双星交汇";
  if (!title) { const inactive = localized("achievements.resonance.inactive", "未激活"); return { unlocked: false, tier: 0, label: inactive, tierName: inactive, dim, dimName }; }
  const isUnlocked = title.check(badgeMap);
  if (!isUnlocked) {
    const inactive = localized("achievements.resonance.inactive", "未激活");
    return { unlocked: false, tier: 0, label: inactive, tierName: inactive, dim, dimName };
  }

  let resonanceTier = 1;
  if (title.id === "grand_slam_legend") {
    resonanceTier = badgeMap.get("grand_slam")?.tier || 1;
  } else {
    const tiers = (title.requiredBadges || []).map((req) => badgeMap.get(req.id)?.tier || 0);
    const minTier = Math.min(...tiers);
    resonanceTier = Math.max(1, Math.min(4, minTier));
  }

  const tierName = localized(`achievements.tier.${TIER_SLUG[resonanceTier] || "bronze"}`, "青铜");
  const label = resonanceLabel(resonanceTier);

  return {
    unlocked: true,
    tier: resonanceTier,
    dim,
    dimName,
    tierName,
    label,
  };
}

export function spectrumTier(tier) {
  if (tier >= 4) return "diamond";
  if (tier === 3) return "gold";
  if (tier === 2) return "silver";
  return "bronze";
}

export function getResonancePillStyle(tier) {
  switch (tier) {
    case 4:
      return "border-cyan-300 bg-cyan-950/80 text-cyan-200 shadow-sm shadow-cyan-400/40 ring-1 ring-cyan-300/40";
    case 3:
      return "border-amber-400 bg-amber-950/80 text-amber-200 shadow-sm shadow-amber-400/30";
    case 2:
      return "border-slate-300/70 bg-slate-800/80 text-slate-100 shadow-sm shadow-slate-300/20";
    case 1:
      return "border-amber-700/60 bg-amber-950/60 text-amber-300 shadow-sm shadow-amber-900/30";
    default:
      return "border-white/20 bg-black/40 text-white/70";
  }
}

export function getResonanceTextColor(tier) {
  switch (tier) {
    case 4:
      return "text-cyan-300 font-bold";
    case 3:
      return "text-amber-300 font-bold";
    case 2:
      return "text-slate-200 font-medium";
    case 1:
      return "text-amber-400";
    default:
      return "text-white/40";
  }
}

export function getAvatarResonanceFrame(resonanceTier, theme) {
  switch (resonanceTier) {
    case 4:
      return "ring-2 ring-cyan-300 shadow-xl shadow-cyan-400/50 ring-offset-2 ring-offset-black/40 animate-pulse";
    case 3:
      return "ring-2 ring-amber-400 shadow-lg shadow-amber-400/40 ring-offset-1 ring-offset-black/20";
    case 2:
      return "ring-2 ring-slate-300 shadow-md shadow-slate-300/30";
    case 1:
      return "ring-2 ring-amber-600/70 shadow-sm shadow-amber-900/30";
    default:
      return theme?.ring ? `ring-2 ${theme.ring} ${theme.glow || ""}` : "ring-1 ring-oai-gray-200 dark:ring-oai-gray-700";
  }
}

export function getEquippedBadgeStyle(resonanceTier, theme) {
  switch (resonanceTier) {
    case 4:
      return "border-cyan-300 bg-cyan-950/90 text-cyan-200 shadow-md shadow-cyan-400/40 ring-1 ring-cyan-300/50";
    case 3:
      return "border-amber-400 bg-amber-950/80 text-amber-200 shadow-sm shadow-amber-400/30 ring-1 ring-amber-400/30";
    case 2:
      return "border-slate-300/70 bg-slate-800/80 text-slate-100 shadow-sm shadow-slate-300/20";
    case 1:
      return "border-amber-700/60 bg-amber-950/60 text-amber-300 shadow-sm shadow-amber-900/30";
    default:
      return theme?.pillClass || "border-white/20 bg-black/40 text-white/80";
  }
}

