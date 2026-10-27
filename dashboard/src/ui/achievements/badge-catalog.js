// Display metadata for the achievement catalog.
//
// Thresholds do NOT live here — the server (SQL catalog table / local-api)
// returns per-badge thresholds + next_threshold in its payloads, and
// test/user-badges-thresholds-single-source.test.js enforces that no
// threshold literals appear in dashboard code. Array order = display order.
import { LotusIcon } from "./LotusIcon";
import {
  Activity,
  Anchor,
  Banknote,
  Blocks,
  Brain,
  BrainCircuit,
  CalendarCheck2,
  CalendarDays,
  Clock,
  Coins,
  Crown,
  Feather,
  FlaskConical,
  Flame,
  FlameKindling,
  FolderGit2,
  Footprints,
  Gauge,
  Heart,
  HeartPulse,
  Hourglass,
  Layers,
  Medal,
  MoonStar,
  Rocket,
  ShieldCheck,
  Skull,
  Sunrise,
  Sword,
  TrendingUp,
  Trophy,
  Zap,
  Sparkles,
  Bot,
  Radio,
  FileText,
  Lock,
  Timer,
  Scale,
  Network,
  Terminal,
  Hammer,
  WifiOff,
  Cpu,
  Compass,
  Atom,
  CalendarCheck,
  CircleDollarSign,
  Copy,
  Crosshair,
  Eclipse,
  Landmark,
  Music4,
  PiggyBank,
  Sparkle,
  Waves,
  Cat,
  Dog,
  Orbit,
  Milestone,
  Handshake,
  Wind,
  Sigma,
} from "lucide-react";

