import { useEffect, useState } from "react";
import { copy, getCopyLocale } from "../../../lib/copy";
import { useTokenFormat } from "../../../hooks/useTokenFormat.js";

// Both banners read the always-local limits endpoint (the same one the quota
// panels use), so they work in the signed-in cloud view too, where the account
// aggregate has no rows for these tools at all.
const LIMITS_TTL_MS = 60_000;
let limitsCache = { at: 0, data: null, promise: null };

function loadUsageLimits() {
  const now = Date.now();
  if (limitsCache.data && now - limitsCache.at < LIMITS_TTL_MS) return Promise.resolve(limitsCache.data);
  if (limitsCache.promise) return limitsCache.promise;
  limitsCache.promise = fetch("/functions/tokentracker-usage-limits", {
    headers: { Accept: "application/json" },
    cache: "no-store"
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      const data = (json && json.data) || json;
      limitsCache = { at: Date.now(), data: data || null, promise: null };
      return data || null;
    })
    .catch(() => {
      limitsCache = { at: 0, data: null, promise: null };
      return null;
    });
  return limitsCache.promise;
}

function useLimitsField(field) {
  const [value, setValue] = useState(null);
  useEffect(() => {
    let alive = true;
    loadUsageLimits().then((data) => {
      if (alive && data && data[field]) setValue(data[field]);
    });
    return () => { alive = false; };
  }, [field]);
  return value;
}

// Same shape as resetCommunityStatsCacheForTests in use-community-stats.js:
// limitsCache is module-level with a 60s TTL, so a test that renders this twice
// with different payloads would otherwise assert against the first response.
export function resetLedgerNoticesCacheForTests() {
  limitsCache = { at: 0, data: null, promise: null };
}

function number(value, digits) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return n.toLocaleString(getCopyLocale() || "en-US", { maximumFractionDigits: digits });
}

// Days are compared as ISO dates in the same timezone the dashboard groups by.
function inRange(day, from, to) {
  const d = String(day || "");
  if (!d) return false;
  if (from && to && (d < from || d > to)) return false;
  return true;
}

function rangeLabel(from, to) {
  if (from && to) return from === to ? from : `${from}~${to}`;
  return "--";
}

const NOTE_CLASS = "mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500";
const LINE_CLASS = "mb-3 text-[11px] leading-snug text-oai-gray-600 dark:text-oai-gray-300 tabular-nums";
const MUTED_LINE_CLASS = "mb-3 text-[11px] leading-snug text-oai-gray-500 dark:text-oai-gray-400 tabular-nums";

