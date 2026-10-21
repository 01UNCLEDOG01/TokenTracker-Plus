const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readSqliteJsonRowsAsync } = require("./sqlite-reader");

// 小浣熊 (Raccoon, raccoon.sensetime.com) credit pools, as seen through the
// local Agent2API gateway. The gateway polls each upstream account on its own
// schedule and snapshots the result into `account_usage_records` — zero auth,
// no extra network round, and the snapshot is minutes old whenever the gateway
// is healthy. This mirrors the gateway's own "wallets" view:
//
//   SELECT usage FROM account_usage_records WHERE account_id = 'user-sample'
//     → { available: 10300, unit: "积分", wallets: [{type: "daily_points",
//         displayName: "每日积分", balance: 1358}, {type: "reward_points",
//         displayName: "奖励积分", balance: 8942}, ...], raw.points: {...} }
//
// The owner's own account is user-sample (verified against the gateway's
// requests table: account_name=UNCLEDOG, provider=raccoon). The gateway also
// pools other raccoon-shaped accounts (user-848338, intl-user-* …) whose
// balances are NOT this user's quota — they are skipped deliberately.
// TOKENTRACKER_RACCOON_ACCOUNT_ID overrides the account for a migrated owner.
//
// Wallet balances refill on their own schedules (the daily wallet accumulates
// +300 per check-in rather than resetting against a fixed grant), so there is
// no honest used_percent for any bucket — the card surfaces balances as a
// status line (same shape as sensenova's grant_credits), never a fake bar.
//
// No daily balances are held here beyond the last-good file; the gateway's db
// is the single source of truth and is re-read on every usage-limits poll.

const DEFAULT_RACCOON_ACCOUNT_ID = "user-sample";
// The gateway refreshes snapshots every few minutes; a row older than this
// means the gateway stopped polling (or was uninstalled) and the card should
// say so instead of presenting a stale balance as live.
const STALE_SNAPSHOT_MS = 6 * 3600 * 1000;

function gatewayDbPath(home) {
  return path.join(home || os.homedir(), ".agent2api", "agent2api.db");
}

function lastGoodPath(home) {
  return path.join(home || os.homedir(), ".tokentracker", "raccoon-last-good.json");
}

// The last successful snapshot, so a gateway blip (write lock, migration,
// corrupted file) serves a stale card instead of an error. A genuinely absent
// db or account row stays invisible ({configured:false}) — that is "gateway
// not installed", not a blip.
function readLastGood(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(lastGoodPath(home), "utf8"));
    if (!raw || typeof raw !== "object" || !raw.raccoon_wallets) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeLastGood(home, value) {
  try {
    const file = lastGoodPath(home);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    // Best effort: a failed write just means the next blip shows an error.
  }
}

function normalizeWallets(payload) {
  const wallets = Array.isArray(payload?.wallets) ? payload.wallets : [];
  const normalized = [];
  for (const wallet of wallets) {
    if (!wallet || typeof wallet !== "object") continue;
    const balance = Number(wallet.balance);
    if (!Number.isFinite(balance)) continue;
    const type = typeof wallet.type === "string" ? wallet.type.trim() : "";
    const name = typeof wallet.displayName === "string" && wallet.displayName.trim()
      ? wallet.displayName.trim()
      : typeof wallet.name === "string" && wallet.name.trim() ? wallet.name.trim() : "";
    if (!type && !name) continue;
    normalized.push({ type, name, balance });
  }
  return normalized;
}

// Returns the shared usage-limits shape (_flat_ — no provider-nested object),
// or {configured:false} when the gateway or the owner's account row is absent
// (the provider stays invisible rather than erroring).
async function fetchRaccoonLimits({
  home,
  env,
  dbPath,
  nowMs = Date.now(),
} = {}) {
  const effectiveDbPath = dbPath || gatewayDbPath(home);
  if (!effectiveDbPath || !fs.existsSync(effectiveDbPath)) {
    return { configured: false, error: null };
  }
  const accountId = (env && typeof env.TOKENTRACKER_RACCOON_ACCOUNT_ID === "string" && env.TOKENTRACKER_RACCOON_ACCOUNT_ID.trim())
    || DEFAULT_RACCOON_ACCOUNT_ID;

  let rows;
  try {
    rows = await readSqliteJsonRowsAsync(
      effectiveDbPath,
      "SELECT account_id, usage, error, last_success_at, updated_at FROM account_usage_records",
      { label: "Raccoon", timeout: 10_000, maxBuffer: 8 * 1024 * 1024, readOnly: true, throwOnReadFailure: true },
    );
  } catch (error) {
    const lastGood = readLastGood(home);
    if (lastGood) return { configured: true, ...lastGood, stale: true };
    return { configured: true, error: error?.message || "gateway db unreadable" };
  }
  if (!Array.isArray(rows)) rows = [];

  const row = rows.find((entry) => entry && entry.account_id === accountId);
  if (!row) return { configured: false, error: null };

  let payload;
  try {
    payload = JSON.parse(row.usage);
  } catch {
    return { configured: true, error: "gateway snapshot is not valid JSON" };
  }
  const wallets = normalizeWallets(payload);
  const available = Number(payload?.available);
  if (!wallets.length && !Number.isFinite(available)) {
    return { configured: true, error: "gateway snapshot carries no wallet balances" };
  }

  const updatedAtMs = Number(row.updated_at) || Number(row.last_success_at) || 0;
  const updatedAtIso = updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null;
  const result = {
    configured: true,
    plan_name: null,
    raccoon_wallets: wallets,
    raccoon_available_credits: Number.isFinite(available) ? available : wallets.reduce((sum, w) => sum + w.balance, 0),
    raccoon_unit: typeof payload?.unit === "string" && payload.unit.trim() ? payload.unit.trim() : "积分",
    raccoon_updated_at: updatedAtIso,
    source: "local-database",
    // No cached_at on purpose: the gateway sweeps every ~10 minutes, so the
    // snapshot's own age would trip the shared provenance pass's 10-minute
    // stale rule on every other poll. This flag is the staleness signal instead
    // — the balance is a slow-moving pool, not a live counter.
    ...(updatedAtMs > 0 && nowMs - updatedAtMs > STALE_SNAPSHOT_MS ? { stale: true } : {}),
  };
  writeLastGood(home, {
    raccoon_wallets: result.raccoon_wallets,
    raccoon_available_credits: result.raccoon_available_credits,
    raccoon_unit: result.raccoon_unit,
    raccoon_updated_at: result.raccoon_updated_at,
    captured_at: new Date(nowMs).toISOString(),
  });
  return result;
}

module.exports = { fetchRaccoonLimits, gatewayDbPath, DEFAULT_RACCOON_ACCOUNT_ID };
