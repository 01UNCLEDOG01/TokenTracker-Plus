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
    if (!entry || typeof entry.account_id !== "string" || !entry.account_id.startsWith(idPrefix)) continue;
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
    ...shape(payload, row),
  };
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// TRAE SOLO: `available` plus rolling grants [{name, remain, total, grantAt,
// expireAt}]; grants without remain (the "免费" seed row) carry nothing.
function shapeTrae(payload) {
  const grants = Array.isArray(payload?.credits) ? payload.credits : [];
  const live = grants.filter((g) => g && Number.isFinite(Number(g.remain)) && Number(g.remain) > 0 && Number.isFinite(Number(g.expireAt)));
  let nearest = null;
  for (const grant of live) {
    if (!nearest || Number(grant.expireAt) < Number(nearest.expireAt)) nearest = grant;
  }
  const available = Number.isFinite(Number(payload?.available))
    ? Number(payload.available)
    : live.reduce((sum, g) => sum + Number(g.remain), 0);
  return {
    plan_name: null,
    trae_available_points: available,
    ...(nearest ? {
      trae_nearest_points: Number(nearest.remain),
      trae_nearest_expire_at: new Date(Number(nearest.expireAt)).toISOString(),
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

function makeGatewayFetcher({ idPrefix, label, shape }) {
  return async function fetchGatewayLimits({ home, dbPath, nowMs = Date.now() } = {}) {
    return fetchGatewayAccount({ home, dbPath, nowMs, idPrefix, label, shape });
  };
}

const fetchTraeLimits = makeGatewayFetcher({ idPrefix: "trae-solo-", label: "Trae", shape: shapeTrae });
const fetchCodeartsLimits = makeGatewayFetcher({ idPrefix: "codearts-", label: "CodeArts", shape: shapeCodearts });
const fetchClinePassLimits = makeGatewayFetcher({ idPrefix: "cline-pass-", label: "Cline Pass", shape: shapeClinePass });

module.exports = {
  fetchTraeLimits,
  fetchCodeartsLimits,
  fetchClinePassLimits,
  gatewayDbPath,
};
