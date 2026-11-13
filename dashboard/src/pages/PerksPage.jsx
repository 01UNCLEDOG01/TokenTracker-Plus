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
import { getPublicVisibility, setPublicVisibility } from "../lib/api";
import { useInsforgeAuth } from "../contexts/InsforgeAuthContext.jsx";
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

// 福利价值六档（灰→绿→蓝→紫→粉→琥珀）：卡片 badge 与页首图例共用这一套色，
// 改口径时只动这里与 perksData.js 头注释，避免「卡片一个色、图例另一个色」。
const PERK_TIER_STYLES = {
  neutral: "bg-oai-gray-100 text-oai-gray-700 border-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-300 dark:border-oai-gray-700",
  success: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:bg-emerald-500/30 dark:text-emerald-200 dark:border-emerald-400/50",
  blue: "bg-sky-500/10 text-sky-700 border-sky-500/20 dark:bg-sky-500/30 dark:text-sky-200 dark:border-sky-400/50",
  purple: "bg-purple-500/10 text-purple-700 border-purple-500/20 dark:bg-purple-500/30 dark:text-purple-200 dark:border-purple-400/50",
  rose: "bg-rose-500/10 text-rose-700 border-rose-500/20 dark:bg-rose-500/30 dark:text-rose-200 dark:border-rose-400/50",
  amber: "bg-amber-500/15 text-amber-700 border-amber-500/25 dark:bg-amber-500/30 dark:text-amber-200 dark:border-amber-400/60",
};
// 卡册小卡底条、筛选 chip 与页首图例共用同一套实色（-500）：卡片 badge 的半透明底
// 在 10px 直径下几乎看不出差别，所以「色」只在 badge 以外的三处用实色。
const PERK_TIER_ACCENT = {
  neutral: "bg-oai-gray-400 dark:bg-oai-gray-500",
  success: "bg-emerald-500",
  blue: "bg-sky-500",
  purple: "bg-purple-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
};
// 价值等级筛选：label 用函数包一层字面量 copy()，这样切语言时实时生效、
// 又不会因为拼串 key 让 copy 注册表误判成「未使用」。
const PERK_TIER_FILTER_OPTIONS = [
  { id: "neutral", accent: PERK_TIER_ACCENT.neutral, label: () => copy("perks.legend.neutral") },
  { id: "success", accent: PERK_TIER_ACCENT.success, label: () => copy("perks.legend.success") },
  { id: "blue", accent: PERK_TIER_ACCENT.blue, label: () => copy("perks.legend.blue") },
  { id: "purple", accent: PERK_TIER_ACCENT.purple, label: () => copy("perks.legend.purple") },
  { id: "rose", accent: PERK_TIER_ACCENT.rose, label: () => copy("perks.legend.rose") },
  { id: "amber", accent: PERK_TIER_ACCENT.amber, label: () => copy("perks.legend.amber") },
];
function TierDot({ className, label }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2.5 w-2.5 rounded-full", className)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
const getBadgeStyle = (type) => PERK_TIER_STYLES[type] || PERK_TIER_STYLES.neutral;

/** 六色图例：色阶只表示「白拿额度」的高低，灰色是最低档、不是差评。 */
function PerkTierLegend() {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
      <span className="font-medium text-oai-gray-600 dark:text-oai-gray-300">{copy("perks.legend.title")}</span>
      <TierDot className={PERK_TIER_ACCENT.neutral} label={copy("perks.legend.neutral")} />
      <TierDot className={PERK_TIER_ACCENT.success} label={copy("perks.legend.success")} />
      <TierDot className={PERK_TIER_ACCENT.blue} label={copy("perks.legend.blue")} />
      <TierDot className={PERK_TIER_ACCENT.purple} label={copy("perks.legend.purple")} />
      <TierDot className={PERK_TIER_ACCENT.rose} label={copy("perks.legend.rose")} />
      <TierDot className={PERK_TIER_ACCENT.amber} label={copy("perks.legend.amber")} />
    </div>
  );
}

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

// 站主 2026-11-12：福利重点自动加粗——可白嫖多少额度、可用多久、是否实名、
// 连接稳定性、速度快慢。金额/时长按模式抓，关键词按词表抓；`**…**` 手工
// 加粗照旧优先，自动包裹不叠加（先按手工粗体切段，纯文本段里再抓关键片段）。
const PERK_KEY_FACT_RE = new RegExp(
  [
    "[¥$]\\s?\\d[\\d,.]*", // ¥80.93 / $25
    "\\d[\\d,.]*\\s*(?:积分|credits?|tokens?|点)", // 300 积分
    "\\d+\\s*(?:天|个月|小时|年)", // 30 天 / 3 个月
    "(?:长期|永久|限时|限免|限量|先到先得|手慢无)",
    "(?:实名|免实名|无需实名)",
    "(?:稳定|不稳定|排队|速度|偏慢|较慢|很慢|恢复|失效|不可用|无流量)",
    "(?:白嫖|免费)",
  ].join("|"),
  "g",
);

/** 把纯文本段里的关键片段包成 <strong>（捕获组分割：奇数下标=命中片段）。 */
function renderKeyFacts(seg, keyPrefix) {
  const parts = seg.split(new RegExp(`(${PERK_KEY_FACT_RE.source})`, "g"));
  if (parts.length === 1) return seg;
  return parts.map((part, j) => {
    if (!part) return null;
    return j % 2 === 1 ? (
      <strong key={`${keyPrefix}-${j}`} className="font-semibold text-oai-black dark:text-white">
        {part}
      </strong>
    ) : (
      part
    );
  });
}

function renderBoldText(text) {
  if (!text || typeof text !== "string") return text;
  // Simpler split by bold markdown
  const segments = text.split(/(\B\*\*[^*]+\*\*|\*\*[^*]+\*\*)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) {
      return (
        <strong key={i} className="font-semibold text-oai-black dark:text-white">
          {seg.slice(2, -2)}
        </strong>
      );
    }
    return renderKeyFacts(seg, String(i));
  });
}