// `art` files live in dashboard/public/achievements/ (see the README there
// for provenance); the lucide `icon` is the render fallback if the art fails
// to load.
export const BADGE_CATALOG = [
  { id: "token_titan", scope: "cloud", icon: Crown, format: "tokens", art: "/achievements/token-titan.png?v=8" },
  { id: "big_day", scope: "cloud", icon: CalendarCheck, format: "tokens", art: "/achievements/big-day.png?v=8" },
  { id: "wordsmith", scope: "cloud", icon: Feather, format: "tokens", art: "/achievements/wordsmith.png?v=8" },
  { id: "marathoner", scope: "cloud", icon: Footprints, format: "days", art: "/achievements/marathoner.png?v=8" },
  { id: "streak", scope: "cloud", icon: Flame, format: "days", art: "/achievements/streak.png?v=8" },
  { id: "weekend_warrior", scope: "cloud", icon: CalendarDays, format: "days", art: "/achievements/weekend-warrior.png?v=8" },
  { id: "momentum", scope: "cloud", icon: TrendingUp, format: "multiplier", art: "/achievements/momentum.png?v=8" },
  { id: "polyglot", scope: "cloud", icon: Brain, format: "count", art: "/achievements/polyglot.png?v=8" },
  { id: "trendsetter", scope: "cloud", icon: Sparkle, format: "count", art: "/achievements/trendsetter.png?v=8" },
  { id: "multitool", scope: "cloud", icon: Blocks, format: "count", art: "/achievements/multitool.png?v=8" },
  { id: "podium", scope: "cloud", icon: Medal, format: "rank", art: "/achievements/podium.png?v=8" },
  { id: "veteran", scope: "cloud", icon: ShieldCheck, format: "days", art: "/achievements/veteran.png?v=8" },
  // Wave-2 cloud badges (2026-10-21). claude_survivor / wishing_well are
  // hidden easter eggs: locked, they render as "???" even to the owner —
  // the flag lives in the SQL catalog and user_badges_full payloads.
  // heart_model reuses the unused heart-on-your-sleeve face (a favorite
  // worn openly — the name semantics carry over).
  { id: "phoenix", scope: "cloud", icon: FlameKindling, format: "days", art: "/achievements/phoenix.png?v=12" },
  { id: "iron_month", scope: "cloud", icon: CalendarCheck2, format: "days", art: "/achievements/iron-month.png?v=12" },
  { id: "full_blast", scope: "cloud", icon: Activity, format: "tokens", art: "/achievements/full-blast.png?v=12" },
  { id: "deep_diver", scope: "cloud", icon: Anchor, format: "count", art: "/achievements/deep-diver.png?v=12" },
  { id: "multitool_day", scope: "cloud", icon: Copy, format: "count", art: "/achievements/multitool-day.png?v=12" },
  { id: "heart_model", scope: "cloud", icon: HeartPulse, format: "percent", art: "/achievements/heart-model.png?v=9" },
  { id: "claude_survivor", scope: "cloud", hidden: true, icon: Skull, format: "tokens", art: "/achievements/claude-survivor.png?v=17" },
  { id: "wishing_well", scope: "cloud", icon: Coins, format: "tokens", art: "/achievements/wishing-well.png?v=16" },
  { id: "grand_slam", scope: "cloud", icon: Trophy, format: "count", art: "/achievements/grand-slam.png?v=12" },
  { id: "project_hopper", scope: "local", icon: FolderGit2, format: "count", art: "/achievements/project-hopper.png?v=8" },
  { id: "project_devotion", scope: "local", icon: Heart, format: "tokens", art: "/achievements/project-devotion.png?v=8" },
  { id: "night_owl", scope: "local", icon: MoonStar, format: "count", art: "/achievements/night-owl.png?v=8" },
  // Habit badges computed on-device. Faces come from the painted medallion
  // set (provenance: dashboard/public/achievements/README.md), except
  // deep_thinker which reuses the unused galaxy-brain face (brain →
  // reasoning; the name semantics carry over).
  { id: "early_bird", scope: "local", icon: Sunrise, format: "count", art: "/achievements/early-bird.png?v=12" },
  { id: "around_the_clock", scope: "local", icon: Clock, format: "count", art: "/achievements/around-the-clock.png?v=12" },
  { id: "sprinter", scope: "local", icon: Gauge, format: "rate", art: "/achievements/sprinter.png?v=15" },
  { id: "cache_alchemist", scope: "local", icon: FlaskConical, format: "tokens", art: "/achievements/cache-alchemist.png?v=12" },
  { id: "deep_thinker", scope: "local", icon: BrainCircuit, format: "tokens", art: "/achievements/deep-thinker.png?v=8" },
  { id: "real_money", scope: "local", icon: Banknote, format: "usd", art: "/achievements/real-money.png?v=12" },
  { id: "session_marathon", scope: "local", icon: Hourglass, format: "duration", art: "/achievements/session-marathon.png?v=12" },
  // Wave-3 badges (2026-10-23)
  { id: "frugal_architect", scope: "local", icon: PiggyBank, format: "tokens", art: "/achievements/frugal-architect.png?v=7" },
  { id: "closed_source_loyalist", scope: "local", icon: Sparkles, format: "tokens", art: "/achievements/closed-source-loyalist.png?v=7" },
  { id: "offgrid_sovereign", scope: "local", icon: WifiOff, format: "tokens", art: "/achievements/offgrid-sovereign.png?v=7" },
  { id: "megacontext_voyager", scope: "local", icon: Layers, format: "tokens", art: "/achievements/megacontext-voyager.png?v=7" },
  { id: "cache_miser", scope: "local", icon: Cpu, format: "count", art: "/achievements/cache-miser.png?v=7" },
  { id: "code_cannon", scope: "local", icon: Crosshair, format: "tokens", art: "/achievements/code-cannon.png?v=7" },
  { id: "buzzer_beater", scope: "local", icon: Timer, format: "count", art: "/achievements/buzzer-beater.png?v=7" },
  { id: "zen_balancer", scope: "local", icon: Scale, backIcon: LotusIcon, format: "count", art: "/achievements/zen-balancer.png?v=7" },
  { id: "swarm_commander", scope: "local", icon: Compass, format: "count", art: "/achievements/swarm-commander.png?v=8" },
  { id: "terminal_purist", scope: "local", icon: Terminal, format: "days", art: "/achievements/terminal-purist.png?v=7" },
  { id: "refactor_titan", scope: "local", icon: Hammer, format: "count", art: "/achievements/refactor-titan.png?v=7" },
  // Wave-4 badges (2026-10-24)
  { id: "zhipu_sage", scope: "local", icon: Atom, format: "tokens", art: "/achievements/zhipu-sage.png?v=11" },
  { id: "moonshot_voyager", scope: "local", icon: Eclipse, format: "tokens", art: "/achievements/moonshot-voyager.png?v=10" },
  { id: "minimax_abyss", scope: "local", icon: Waves, format: "tokens", art: "/achievements/minimax-abyss.png?v=11" },
  { id: "gemini_gemma", scope: "local", icon: Bot, format: "tokens", art: "/achievements/gemini-gemma.png?v=1" },
  { id: "hyperspeed_grok", scope: "local", icon: Rocket, format: "tokens", art: "/achievements/hyperspeed-grok.png?v=9" },
  { id: "qwen_dynasty", scope: "local", icon: Landmark, format: "tokens", art: "/achievements/qwen-dynasty.png?v=10" },
  { id: "flash_immortal", scope: "local", icon: Zap, format: "tokens", art: "/achievements/flash-immortal.png?v=9" },
  { id: "seedance_master", scope: "local", icon: Music4, format: "tokens", art: "/achievements/seedance-master.png?v=10" },
  { id: "token_arbitrageur", scope: "local", icon: CircleDollarSign, format: "count", art: "/achievements/token-arbitrageur.png?v=10" },
  // Wave-5 badges (2026-10-25)
  { id: "meituan_longcat", scope: "local", icon: Cat, format: "tokens", art: "/achievements/meituan-longcat.png?v=6" },
  { id: "jd_joy_brother", scope: "local", icon: Dog, format: "tokens", art: "/achievements/jd-joy-brother.png?v=6" },
  { id: "hunyuan_master", scope: "local", icon: Orbit, format: "tokens", art: "/achievements/hunyuan-master.png?v=5" },
  { id: "stepfun_voyager", scope: "local", icon: Milestone, format: "tokens", art: "/achievements/stepfun-voyager.png?v=4" },
  // Open-weight wave (2026-10-26). Art lands separately; the lucide icon is
  // the documented fallback until each medallion is approved.
  { id: "open_commons", scope: "local", icon: Handshake, format: "tokens", art: "/achievements/open-commons.png?v=1" },
  { id: "mistral_westwind", scope: "local", icon: Wind, format: "tokens", art: "/achievements/mistral-westwind.png?v=2" },
  { id: "nemotron_spiral", scope: "local", icon: Cpu, format: "tokens", art: "/achievements/nemotron-spiral.png?v=2" },
  { id: "phi_disciple", scope: "local", icon: Sigma, format: "tokens", art: "/achievements/phi-disciple.png?v=2" },
  { id: "spark_alpaca", scope: "local", icon: Bot, format: "tokens", art: "/achievements/spark-alpaca.png?v=2" },
  { id: "iflytek_spark", scope: "local", icon: Sparkles, format: "tokens", art: "/achievements/iflytek-spark.png?v=1" },
  { id: "sensenova_daily", scope: "local", icon: Sunrise, format: "tokens", art: "/achievements/sensenova-daily.png?v=2" },
  { id: "xiaomi_mimo", scope: "local", icon: Radio, format: "tokens", art: "/achievements/xiaomi-mimo.png?v=1" },
  // Wave-6 badges (2026-10-25)
  { id: "dragon_heir", scope: "local", icon: Crown, format: "count", art: "/achievements/dragon-heir.png?v=3" },
  { id: "kill_line", scope: "local", icon: Sword, format: "percent", art: "/achievements/kill-line.png?v=4" },
];

