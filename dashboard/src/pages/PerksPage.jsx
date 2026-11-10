import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Gift,
  ExternalLink,
  Copy,
  Check,
  Search,
  Sparkles,
  Info,
  ShieldCheck,
  ArrowUpRight,
  SlidersHorizontal,
  Flag,
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { copy, getCopyLocale } from "../lib/copy";
import { cn } from "../lib/cn";
import { showToast } from "../ui/components/Toast.jsx";
import { ProviderIcon, hasProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import { PERK_CATEGORIES, PERK_PROVIDERS } from "../data/perksData.js";
import { PERKS_AIHOT_PROVIDERS } from "../data/perks-aihot-map.js";
import { localizePerk } from "../data/perks-i18n-en.js";
import { comparePerks } from "../data/perks-sort.mjs";
import {
  PERKS_CLAIMS_KEY, PERKS_LEGACY_CLAIMS_KEY, PERKS_V1_CLAIMS_KEY,
  getPerkClaimDay, nextPerkClaimDayDelay,
  getPerkClaimCycles, getPerkClaimDate, getPerkClaimStreak, isPerkClaimed, normalizePerkClaims,
  migrateLegacyPerkClaims, togglePerkClaim,
} from "../lib/perks-claims.mjs";

function readPerksClaims() {
  try {
    const raw = window?.localStorage?.getItem(PERKS_CLAIMS_KEY);
    if (raw != null) {
      const parsed = normalizePerkClaims(JSON.parse(raw), PERK_PROVIDERS);
      // 损坏的 v3 载荷解析为空时仍尝试迁移链，别把旧记录静默清掉。
      if (Object.keys(parsed).length) return parsed;
    }
    // Migration chain: v2 ({cycle: date}) first, then the older v1 ({id: date}).
    for (const legacyKey of [PERKS_LEGACY_CLAIMS_KEY, PERKS_V1_CLAIMS_KEY]) {
      const legacy = window?.localStorage?.getItem(legacyKey);
      if (legacy != null) {
        const migrated = migrateLegacyPerkClaims(JSON.parse(legacy), PERK_PROVIDERS);
        if (Object.keys(migrated).length) return migrated;
      }
    }
    return raw != null ? {} : null;
  } catch {
    return null;
  }
}

function writePerksClaims(claims) {
  try {
    window?.localStorage?.setItem(PERKS_CLAIMS_KEY, JSON.stringify({ schema: 3, providers: claims }));
    return true;
  } catch {
    // 私密模式等存储不可用时静默降级：标记仅本次会话生效
    return false;
  }
}

function fallbackCopy(text) {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "absolute";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

// 「反馈口径变动」一键 Issue：把卡片现口径预填进 GitHub new-issue，让社区用户
// 发现福利变了能一键上报（站主逐张端内实测的维护负担太重，需要社区帮盯）。
// 用裸 new-issue + title/body 预填（不用 YAML 表单模板——表单不吃 URL 预填）。
export function buildPerksFeedbackUrl(item) {
  const title = `[福利口径反馈] ${item.name}（${item.id}）`;
  const body = [
    "## 卡片口径反馈",
    "",
    `- 卡片：${item.name}（id: ${item.id}）`,
    `- 当前徽标：${item.badge || "（无）"}`,
    `- 卡片核对日期：${item.checkedAt || "未标注"}`,
    `- 卡片来源页：${item.sourceUrl || "未标注"}`,
    "",
    "### 你核实到的现行口径",
    "",
    "（请填写你在官方页面或端内看到的现状）",
    "",
    "### 证据",
    "",
    "（请附官方页面链接或端内截图，感谢！）",
  ].join("\n");
  return `https://github.com/01UNCLEDOG01/TokenTracker-Plus/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

// AIHOT 快照 → 卡片角标信号：日期取该卡映射的所有 AIHOT provider 里最新一次
// 核对；「已无在架」要求映射的全部 provider 都从最新快照消失且出现在
// dropped_providers（快照里上一轮还在、这一轮没了）——缺席本身不算下架，
// AIHOT 没覆盖的家不打任何标。
function beijingDate(iso) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return "";
  }
}

function buildAihotSignal(item, aihotIndex) {
  const providers = PERKS_AIHOT_PROVIDERS[item.id];
  if (!providers || !aihotIndex) return null;
  let latest = "";
  for (const provider of providers) {
    const deal = aihotIndex.byProvider.get(provider);
    if (deal && (deal.verified_at || "") > latest) latest = deal.verified_at || "";
  }
  // 下架提示独立于在架日期：全部 provider 上轮在架、本轮消失也要出信号。
  const dropped = providers.every((provider) => !aihotIndex.byProvider.has(provider)) && providers.every((provider) => aihotIndex.dropped.has(provider));
  if (!latest && !dropped) return null;
  return { date: latest ? beijingDate(latest) : "", dropped };
}

function ProviderLogo({ item }) {
  const hasIcon = item.provider ? hasProviderIcon(item.provider) : false;
  const initial = item.name.charAt(0).toUpperCase();

  return (
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-oai-gray-200/80 bg-white p-1 text-base font-semibold shadow-xs transition-transform group-hover:scale-105 dark:border-oai-gray-800 dark:bg-oai-gray-900/90 dark:text-oai-white">
      {hasIcon ? (
        <ProviderIcon provider={item.provider} size={28} className="object-contain" loading="lazy" />
      ) : (
        <span className="font-mono text-sm font-bold text-oai-gray-700 dark:text-oai-gray-300">
          {initial}
        </span>
      )}
    </div>
  );
}

function renderBoldText(text) {
  if (!text || typeof text !== "string") return text;
  // Simpler split by bold markdown
  const segments = text.split(/(\B\*\*[^*]+\*\*\B|\*\*[^*]+\*\*)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
      return (
        <strong key={i} className="font-semibold text-oai-black dark:text-white">
          {seg.slice(2, -2)}
        </strong>
      );
    }
    return seg;
  });
}

function PerkCard({ item, claims, claimDay, onToggleClaim, aihot }) {
  const [copied, setCopied] = useState(false);

  const handleCopyCode = (e) => {
    e.stopPropagation();
    if (!item.inviteCode) return;
    const text = item.inviteCode;
    const onSuccess = () => {
      setCopied(true);
      showToast({
        title: copy("perks.copy.success", { name: item.name, code: text }),
      });
      setTimeout(() => setCopied(false), 2500);
    };
    const onFailure = () => {
      showToast({ title: copy("perks.copy.failed") });
    };

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        if (fallbackCopy(text)) onSuccess();
        else onFailure();
      });
    } else {
      if (fallbackCopy(text)) onSuccess();
      else onFailure();
    }
  };

  const getBadgeStyle = (type) => {
    switch (type) {
      case "success":
        return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30";
      case "amber":
        return "bg-amber-500/10 text-amber-700 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30";
      case "purple":
        return "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30";
      case "blue":
        return "bg-sky-500/10 text-sky-700 border-sky-500/20 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30";
      default:
        return "bg-oai-gray-100 text-oai-gray-700 border-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:border-oai-gray-700";
    }
  };

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-oai-gray-200/90 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-oai-gray-300 hover:shadow-md dark:border-oai-gray-800/90 dark:bg-oai-gray-900/80 dark:hover:border-oai-gray-700 dark:hover:shadow-black/40">
      <div>
        {/* Card Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <ProviderLogo item={item} />
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-oai-black text-base dark:text-white">
                {item.name}
              </h3>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-md bg-oai-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Feature Badge */}
        <div className="mt-3.5">
          <div
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold leading-normal tracking-tight break-words",
              getBadgeStyle(item.badgeType)
            )}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
            <span className="min-w-0 leading-tight">{item.badge}</span>
          </div>
        </div>

        {/* Description */}
        <p className="mt-3 text-xs leading-relaxed text-oai-gray-600 dark:text-oai-gray-300">
          {renderBoldText(item.description)}
        </p>

        {/* Tips Box */}
        {item.tips && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-oai-gray-50/80 p-2.5 text-[11px] leading-relaxed text-oai-gray-500 border border-oai-gray-200/50 dark:bg-oai-gray-950/60 dark:text-oai-gray-300 dark:border-oai-gray-800/60">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden />
            <span className="flex-1">{item.tips}</span>
          </div>
        )}

        {/* Provenance: which date this card was checked and against which page */}
        {item.checkedAt && item.sourceUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
            <span>{copy("perks.card.checked", { date: item.checkedAt })}</span>
            {aihot?.date && (
              <span className="inline-flex items-center rounded-md bg-sky-500/10 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                {copy("perks.aihot.badge", { date: aihot.date })}
              </span>
            )}
            {aihot?.dropped && (
              <span className="inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                {copy("perks.aihot.dropped")}
              </span>
            )}
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 transition hover:text-oai-gray-600 dark:hover:text-oai-gray-300"
            >
              <span>{copy("perks.card.source")}</span>
              <ArrowUpRight className="h-3 w-3" aria-hidden />
            </a>
            <a
              href={buildPerksFeedbackUrl(item)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 transition hover:text-amber-600 dark:hover:text-amber-400"
            >
              <Flag className="h-3 w-3" aria-hidden />
              <span>{copy("perks.card.feedback")}</span>
            </a>
          </div>
        )}
      </div>

      {/* Card Actions */}
      <div className="mt-5 border-t border-oai-gray-100 pt-4 dark:border-oai-gray-800/80">
        {item.hasInvite ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <a
                href={item.inviteUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-800 active:scale-[0.98] dark:bg-emerald-700 dark:hover:bg-emerald-800"
              >
                <Gift className="h-3.5 w-3.5" aria-hidden />
                <span>{copy("perks.action.invite")}</span>
                <ArrowUpRight className="h-3 w-3 opacity-80" aria-hidden />
              </a>

              {item.inviteCode && (
                <button
                  type="button"
                  onClick={handleCopyCode}
                  title={copy("perks.action.copy_code")}
                  aria-label={copy("perks.action.copy_code")}
                  className="flex items-center justify-center rounded-xl border border-oai-gray-200 bg-white px-2.5 py-2 text-xs font-medium text-oai-gray-700 transition hover:bg-oai-gray-50 active:scale-[0.98] dark:border-oai-gray-700 dark:bg-oai-gray-800 dark:text-oai-gray-200 dark:hover:bg-oai-gray-700"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                  ) : (
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                  )}
                </button>
              )}
            </div>

            <a
              href={item.officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-oai-gray-200/90 bg-oai-gray-50/50 py-1.5 text-[11px] font-medium text-oai-gray-600 transition hover:bg-oai-gray-100 hover:text-oai-gray-900 active:scale-[0.98] dark:border-oai-gray-800 dark:bg-oai-gray-950/40 dark:text-oai-gray-300 dark:hover:border-oai-gray-700 dark:hover:bg-oai-gray-800 dark:hover:text-white"
            >
              <span>{item.officialUrlLabel || copy("perks.action.official")}</span>
              <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
            </a>
          </div>
        ) : (
          <div>
            <a
              href={item.officialUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-oai-gray-900/10 bg-oai-gray-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-oai-black active:scale-[0.98] dark:border-white/10 dark:bg-white dark:text-oai-black dark:hover:bg-oai-gray-100 dark:shadow-sm"
            >
              <span>{item.officialUrlLabel || copy("perks.action.official_direct")}</span>
              <ExternalLink className="h-3.5 w-3.5 opacity-80" aria-hidden />
            </a>
          </div>
        )}

        {item.officialUrlAlt ? (
          <a
            href={item.officialUrlAlt}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-oai-gray-200/90 bg-oai-gray-50/50 py-1.5 text-[11px] font-medium text-oai-gray-600 transition hover:bg-oai-gray-100 hover:text-oai-gray-900 active:scale-[0.98] dark:border-oai-gray-800 dark:bg-oai-gray-950/40 dark:text-oai-gray-300 dark:hover:border-oai-gray-700 dark:hover:bg-oai-gray-800 dark:hover:text-white"
          >
            <span>{item.officialUrlAltLabel || copy("perks.action.official_direct")}</span>
            <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
          </a>
        ) : null}

        {getPerkClaimCycles(item).map((cycle) => {
          const claimedAt = getPerkClaimDate(item, claims, cycle, claimDay);
          const labelKey = cycle === "once" ? (claimedAt ? "perks.claim.claimed" : "perks.claim.mark")
            : cycle === "daily" ? (claimedAt ? "perks.claim.daily_claimed" : "perks.claim.daily_mark")
              : (claimedAt ? "perks.claim.monthly_claimed" : "perks.claim.monthly_mark");
          return (
            <button
              key={cycle}
              type="button"
              onClick={() => onToggleClaim(item, cycle)}
              aria-pressed={Boolean(claimedAt)}
              className={cn(
                "mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-[11px] font-medium transition active:scale-[0.98]",
                claimedAt
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "border-oai-gray-200/90 bg-white text-oai-gray-500 hover:bg-oai-gray-50 hover:text-oai-gray-800 dark:border-oai-gray-500 dark:bg-oai-gray-800/60 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200"
              )}
            >
              {claimedAt ? (
                <Check className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
              )}
              <span>{copy(labelKey, { date: claimedAt })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- 卡册（学 AIHOT「越领越亮」，站主 2026-11-11 拍板）---
// 亮度只看累计领取次数（claims v3 的 lifetime count，不回退）：
// 1-6 次=点亮、7-14=银、15-29=金、30+=闪；once 卡领过即恒亮。
export const ALBUM_PAGE_SIZE = 6;

export function albumBrightnessTier(streak) {
  if (!Number.isFinite(streak) || streak <= 0) return 0;
  if (streak >= 30) return 4;
  if (streak >= 15) return 3;
  if (streak >= 7) return 2;
  return 1;
}

// badgeType 等级 → 卡牌描边色（与徽章配色同色系）。
const TIER_BORDER = {
  neutral: "border-oai-gray-300/70 dark:border-oai-gray-600/70",
  success: "border-emerald-400/60 dark:border-emerald-500/50",
  blue: "border-sky-400/60 dark:border-sky-500/50",
  purple: "border-purple-400/60 dark:border-purple-500/50",
  rose: "border-rose-400/60 dark:border-rose-500/50",
  amber: "border-amber-400/70 dark:border-amber-500/60",
};

const BRIGHTNESS_RING = [
  "", // 0 未点亮：靠 opacity 表达
  "", // 1 点亮
  "ring-2 ring-oai-gray-300/70 dark:ring-oai-gray-500/60", // 2 银
  "ring-2 ring-amber-400/80 dark:ring-amber-500/70 shadow-md shadow-amber-500/10", // 3 金
  "ring-2 ring-amber-400 dark:ring-amber-400/90 shadow-lg shadow-amber-400/20 animate-pulse", // 4 闪
];

function AlbumCard({ item, tier, claimedNow, streak, expanded, onToggleExpand }) {
  const hasIcon = item.provider ? hasProviderIcon(item.provider) : false;
  const initial = item.name.charAt(0).toUpperCase();
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggleExpand}
      className={cn(
        "group relative flex h-44 flex-col items-center justify-between overflow-hidden rounded-2xl border-2 bg-white p-3 text-center transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:bg-oai-gray-900/80",
        TIER_BORDER[item.badgeType] || TIER_BORDER.neutral,
        BRIGHTNESS_RING[tier],
        tier === 0 && "opacity-65 grayscale-[35%] dark:opacity-60",
      )}
    >
      {/* 连击角标 */}
      {streak !== 0 && (
        <span className="absolute right-1.5 top-1.5 rounded-md bg-oai-gray-900/80 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white dark:bg-white/85 dark:text-oai-black">
          {streak}
        </span>
      )}
      {claimedNow && (
        <span className="absolute left-1.5 top-1.5 inline-flex items-center rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
          <Check className="h-2.5 w-2.5" aria-hidden />
        </span>
      )}
      <span className="mt-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl border border-oai-gray-200/80 bg-white p-1 dark:border-oai-gray-700 dark:bg-oai-gray-900">
        {hasIcon ? (
          <ProviderIcon provider={item.provider} size={30} className="object-contain" loading="lazy" />
        ) : (
          <span className="font-mono text-sm font-bold text-oai-gray-700 dark:text-oai-gray-300">{initial}</span>
        )}
      </span>
      <span className="line-clamp-2 text-xs font-semibold leading-tight text-oai-black dark:text-white">
        {item.name}
      </span>
      <span className="line-clamp-2 pb-1 text-[10px] leading-tight text-oai-gray-500 dark:text-oai-gray-400">
        {item.badge}
      </span>
    </button>
  );
}

function AlbumView({ items, claims, claimDay, selectedCategory, expandedId, onToggleExpand, onToggleClaim, page, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(items.length / ALBUM_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(safePage * ALBUM_PAGE_SIZE, (safePage + 1) * ALBUM_PAGE_SIZE);
  const expandedItem = items.find(function (entry) { return entry.item.id === expandedId; });
  return (
    <div>
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-oai-gray-200 py-16 text-center dark:border-oai-gray-800">
          <LayoutGrid className="h-8 w-8 text-oai-gray-400" />
          <p className="mt-2 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300">
            {copy("perks.empty.title")}
          </p>
          <p className="text-xs text-oai-gray-400">{copy("perks.empty.desc")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {pageItems.map(({ item, tier, claimedNow, streak }) => (
              <AlbumCard
                key={item.id}
                item={localizePerk(item, getCopyLocale())}
                tier={tier}
                claimedNow={claimedNow}
                streak={streak}
                expanded={item.id === expandedId}
                onToggleExpand={() => onToggleExpand(item.id)}
              />
            ))}
          </div>

          {/* 展开的完整卡片：占满整行，领取按钮照常可用 */}
          {expandedItem && (
            <div className="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              <PerkCard
                item={localizePerk(expandedItem.item, getCopyLocale())}
                claims={claims}
                claimDay={claimDay}
                onToggleClaim={onToggleClaim}
                aihot={expandedItem.aihot}
              />
            </div>
          )}

          {/* 翻页：两排一页，越亮越靠前 */}
          {totalPages !== 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                aria-label={copy("perks.album.prev")}
                disabled={safePage === 0}
                onClick={() => onPageChange(safePage - 1)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                  safePage === 0
                    ? "border-oai-gray-200 text-oai-gray-300 dark:border-oai-gray-700 dark:text-oai-gray-600"
                    : "border-oai-gray-200 text-oai-gray-600 hover:bg-oai-gray-50 dark:border-oai-gray-600 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                <span>{copy("perks.album.prev")}</span>
              </button>
              <span className="text-xs tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                {copy("perks.album.page", { page: safePage + 1, pages: totalPages })}
              </span>
              <button
                type="button"
                aria-label={copy("perks.album.next")}
                disabled={safePage >= totalPages - 1}
                onClick={() => onPageChange(safePage + 1)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
                  safePage >= totalPages - 1
                    ? "border-oai-gray-200 text-oai-gray-300 dark:border-oai-gray-700 dark:text-oai-gray-600"
                    : "border-oai-gray-200 text-oai-gray-600 hover:bg-oai-gray-50 dark:border-oai-gray-600 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                )}
              >
                <span>{copy("perks.album.next")}</span>
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
          <p className="mt-3 text-center text-[11px] text-oai-gray-400 dark:text-oai-gray-500">
            {copy("perks.album.hint")}
          </p>
        </>
      )}
    </div>
  );
}

export function PerksPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const locale = getCopyLocale();
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [claims, setClaims] = useState(() => readPerksClaims() ?? {});
  const [claimDay, setClaimDay] = useState(getPerkClaimDay);
  const unsavedClaims = useRef(null);
  const [claimFilter, setClaimFilter] = useState("all");
  // 卡册视图（学 AIHOT 集卡）：viewMode 切换列表/卡册；albumPage 记翻页位置；
  // expandedId 是卡册里展开完整卡片的卡。
  const [viewMode, setViewMode] = useState("list");
  const [albumPage, setAlbumPage] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  // AIHOT 快照只做后台对时：页面先用静态数据整页渲染，快照回来后才补角标，
  // 任何失败都静默保持原样（信源挂了不影响福利指南本身）。
  const [aihotData, setAihotData] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch("/functions/tokentracker-aihot-free-tokens", { cache: "no-store" })
      .then((res) => (res && res.ok ? res.json() : null))
      .then((data) => {
        if (alive && data && Array.isArray(data.items)) setAihotData(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const aihotIndex = useMemo(() => {
    const byProvider = new Map();
    for (const deal of aihotData?.items || []) {
      const prev = byProvider.get(deal.provider);
      if (!prev || (deal.verified_at || "") > (prev.verified_at || "")) byProvider.set(deal.provider, deal);
    }
    return { byProvider, dropped: new Set(aihotData?.dropped_providers || []) };
  }, [aihotData]);

  useEffect(() => {
    document.title = `${copy("perks.title")} | TokenTracker`;
  }, []);

  useEffect(() => {
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      const now = Date.now();
      setClaimDay(getPerkClaimDay(now));
      const stored = unsavedClaims.current ?? readPerksClaims();
      if (stored != null) setClaims(stored);
      timer = setTimeout(refresh, nextPerkClaimDayDelay(now));
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    const storage = (event) => {
      if (event.key == null || event.key === PERKS_CLAIMS_KEY || event.key === PERKS_LEGACY_CLAIMS_KEY || event.key === PERKS_V1_CLAIMS_KEY) refresh();
    };
    try {
      const hasLegacy = window.localStorage.getItem(PERKS_LEGACY_CLAIMS_KEY) != null
        || window.localStorage.getItem(PERKS_V1_CLAIMS_KEY) != null;
      if (window.localStorage.getItem(PERKS_CLAIMS_KEY) == null && hasLegacy) {
        const migrated = readPerksClaims();
        if (migrated != null) writePerksClaims(migrated);
      }
    } catch { /* unavailable storage keeps the in-memory selection */ }
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const toggleClaim = (item, cycle) => {
    const day = getPerkClaimDay();
    const next = togglePerkClaim(unsavedClaims.current ?? readPerksClaims() ?? claims, item, cycle, day);
    setClaimDay(day);
    setClaims(next);
    unsavedClaims.current = writePerksClaims(next) ? null : next;
  };

  const categoryCounts = useMemo(() => {
    const counts = { all: PERK_PROVIDERS.length };
    for (const cat of PERK_CATEGORIES) {
      if (cat.id === "all") continue;
      counts[cat.id] = PERK_PROVIDERS.filter((item) => item.category?.includes(cat.id)).length;
    }
    return counts;
  }, []);

  const matchedItems = useMemo(() => {
    return PERK_PROVIDERS.filter((item) => {
      // Category Filter
      if (selectedCategory !== "all") {
        if (!item.category.includes(selectedCategory)) {
          return false;
        }
      }
      // Search Query — match both the Chinese source and the English overlay
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const shown = localizePerk(item, locale);
        const zhHay = `${item.name} ${item.description} ${item.badge} ${item.tags.join(" ")}`.toLowerCase();
        const enHay = shown === item ? "" : `${shown.name} ${shown.description} ${shown.badge} ${shown.tags.join(" ")}`.toLowerCase();
        return zhHay.includes(query) || enHay.includes(query);
      }
      return true;
    });
  }, [locale, searchQuery, selectedCategory]);

  const claimedCount = matchedItems.filter((item) => isPerkClaimed(item, claims, claimDay, selectedCategory)).length;
  const filteredItems = matchedItems.filter((item) => {
    const claimed = isPerkClaimed(item, claims, claimDay, selectedCategory);
    return claimFilter === "all" || (claimFilter === "claimed" ? claimed : !claimed);
  });

  // 卡册排序：今日已领 > 累计亮度档 > A-Z 稳定序（AIHOT「越亮的越靠前」）。
  const albumItems = useMemo(() => {
    const ranked = filteredItems.map((item) => {
      const streak = Math.max(...getPerkClaimCycles(item).map((cycle) => getPerkClaimStreak(item, claims, cycle)), 0);
      const claimedNow = isPerkClaimed(item, claims, claimDay, selectedCategory);
      return {
        item,
        streak,
        claimedNow,
        tier: albumBrightnessTier(streak),
        aihot: buildAihotSignal(item, aihotIndex),
      };
    });
    ranked.sort((a, b) =>
      (a.claimedNow === b.claimedNow ? 0 : a.claimedNow ? -1 : 1)
      || b.tier - a.tier
      || comparePerks(a.item, b.item),
    );
    return ranked;
  }, [filteredItems, claims, claimDay, selectedCategory, aihotIndex]);

  // 卡册翻页随筛选结果收缩回合法范围，避免「清除筛选后跳回旧页码」。
  useEffect(() => {
    setAlbumPage((current) => {
      const maxPage = Math.max(0, Math.ceil(albumItems.length / ALBUM_PAGE_SIZE) - 1);
      return current > maxPage ? maxPage : current;
    });
  }, [albumItems.length]);

  return (
    <div className="tt-perks-page flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-16 pt-8 sm:pb-20 sm:pt-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          {/* Header Banner */}
          <div className="mb-8 flex flex-col justify-between gap-4 border-b border-oai-gray-200/80 pb-6 sm:flex-row sm:items-end dark:border-oai-gray-800">
            <div>
              <div className="flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                  <Gift className="h-4 w-4" aria-hidden />
                </span>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {copy("perks.title")}
                </h1>
              </div>
              <p className="mt-1.5 max-w-2xl text-sm text-oai-gray-500 dark:text-oai-gray-300">
                {copy("perks.subtitle")}
              </p>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-oai-gray-400 dark:text-oai-gray-500">
                {copy("perks.credit_aihot")}
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-300">
              <span className="inline-flex items-center gap-1 rounded-md bg-oai-gray-100 px-2 py-1 font-medium text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                <span>{copy("perks.count", { count: PERK_PROVIDERS.length })}</span>
              </span>
            </div>
          </div>

          {/* Top Disclaimer / Notice Banner */}
          <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-900/90 dark:border-amber-400/20 dark:bg-amber-400/5 dark:text-amber-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <p className="flex-1">
              {copy("perks.disclaimer")}
            </p>
          </div>

          {/* Invite / Official-link transparency notice — kept at the top so
              it is actually read (owner call 2026-11-01: a footer notice
              scrolls out of sight). */}
          <div className="mb-6 rounded-2xl border border-oai-gray-200/70 bg-oai-gray-50/60 p-5 text-xs text-oai-gray-500 dark:border-oai-gray-800/60 dark:bg-oai-gray-950/40 dark:text-oai-gray-300">
            <h4 className="font-semibold text-oai-black dark:text-white">
              {copy("perks.notice.title")}
            </h4>
            <p className="mt-1 leading-relaxed">
              {copy("perks.notice.desc")}
            </p>
          </div>

          {/* Filters & Search Toolbar */}
          <div className="mb-6 space-y-2.5">
            {/* Top Row: Core Platform Categories */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PERK_CATEGORIES.slice(0, 4).map((cat) => {
                const active = selectedCategory === cat.id;
                const label = copy(`perks.cat.${cat.id}`) || cat.label;
                const count = categoryCounts[cat.id] ?? 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                        : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    )}
                  >
                    <span>{label}</span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active ? "opacity-75" : "text-oai-gray-600 dark:text-oai-gray-300"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Bottom Row: Benefit Form Categories (left) + Claim-state filter & Search Input aligned together (right) */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-1.5">
                {PERK_CATEGORIES.slice(4).map((cat) => {
                  const active = selectedCategory === cat.id;
                  const label = copy(`perks.cat.${cat.id}`) || cat.label;
                  const count = categoryCounts[cat.id] ?? 0;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                        active
                          ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                          : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                      )}
                    >
                      <span>{label}</span>
                      <span
                        className={cn(
                          "text-[10px] tabular-nums",
                          active ? "opacity-75" : "text-oai-gray-600 dark:text-oai-gray-300"
                        )}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Claim-state filter + Search Input in the same row */}
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: "all", label: copy("perks.filter.all") },
                    { id: "claimed", label: copy("perks.filter.claimed") },
                    { id: "unclaimed", label: copy("perks.filter.unclaimed") },
                  ].map((opt) => {
                    const active = claimFilter === opt.id;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setClaimFilter(opt.id)}
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          active
                            ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                            : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                        }`}
                      >
                        <span>{opt.label}</span>
                        <span className="text-[10px] tabular-nums opacity-90">
                          {opt.id === "all"
                            ? matchedItems.length
                            : opt.id === "claimed"
                              ? claimedCount
                              : matchedItems.length - claimedCount}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Search Input + 视图切换 */}
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
                  <div className="relative w-full sm:w-60">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oai-gray-400"
                      aria-hidden
                    />
                    <input
                      type="text"
                      aria-label={copy("perks.search_placeholder")}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={copy("perks.search_placeholder")}
                      className="h-9 w-full rounded-xl border border-oai-gray-200 bg-white pl-8 pr-3 text-xs text-oai-black placeholder-oai-gray-400 transition focus:border-emerald-500 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 dark:border-oai-gray-500 dark:bg-oai-gray-900 dark:text-white dark:placeholder-oai-gray-300"
                    />
                  </div>
                  <div className="flex items-center gap-1 rounded-xl border border-oai-gray-200 bg-white p-0.5 dark:border-oai-gray-600 dark:bg-oai-gray-900">
                    {[
                      { id: "list", label: copy("perks.view.list"), icon: List },
                      { id: "album", label: copy("perks.view.album"), icon: LayoutGrid },
                    ].map((opt) => {
                      const active = viewMode === opt.id;
                      const Icon = opt.icon;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setViewMode(opt.id)}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                            active
                              ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                              : "text-oai-gray-500 hover:text-oai-gray-800 dark:text-oai-gray-400 dark:hover:text-oai-gray-200",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden />
                          <span>{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Provider Cards: 列表视图 / 卡册视图（学 AIHOT 集卡，站主 2026-11-11）。
              三块 && 条件渲染而非三元链：ui-hardcode 扫描器会把顶层比较符与自闭合
              标签间的代码误报成 JSX 文本（仓库已知坑），条件用 === / !== 避开 > */}
          {viewMode === "album" && (
            <AlbumView
              items={albumItems}
              claims={claims}
              claimDay={claimDay}
              selectedCategory={selectedCategory}
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId((current) => (current === id ? null : id))}
              onToggleClaim={toggleClaim}
              page={albumPage}
              onPageChange={(nextPage) => {
                setExpandedId(null); // 翻页后展开卡不在本页，收起避免悬空
                setAlbumPage(nextPage);
              }}
            />
          )}
          {viewMode !== "album" && filteredItems.length === 0 && (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-oai-gray-200 py-16 text-center dark:border-oai-gray-800">
              <SlidersHorizontal className="h-8 w-8 text-oai-gray-400" />
              <p className="mt-2 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("perks.empty.title")}
              </p>
              <p className="text-xs text-oai-gray-400">
                {copy("perks.empty.desc")}
              </p>
            </div>
          )}
          {viewMode !== "album" && filteredItems.length !== 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <PerkCard
                  key={item.id}
                  item={localizePerk(item, locale)}
                  claims={claims}
                  claimDay={claimDay}
                  onToggleClaim={toggleClaim}
                  aihot={buildAihotSignal(item, aihotIndex)}
                />
              ))}
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

export default PerksPage;
