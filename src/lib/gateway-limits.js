const os = require("node:os");
const path = require("node:path");

const { readSqliteJsonRowsAsync } = require("./sqlite-reader");

// Limit cards fed by the local Agent2API gateway's own account snapshots —
// the same source the raccoon card reads (`account_usage_records` in
// ~/.agent2api/agent2api.db), one fetcher per upstream product the gateway
// holds for the owner:
//
//   trae      — TRAE SOLO points held as rolling check-in grants (each grant
//               carries its own expireAt, so the card also reports the soonest
//               expiry); the account is the owner's SECONDARY account
//               (user-confirmed 2026-10-22), distinct from the trae-cn usage
//               ledger counted from the main account's cloud billing.
//   codearts  — Huawei CodeArts Agent trial credits: named meters with real
//               used/total pairs plus a monthly reset date.
//   clinePass — Cline Pass micro-credits; the gateway disabled this account,
//               so its snapshot ages — the shared staleness flag covers it.
//
// Accounts are matched by id prefix (the gateway's ids look like
// "trae-solo-<hash>", "codearts-<hash>", "cline-pass-usr-<id>"); among
// matching rows the freshest snapshot wins, so a re-added or second account
// cannot silently shadow the live one. Other raccoon-shaped pool accounts are
// NOT matched here — the raccoon card owns that family.

const STALE_SNAPSHOT_MS = 6 * 3600 * 1000;

function gatewayDbPath(home) {
  return path.join(home || os.homedir(), ".agent2api", "agent2api.db");
}

async function readGatewaySnapshots(dbPath) {
  return readSqliteJsonRowsAsync(
    dbPath,
    "SELECT account_id, usage, error, last_success_at, updated_at FROM account_usage_records",
    { label: "Gateway", timeout: 10_000, maxBuffer: 8 * 1024 * 1024, readOnly: true, throwOnReadFailure: true },
  );
}

// Shared tail: pick the freshest row for an id prefix, parse its usage JSON,
// and shape the common envelope. Returns null for "account absent" (the
// provider stays invisible) and throws nothing — parse failures surface as
// {configured:true, error} like every other provider.
async function fetchGatewayAccount({
  home,
  dbPath,
  nowMs,
  idPrefix,
  accountId,
  label,
  shape,
}) {
  const effectiveDbPath = dbPath || gatewayDbPath(home);
  let rows;
  try {
    rows = await readGatewaySnapshots(effectiveDbPath);
  } catch (error) {
    return { configured: true, error: error?.message || `${label} gateway db unreadable` };
  }
  if (!Array.isArray(rows)) rows = [];

  let row = null;
  for (const entry of rows) {
    if (!entry || typeof entry.account_id !== "string") continue;
    // An exact id wins over the prefix scan: two Trae accounts now live in the
    // same table with the same "trae-solo-" prefix, and "freshest row wins"
    // would make the two cards swap identities whenever one sweeps first.
    if (accountId ? entry.account_id !== accountId : !entry.account_id.startsWith(idPrefix)) continue;
    if (!row || Number(entry.updated_at || 0) > Number(row.updated_at || 0)) row = entry;
  }
  if (!row) return null;

  let payload;
  try {
    payload = JSON.parse(row.usage);
  } catch {
    return { configured: true, error: `${label} gateway snapshot is not valid JSON` };
  }
  const updatedAtMs = Number(row.updated_at) || Number(row.last_success_at) || 0;
  return {
    configured: true,
    source: "local-database",
    gateway_updated_at: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : null,
    // No cached_at on purpose — same reasoning as the raccoon card: the
    // gateway sweeps every ~10 minutes and the shared provenance pass would
    // flag the card stale on every other poll. This flag is the staleness
    // signal instead.
    ...(updatedAtMs > 0 && nowMs - updatedAtMs > STALE_SNAPSHOT_MS ? { stale: true } : {}),
    ...shape(payload, row, nowMs),
  };
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// TRAE SOLO: `available` plus rolling grants [{name, remain, total, grantAt,
// expireAt}]; grants without remain (the "免费" seed row) carry nothing.
// Every live grant is returned with both numbers so the card can draw one thin
// bar per batch. There is no account-wide denominator here — summing `total`
// across grants would invent a plan limit the API never supplied — so the card
// must never render a whole-card percentage from this data.
function shapeTrae(payload, _row, nowMs = Date.now()) {
  const grants = Array.isArray(payload?.credits) ? payload.credits : [];
  const live = [];
  for (const grant of grants) {
    const remain = Number(grant?.remain);
    const total = Number(grant?.total);
    const expireAt = Number(grant?.expireAt);
    if (!Number.isFinite(remain) || remain <= 0) continue;
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!Number.isFinite(expireAt) || expireAt <= nowMs) continue;
    live.push({
      name: typeof grant?.name === "string" ? grant.name : "",
      remain,
      total,
      expire_at: new Date(expireAt).toISOString(),
      _expireAtMs: expireAt,
    });
  }
  live.sort((a, b) => a._expireAtMs - b._expireAtMs);
  const available = Number.isFinite(Number(payload?.available))
    ? Number(payload.available)
    : live.reduce((sum, g) => sum + g.remain, 0);
  const nearest = live[0] || null;
  // The gateway exposes the account's own totals under raw.entUsage. That is
  // the only honest source for "total / used"; the per-grant list remains for
  // the nearest expiry and as a fallback when a snapshot predates the summary.
  const summary = payload?.raw?.entUsage?.usage_summary || payload?.usage_summary || null;
  const grantTotal = live.reduce((sum, g) => sum + g.total, 0);
  const totalPoints = Number.isFinite(Number(summary?.total_amount))
    ? Number(summary.total_amount)
    : grantTotal;
  const usedPoints = Number.isFinite(Number(summary?.consumed_amount))
    ? Number(summary.consumed_amount)
    : Math.max(0, totalPoints - available);
  const ratio = Number.isFinite(Number(summary?.consumption_ratio))
    ? Number(summary.consumption_ratio)
    : totalPoints > 0 ? usedPoints / totalPoints : null;
  return {
    plan_name: null,
    trae_available_points: available,
    trae_total_points: totalPoints > 0 ? totalPoints : null,
    trae_used_points: totalPoints > 0 ? usedPoints : null,
    trae_consumption_ratio: ratio,
    trae_grants: live.map(({ _expireAtMs, ...grant }) => grant),
    ...(nearest ? {
      trae_nearest_points: nearest.remain,
      trae_nearest_expire_at: nearest.expire_at,
    } : {}),
  };
}