export const BADGE_BY_ID = new Map(BADGE_CATALOG.map((b) => [b.id, b]));

const CATALOG_INDEX = new Map(BADGE_CATALOG.map((b, i) => [b.id, i]));

export function badgeCopyKey(badgeId, slot) {
  return `achievements.badge.${badgeId}.${slot}`;
}

/** Sort earned badges by tier desc, then catalog order. */
export function sortBadges(badges) {
  return [...(badges || [])].sort((a, b) => {
    const tierDiff = (b?.tier || 0) - (a?.tier || 0);
    if (tierDiff !== 0) return tierDiff;
    return (CATALOG_INDEX.get(a?.id) ?? 99) - (CATALOG_INDEX.get(b?.id) ?? 99);
  });
}

/** Highest-priority earned badge (tier desc, catalog order tie-break). */
export function highestBadge(badges) {
  const earned = (badges || []).filter((b) => b && (b.tier || 0) >= 1 && BADGE_BY_ID.has(b.id));
  if (earned.length === 0) return null;
  return sortBadges(earned)[0];
}

export const BADGE_CATEGORIES = [
  { key: "all", name: "全部", en: "All" },
  { key: "models", name: "大模型信仰", en: "AI Models" },
  { key: "engineering", name: "工程习惯", en: "Engineering" },
  { key: "habits", name: "作息律动", en: "Rhythm & Habit" },
  { key: "scale", name: "规模体量", en: "Scale & Peak" },
];

