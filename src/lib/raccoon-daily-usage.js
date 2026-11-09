"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// 小浣熊 (Raccoon, xiaohuanxiong.com) DAILY point usage, read straight from
// the desktop app's own session — same zero-config pattern as the MiniMax
// Code lane: ~/.office-raccoon/agent/config/auth.json holds a JWT access
// token the app itself wrote; nothing is entered or sent anywhere except
// xiaohuanxiong.com. The token is kept in memory only and never logged.
//
// Why this lane exists: the gateway snapshot (raccoon-limits.js) carries
// wallet BALANCES only. The daily wallet accumulates +300 per check-in and
// each grant expires after 7 days, so no daily total or used amount exists
// in the snapshot — no honest bar could be drawn there. The upstream points
// bills endpoint does carry both:
//
//   GET /api/web/points/v1/balance
//       → { data: { available_points, daily_points, reward_points, ... } }
//   GET /api/web/points/v2/bills?type=all&paging.limit=100[&cursor=…]
//       → { data: { items: [{ biz_type, event_name, points, created_at,
//             grant_at?, expire_at? }], has_more, next_cursor } }
//
// Bill taxonomy observed on a live account (2026-11-09, paging verified):
//   daily_grant   每日积分发放     +300, grant_at = grant day 00:00 +08:00,
//                                 expire_at = +7 days 23:59:59
//   daily_expire  每日积分到期清零  -300 when a week-old grant lapses
//   desktop       桌面端 LLM 对话消耗 -N per call
//   reward_grant  使用体验补偿积分   +N one-off compensation
//
// 每日总额度 = today's daily_grant sum; 每日已用 = today's negative bills
// EXCLUDING daily_expire (an expiry is not usage). Reward grants are
// deliberately not counted as daily quota — they carry no day cap. Both
// sides group on the Asia/Shanghai calendar day, which is the boundary the
// upstream itself grants and expires on.
//
// Usage can outspend the day's grant (older grant batches still carry
// balance), so used_percent clamps at 100 for the meter while the raw
// amounts stay untouched in the payload — the hover detail shows the real
// numbers, never a fabricated fraction.

const DEFAULT_TIMEOUT_MS = 12_000;
const PAGE_LIMIT = 100;
// A page boundary only matters once a single day outgrows 20 × 100 bills
// (~2k LLM calls); past the cap we stop paging and flag the result partial
// instead of silently undercounting or paging unbounded.
const MAX_PAGES = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

function raccoonAuthFilePath(home, env) {
  const override = env && typeof env.TOKENTRACKER_RACCOON_AUTH_FILE === "string"
    ? env.TOKENTRACKER_RACCOON_AUTH_FILE.trim()
    : "";
  if (override) return override;
  return path.join(home || os.homedir(), ".office-raccoon", "agent", "config", "auth.json");
}

function readDesktopToken(home, env) {
  try {
    const doc = JSON.parse(fs.readFileSync(raccoonAuthFilePath(home, env), "utf8"));
    const token = typeof doc?.access_token === "string" ? doc.access_token.trim() : "";
    return token || null;
  } catch {
    return null;
  }
}

// Beijing calendar day of a timestamp — the upstream grants and expires on
// Asia/Shanghai midnights, so "today" must follow that clock even if the
// machine runs elsewhere.
function beijingDateKey(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(new Date(ms));
}

function beijingMidnightMs(dateKey) {
  const parsed = Date.parse(`${dateKey}T00:00:00+08:00`);
  return Number.isFinite(parsed) ? parsed : null;
}

