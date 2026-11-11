export const PERKS_CLAIMS_KEY = "tokentracker.perks.claims.v3";
export const PERKS_LEGACY_CLAIMS_KEY = "tokentracker.perks.claims.v2";
export const PERKS_V1_CLAIMS_KEY = "tokentracker.perks.claims.v1";
const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 3_600_000;

// Schema 3 (owner call 2026-11-11, 学 AIHOT 卡册「越领越亮」): each cycle
// stores { last?, count } — last drives the claimed/not-claimed UI exactly
// like v2 did, count is the LIFETIME claim total that never decreases
// (unclaiming today keeps the streak history; re-claiming tomorrow counts
// again). Migration: v2 {cycle: "date"} → {last: "date", count: 1} — we only
// know it was claimed once; v1 {id: "date"} → every applicable cycle.

export function getPerkClaimDay(nowMs = Date.now()) {
  return new Date(nowMs + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}

export function nextPerkClaimDayDelay(nowMs = Date.now()) {
  const tomorrow = Date.parse(`${getPerkClaimDay(nowMs)}T00:00:00+08:00`) + DAY_MS;
  return Math.max(1_000, tomorrow - nowMs);
}

export function getPerkClaimCycles(item) {
  const cycles = [];
  if (item.category?.includes("daily_claim")) cycles.push("daily");
  if (item.category?.includes("monthly_claim")) cycles.push("monthly");
  return cycles.length ? cycles : ["once"];
}

function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && new Date(Date.parse(`${value}T00:00:00Z`)).toISOString().slice(0, 10) === value;
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCycleEntry(value) {
  // v3 {last?, count, cleared?}; a bare string is a kept-over v2 date.
  // cleared = 当天取消的标记（站主 2026-11-12：领取→取消→领取不得反复刷
  // count——当天取消后重新领取只恢复标记，count 不再 +1）。
  if (typeof value === "string") return validDate(value) ? { last: value, count: 1 } : null;
  if (!isRecord(value)) return null;
  const last = validDate(value.last) ? value.last : undefined;
  const count = Number.isSafeInteger(value.count) && value.count > 0 ? value.count : (last ? 1 : 0);
  const cleared = validDate(value.cleared) ? value.cleared : undefined;
  if (!last && count === 0) return null;
  return last ? { last, count, cleared } : { count, cleared };
}

export function normalizePerkClaims(value, providers) {
  if (!isRecord(value) || value.schema !== 3 || !isRecord(value.providers)) return {};
  const rows = [];
  for (const item of providers) {
    const stored = value.providers[item.id];
    if (!isRecord(stored)) continue;
    const entries = [];
    for (const cycle of getPerkClaimCycles(item)) {
      const entry = normalizeCycleEntry(stored[cycle]);
      if (entry) entries.push([cycle, entry]);
    }
    if (entries.length) rows.push([item.id, Object.fromEntries(entries)]);
  }
  return Object.fromEntries(rows);
}

// v2 {cycle: "date"} → {last: "date", count: 1}; v1 {id: "date"} → every
// applicable cycle {last, count: 1}. The v2 storage key stays reserved so the
// old record remains recoverable (same contract as the v1→v2 migration).
export function migrateLegacyPerkClaims(value, providers) {
  if (!isRecord(value)) return {};
  const v1 = !value.schema;
  const providersRecord = !v1 && isRecord(value.providers) ? value.providers : value;
  const rows = [];
  for (const item of providers) {
    const stored = providersRecord[item.id];
    if (!isRecord(stored)) {
      if (!(v1 && validDate(stored))) continue;
      rows.push([item.id, Object.fromEntries(getPerkClaimCycles(item).map((cycle) => [cycle, { last: stored, count: 1 }]))]);
      continue;
    }
    const entries = [];
    for (const cycle of getPerkClaimCycles(item)) {
      const entry = normalizeCycleEntry(stored[cycle]);
      if (entry) entries.push([cycle, entry]);
    }
    if (entries.length) rows.push([item.id, Object.fromEntries(entries)]);
  }
  return Object.fromEntries(rows);
}

export function getPerkClaimDate(item, claims, cycle, day) {
  if (!getPerkClaimCycles(item).includes(cycle)) return null;
  const entry = claims?.[item.id]?.[cycle];
  // 当天取消过：显示为未领取（daily/once 按当天；monthly 取消清除整月标记）。
  const cleared = entry?.cleared;
  if (cleared === day) return null;
  if (cycle === "monthly" && cleared && cleared.slice(0, 7) === day.slice(0, 7)) return null;
  const date = entry?.last;
  if (!validDate(date) || date > day) return null;
  if (cycle === "daily" && date !== day) return null;
  if (cycle === "monthly" && date.slice(0, 7) !== day.slice(0, 7)) return null;
  return date;
}

// Lifetime claim total for the album's brightness tiers (AIHOT-style
// 越领越亮). Zero when never claimed; unclaiming does not reduce it.
export function getPerkClaimStreak(item, claims, cycle) {
  if (!getPerkClaimCycles(item).includes(cycle)) return 0;
  const count = claims?.[item.id]?.[cycle]?.count;
  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export function isPerkClaimed(item, claims, day, category = "all") {
  const cycles = category === "daily_claim" ? ["daily"]
    : category === "monthly_claim" ? ["monthly"] : getPerkClaimCycles(item);
  return cycles.every((cycle) => Boolean(getPerkClaimDate(item, claims, cycle, day)));
}

export function togglePerkClaim(claims, item, cycle, day) {
  if (!getPerkClaimCycles(item).includes(cycle) || !validDate(day)) throw new TypeError("Invalid perk claim cycle/date");
  const next = { ...claims };
  const row = { ...claims[item.id] };
  const entry = normalizeCycleEntry(row[cycle]) || { count: 0 };
  if (getPerkClaimDate(item, claims, cycle, day)) {
    // Unclaim: 标记 cleared（last 与 lifetime count 都保留——亮度不回退），
    // 同一天内重新领取只摘标记、count 不再 +1（AIHOT 口径：一天一次，
    // 领取→取消→领取不得刷 ×N，站主 2026-11-12）。
    row[cycle] = { ...entry, cleared: day };
  } else if (entry.cleared === day) {
    // Same-day re-claim after an unclaim: restore the mark, keep count.
    row[cycle] = { ...entry, last: day, cleared: undefined };
  } else {
    // (Re-)claim on a fresh day: a new last plus one more lifetime count.
    row[cycle] = { last: day, count: (entry.count || 0) + 1, cleared: undefined };
  }
  if (Object.keys(row).length) next[item.id] = row;
  else delete next[item.id];
  return next;
}