export const BADGE_CATEGORY_MAP = {
  models: new Set([
    "qwen_dynasty", "seedance_master", "hunyuan_master", "jd_joy_brother", "meituan_longcat",
    "zhipu_sage", "moonshot_voyager", "minimax_abyss", "gemini_gemma", "hyperspeed_grok",
    "flash_immortal", "closed_source_loyalist", "claude_survivor", "wishing_well", "heart_model", "stepfun_voyager",
    "dragon_heir", "kill_line",
    "open_commons", "mistral_westwind", "nemotron_spiral", "phi_disciple", "spark_alpaca",
    "iflytek_spark", "sensenova_daily", "xiaomi_mimo"
  ]),
  habits: new Set([
    "night_owl", "early_bird", "around_the_clock", "zen_balancer", "buzzer_beater",
    "marathoner", "streak", "weekend_warrior", "session_marathon", "iron_month"
  ]),
  engineering: new Set([
    "project_hopper", "project_devotion", "refactor_titan", "terminal_purist",
    "swarm_commander", "multitool", "multitool_day", "token_arbitrageur",
    "cache_alchemist", "cache_miser", "megacontext_voyager", "offgrid_sovereign"
  ]),
  scale: new Set([
    "token_titan", "big_day", "wordsmith", "sprinter", "deep_thinker",
    "code_cannon", "full_blast", "real_money", "deep_diver", "momentum",
    "polyglot", "trendsetter", "podium", "grand_slam", "frugal_architect", "veteran", "phoenix"
  ])
};

export const BADGE_DIFFICULTY = {
  project_hopper: 1,
  early_bird: 1.2,
  night_owl: 1.5,
  multitool: 1.8,
  polyglot: 2,
  around_the_clock: 2.2,
  marathoner: 2.5,
  buzzer_beater: 2.8,
  token_arbitrageur: 3,
  weekend_warrior: 3.2,
  sprinter: 3.5,
  session_marathon: 3.8,
  frugal_architect: 4,
  qwen_dynasty: 4.2,
  seedance_master: 4.2,
  hunyuan_master: 4.2,
  jd_joy_brother: 4.2,
  meituan_longcat: 4.2,
  stepfun_voyager: 4.2,
  open_commons: 5.5,
  mistral_westwind: 4.5,
  nemotron_spiral: 4.5,
  phi_disciple: 4.2,
  spark_alpaca: 5.0,
  iflytek_spark: 4.3,
  sensenova_daily: 4.4,
  xiaomi_mimo: 4.6,
  dragon_heir: 4,
  kill_line: 4.6,
  zhipu_sage: 4.5,
  moonshot_voyager: 4.5,
  minimax_abyss: 4.5,
  gemini_gemma: 4.5,
  hyperspeed_grok: 4.5,
  flash_immortal: 4.5,
  wordsmith: 5,
  code_cannon: 5.2,
  megacontext_voyager: 5.5,
  cache_miser: 5.8,
  cache_alchemist: 6,
  deep_thinker: 6.2,
  offgrid_sovereign: 6.5,
  terminal_purist: 6.8,
  swarm_commander: 7,
  refactor_titan: 7.2,
  zen_balancer: 7.5,
  streak: 7.8,
  big_day: 8,
  project_devotion: 8.2,
  claude_survivor: 8.5,
  wishing_well: 8.5,
  closed_source_loyalist: 8.5,
  heart_model: 8.8,
  full_blast: 9,
  iron_month: 9.2,
  multitool_day: 9.3,
  momentum: 9.4,
  veteran: 9.5,
  phoenix: 9.6,
  deep_diver: 9.7,
  token_titan: 9.8,
  trendsetter: 9.9,
  podium: 10,
  grand_slam: 10,
};