// Qoder CN reports credits and money, never token counts, and its daily-trend
// endpoint only settles closed Beijing days. The CLI's spend block therefore
// carries a per-model breakdown plus a live "today" figure read from the
// request-detail list, and the token row below is an estimate scaled by the
// locally measured tokens-per-message anchor.
export function QoderCnOfficialSpend({ from, to }) {
  const { formatTokens } = useTokenFormat();
  const cn = useLimitsField("qoderCn");
  const spend = cn?.spend || null;
  // Methodology details collapse. This hook must sit above the early return:
  // the first render has no spend yet, and a hook count that changes once the
  // data arrives crashes the whole tree.
  const [detailsOpen, setDetailsOpen] = useState(false);

  // "We could not fetch it" and "you used nothing" must never look the same.
  // Returning null here removed the whole block, and a missing block reads as
  // "nothing to report" rather than "the fetch failed" - which is how a dead
  // feed spent two days looking like an idle account.
  if (!spend) {
    return (
      <p className={MUTED_LINE_CLASS}>
        {copy("usage.overview.qoder_cn_spend_unavailable")}
      </p>
    );
  }

  const daily = Array.isArray(spend.daily) ? spend.daily : [];
  let credits = 0, cost = 0, messages = 0;
  for (const day of daily) {
    if (!inRange(day?.date, from, to)) continue;
    credits += Number(day?.credits) || 0;
    cost += Number(day?.cost) || 0;
    messages += Number(day?.messages) || 0;
  }
  const anchor = Number(spend.est_anchor?.messages) !== 0
    ? Number(spend.est_anchor.tokens) / Number(spend.est_anchor.messages)
    : null;
  const estTokens = anchor != null ? Math.round(messages * anchor) : 0;
  const hasEstTokens = estTokens !== 0;
  const estTokensText = hasEstTokens ? formatTokens(estTokens) : null;
  const showsEstTokens = hasEstTokens && estTokensText != null;
  const showsToday = Boolean(spend.realtime_today) && Number(spend.messages_today) !== 0;
  const nothingInPeriod = !hasEstTokens;
  const valueSummary = spend.value_summary || null;
  const freeload = valueSummary?.freeloading || null;
  const showsFreeload = Boolean(freeload) && Number(freeload.messages) !== 0;
  // "本机实测" is only true on machines that actually hold a measured window;
  // everyone else runs on the fork-default anchor and must not read that claim.
  const hasLocalAnchor = String(spend.est_anchor?.source || "") === "local-queue";

  return (
    <div>
      <p className={LINE_CLASS}>
        {copy("usage.overview.qoder_cn_period", {
          credits: number(credits, 3),
          cost: number(cost, 2),
          messages: number(messages, 0),
          range: rangeLabel(from, to)
        })}
      </p>
      {showsToday && (
        <p className={LINE_CLASS}>
          {copy("usage.overview.qoder_cn_today", {
            credits: number(spend.credits_today, 3),
            cost: number(spend.cost_today, 2),
            messages: number(spend.messages_today, 0)
          })}
        </p>
      )}
      {nothingInPeriod && (
        <p className={MUTED_LINE_CLASS}>{copy("usage.overview.qoder_cn_none")}</p>
      )}
      <button
        type="button"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
        className="mb-3 inline-flex items-center gap-1 text-[10px] text-oai-gray-500 transition-colors hover:text-oai-gray-700 dark:text-oai-gray-400 dark:hover:text-oai-gray-200"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden
          className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        {copy("usage.overview.qoder_cn_details_toggle")}
      </button>
      {detailsOpen && (
        <div>
          {valueSummary && (
            <p className={MUTED_LINE_CLASS}>
              {copy("usage.overview.qoder_cn_three_values", {
                cash: number(valueSummary.cash_paid_cny, 2),
                official: number(valueSummary.official_cost_cny, 2)
              })}
            </p>
          )}
          {showsFreeload && (
            <p className={MUTED_LINE_CLASS}>
              {copy("usage.overview.qoder_cn_freeloading", {
                low: number(freeload.cny_low, 0),
                high: number(freeload.cny_high, 0),
                msgs: number(freeload.messages, 0)
              })}
            </p>
          )}
          {showsEstTokens && (
            <p className={MUTED_LINE_CLASS}>
              {copy("usage.overview.qoder_cn_est_tokens", {
                tokens: estTokensText,
                ratio: anchor != null ? number(anchor, 0) : "--"
              })}
            </p>
          )}
          <p className={NOTE_CLASS}>
            {copy("usage.overview.qoder_cn_official", {
              credits: number(spend.credits_total, 3),
              cost: number(spend.cost_total, 2),
              messages: number(spend.messages_total, 0),
              since: spend.since ? String(spend.since) : "--"
            })}
          </p>
          <p className={NOTE_CLASS}>
            {copy(hasLocalAnchor ? "usage.overview.qoder_cn_local_stale" : "usage.overview.qoder_cn_model_rows_generic")}
          </p>
          {cn.spend_stale && (
            <p className={NOTE_CLASS}>
              {copy("usage.overview.qoder_cn_spend_snapshot", {
                date: cn.spend_cached_at ? String(cn.spend_cached_at).slice(0, 16).replace("T", " ") : "--"
              })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// WorkBuddy bills in its own credits and keeps the real per-conversation ledger
// in a local SQLite file, so this is measured rather than estimated. Domestic
// (WorkBuddy) and international (WorkBuddy AI) are separate products with
// separate plans, so each gets its own line and its own currency.
export function WorkbuddyCreditSpend({ from, to, edition }) {
  const ledger = useLimitsField("workbuddyCredits");
  if (!ledger || !Array.isArray(ledger.editions) || ledger.editions.length === 0) return null;

  // Each card shows only its own edition once the two are separate sources;
  // an unknown edition (legacy merged rows) still shows the whole ledger.
  const visible = edition
    ? ledger.editions.filter((e) => e && e.id === edition)
    : ledger.editions;
  const rows = visible.map((edition) => {
    let credits = 0;
    for (const day of (Array.isArray(edition?.per_day) ? edition.per_day : [])) {
      if (!inRange(day?.date, from, to)) continue;
      credits += Number(day?.credits) || 0;
    }
    const total = Number(edition?.credits_total) || 0;
    const perCredit = total !== 0 ? (Number(edition?.cost) || 0) / total : 0;
    return {
      name: String(edition?.name || "WorkBuddy"),
      symbol: String(edition?.symbol || ""),
      credits,
      cost: credits * perCredit,
      total,
      since: String(edition?.since || "--")
    };
  });
  const active = rows.filter((row) => {
    return row.credits !== 0;
  });
  const nothingInPeriod = active.length === 0;

  return (
    <div>
      {active.map((row) => (
        <p key={row.name} className={LINE_CLASS}>
          {copy("usage.overview.workbuddy_credits", {
            name: row.name,
            credits: number(row.credits, 2),
            symbol: row.symbol,
            cost: number(row.cost, 2),
            total: number(row.total, 2),
            since: row.since,
            range: rangeLabel(from, to)
          })}
        </p>
      ))}
      {active.length === 0 && <p className={MUTED_LINE_CLASS}>{copy("usage.overview.workbuddy_none")}</p>}
      <p className={NOTE_CLASS}>{copy("usage.overview.workbuddy_note")}</p>
    </div>
  );
}

// Qoder international also records no token counts: its transcripts carry a
// real per-message `credits` value, money converts at the published plan rate,
// and the token rows are back-derived from credits at the reference model's
// list prices. The CN card states its estimation basis explicitly, so the
// international card declares its own ledger basis instead of staying silent
// next to it.
export function QoderIntlCreditsNote() {
  return <p className={NOTE_CLASS}>{copy("usage.overview.qoder_intl_credits_note")}</p>;
}
