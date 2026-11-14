// 详情大卡（从 PerksPage.jsx 拆出，2026-11-14）：福利卡的完整渲染——徽标、
// 截止日、富文本描述、来源/反馈行、领取按钮与补记日期。
import React, { useState } from "react";
import {
  Gift,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Info,
  ArrowUpRight,
  Flag,
} from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { showToast } from "../../ui/components/Toast.jsx";
import { ProviderIcon, hasProviderIcon } from "../../ui/dashboard/components/ProviderIcon.jsx";
import { getPerkClaimCycles, getPerkClaimDate } from "../../lib/perks-claims.mjs";
import { perkDaysLeft, buildPerksFeedbackUrl } from "./album-data.js";
import { getBadgeStyle } from "./tier-styles.js";

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

// ⚠️ 安全红线句（「第三方中转聚合站/网关：请求经其服务器转发，勿发送密钥/隐私/
// 敏感代码…」）自动加粗 + 红色（站主 2026-11-14：聚合站安全性无法保证，这句必须
// 醒目、不能淹没在 tips 文本里）。只认「⚠️ 第三方中转」开头的整句——Qoder 等卡的
// ⚠️ 可用性告警保持原样，不跟着变色。警告句内部不再解析加粗（红色即全部强调）。
function renderRichText(text) {
  if (!text || typeof text !== "string") return text;
  const segments = text.split(/(⚠️\s*第三方中转[^。]*。)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith("⚠️")) {
      return (
        <strong key={"warn-" + i} className="font-semibold text-red-600 dark:text-red-400">
          {seg}
        </strong>
      );
    }
    return renderBoldText(seg);
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
        {renderRichText(text)}
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

// 补记实际领取日（站主 2026-11-13）：漏标/晚标的月领与一次性卡，可把日期回改
// 到真实领取日（月领限本月内，不得晚于今天）。只修日期，不改领取次数与连击。
function ClaimDateAdjust({ date, today, monthScoped, onApply }) {
  const [editing, setEditing] = useState(false);
  const minDate = monthScoped ? `${today.slice(0, 7)}-01` : undefined;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 flex w-full items-center justify-center gap-1 text-[10px] text-oai-gray-400 underline-offset-2 hover:text-oai-gray-600 hover:underline dark:text-oai-gray-500 dark:hover:text-oai-gray-300"
      >
        {copy("perks.claim.adjust_date")}
      </button>
    );
  }
  return (
    <label className="mt-1 flex w-full items-center justify-center gap-1.5 text-[10px] text-oai-gray-500 dark:text-oai-gray-400">
      <span>{copy("perks.claim.adjust_date")}</span>
      <input
        type="date"
        value={date}
        min={minDate}
        max={today}
        onChange={(e) => {
          const nextDate = e.target.value;
          if (!nextDate) return;
          onApply(nextDate);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
        className="rounded border border-oai-gray-300 bg-white px-1 py-0.5 text-[10px] text-oai-gray-700 dark:border-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-200"
      />
    </label>
  );
}

export function PerkCard({ item, claims, claimDay, onToggleClaim, onAdjustClaimDate, aihot }) {
  // 活动截止倒计时：自家人工 endsAt 优先，AIHOT 映射 deal 的最早 ends_at 兜底
  // （AIHOT 列表红字「还剩 N 天」同源数据，2026-11-14 联动）。
  const deadline = perkDaysLeft(item.endsAt || aihot?.endsAt);
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
            <span className="flex-1">{renderRichText(item.tips)}</span>
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
            <React.Fragment key={cycle}>
              <button
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
              {claimedAt && cycle !== "daily" ? (
                <ClaimDateAdjust
                  date={claimedAt}
                  today={claimDay}
                  monthScoped={cycle === "monthly"}
                  onApply={(nextDate) => onAdjustClaimDate(item, cycle, nextDate)}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