// CodeArts: named meters with real credit pairs. The 对话 token meter is a
// cumulative counter with no cap (allowance_tokens is a flag), so only the
// credit buckets surface.
function shapeCodearts(payload) {
  const stats = payload?.raw?.statistics || payload?.statistics || {};
  const meters = Array.isArray(stats.meters) ? stats.meters : [];
  const byName = new Map(meters.map((m) => [String(m?.name || ""), m]));
  const bucket = (name) => {
    const meter = byName.get(name);
    if (!meter) return null;
    const remaining = Number(meter.credit_remaining);
    if (!Number.isFinite(remaining)) return null;
    return { remaining, total: Number(meter.credit_total) || 0 };
  };
  const subscription = payload?.subscription && typeof payload.subscription === "object" ? payload.subscription : {};
  return {
    plan_name: typeof subscription.planName === "string" && subscription.planName.trim() ? subscription.planName.trim() : null,
    codearts_available_credits: Number.isFinite(Number(payload?.available)) ? Number(payload.available) : 0,
    codearts_package: bucket("usageTotalPackageCredit"),
    codearts_bonus: bucket("usageBonusPackageCredit"),
    codearts_basic: bucket("usageBasicPackageCredit"),
    codearts_reset_date: typeof stats.reset_date === "string" ? stats.reset_date : null,
    codearts_tokens_used: (() => {
      const meter = byName.get("usageTokenChatMessages");
      const used = Number(meter?.used_tokens);
      return Number.isFinite(used) ? used : 0;
    })(),
  };
}

// Cline Pass: the raccoon wallets shape.
function shapeClinePass(payload) {
  const wallets = Array.isArray(payload?.wallets) ? payload.wallets : [];
  const shaped = [];
  for (const wallet of wallets) {
    if (!wallet || typeof wallet !== "object") continue;
    const balance = Number(wallet.balance);
    if (!Number.isFinite(balance)) continue;
    const name = typeof wallet.displayName === "string" && wallet.displayName.trim() ? wallet.displayName.trim() : "";
    if (!name) continue;
    shaped.push({ name, balance });
  }
  return {
    plan_name: null,
    cline_wallets: shaped,
    cline_available_credits: Number.isFinite(Number(payload?.available))
      ? Number(payload.available)
      : shaped.reduce((sum, w) => sum + w.balance, 0),
    cline_unit: typeof payload?.unit === "string" && payload.unit.trim() ? payload.unit.trim() : "credit",
  };
}

function makeGatewayFetcher({ idPrefix, accountId, label, shape }) {
  return async function fetchGatewayLimits({ home, dbPath, nowMs = Date.now() } = {}) {
    return fetchGatewayAccount({ home, dbPath, nowMs, idPrefix, accountId, label, shape });
  };
}

// Two Trae accounts share this table (owner added the main one on 2026-10-22),
// so each card pins its own id instead of racing on updated_at. Re-pin here if
// either account is re-authorised and the gateway re-hashes it.
const TRAE_ALT_ACCOUNT_ID = "trae-solo-4fc0b0ec01dfac776c2555fcca7e7f0859851e8c8f2504a1d8e38429b87e3dfe";
const TRAE_MAIN_ACCOUNT_ID = "trae-solo-1123d1cb75a5db58931ce004f9e1db1bcec17e5a65ec20f29ac11eb95b08c06a";

const fetchTraeLimits = makeGatewayFetcher({ idPrefix: "trae-solo-", accountId: TRAE_ALT_ACCOUNT_ID, label: "Trae", shape: shapeTrae });
const fetchTraeMainLimits = makeGatewayFetcher({ idPrefix: "trae-solo-", accountId: TRAE_MAIN_ACCOUNT_ID, label: "Trae", shape: shapeTrae });
const fetchCodeartsLimits = makeGatewayFetcher({ idPrefix: "codearts-", label: "CodeArts", shape: shapeCodearts });
const fetchClinePassLimits = makeGatewayFetcher({ idPrefix: "cline-pass-", label: "Cline Pass", shape: shapeClinePass });

module.exports = {
  fetchTraeLimits,
  fetchTraeMainLimits,
  fetchCodeartsLimits,
  fetchClinePassLimits,
  gatewayDbPath,
};