function billTimeMs(value) {
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDailyGrant(bill) {
  return bill?.biz_type === "daily_grant" && Number(bill?.points) > 0;
}

function isConsumption(bill) {
  return Number(bill?.points) < 0 && bill?.biz_type !== "daily_expire";
}

function accumulateBills(items, todayStartMs, tomorrowStartMs) {
  let grant = 0;
  let used = 0;
  for (const bill of items) {
    if (!bill || typeof bill !== "object") continue;
    // Grants stamp the day they belong to in grant_at (posting can lag past
    // midnight). Consumption bills carry no grant_at today; if upstream ever
    // adds one meaning "drawn from the batch granted at", it must NOT drag a
    // today bill into an older day — consumption always groups by posting
    // time, falling back to grant_at only when created_at is missing.
    const grantDay = billTimeMs(bill.grant_at);
    const createdDay = billTimeMs(bill.created_at);
    let day;
    if (Number(bill?.points) > 0 && bill?.biz_type === "daily_grant") {
      day = grantDay ?? createdDay;
    } else {
      day = createdDay ?? grantDay;
    }
    if (day === null || day < todayStartMs || day >= tomorrowStartMs) continue;
    if (isDailyGrant(bill)) grant += Number(bill.points);
    else if (isConsumption(bill)) used += -Number(bill.points);
  }
  return { grant, used };
}

async function getJson(fetchImpl, url, token, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    const error = new Error(`Raccoon points HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

function envelope(doc) {
  return doc && typeof doc === "object" && doc.data && typeof doc.data === "object" ? doc.data : {};
}

async function fetchRaccoonDailyUsage({
  home,
  env = {},
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const token = readDesktopToken(home, env);
  if (!token) {
    // No desktop install (or the app never signed in) — the card stays with
    // its gateway balances, exactly as before this lane existed.
    return { configured: false, error: null };
  }

  const todayKey = beijingDateKey(nowMs);
  const todayStartMs = beijingMidnightMs(todayKey);
  const tomorrowStartMs = todayStartMs === null ? null : todayStartMs + DAY_MS;
  if (todayStartMs === null) {
    return { configured: true, error: "Raccoon daily usage clock is unreadable" };
  }

  // Best-effort balance: the wallet numbers come from the gateway snapshot,
  // so a failed balance call only costs the tooltip line, not the bar.
  let dailyBalance = null;
  let availablePoints = null;
  try {
    const balanceDoc = await getJson(
      fetchImpl,
      "https://xiaohuanxiong.com/api/web/points/v1/balance",
      token,
      timeoutMs,
    );
    const balance = envelope(balanceDoc);
    const daily = Number(balance.daily_points);
    const available = Number(balance.available_points);
    if (Number.isFinite(daily)) dailyBalance = daily;
    if (Number.isFinite(available)) availablePoints = available;
  } catch {
    // Balance is enrichment only; bills decide whether the bar renders.
  }

  let grant = 0;
  let used = 0;
  let partial = false;
  let cursor = null;
  let pages = 0;
  try {
    for (;;) {
      const params = new URLSearchParams({ type: "all", "paging.limit": String(PAGE_LIMIT) });
      if (cursor) params.set("cursor", cursor);
      const doc = await getJson(
        fetchImpl,
        "https://xiaohuanxiong.com/api/web/points/v2/bills?" + params.toString(),
        token,
        timeoutMs,
      );
      // HTTP 200 can still carry a business error ({ code: 42, message });
      // degrade honestly instead of rendering an empty day as "no usage".
      if (doc && typeof doc === "object" && Number(doc.code) !== 0 && Number.isFinite(Number(doc.code))) {
        return { configured: true, error: `Raccoon points bills error ${doc.code}: ${typeof doc.message === "string" ? doc.message : "unknown"}` };
      }
      const data = envelope(doc);
      const items = Array.isArray(data.items) ? data.items : [];
      pages += 1;
      const sums = accumulateBills(items, todayStartMs, tomorrowStartMs);
      grant += sums.grant;
      used += sums.used;
      // Bills arrive newest-first; once a page dips before today's boundary
      // every later page is older still.
      let oldest = null;
      for (const bill of items) {
        const ts = billTimeMs(bill?.created_at);
        if (ts !== null && (oldest === null || ts < oldest)) oldest = ts;
      }
      const more = data.has_more === true && typeof data.next_cursor === "string" && data.next_cursor !== "";
      if (!more || (oldest !== null && oldest < todayStartMs)) break;
      if (pages >= MAX_PAGES) {
        partial = true;
        break;
      }
      cursor = data.next_cursor;
    }
  } catch (error) {
    const status = Number(error?.statusCode);
    if (status === 401 || status === 403) {
      return {
        configured: true,
        error: "Raccoon desktop session expired — re-login in the 小浣熊 desktop app",
      };
    }
    if (status === 429) {
      return { configured: true, error: "Raccoon points rate limited" };
    }
    return { configured: true, error: error?.message || "Raccoon daily usage fetch failed" };
  }

  const usage = {
    date: todayKey,
    grant_points: grant,
    used_points: used,
    ...(dailyBalance !== null ? { daily_balance: dailyBalance } : {}),
    ...(availablePoints !== null ? { available_points: availablePoints } : {}),
    ...(partial ? { partial: true } : {}),
    source: "office-raccoon-desktop",
    captured_at: new Date(nowMs).toISOString(),
  };

  const usedPercent = grant > 0 ? Math.max(0, Math.min(100, (used / grant) * 100)) : null;
  const window = usedPercent !== null
    ? {
      kind: "daily",
      used: used,
      limit: grant,
      remaining: Math.max(0, grant - used),
      used_percent: usedPercent,
      // The hover/expanded detail reads the *_credits convention with a unit;
      // points keep their own wording (今日已用 … 积分) instead of "credits".
      used_credits: used,
      limit_credits: grant,
      remaining_credits: Math.max(0, grant - used),
      unit: "points",
      reset_at: todayStartMs + DAY_MS,
      limit_window_seconds: DAY_MS,
    }
    : null;

  return {
    configured: true,
    raccoon_daily_usage: usage,
    raccoon_daily_usage_window: window,
    error: null,
  };
}

module.exports = {
  fetchRaccoonDailyUsage,
  raccoonAuthFilePath,
  beijingDateKey,
  beijingMidnightMs,
  accumulateBills,
  MAX_PAGES,
  PAGE_LIMIT,
};
