export const PERKS_CLAIMS_KEY = "tokentracker.perks.claims.v2";
export const PERKS_LEGACY_CLAIMS_KEY = "tokentracker.perks.claims.v1";
const DAY_MS = 86_400_000;
const BEIJING_OFFSET_MS = 8 * 3_600_000;

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
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function normalizePerkClaims(value, providers) {
  if (!isRecord(value) || value.schema !== 2 || !isRecord(value.providers)) return {};
  const rows = [];
  for (const item of providers) {
    const stored = value.providers[item.id];
    if (!isRecord(stored)) continue;
    const entries = getPerkClaimCycles(item)
      .filter((cycle) => validDate(stored[cycle]))
      .map((cycle) => [cycle, stored[cycle]]);
    if (entries.length) rows.push([item.id, Object.fromEntries(entries)]);
  }
  return Object.fromEntries(rows);
}

// v1 recorded one calendar date for the entire card. Carry that recorded date
// into its applicable cycles; the current day/month decides whether it is due.
// The original v1 storage key is kept so the old ambiguous record is recoverable.
export function migrateLegacyPerkClaims(value, providers) {
  if (!isRecord(value)) return {};
  const rows = [];
  for (const item of providers) {
    if (!validDate(value[item.id])) continue;
    rows.push([item.id, Object.fromEntries(getPerkClaimCycles(item).map((cycle) => [cycle, value[item.id]]))]);
  }
  return Object.fromEntries(rows);
}

export function getPerkClaimDate(item, claims, cycle, day) {
  if (!getPerkClaimCycles(item).includes(cycle)) return null;
  const date = claims?.[item.id]?.[cycle];
  if (!validDate(date) || date > day) return null;
  if (cycle === "daily" && date !== day) return null;
  if (cycle === "monthly" && date.slice(0, 7) !== day.slice(0, 7)) return null;
  return date;
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
  if (getPerkClaimDate(item, claims, cycle, day)) delete row[cycle];
  else row[cycle] = day;
  if (Object.keys(row).length) next[item.id] = row;
  else delete next[item.id];
  return next;
}
