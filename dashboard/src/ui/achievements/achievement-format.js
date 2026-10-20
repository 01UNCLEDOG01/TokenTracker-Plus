import { formatTokensCompact } from "../../lib/format-tokens";

/** Format a badge metric value per the catalog entry's `format`. */
export function formatBadgeValue(format, value) {
  const n = Number(value) || 0;
  switch (format) {
    case "tokens":
      return formatTokensCompact(n);
    case "rank":
      return `#${Math.round(n)}`;
    case "multiplier":
      return `${(Math.round(n * 10) / 10).toString()}×`;
    case "usd":
      return `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    case "duration": {
      // metric + thresholds are milliseconds of active session time
      const hours = n / 3_600_000;
      if (hours >= 1) return `${Math.round(hours * 10) / 10}h`;
      return `${Math.max(1, Math.round(n / 60_000))}m`;
    }
    default:
      return Math.round(n).toLocaleString();
  }
}

/**
 * Progress ratio (0..1) toward the next tier. For lower_is_better metrics
 * (podium: rank) the ratio inverts — closing in on a SMALLER number means
 * progress grows. Values are clamped; a shrunk metric after an earned tier
 * never renders a >100% or negative bar.
 */
export function badgeProgress(badge) {
  if (!badge) return 0;
  const next = Number(badge.next_threshold);
  const value = Number(badge.metric_value ?? badge.value);
  if (!Number.isFinite(next) || next <= 0) return badge.tier >= 4 ? 1 : 0;
  if (!Number.isFinite(value) || value <= 0) return 0;
  const ratio = badge.lower_is_better ? next / value : value / next;
  return Math.max(0, Math.min(1, ratio));
}

/** Max first-achieved timestamp across tiers (for "new badge" detection). */
export function latestAchievedAt(badge) {
  const achieved = badge?.achieved || {};
  const times = Object.values(achieved)
    .map((t) => (t ? Date.parse(t) : NaN))
    .filter((t) => Number.isFinite(t));
  return times.length > 0 ? Math.max(...times) : null;
}
