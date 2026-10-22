// Display metadata for the achievement catalog.
//
// Thresholds do NOT live here — the server (SQL catalog table / local-api)
// returns per-badge thresholds + next_threshold in its payloads, and
// test/user-badges-thresholds-single-source.test.js enforces that no
// threshold literals appear in dashboard code. Array order = display order.
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
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";

// `art` files live in dashboard/public/achievements/ (see the README there
// for provenance); the lucide `icon` is the render fallback if the art fails
// to load.
export const BADGE_CATALOG = [
  { id: "token_titan", scope: "cloud", icon: Crown, format: "tokens", art: "/achievements/token-titan.png?v=7" },
  { id: "big_day", scope: "cloud", icon: Zap, format: "tokens", art: "/achievements/big-day.png?v=7" },
  { id: "wordsmith", scope: "cloud", icon: Feather, format: "tokens", art: "/achievements/wordsmith.png?v=7" },
  { id: "marathoner", scope: "cloud", icon: Footprints, format: "days", art: "/achievements/marathoner.png?v=7" },
  { id: "streak", scope: "cloud", icon: Flame, format: "days", art: "/achievements/streak.png?v=7" },
  { id: "weekend_warrior", scope: "cloud", icon: CalendarDays, format: "days", art: "/achievements/weekend-warrior.png?v=7" },
  { id: "momentum", scope: "cloud", icon: TrendingUp, format: "multiplier", art: "/achievements/momentum.png?v=7" },
  { id: "polyglot", scope: "cloud", icon: Brain, format: "count", art: "/achievements/polyglot.png?v=7" },
  { id: "trendsetter", scope: "cloud", icon: Rocket, format: "count", art: "/achievements/trendsetter.png?v=7" },
  { id: "multitool", scope: "cloud", icon: Blocks, format: "count", art: "/achievements/multitool.png?v=7" },
  { id: "podium", scope: "cloud", icon: Medal, format: "rank", art: "/achievements/podium.png?v=7" },
  { id: "veteran", scope: "cloud", icon: ShieldCheck, format: "days", art: "/achievements/veteran.png?v=7" },
  // Wave-2 cloud badges (2026-10-21). claude_survivor / wishing_well are
  // hidden easter eggs: locked, they render as "???" even to the owner —
  // the flag lives in the SQL catalog and user_badges_full payloads.
  // heart_model reuses the unused heart-on-your-sleeve face (a favorite
  // worn openly — the name semantics carry over).
  { id: "phoenix", scope: "cloud", icon: FlameKindling, format: "days", art: "/achievements/phoenix.png?v=8" },
  { id: "iron_month", scope: "cloud", icon: CalendarCheck2, format: "days", art: "/achievements/iron-month.png?v=8" },
  { id: "full_blast", scope: "cloud", icon: Activity, format: "tokens", art: "/achievements/full-blast.png?v=8" },
  { id: "deep_diver", scope: "cloud", icon: Anchor, format: "count", art: "/achievements/deep-diver.png?v=8" },
  { id: "multitool_day", scope: "cloud", icon: Layers, format: "count", art: "/achievements/multitool-day.png?v=8" },
  { id: "heart_model", scope: "cloud", icon: HeartPulse, format: "percent", art: "/achievements/heart-model.png?v=7" },
  { id: "claude_survivor", scope: "cloud", hidden: true, icon: Skull, format: "tokens", art: "/achievements/claude-survivor.png?v=8" },
  { id: "wishing_well", scope: "cloud", hidden: true, icon: Coins, format: "tokens", art: "/achievements/wishing-well.png?v=8" },
  { id: "grand_slam", scope: "cloud", icon: Trophy, format: "count", art: "/achievements/grand-slam.png?v=8" },
  { id: "project_hopper", scope: "local", icon: FolderGit2, format: "count", art: "/achievements/project-hopper.png?v=7" },
  { id: "project_devotion", scope: "local", icon: Heart, format: "tokens", art: "/achievements/project-devotion.png?v=7" },
  { id: "night_owl", scope: "local", icon: MoonStar, format: "count", art: "/achievements/night-owl.png?v=7" },
  // Habit badges computed on-device. Faces are self-drawn medallions matched
  // to each badge's meaning, except deep_thinker which reuses the unused
  // galaxy-brain face (brain → reasoning; the name semantics carry over).
  { id: "early_bird", scope: "local", icon: Sunrise, format: "count", art: "/achievements/early-bird.png?v=8" },
  { id: "around_the_clock", scope: "local", icon: Clock, format: "count", art: "/achievements/around-the-clock.png?v=8" },
  { id: "sprinter", scope: "local", icon: Gauge, format: "tokens", art: "/achievements/sprinter.png?v=8" },
  { id: "cache_alchemist", scope: "local", icon: FlaskConical, format: "tokens", art: "/achievements/cache-alchemist.png?v=8" },
  { id: "deep_thinker", scope: "local", icon: BrainCircuit, format: "tokens", art: "/achievements/deep-thinker.png?v=7" },
  { id: "real_money", scope: "local", icon: Banknote, format: "usd", art: "/achievements/real-money.png?v=8" },
  { id: "session_marathon", scope: "local", icon: Hourglass, format: "duration", art: "/achievements/session-marathon.png?v=8" },
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