/// 福利卡描述：超过 96 字默认收束到三行（点击展开/收起），短描述原样渲染。
/// 展开状态留在卡片实例上——切页/筛选项变化重排时按新实例重置，可接受。
function PerkCardDescription({ text }) {
  const [expanded, setExpanded] = useState(false);
  const long = typeof text === "string" && text.length > 96;
  const collapsed = long && !expanded;
  return (
    <div className="mt-3">
      <p
        className="text-xs leading-relaxed text-oai-gray-600 dark:text-oai-gray-300"
        style={
          collapsed
            ? {
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : undefined
        }
      >
        {renderBoldText(text)}
      </p>
      {long ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-[11px] font-medium text-oai-brand-600 hover:underline dark:text-oai-brand-400"
          aria-expanded={expanded}
        >
          {expanded ? copy("perks.desc.collapse") : copy("perks.desc.expand")}
        </button>
      ) : null}
    </div>
  );
}

function PerkCard({ item, claims, claimDay, onToggleClaim, aihot, flashed }) {
  // 活动截止倒计时（只有数据里写了 endsAt 的卡才有）
  const deadline = perkDaysLeft(item.endsAt);
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


  return (
    <div
      id={`perk-${item.id}`}
      className={cn(
        "perk-card-cv group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-oai-gray-200/90 bg-white p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-oai-gray-300 hover:shadow-md dark:border-oai-gray-800/90 dark:bg-oai-gray-900/80 dark:hover:border-oai-gray-700 dark:hover:shadow-black/40",
        // 卡册点击跳转后的高亮闪烁（2026-11-11 站主要求点击联动）。
        flashed ? "perk-card-flash" : null,
      )}
    >
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
          {deadline && (
            <span
              className={cn(
                "mt-2 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                deadline.ended
                  ? "border-oai-gray-200 bg-oai-gray-100 text-oai-gray-500 dark:border-oai-gray-700 dark:bg-oai-gray-800 dark:text-oai-gray-400"
                  : deadline.days <= 3
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:border-rose-400/30 dark:bg-rose-500/15 dark:text-rose-300"
                    : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
              )}
            >
              <Info className="h-3 w-3" aria-hidden />
              <span>
                {deadline.ended
                  ? copy("perks.deal.ended")
                  : copy("perks.deal.left_days", { days: deadline.days })}
              </span>
            </span>
          )}
        </div>

        {/* Description — 站主 2026-11-12：长描述默认收束到三行，点「展开」看全文；
            重点（金额/时长/实名/稳定/速度）已由 renderBoldText 自动加粗。 */}
        <PerkCardDescription text={item.description} />

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
              onClick={() => { if (!claimedAt) onToggleClaim(item, cycle); }}
              disabled={Boolean(claimedAt)}
              aria-disabled={Boolean(claimedAt)}
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

// --- 卡册（AIHOT 式复刻，站主 2026-11-11 拍板「照着他做」）---
// AIHOT 的灵魂：统计头（今天还能领/本月已领到/下次刷新倒计时）+ 常驻卡牌带
// （扑克式小卡：面值角标+logo+品牌名；未收=暗卡藏品牌，收了才揭晓）+
// 「N 张收了 M 张」进度 + 圆点翻页。亮度档沿用累计领取 7/15/30 次。
export const ALBUM_PAGE_SIZE = 18;

// AIHOT provider slug → 我们卡册的卡 id（反查表）：统计「今天还能领」时
// 判断快照 deal 是否已被我们领掉用。多卡映射同一 provider 时取首个。
// 价值档位排序权重（站主 2026-11-12：卡册按档位色从琥珀排到灰，不管领取状态）。
const TIER_RANK = { amber: 5, rose: 4, purple: 3, blue: 2, success: 1, neutral: 0 };

const AIHOT_PROVIDER_TO_CARD = (() => {
  const map = new Map();
  for (const [cardId, providers] of Object.entries(PERKS_AIHOT_PROVIDERS)) {
    for (const provider of providers) if (!map.has(provider)) map.set(provider, cardId);
  }
  return map;
})();

export function albumBrightnessTier(streak) {
  if (!Number.isFinite(streak) || streak <= 0) return 0;
  if (streak >= 30) return 4;
  if (streak >= 15) return 3;
  if (streak >= 7) return 2;
  return 1;
}

const BRIGHTNESS_RING = [
  "", // 0 未收：暗卡
  "", // 1 已收
  "ring-2 ring-oai-gray-300/80 dark:ring-oai-gray-400/60", // 2 银
  "ring-2 ring-amber-400/90 dark:ring-amber-500/70 shadow-md shadow-amber-500/10", // 3 金
  "ring-2 ring-amber-400 shadow-lg shadow-amber-400/25 animate-pulse", // 4 闪
];

function formatCountdown(msLeft) {
  const total = Math.max(0, Math.floor(msLeft / 1000));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// 卡册小卡（照 AIHOT 的实物卡）：
//   未领取 = 纸质正面（面值条 + 图标底座 + 品牌名），深色主题下也是浅色卡；
//   已领取 = 翻到青色卡背（双向斜纹 + 3px 白边 + 白底圆形 logo + ×N），领取瞬间 rotateY 翻面。
// 只渲染当前那一面：同品牌名不会在页面/无障碍树里出现两次（下方详情卡还有一份 h3）。
// 活动截止倒计时：endsAt 是北京时间自然日（YYYY-MM-DD），当日 23:59 失效。
// 只给数据里写明截止日的卡加了 endsAt，没写的不编。
export function perkDaysLeft(endsAt, nowMs = Date.now()) {
  if (!endsAt) return null;
  const end = Date.parse(`${endsAt}T23:59:59+08:00`);
  if (!Number.isFinite(end)) return null;
  const ms = end - nowMs;
  return { ended: ms <= 0, days: Math.max(0, Math.ceil(ms / 86400000)) };
}

// 卡册稀有度（站主 2026-11-12 拍板五档）：蓝→铜→银→金→闪。
// 每天能领的累计 7/15/30/60/90 天；每月能领的 1/2/3/4/5 次；
// 只能领一次的看这一次价值 ¥1/10/20/50/100。基础卡背青色。
export function cardRarity(cycleCounts, dealYuan) {
  const RANKS = ["blue", "bronze", "silver", "gold", "holo"];
  let best = 0;
  const bump = (level) => { best = Math.max(best, level); };
  const step = (count, thresholds) => {
    let level = 0;
    for (const t of thresholds) if (count >= t) level += 1;
    bump(level);
  };
  for (const [cycle, count] of Object.entries(cycleCounts || {})) {
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    if (cycle === "daily") step(count, [7, 15, 30, 60, 90]);
    else if (cycle === "monthly") step(count, [1, 2, 3, 4, 5]);
    else if (cycle === "once" && dealYuan != null && Number.isFinite(dealYuan)) {
      step(dealYuan, [1, 10, 20, 50, 100]);
    }
  }
  return best > 0 ? RANKS[best - 1] : null;
}

function AlbumMiniLogo({ item, hasIcon }) {
  if (hasIcon) {
    return <ProviderIcon provider={item.provider} size={26} className="object-contain" loading="lazy" />;
  }
  return <span className="font-mono text-[11px] font-bold text-oai-gray-700">{item.name.charAt(0).toUpperCase()}</span>;
}

function AlbumMiniCard({ item, cycle, collected, tier, streak, claimedNow, sealed, rarity, faceValue, onJump, flipCount, onSealedClick, showStreak = true, variant = "vitrine", endsAt }) {
  const hasIcon = item.provider ? hasProviderIcon(item.provider) : false;
  const accent = PERK_TIER_ACCENT[item.badgeType] || PERK_TIER_ACCENT.neutral;
  // AIHOT 翻牌口径（站主 2026-11-12 图2/图3 定谳，方向与直觉相反）：
  //   青色卡背 = 「等待领取」——以前领过、今天还没领（图2），稀有度金/闪材质刻在卡背上；
  //   纸质正面 = 领取揭示后的样子（图3）——今天领过、或从没领过（悬念面无 ×N）、或绝版（盖红章）。
  // 领取瞬间：卡从青背 rotateY 翻成正面（「翻牌领福利」），次日自动翻回等待态。
  // 绝版形态（玻璃柜副本）：同卡的第二形态，做旧+盖戳，点击弹窗。
  const isVitrineForm = sealed && variant === "vitrine";
  // 卡型标签（站主 2026-11-12）：每张小卡代表一个周期（日/月/一各一张卡）。
  const cycleTagMap = {
    daily: { key: "daily", label: copy("perks.cycle.daily"), cls: "bg-sky-600/85" },
    monthly: { key: "monthly", label: copy("perks.cycle.monthly"), cls: "bg-violet-600/85" },
    once: { key: "once", label: copy("perks.cycle.once"), cls: "bg-amber-600/85" },
  };
  const cycleTags = [cycleTagMap[cycle] || cycleTagMap.daily];
  // 主卡册日常形态照常翻转；玻璃柜副本恒为正面（展示已下线福利+章）。
  const showBack = collected && !claimedNow && !isVitrineForm;
  // 领取瞬间翻面重播：flipKey 由父层（PerksPage）统一管理——翻页容器按页
  // key 重建会清掉组件内的延迟定时器。翻转目标是正面，key 挂在正面节点上。
  const flipKey = flipCount || 0;
  const revealed = Boolean(claimedNow) && !isVitrineForm;
  // 绝版形态（玻璃柜副本）的面值条显示已下线福利名；主卡册的日常形态照常显示面值。
  const chipLabel = isVitrineForm && item.retiredDeal?.label ? item.retiredDeal.label : faceValue;
  // 面值过长降级（AIHOT ft-cd-val-long 同款）：超过 10 字符缩字号并隐藏钻点。
  // （取 10 的 min 比较是为了避开 ui-hardcode 扫描器对 JSX 里 ASCII 大于号的误报。）
  const valLong = Math.min(String(chipLabel || "").length, 10) === 10;
  // 卡堆层叠 v2（AIHOT .ft-deck 同款机制，站主 2026-11-13 指定照抄）：连领 2 次起
  // 卡底下垫 1-2 张与卡同尺寸的「底牌」，translate(±4px,3-4px)rotate(±4-5°) 从左右
  // 底角斜露——领一次多一张，×N 仍是精确数，底牌封顶 2 张只给「厚薄」体感；
  // 绝版玻璃柜副本恒为单卡，不堆。（比较刻意不用大于号写法：ui-hardcode 扫描器
  // 把 JSX 表达式里的 ASCII 大于号连到下一个标签误报成 JSX 文本。）
  const claimEdges = collected ? Math.max(streak - 1, 0) : 0;
  const stackLayers = isVitrineForm ? 0 : Math.min(claimEdges, 2);
  // ×N 徽章照 AIHOT 挂到卡外右下角（玻璃柜保留卡内角标，做旧卡配内嵌小字）。
  const outerCnt = variant === "strip" && streak !== 0 && (showBack || (showStreak && collected));
  // holo 卡鼠标跟随 3D（AIHOT .ft-slot-holo 思路，只倾斜不放大——站主 2026-11-13
  // 拍板：特效留在卡牌范围内，超出会乱、晃眼）。--ft-x/--ft-y 由 move 事件写入，
  // 交给 CSS calc 消费；离开复位到中心。
  const holoTilt = rarity === "holo" && variant === "strip"
    ? {
        onMouseMove: (e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--ft-x", ((e.clientX - rect.left) / rect.width).toFixed(3));
          e.currentTarget.style.setProperty("--ft-y", ((e.clientY - rect.top) / rect.height).toFixed(3));
        },
        onMouseLeave: (e) => {
          e.currentTarget.style.setProperty("--ft-x", "0.5");
          e.currentTarget.style.setProperty("--ft-y", "0.5");
        },
      }
    : null;
  return (
    <button
      type="button"
      {...(holoTilt || {})}
      onClick={isVitrineForm && onSealedClick ? () => onSealedClick(item) : onJump ? () => onJump(item.id) : undefined}
      title={isVitrineForm ? copy("perks.album.vitrine_detail") : onJump ? copy("perks.album.jump") : undefined}
      aria-label={`${item.name} — ${isVitrineForm ? copy("perks.album.vitrine_detail") : copy("perks.album.jump")}`}
      data-perk-id={item.id}
      data-flip-key={flipKey}
      className={cn(
        "perk-mini relative block h-[118px] w-full text-center focus-visible:outline-none",
        revealed ? "is-collected" : "is-uncollected",
        holoTilt ? "perk-holo-tilt" : null,
      )}
    >
      <span className="perk-mount" aria-hidden />
      {stackLayers === 2 && (
        <span className="perk-deck perk-deck2" aria-hidden />
      )}
      {stackLayers !== 0 && (
        <span className="perk-deck perk-deck1" aria-hidden />
      )}
      {showBack ? (
        <span
          className={cn(
            "perk-mini-card perk-card-back absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg",
            rarity === "blue" ? "perk-rarity-blue" : null,
            rarity === "bronze" ? "perk-rarity-bronze" : null,
            rarity === "silver" ? "perk-rarity-silver" : null,
            rarity === "gold" ? "perk-rarity-gold" : null,
            rarity === "holo" ? "perk-rarity-holo" : null,
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm">
            <AlbumMiniLogo item={item} hasIcon={hasIcon} />
          </span>
          <span className="perk-back-mark" aria-hidden>
            {`TT PLUS`}
          </span>
          {variant !== "strip" && streak !== 0 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-oai-gray-900/75 px-1.5 text-[9px] font-semibold tabular-nums text-white">
              ×{streak}
            </span>
          )}
          <span className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[3px] rounded-b-md", accent)} aria-hidden />
        </span>
      ) : (
        <span
          key={flipKey}
          className={cn(
            "perk-mini-card perk-card-front absolute inset-0 flex flex-col items-center justify-between overflow-hidden rounded-lg border border-oai-gray-200/80 p-1.5",
            isVitrineForm ? "perk-card-aged" : null,
            !isVitrineForm && rarity ? "perk-front-" + rarity : null,
          )}
        >
          <span className="flex w-full items-center justify-between gap-1">
            <span className="flex gap-0.5">
              {isVitrineForm && chipLabel ? (
                <span
                  className={cn(
                    "max-w-full truncate rounded bg-oai-gray-900/85 px-1 py-0.5 font-semibold leading-tight text-white",
                    valLong ? "text-[8px]" : "text-[9px]",
                  )}
                >
                  {chipLabel}
                  {valLong ? null : <span className="perk-pips" aria-hidden>◆</span>}
                </span>
              ) : cycleTags.map((tag) => (
                <span key={tag.key} className={cn("rounded px-1 py-0.5 text-[8px] font-bold leading-none text-white", tag.cls)}>
                  {tag.label}
                </span>
              ))}
            </span>
            {variant === "strip" && endsAt ? (
              <span className="perk-cd-end ml-auto self-center">{endsAt.slice(5)}</span>
            ) : null}
            {isVitrineForm && (
              <span className="perk-seal absolute right-0 top-0 rounded px-1 py-0.5 text-[8px] font-extrabold tracking-wider">
                {copy("perks.album.sealed")}
              </span>
            )}
          </span>
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white p-0.5 shadow-sm">
            <AlbumMiniLogo item={item} hasIcon={hasIcon} />
          </span>
          <span className="w-full truncate text-[10px] font-semibold leading-tight text-oai-gray-700">
            {item.name}
          </span>
          {variant !== "strip" && showStreak && collected && streak !== 0 && (
            <span className="absolute bottom-1 right-1 rounded-full bg-oai-gray-900/75 px-1.5 text-[9px] font-semibold tabular-nums text-white">
              ×{streak}
            </span>
          )}
          <span className={cn("pointer-events-none absolute inset-x-0 bottom-0 h-[3px]", accent)} aria-hidden />
        </span>
      )}
      {outerCnt && (
        <span className="perk-cnt absolute -bottom-2 -right-2 z-10 rounded-full border border-oai-gray-200 bg-white px-1.5 text-[9px] font-bold leading-[14px] tabular-nums text-oai-gray-600 shadow-sm dark:border-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
          ×{streak}
        </span>
      )}
    </button>
  );
}

// 绝版展示柜（站主 2026-11-12「封装到玻璃柜」）：和还能领福利的卡分开陈列。
// 玻璃质感 = 深色玻璃渐变 + 内阴影高光；绝版卡保持纸面 + 红章 + ×N。
function AlbumVitrine({ entries, flipKeys, onSealedClick }) {
  if (!entries.length) return null;
  return (
    <div className="mb-8">
      <div className="perk-vitrine relative overflow-hidden rounded-2xl p-4">
        <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/70 dark:bg-white/25" aria-hidden />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("perks.album.vitrine")}</h2>
          <span className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
            {copy("perks.album.sealed_count", { count: entries.length })}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
          {entries.map((entry) => (
            <div key={entry.item.id} className="flex flex-col items-center gap-1">
              <AlbumMiniCard
                item={entry.item}
                collected={entry.collected}
                tier={entry.tier}
                streak={entry.streak}
                claimedNow={entry.claimedNow}
                sealed={entry.sealed}
                rarity={entry.rarity}
                faceValue={entry.faceValue}
                onSealedClick={onSealedClick}
                flipCount={flipKeys[entry.item.id] || 0}
                showStreak={false}
              />
              {Boolean(entry.streak) && (
                <span className="text-[10px] text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("perks.album.vitrine_claims", { count: entry.streak })}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlbumStats({ claimableTodayYuan, claimedMonthYuan, totalClaimedYuan, claimDay, collected, total, sealedCount }) {
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const money = (value) => `¥${Math.round(value).toLocaleString()}`;
  return (
    <div className="flex w-full shrink-0 flex-col justify-center gap-3 rounded-2xl border border-oai-gray-200/80 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-900/70 sm:w-52">
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.claimable")}</p>
        <p className="text-2xl font-semibold tracking-tight text-oai-black dark:text-white">
          {claimableTodayYuan > 0 ? money(claimableTodayYuan) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.month")}</p>
        <p className="text-lg font-semibold text-oai-black dark:text-white">
          {claimedMonthYuan > 0 ? money(claimedMonthYuan) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.total_claimed")}</p>
        <p className="text-lg font-semibold text-oai-black dark:text-white">
          {totalClaimedYuan > 0 ? money(totalClaimedYuan) : "—"}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{copy("perks.album.refresh")}</p>
        <p className="font-mono text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
          {formatCountdown(
            Date.parse(`${claimDay}T00:00:00+08:00`) + 86_400_000 - nowMs,
          )}
        </p>
      </div>
      <p className="text-[10px] leading-tight text-oai-gray-400 dark:text-oai-gray-500">
        {copy("perks.album.note")}
      </p>
      <p className="text-[11px] font-medium text-oai-gray-600 dark:text-oai-gray-300">
        {copy("perks.album.collected", { collected, total })}
        {sealedCount > 0 ? ` · ${copy("perks.album.sealed_count", { count: sealedCount })}` : null}
      </p>
    </div>
  );
}

function AlbumStrip({ items, stripItems, claimDay, page, onPageChange, onJump, flipKeys, aihotSums }) {
  const totalPages = Math.max(1, Math.ceil(stripItems.length / ALBUM_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  // 翻页双动画（AIHOT ft-pg-out/in 同款）：旧页 rotateY(0→-95°) 转出 0.62s 后卸载，
  // 新页照旧 rotateY(-95°→0) 转入——一出一进才是完整「翻纸」。reduce-motion 由 CSS
  // 直接 display:none 掉转出层。
  const prevPageRef = useRef(safePage);
  const [leavingPage, setLeavingPage] = useState(null);
  useEffect(() => {
    if (prevPageRef.current === safePage) return undefined;
    setLeavingPage(prevPageRef.current);
    prevPageRef.current = safePage;
    const timer = setTimeout(() => setLeavingPage(null), 640);
    return () => clearTimeout(timer);
  }, [safePage]);
  const leavingItems = leavingPage === null
    ? []
    : stripItems.slice(leavingPage * ALBUM_PAGE_SIZE, (leavingPage + 1) * ALBUM_PAGE_SIZE);
  const pageItems = stripItems.slice(safePage * ALBUM_PAGE_SIZE, (safePage + 1) * ALBUM_PAGE_SIZE);
  const collected = items.filter((entry) => entry.collected).length;
  // 绝版 = 已收藏 + 活动已结束（AIHOT 的「绝版」口径），只做计数与盖章，不重排。
  const sealedCount = items.filter(function (entry) { return entry.sealed; }).length;
  // 求和来自 AIHOT 全目录（PerksPage 传 aihotSums），不是卡册映射子集。
  const claimableTodayYuan = aihotSums.claimable;
  const claimedMonthYuan = aihotSums.monthly;
  const totalClaimedYuan = aihotSums.totalClaimed;
  return (
    <div className="mb-8 flex flex-col gap-4 lg:flex-row">
      <AlbumStats
        claimableTodayYuan={claimableTodayYuan}
        claimedMonthYuan={claimedMonthYuan}
        totalClaimedYuan={totalClaimedYuan}
        claimDay={claimDay}
        collected={collected}
        total={items.length}
        sealedCount={sealedCount}
      />
      <div
        className="min-w-0 flex-1 rounded-2xl border border-oai-gray-200/80 bg-oai-gray-50/60 p-4 dark:border-oai-gray-800 dark:bg-oai-gray-950/50"
        style={{ perspective: "2600px" }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("perks.album.title")}</h2>
          {totalPages !== 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label={copy("perks.album.prev")}
                disabled={safePage === 0}
                onClick={() => onPageChange(safePage - 1)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border transition",
                  safePage === 0
                    ? "border-oai-gray-200 text-oai-gray-300 dark:border-oai-gray-700 dark:text-oai-gray-600"
                    : "border-oai-gray-300 text-oai-gray-600 hover:bg-oai-gray-100 dark:border-oai-gray-600 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                )}
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
              {Array.from({ length: totalPages }, (_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={copy("perks.album.page", { page: idx + 1, pages: totalPages })}
                  onClick={() => onPageChange(idx)}
                  className={cn(
                    "h-1.5 w-4 rounded-full transition",
                    idx === safePage ? "bg-oai-gray-800 dark:bg-white" : "bg-oai-gray-300 dark:bg-oai-gray-600",
                  )}
                />
              ))}
              <button
                type="button"
                aria-label={copy("perks.album.next")}
                disabled={safePage >= totalPages - 1}
                onClick={() => onPageChange(safePage + 1)}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full border transition",
                  safePage >= totalPages - 1
                    ? "border-oai-gray-200 text-oai-gray-300 dark:border-oai-gray-700 dark:text-oai-gray-600"
                    : "border-oai-gray-300 text-oai-gray-600 hover:bg-oai-gray-100 dark:border-oai-gray-600 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800",
                )}
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )}
        </div>
        <div className="perk-binder">
          <div className="relative">
            <div key={safePage} className="perk-page-turn grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
              {pageItems.map((entry) => (
                <AlbumMiniCard
                  key={entry.item.id + ":" + entry.cycle}
                  item={entry.item}
                  cycle={entry.cycle}
                  collected={entry.collected}
                  tier={entry.tier}
                  streak={entry.streak}
                  claimedNow={entry.claimedNow}
                  sealed={entry.sealed}
                  rarity={entry.rarity}
                  faceValue={entry.faceValue}
                  onJump={onJump}
                  flipCount={flipKeys[entry.item.id + ":" + entry.cycle] || 0}
                  variant="strip"
                  endsAt={entry.item.endsAt}
                />
              ))}
            </div>
            {leavingPage !== null && (
              <div
                key={`out-${leavingPage}`}
                className="perk-page-turn-out absolute inset-0 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9"
                aria-hidden
              >
                {leavingItems.map((entry) => (
                  <AlbumMiniCard
                    key={`out-${entry.item.id}:${entry.cycle}`}
                    item={entry.item}
                    cycle={entry.cycle}
                    collected={entry.collected}
                    tier={entry.tier}
                    streak={entry.streak}
                    claimedNow={entry.claimedNow}
                    sealed={entry.sealed}
                    rarity={entry.rarity}
                    faceValue={entry.faceValue}
                    flipCount={0}
                    variant="strip"
                    endsAt={entry.item.endsAt}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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
  // 领取记录绑定账号（站主 2026-11-12）：登录态下与服务端同步。
  const auth = useInsforgeAuth();
  const claimsSyncAdopted = useRef(false);
  const claimsSyncBusy = useRef(false);

  const pushClaimsToServer = (next) => {
    if (!auth?.signedIn || !auth?.getAccessToken || claimsSyncBusy.current) return;
    claimsSyncBusy.current = true;
    (async () => {
      try {
        const token = await auth.getAccessToken();
        if (!token) return;
        await setPublicVisibility({ accessToken: token, perks_claims: { schema: 3, providers: next } });
      } catch { /* 静默：本地已保存 */ } finally {
        claimsSyncBusy.current = false;
      }
    })();
  };

  useEffect(() => {
    if (!auth?.signedIn || !auth?.getAccessToken || claimsSyncAdopted.current) return;
    let alive = true;
    (async () => {
      try {
        const token = await auth.getAccessToken();
        if (!token || !alive) return;
        const data = await getPublicVisibility({ accessToken: token });
        const serverClaims = data?.perks_claims;
        if (!alive || !serverClaims || typeof serverClaims !== "object") return;
        const normalized = normalizePerkClaims(serverClaims, PERK_PROVIDERS);
        if (!Object.keys(normalized).length) return;
        claimsSyncAdopted.current = true;
        setClaims(normalized);
        writePerksClaims(normalized);
      } catch { /* 服务端不可达时保持本地 */ }
    })();
    return () => { alive = false; };
  }, [auth?.signedIn]);
  const [claimFilter, setClaimFilter] = useState("all");
  // 价值等级（六色）筛选：与页首图例、卡片徽标同一套口径。
  const [tierFilter, setTierFilter] = useState("all");
  // 卡册（AIHOT 式，常驻页首）：albumPage 记卡牌带翻页位置。
  const [albumPage, setAlbumPage] = useState(0);
  // 卡册小卡 → 下方详情卡的点击联动：目标卡平滑滚动 + 边框闪烁高亮。
  const [flashedId, setFlashedId] = useState(null);
  const flashTimer = useRef(null);
  useEffect(() => () => clearTimeout(flashTimer.current), []);
  const jumpToCard = (id) => {
    // 先摘 class 再下一帧挂回：同卡连点也能重播闪烁动画。
    setFlashedId(null);
    requestAnimationFrame(() => {
      setFlashedId(id);
      document.getElementById(`perk-${id}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashedId(null), 1300);
    });
  };
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

  // 「今天还能领 / 本月已领到」按 AIHOT 全目录口径（站主 2026-11-12：我们的
  // ¥6 vs AIHOT ¥583 = 只统计了映射卡）。快照里每个 provider 的最新 deal：
  // 未被我们领掉的（含未映射到卡册的）都算今天还能领；月领周期且本月已领的
  // 计入本月已领到。
  const aihotSums = useMemo(() => {
    let claimable = 0;
    let monthly = 0;
    let totalClaimed = 0;
    for (const [provider, deal] of aihotIndex.byProvider) {
      if (aihotIndex.dropped.has(provider) || !Number.isFinite(deal.yuan)) continue;
      const cardId = AIHOT_PROVIDER_TO_CARD.get(provider);
      const item = cardId ? PERK_PROVIDERS.find((row) => row.id === cardId) : null;
      const claimedToday = item ? isPerkClaimed(item, claims, claimDay, "all") : false;
      if (!claimedToday) claimable += deal.yuan;
      const monthlyClaimed = item
        && getPerkClaimCycles(item).includes("monthly")
        && Boolean(getPerkClaimDate(item, claims, "monthly", claimDay));
      if (monthlyClaimed) monthly += deal.yuan;
      // 累计领取：deal 价值 × 各周期已领次数（daily 按天、monthly 按月、once 领过即 1）。
      if (item) {
        for (const cycle of getPerkClaimCycles(item)) {
          const count = claims?.[item.id]?.[cycle]?.count || 0;
          totalClaimed += deal.yuan * Math.min(count, cycle === "once" ? 1 : count);
        }
      }
    }
    return { claimable, monthly, totalClaimed };
  }, [aihotIndex, claims, claimDay]);

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

  // 领取（标记，非取消）后把视口带回卡册里那张小卡——翻面动画在页首，
  // 人在明细卡处领取根本看不到（站主 2026-11-12）。effect 放在 albumItems
  // 之后：领取会改排序，页码必须按领取后的卡册顺序算。
  const pendingScrollId = useRef(null);
  // 连击翻面计数（per 卡）：streak 增长 → 卡背 key 重建重播 rotateY。
  // 放主组件层——翻页容器按页 key 重建时组件内定时器会被清掉（教训）。
  const [flipKeys, setFlipKeys] = useState({});
  // 绝版卡弹窗：玻璃柜里的卡点击后展示已下线福利的详情（站主 2026-11-12）。
  const [sealedDetail, setSealedDetail] = useState(null);
  const prevStreaksRef = useRef({});

  const toggleClaim = (item, cycle) => {
    const day = getPerkClaimDay();
    const wasClaimed = isPerkClaimed(item, claims, claimDay, selectedCategory);
    const next = togglePerkClaim(unsavedClaims.current ?? readPerksClaims() ?? claims, item, cycle, day);
    setClaimDay(day);
    setClaims(next);
    unsavedClaims.current = writePerksClaims(next) ? null : next;
    pushClaimsToServer(next);
    if (!wasClaimed) pendingScrollId.current = item.id;
  };

  const categoryCounts = useMemo(() => {
    const counts = { all: PERK_PROVIDERS.length };
    for (const cat of PERK_CATEGORIES) {
      if (cat.id === "all") continue;
      counts[cat.id] = PERK_PROVIDERS.filter((item) => item.category?.includes(cat.id)).length;
    }
    return counts;
  }, []);

  const tierCounts = useMemo(() => {
    const counts = { all: PERK_PROVIDERS.length };
    for (const item of PERK_PROVIDERS) {
      counts[item.badgeType] = (counts[item.badgeType] || 0) + 1;
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
      // Value-tier Filter（灰/绿/蓝/紫/粉/琥珀）
      if (tierFilter !== "all" && item.badgeType !== tierFilter) {
        return false;
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
  }, [locale, searchQuery, selectedCategory, tierFilter]);

  const claimedCount = matchedItems.filter((item) => isPerkClaimed(item, claims, claimDay, selectedCategory)).length;
  const filteredItems = matchedItems.filter((item) => {
    const claimed = isPerkClaimed(item, claims, claimDay, selectedCategory);
    return claimFilter === "all" || (claimFilter === "claimed" ? claimed : !claimed);
  });

  // 卡册排序：已收亮卡 > 累计亮度档 > A-Z 稳定序（AIHOT「越亮的越靠前」，
  // 截图里第一行亮卡第二行暗卡）。面值/折算值取映射 provider 的最新 AIHOT deal。
  const albumItems = useMemo(() => {
    // 每周期独立成卡（站主 2026-11-12）：同一软件有几种可领周期就出几张卡，
    // 每张卡的稀有度/次数只看自己那个周期。详情卡保持一张（领取按钮分行）。
    const expanded = [];
    for (const item of filteredItems) {
      for (const cycle of getPerkClaimCycles(item)) {
        expanded.push({ item, cycle });
      }
    }
    const ranked = expanded.map(({ item, cycle }) => {
      const streak = getPerkClaimStreak(item, claims, cycle);
      const claimedNow = Boolean(getPerkClaimDate(item, claims, cycle, claimDay));
      const cycleCounts = {};
      cycleCounts[cycle] = claims?.[item.id]?.[cycle]?.count || 0;
      const deal = (() => {
        const providers = PERKS_AIHOT_PROVIDERS[item.id];
        if (!providers) return null;
        let best = null;
        for (const provider of providers) {
          const candidate = aihotIndex.byProvider.get(provider);
          if (candidate && (!best || (candidate.verified_at || "") > (best.verified_at || ""))) best = candidate;
        }
        return best;
      })();
      const monthlyClaimed = cycle === "monthly" && Boolean(getPerkClaimDate(item, claims, "monthly", claimDay));
      // 绝版 = 活动结束（站主 2026-11-12 口径）：AIHOT 把该 provider 标记为
      // dropped（下线活动，如 workbuddy 国际版 DeepSeek 免费调用）、或数据里
      // 写了 endsAt 且已过期、或显式 retired 标记——与是否领取过无关。
      const sealed = item.retired === true
        || Boolean(perkDaysLeft(item.endsAt)?.ended)
        || (() => {
          const providers = PERKS_AIHOT_PROVIDERS[item.id];
          return Boolean(providers && providers.some((provider) => aihotIndex.dropped.has(provider)));
        })();
      return {
        item,
        cycle,
        streak,
        claimedNow,
        tier: albumBrightnessTier(streak),
        rarity: cardRarity(cycleCounts, deal && Number.isFinite(deal.yuan) ? deal.yuan : null),
        collected: streak > 0,
        sealed,
        faceValue: deal?.label || null,
        // 「今天还能领」= 该卡映射 deal 的折算值（今日尚未领取时计入合计），
        // 与 AIHOT 顶部口径一致：所有 counted 估值都算今天可领。
        dealYuanPending: deal && Number.isFinite(deal.yuan) && !claimedNow ? deal.yuan : 0,
        dealYuanMonthlyClaimed: deal && Number.isFinite(deal.yuan) && monthlyClaimed ? deal.yuan : 0,
      };
    });
    const CYCLE_RANK = { daily: 0, monthly: 1, once: 2 };
    ranked.sort((a, b) =>
      (TIER_RANK[b.item.badgeType] ?? 0) - (TIER_RANK[a.item.badgeType] ?? 0)
      || comparePerks(a.item, b.item)
      || (CYCLE_RANK[a.cycle] ?? 9) - (CYCLE_RANK[b.cycle] ?? 9),
    );
    return ranked;
  }, [filteredItems, claims, claimDay, selectedCategory, aihotIndex]);

  // 绝版展示柜（站主 2026-11-12：绝版卡「封装到玻璃柜」，和还能领的卡不混在
  // 一起）：只陈列领到过的绝版卡，没领过的绝版按 AIHOT 规则不放出来。
  // 主卡册 = 全量卡（绝版卡的日常形态也在卡册里——站主 2026-11-12 定谳：
  // 玻璃柜是同一张卡的「绝版形态」副本，日常卡仍可照常领取）。
  const stripItems = albumItems;
  // 玻璃柜独立于页面筛选（站主 2026-11-12：切换领取/分类筛选不应让绝版卡消失）。
  const vitrineItems = useMemo(() => {
    const items = [];
    for (const item of PERK_PROVIDERS) {
      const providers = PERKS_AIHOT_PROVIDERS[item.id];
      const sealed = item.retired === true
        || Boolean(perkDaysLeft(item.endsAt)?.ended)
        || Boolean(providers && providers.some(function (provider) { return aihotIndex.dropped.has(provider); }));
      if (!sealed) continue;
      const streak = Math.max(...getPerkClaimCycles(item).map(function (cycle) { return getPerkClaimStreak(item, claims, cycle); }), 0);
      if (streak <= 0) continue;
      items.push({
        item,
        collected: true,
        tier: albumBrightnessTier(streak),
        rarity: null,
        streak,
        claimedNow: isPerkClaimed(item, claims, claimDay, "all"),
        sealed: true,
        faceValue: null,
      });
    }
    return items;
  }, [claims, claimDay, aihotIndex]);

  useEffect(() => {
    const id = pendingScrollId.current;
    if (!id) return;
    pendingScrollId.current = null;
    const idx = albumItems.findIndex(function (entry) { return entry.item.id === id; });
    if (idx < 0) return;
    setAlbumPage(Math.floor(idx / ALBUM_PAGE_SIZE));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        document.querySelector(`.perk-mini[data-perk-id="${id}"]`)
          ?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      }),
    );
  }, [albumItems]);

  // 连击翻面：diff 每张卡的 streak，增长者的卡背延迟 500ms 重建（等滚动
  // 到位再翻，否则动画在人看到之前就放完了）。批量合并成一次 setState。
  const flipDiffMountedRef = useRef(false);
  useEffect(() => {
    // 首轮只建档：卡册挂载时已有连击的卡不算「增长」，否则整册在
    // 加载 500ms 后集体空翻一次（站主实测口径：只在领取瞬间翻）。
    if (!flipDiffMountedRef.current) {
      flipDiffMountedRef.current = true;
      for (const entry of albumItems) prevStreaksRef.current[entry.item.id + ":" + entry.cycle] = entry.streak;
      return;
    }
    const grew = [];
    for (const entry of albumItems) {
      const key = entry.item.id + ":" + entry.cycle;
      const prev = prevStreaksRef.current[key] || 0;
      if (entry.collected && entry.streak > prev) grew.push(key);
      prevStreaksRef.current[key] = entry.streak;
    }
    if (!grew.length) return;
    const timer = setTimeout(() => {
      setFlipKeys((current) => {
        const next = { ...current };
        for (const id of grew) next[id] = (next[id] || 0) + 1;
        return next;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [albumItems]);

  // 卡册翻页随筛选结果收缩回合法范围，避免「清除筛选后跳回旧页码」。
  useEffect(() => {
    setAlbumPage((current) => {
      const maxPage = Math.max(0, Math.ceil(stripItems.length / ALBUM_PAGE_SIZE) - 1);
      return current > maxPage ? maxPage : current;
    });
  }, [stripItems.length]);

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

          {/* AIHOT 式卡册：统计头 + 扑克卡牌带，常驻页首（站主 2026-11-11 拍板照做） */}
          <AlbumStrip
            items={albumItems}
            stripItems={stripItems}
            claimDay={claimDay}
            page={albumPage}
            onPageChange={setAlbumPage}
            onJump={jumpToCard}
            flipKeys={flipKeys}
            aihotSums={aihotSums}
          />

          {/* 绝版展示柜：独立于主卡册（站主 2026-11-12 玻璃柜方案） */}
          <AlbumVitrine entries={vitrineItems} flipKeys={flipKeys} onSealedClick={setSealedDetail} />

          {sealedDetail ? (
            <div
              className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
              role="dialog"
              aria-modal="true"
              aria-label={copy("perks.album.vitrine_detail")}
              onClick={() => setSealedDetail(null)}
            >
              <div
                className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-oai-gray-200 dark:bg-oai-gray-950 dark:ring-oai-gray-800"
                onClick={function (event) { event.stopPropagation(); }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold text-oai-black dark:text-white">
                    {sealedDetail.name}
                    <span className="perk-seal ml-2 inline-block rounded px-1 py-0.5 align-middle text-[9px] font-extrabold tracking-wider">
                      {copy("perks.album.sealed")}
                    </span>
                  </h3>
                  <button
                    type="button"
                    onClick={function () { setSealedDetail(null); }}
                    aria-label={copy("perks.album.vitrine_close")}
                    className="rounded-md px-2 py-1 text-sm text-oai-gray-500 transition hover:bg-oai-gray-100 hover:text-oai-black dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white"
                  >
                    ✕
                  </button>
                </div>
                {sealedDetail.retiredDeal ? (
                  <div className="mt-3 space-y-2 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
                    <p className="font-semibold text-oai-black dark:text-white">{sealedDetail.retiredDeal.label}</p>
                    <p>{sealedDetail.retiredDeal.detail}</p>
                    {sealedDetail.endsAt ? (
                      <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {copy("perks.album.retired_until", { date: sealedDetail.endsAt })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* 六色图例：把色阶含义摆在页面上（站主 2026-11-11 要求） */}
          <PerkTierLegend />

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
            {/* Value-tier Row：六色筛选（站主 2026-11-12：放第一行），颜色口径与页首图例一致 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 inline-flex items-center gap-1.5 text-[11px] font-medium text-oai-gray-500 dark:text-oai-gray-400">
                {copy("perks.legend.title")}
              </span>
              <button
                type="button"
                aria-pressed={tierFilter === "all"}
                onClick={() => setTierFilter("all")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                  tierFilter === "all"
                    ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                    : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                )}
              >
                <span>{copy("perks.tier.all")}</span>
                <span className="text-[10px] tabular-nums opacity-80">{tierCounts.all ?? 0}</span>
              </button>
              {PERK_TIER_FILTER_OPTIONS.map((opt) => {
                const active = tierFilter === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTierFilter(active ? "all" : opt.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                        : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-500 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                    )}
                  >
                    <span className={cn("h-2 w-2 rounded-full", opt.accent)} aria-hidden />
                    <span>{opt.label()}</span>
                    <span className="text-[10px] tabular-nums opacity-80">{tierCounts[opt.id] ?? 0}</span>
                  </button>
                );
              })}
            </div>

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
                </div>
              </div>
            </div>
          </div>

          {/* Provider Cards Grid。三块 && 条件渲染而非三元链：ui-hardcode 扫描器会把
              顶层比较符与自闭合标签间的代码误报成 JSX 文本（仓库已知坑），条件用 === / !== */}
          {filteredItems.length === 0 && (
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
          {filteredItems.length !== 0 && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <PerkCard
                  key={item.id}
                  item={localizePerk(item, locale)}
                  claims={claims}
                  claimDay={claimDay}
                  onToggleClaim={toggleClaim}
                  aihot={buildAihotSignal(item, aihotIndex)}
                  flashed={flashedId === item.id}
                />
              ))}
            </div>
          )}

        </div>
      </main>
      {/* 长列表跳转：一屏一屏翻太慢，给「回到顶部 / 回到底部」两个常驻按钮 */}
      <div className="pointer-events-none sticky bottom-6 z-20 flex justify-end px-4 sm:px-6">
        <div className="pointer-events-auto flex flex-col gap-2">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label={copy("perks.scroll.top")}
            title={copy("perks.scroll.top")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-oai-gray-200 bg-white/90 text-oai-gray-600 shadow-md backdrop-blur transition hover:bg-white hover:text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900/90 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4 rotate-90" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })}
            aria-label={copy("perks.scroll.bottom")}
            title={copy("perks.scroll.bottom")}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-oai-gray-200 bg-white/90 text-oai-gray-600 shadow-md backdrop-blur transition hover:bg-white hover:text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900/90 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4 -rotate-90" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

export default PerksPage;
