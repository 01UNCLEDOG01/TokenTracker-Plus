import React, { useMemo, useState, useEffect } from "react";
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
} from "lucide-react";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import { showToast } from "../ui/components/Toast.jsx";
import { ProviderIcon, hasProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";
import { PERK_CATEGORIES, PERK_PROVIDERS } from "../data/perksData.js";

const PERKS_CLAIMS_KEY = "tokentracker.perks.claims.v1";

function readPerksClaims() {
  try {
    const raw = window?.localStorage?.getItem(PERKS_CLAIMS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writePerksClaims(claims) {
  try {
    window?.localStorage?.setItem(PERKS_CLAIMS_KEY, JSON.stringify(claims));
  } catch {
    // 私密模式等存储不可用时静默降级：标记仅本次会话生效
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

function ProviderLogo({ item }) {
  const hasIcon = item.provider ? hasProviderIcon(item.provider) : false;
  const initial = item.name.charAt(0).toUpperCase();

  return (
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-oai-gray-200/80 bg-white p-1 text-base font-semibold shadow-xs transition-transform group-hover:scale-105 dark:border-oai-gray-800 dark:bg-oai-gray-900/90 dark:text-oai-white">
      {hasIcon ? (
        <ProviderIcon provider={item.provider} size={28} className="object-contain" />
      ) : (
        <span className="font-mono text-sm font-bold text-oai-gray-700 dark:text-oai-gray-300">
          {initial}
        </span>
      )}
    </div>
  );
}

function PerkCard({ item, claimedAt, onToggleClaim }) {
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
                    className="inline-flex items-center rounded-md bg-oai-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-400"
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
          {item.description}
        </p>

        {/* Tips Box */}
        {item.tips && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-oai-gray-50/80 p-2.5 text-[11px] leading-relaxed text-oai-gray-500 border border-oai-gray-200/50 dark:bg-oai-gray-950/60 dark:text-oai-gray-400 dark:border-oai-gray-800/60">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-400" aria-hidden />
            <span className="flex-1">{item.tips}</span>
          </div>
        )}

        {/* Provenance: which date this card was checked and against which page */}
        {item.checkedAt && item.sourceUrl && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-oai-gray-400 dark:text-oai-gray-500">
            <span>{copy("perks.card.checked", { date: item.checkedAt })}</span>
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 transition hover:text-oai-gray-600 dark:hover:text-oai-gray-300"
            >
              <span>{copy("perks.card.source")}</span>
              <ArrowUpRight className="h-3 w-3" aria-hidden />
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
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-700 active:scale-[0.98] dark:bg-emerald-500 dark:hover:bg-emerald-600"
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
              <span>{copy("perks.action.official")}</span>
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

        <button
          type="button"
          onClick={() => onToggleClaim(item.id)}
          aria-pressed={Boolean(claimedAt)}
          className={cn(
            "mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border py-1.5 text-[11px] font-medium transition active:scale-[0.98]",
            claimedAt
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "border-oai-gray-200/90 bg-white text-oai-gray-500 hover:bg-oai-gray-50 hover:text-oai-gray-800 dark:border-oai-gray-800 dark:bg-transparent dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-oai-gray-200"
          )}
        >
          {claimedAt ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>
            {claimedAt
              ? copy("perks.claim.claimed", { date: claimedAt })
              : copy("perks.claim.mark")}
          </span>
        </button>
      </div>
    </div>
  );
}

export function PerksPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [claims, setClaims] = useState(readPerksClaims);

  useEffect(() => {
    document.title = `${copy("perks.title")} | TokenTracker`;
  }, []);

  const toggleClaim = (id) => {
    setClaims((prev) => {
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        next[id] = new Date().toISOString().slice(0, 10);
      }
      writePerksClaims(next);
      return next;
    });
  };

  const categoryCounts = useMemo(() => {
    const counts = { all: PERK_PROVIDERS.length };
    for (const cat of PERK_CATEGORIES) {
      if (cat.id === "all") continue;
      counts[cat.id] = PERK_PROVIDERS.filter((item) => item.category?.includes(cat.id)).length;
    }
    return counts;
  }, []);

  const filteredItems = useMemo(() => {
    return PERK_PROVIDERS.filter((item) => {
      // Category Filter
      if (selectedCategory !== "all") {
        if (!item.category.includes(selectedCategory)) {
          return false;
        }
      }
      // Search Query
      if (searchQuery.trim()) {
        const query = searchQuery.trim().toLowerCase();
        const matchName = item.name.toLowerCase().includes(query);
        const matchDesc = item.description.toLowerCase().includes(query);
        const matchBadge = item.badge.toLowerCase().includes(query);
        const matchTag = item.tags.some((t) => t.toLowerCase().includes(query));
        return matchName || matchDesc || matchBadge || matchTag;
      }
      return true;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
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
              <p className="mt-1.5 max-w-2xl text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("perks.subtitle")}
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
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

          {/* Filters & Search Toolbar */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Category Tabs */}
            <div className="flex flex-wrap items-center gap-1.5">
              {PERK_CATEGORIES.map((cat) => {
                const active = selectedCategory === cat.id;
                const label = copy(`perks.cat.${cat.id}`) || cat.label;
                const count = categoryCounts[cat.id] ?? 0;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition",
                      active
                        ? "bg-oai-black text-white shadow-xs dark:bg-white dark:text-oai-black"
                        : "bg-white text-oai-gray-600 border border-oai-gray-200 hover:bg-oai-gray-50 dark:bg-oai-gray-900 dark:border-oai-gray-800 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800"
                    )}
                  >
                    <span>{label}</span>
                    <span
                      className={cn(
                        "text-[10px] tabular-nums",
                        active ? "opacity-75" : "text-oai-gray-400 dark:text-oai-gray-500"
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative w-full sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-oai-gray-400"
                aria-hidden
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={copy("perks.search_placeholder")}
                className="h-9 w-full rounded-xl border border-oai-gray-200 bg-white pl-8 pr-3 text-xs text-oai-black placeholder-oai-gray-400 transition focus:border-emerald-500 focus:outline-hidden focus:ring-1 focus:ring-emerald-500 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-white dark:placeholder-oai-gray-500"
              />
            </div>
          </div>

          {/* Provider Cards Grid */}
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-oai-gray-200 py-16 text-center dark:border-oai-gray-800">
              <SlidersHorizontal className="h-8 w-8 text-oai-gray-400" />
              <p className="mt-2 text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("perks.empty.title")}
              </p>
              <p className="text-xs text-oai-gray-400">
                {copy("perks.empty.desc")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => (
                <PerkCard
                  key={item.id}
                  item={item}
                  claimedAt={claims[item.id]}
                  onToggleClaim={toggleClaim}
                />
              ))}
            </div>
          )}

          {/* Footer Transparency Notice */}
          <div className="mt-12 rounded-2xl border border-oai-gray-200/70 bg-oai-gray-50/60 p-5 text-xs text-oai-gray-500 dark:border-oai-gray-800/60 dark:bg-oai-gray-950/40 dark:text-oai-gray-400">
            <h4 className="font-semibold text-oai-black dark:text-white">
              {copy("perks.notice.title")}
            </h4>
            <p className="mt-1 leading-relaxed">
              {copy("perks.notice.desc")}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default PerksPage;
