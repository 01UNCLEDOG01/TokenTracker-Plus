import React, { useState, useEffect, useMemo, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown, Info, Loader2, RefreshCw, SquareArrowOutUpRight } from "lucide-react";

// Solid (fill-based) monochrome all-tools mark — matches the fill-based
// mono provider icons, unlike lucide's stroke-only Layers3. Drawn bold and
// edge-to-edge so it reads at the same visual weight as the sibling marks.
function AllToolsIcon({ size = 15, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 1.6 23 7.4 12 13.2 1 7.4 12 1.6Z" />
      <path d="m4 10.3-3 1.5 11 5.5 11-5.5-3-1.5-8 4-8-4Z" opacity="0.72" />
      <path d="m4 14.6-3 1.5 11 5.5 11-5.5-3-1.5-8 4-8-4Z" opacity="0.45" />
    </svg>
  );
}
import { Popover } from "@base-ui/react/popover";
import { Card, Button, Counter } from "../../components";
import { Select } from "../../components/Select.jsx";
import { useTheme } from "../../../hooks/useTheme.js";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { useTokenFormat } from "../../../hooks/useTokenFormat.js";
import { copy, getCopyLocale } from "../../../lib/copy";
import { QoderCnOfficialSpend, QoderIntlCreditsNote, VyceAiSpend, WorkbuddyCreditSpend } from "./LedgerNotices.jsx";
import { CURRENCY_USD, getCurrencySymbol } from "../../../lib/currency";
import { formatProviderDisplayName } from "../../../lib/provider-display";
import { DateRangePopover, formatDateShort, getDateFnsLocale } from "./DateRangePopover.jsx";
import { useAccountView } from "../../../contexts/AccountViewContext.jsx";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { formatUsdCurrency } from "../../../lib/format";
import { buildAllModels, hasModelTokenSplits } from "../../../lib/model-breakdown";
import { ContextBreakdownPanel } from "./ContextBreakdownPanel.jsx";

const ALL_PROVIDERS_KEY = "__all__";
const FULL_SHARE_LABEL = `${(100).toFixed(2)}%`;

function formatPositiveTokens(formatter, value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? formatter(n) : null;
}

function formatCost(value, currency, rate) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const symbol = getCurrencySymbol(currency);
  const converted = currency === CURRENCY_USD ? n : n * rate;
  if (converted < 0.01) return `<${symbol}0.01`;
  return formatUsdCurrency(n, { decimals: 2, currency, rate });
}

function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map((p) => {
    if (typeof p === "string") {
      return { key: p, label: getPeriodLabel(p) };
    }
    return { key: p.key, label: p.label || getPeriodLabel(p.key) };
  });
}

function parseAnimatedCounterValue(displayValue) {
  if (typeof displayValue !== "string") return null;
  const match = displayValue.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Provider color mapping for visual distinction
const PROVIDER_COLORS = {
  ACODE: "var(--brand-primary-light)",
  CODEX: "#3b82f6",     // blue-500
  DSH: "var(--community-deepseek)", // DeepSeek Harness brand blue
  CLAUDE: "#d97757",    // Anthropic Japonica orange-red
  OPENCODE: "#f59e0b",  // amber-500
  GEMINI: "#2196f3",    // Google Gemini bright blue
  KIMI: "#a78bfa",      // violet-400
  "KILO-CLI": "#facc15",   // yellow-400 (Kilo brand yellow)
  "KILO-CODE": "#facc15",
  MIMO: "#ff6900",         // Xiaomi MiMo brand orange
  DROID: "#ef4444",        // red-500 (Factory brand)
  ZCODE: "#14b8a6",        // teal-500 (Z.ai / GLM — distinct from the blues)
  ANYTHINGLLM: "var(--provider-anythingllm)", // AnythingLLM primary cyan
  LMSTUDIO: "var(--provider-lmstudio)", // LM Studio icon gradient lead
  UNSLOTH: "var(--provider-unsloth)",  // Unsloth green
};

function getProviderColor(label, index) {
  const normalized = label?.toUpperCase?.() || "";
  return PROVIDER_COLORS[normalized] || `hsl(${150 + index * 40}, 60%, 45%)`;
}

function resolveContextBreakdownSource(provider) {
  const source = String(provider?.source || "").trim().toLowerCase();
  const label = String(provider?.label || "").trim().toLowerCase();
  if (source === "claude" || label === "claude") return "claude";
  if (source === "codex" || label === "codex") return "codex";
  if (source === "grok" || label === "grok" || label.includes("grok")) return "grok";
  return null;
}

function contextBreakdownHeading(source) {
  if (source === "claude") return copy("dashboard.context_breakdown.heading_claude");
  if (source === "codex") return copy("dashboard.context_breakdown.heading_codex");
  if (source === "grok") return copy("dashboard.context_breakdown.heading_grok");
  return copy("dashboard.context_breakdown.heading");
}

function hasProviderModels(provider) {
  return Boolean(provider?.models?.length);
}

function getProviderPercentValue(provider) {
  const rawValue = Number(provider?.totalPercentValue ?? provider?.totalPercent);
  return Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
}

function formatProviderPercent(provider) {
  const value = getProviderPercentValue(provider);
  if (value > 0 && !(value >= 0.01)) return copy("usage.overview.percent_below_threshold");
  return value.toFixed(2);
}

// A request-only provider (issue 948) has conversation activity but neither
// token totals nor spend: it stays out of the card grid and surfaces in the
// notice row below. A credits-billed source like Qoder international also has
// zero tokens and real conversations, but it carries money — hiding it here
// would take its cost card and credit banner off the dashboard.
function isRequestOnlyProvider(provider) {
  const source = String(provider?.source || provider?.label || "").trim().toLowerCase();
  // Qoder and Qoder CN are first-party supported providers with official cards
  if (source.includes("qoder")) return false;
  const requests = Number(provider?.requests) || 0;
  return requests > 0 && !(Number(provider?.usage) > 0) && !(Number(provider?.usd) > 0);
}

// Zero-token (request-only) model rows show their request count where a
// token total would sit; rows with neither keep the legacy empty cell. A
// merged row can carry BOTH (issue 948: token usage from one tool,
// request-only activity from another) — show both instead of hiding the
// requests behind the token total.
function modelTokensCellLabel(model, formatTokens) {
  const positive = formatPositiveTokens(formatTokens, model?.usage);
  const requests = Math.max(0, Number(model?.requests) || 0);
  if (positive && requests > 0) {
    return `${positive} · ${copy("usage.overview.request_count", { count: requests })}`;
  }
  if (positive) return positive;
  return requests > 0 ? copy("usage.overview.request_count", { count: requests }) : null;
}

const PERIOD_COPY_KEYS = {
  day: "usage.period.day",
  week: "usage.period.week",
  month: "usage.period.month",
  total: "usage.period.total",
  custom: "usage.period.custom",
};

function getPeriodLabel(key) {
  const copyKey = PERIOD_COPY_KEYS[key];
  return copyKey ? copy(copyKey) : String(key).toUpperCase();
}

// upstream PRs 983/986: label the data scope and — for signed-in
// localhost users — let them peek at the other scope without touching the
// Cloud sync toggle. The override lives in AccountViewContext (in-memory, not
// persisted), so every usage surface flips together and refetches via the
// revision bump.
function UsageScopeSwitcher() {
  const { accountView, scopeOverride, setScopeOverride, canOverrideScope } = useAccountView();
  const active = scopeOverride ?? (accountView ? "account" : "local");
  if (!canOverrideScope) {
    // upstream PR 983: still label the scope so cloud-aggregate rows can't be misread
    // as a local pricing bug.
    return (
      <span
        data-usage-scope-badge=""
        className="inline-flex items-center h-8 px-3 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 text-oai-gray-600 dark:text-oai-gray-300"
      >
        {copy(accountView ? "usage.overview.scope_account" : "usage.overview.scope_local")}
      </span>
    );
  }
  const options = [
    { key: "local", labelKey: "usage.overview.scope_local" },
    { key: "account", labelKey: "usage.overview.scope_account" },
  ];
  return (
    <div
      role="group"
      aria-label={copy("usage.overview.scope_aria")}
      data-usage-scope-switcher=""
      className="inline-flex items-center rounded-md border border-oai-gray-300 dark:border-oai-gray-700 overflow-hidden"
    >
      {options.map((option) => {
        const selected = active === option.key;
        return (
          <button
            key={option.key}
            type="button"
            aria-pressed={selected}
            onClick={() => setScopeOverride(option.key)}
            className={`h-8 px-3 text-xs font-medium transition-colors duration-150 ${
              selected
                ? "bg-oai-gray-900 text-white dark:bg-oai-white dark:text-oai-black"
                : "bg-oai-white text-oai-gray-600 hover:text-oai-brand dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:text-oai-white"
            }`}
          >
            {copy(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

// Refresh button with rotation animation
function RefreshButton({ loading, onClick }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={loading}
      onClick={onClick}
      aria-label={copy("usage.button.refresh")}
      className="w-8 p-0"
    >
      <motion.span
        aria-hidden="true"
        animate={loading ? { rotate: 360 } : { rotate: 0 }}
        transition={
          loading && !shouldReduceMotion
            ? { duration: 1, repeat: Infinity, ease: "linear" }
            : { duration: 0.3 }
        }
        style={{ display: "inline-flex" }}
      >
        {/* Real arc geometry: the previous "↻" text glyph is a non-circular,
            font-dependent shape whose glyph-box center sits off the arc's
            visual center, so the spin wobbled instead of reading as a circle. */}
        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
      </motion.span>
    </Button>
  );
}

function SummaryValueSkeleton() {
  return (
    <div
      data-testid="usage-summary-skeleton"
      aria-hidden="true"
      className="mx-auto h-[58px] sm:h-[72px] w-[min(72vw,18rem)] rounded-2xl bg-oai-gray-100 dark:bg-oai-gray-800 animate-pulse motion-reduce:animate-none"
    />
  );
}

function ProviderDistributionSkeleton() {
  return (
    <div
      data-testid="usage-provider-skeleton"
      aria-hidden="true"
      className="space-y-6"
    >
      <div className="h-1.5 w-full rounded-full bg-oai-gray-100 dark:bg-oai-gray-800 animate-pulse motion-reduce:animate-none" />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-[92px] rounded-xl border border-oai-gray-100 dark:border-oai-gray-800 bg-oai-gray-50 dark:bg-oai-gray-800/60 animate-pulse motion-reduce:animate-none"
            style={{ animationDelay: `${index * 70}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

export function UsageOverview({
  period,
  periods,
  onPeriodChange,
  summaryValue,
  summaryFullValue,
  onToggleSummaryFormat,
  summaryLabel,
  summaryCostValue,
  onCostInfo,
  fleetData = [],
  onRefresh,
  loading,
  announceLoading = false,
  summaryLoading = false,
  providersLoading = false,
  hasSummary = true,
  className = "",
  customFrom,
  customTo,
  onCustomRangeApply,
  customRangeOpen,
  onCustomRangeOpenChange,
  onOpenShare,
  from,
  to,
  // First day that actually holds usage. "Total" queries a rolling 24-month
  // window, but the number on screen is the whole history, so the label must
  // start at the first recorded day instead of the window's left edge.
  totalFrom = null,
  deviceOptions = [],
  selectedDevice = "",
  onDeviceChange,
}) {
  const tabs = normalizePeriods(periods);
  const dateLocale = getDateFnsLocale(getCopyLocale());
  const summaryCounterValue = parseAnimatedCounterValue(String(summaryValue ?? ""));
  // Weeks run Monday–Sunday, so a week selected near a month boundary can
  // hold more usage than the month-to-date it overlaps. Spell out the covered
  // dates and flag the straddle so the week/month totals read as different
  // windows, not as a miscount. Day is a single calendar date, so a
  // "Oct 13 — Oct 13" range under the summary is redundant — hide it.
  const showCrossMonthHint =
    period === "week" &&
    typeof from === "string" &&
    typeof to === "string" &&
    from.slice(0, 7) !== to.slice(0, 7);
  const rangeStart = period === "total" && totalFrom ? totalFrom : from;
  const periodRangeLabel =
    period !== "day" && rangeStart && to
      ? `${formatDateShort(rangeStart, dateLocale)} — ${formatDateShort(to, dateLocale)}`
      : null;
  // The digit-by-digit Counter renders at a fixed 72px and would clip on
  // phones. Below sm we drop it and render the plain value, which scales
  // with the responsive font class below. 639px == one below Tailwind's
  // sm (640px), so this flips in lockstep with the sm: classes.
  const matchesCompact = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 639px)").matches;
  const [isCompactSummary, setIsCompactSummary] = useState(matchesCompact);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(max-width: 639px)");
    const onChange = (e) => setIsCompactSummary(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const showAnimatedSummary = summaryCounterValue != null && !isCompactSummary;
  // Keep the selected period chip in view when the tab strip scrolls
  // horizontally on narrow screens.
  const tablistRef = useRef(null);
  useEffect(() => {
    const el = tablistRef.current?.querySelector('[aria-selected="true"]');
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [period]);
  // Nothing is expanded by default; every card toggles open/closed.
  const [expandedProvider, setExpandedProvider] = useState(null);
  const { resolvedTheme } = useTheme();
  const { currency, rate } = useCurrency();
  const { formatTokens } = useTokenFormat();
  const isDark = resolvedTheme === "dark";
  const gradientFrom = isDark ? "rgba(10,10,10,0.98)" : "rgba(255,255,255,0.96)";
  const gradientTo = isDark ? "rgba(10,10,10,0)" : "rgba(255,255,255,0)";

  const showSummarySkeleton = summaryLoading && !hasSummary;
  const showProviderSkeleton = providersLoading && !fleetData.some(hasProviderModels);

  // A new time/device scope collapses back to the card grid — drill-down
  // stays an explicit user action rather than a forced default.
  useEffect(() => {
    setExpandedProvider(null);
  }, [period, from, to, selectedDevice]);

  const handleTablistKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabElements = Array.from(
      event.currentTarget.querySelectorAll('[role="tab"]'),
    ).filter((tab) => !tab.disabled);
    const currentIndex = tabElements.indexOf(event.target.closest('[role="tab"]'));
    if (currentIndex === -1 || tabElements.length === 0) return;

    event.preventDefault();
    let nextIndex = currentIndex;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabElements.length - 1;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabElements.length;
    else nextIndex = (currentIndex - 1 + tabElements.length) % tabElements.length;

    tabElements[nextIndex].focus();
    tabElements[nextIndex].click();
  };

  const summaryContent = showAnimatedSummary ? (
    <Counter
      value={summaryCounterValue}
      displayValue={summaryValue}
      fontSize={72}
      padding={6}
      gap={1}
      textColor="var(--oai-black, #111827)"
      fontWeight={700}
      gradientHeight={isDark ? 0 : 8}
      gradientFrom={gradientFrom}
      gradientTo={gradientTo}
      counterStyle={{ paddingLeft: 0, paddingRight: 0, gap: 0 }}
      digitStyle={{ width: "0.88ch" }}
    />
  ) : (
    summaryValue
  );

  // FleetData is already grouped by provider. Request-only providers
  // (issue 948: zero tokens, activity as conversation_count) stay out of the
  // card grid — the grid's visual language is token share — and surface in a
  // slim notice row below it instead.
  const providers = fleetData.filter((f) => f.models?.length > 0 && !isRequestOnlyProvider(f));
  const requestOnlyProviders = fleetData.filter(
    (f) => f.models?.length > 0 && isRequestOnlyProvider(f),
  );
  // Devin contributes real token counts but its models (swe-2, swe-2-high,
  // compactor) ship without pricing data, so the dollar figure silently
  // under-reports whenever Devin is in view — surface the notice on both the
  // provider drill-down and the combined "All" ranking.
  const devinContributes = providers.some(
    (provider) =>
      String(provider?.source || provider?.label || "").trim().toLowerCase() === "devin",
  );
  const kiroContributes = providers.some(
    (provider) =>
      String(provider?.source || provider?.label || "").trim().toLowerCase() === "kiro",
  );
  const allModels = useMemo(() => buildAllModels(fleetData), [fleetData]);
  const allUsage = allModels.reduce((sum, model) => sum + (Number(model.usage) || 0), 0);
  const allCost = providers.reduce((sum, provider) => sum + (Number(provider.usd) || 0), 0);
  const activeProvider =
    expandedProvider == null
      ? null
      : expandedProvider === ALL_PROVIDERS_KEY || providers.some(function matchesExpandedProvider(provider) {
          return provider.label === expandedProvider;
        })
        ? expandedProvider
        : null;

  return (
    <Card className={className}>
      <div aria-busy={loading || showSummarySkeleton || showProviderSkeleton}>
        {announceLoading ? (
          <span className="sr-only" role="status">
            {copy("qpd.card.updating")}
          </span>
        ) : null}
        {/* Header: Period Tabs + Refresh. Tabs are a single horizontal-scroll
            strip (never wrap into stacked rows); actions stay pinned right. */}
        <div className="flex items-center gap-2 mb-6">
          <div ref={tablistRef} role="tablist" aria-label={copy("usage.overview.tablist_aria")} onKeyDown={handleTablistKeyDown} className="flex flex-1 min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((p) => {
              const isActive = period === p.key;
              const tabClass = `shrink-0 whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                isActive
                  ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                  : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
              }`;

              if (p.key === "custom") {
                const customLabel = isActive && customFrom && customTo
                  ? `${formatDateShort(customFrom, dateLocale)} — ${formatDateShort(customTo, dateLocale)}`
                  : p.label;

                return (
                  <Popover.Root
                    key="custom"
                    open={customRangeOpen}
                    onOpenChange={(open) => {
                      if (open) onPeriodChange?.("custom");
                      else onCustomRangeOpenChange?.(open);
                    }}
                  >
                    <Popover.Trigger
                      render={
                        <button
                          role="tab"
                          aria-selected={isActive}
                          tabIndex={isActive ? 0 : -1}
                          type="button"
                          className={tabClass}
                        />
                      }
                    >
                      {customLabel}
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner sideOffset={8} side="bottom" align="start" className="!z-[9999]">
                        <Popover.Popup className="bg-white dark:bg-oai-gray-900 border border-oai-gray-200 dark:border-oai-gray-700 rounded-xl shadow-lg">
                          <DateRangePopover
                            from={customFrom}
                            to={customTo}
                            onApply={onCustomRangeApply}
                            onCancel={() => onCustomRangeOpenChange?.(false)}
                          />
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                );
              }

              return (
                <button
                  key={p.key}
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                  className={tabClass}
                  onClick={() => onPeriodChange?.(p.key)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <UsageScopeSwitcher />
            {deviceOptions.length > 1 ? (
              <Select
                value={selectedDevice}
                onValueChange={onDeviceChange}
                options={deviceOptions}
                ariaLabel={copy("dashboard.device_filter.aria")}
                matchTriggerWidth
                className="h-8 px-3 text-xs font-medium rounded-md border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-brand hover:text-oai-brand hover:[&_svg]:text-oai-brand transition-colors duration-200"
              />
            ) : null}
            {onOpenShare ? (
              <button
                type="button"
                onClick={onOpenShare}
                aria-label={copy("share.button.aria")}
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md border border-oai-gray-300 dark:border-oai-gray-700 bg-oai-white dark:bg-oai-gray-900 text-oai-black dark:text-oai-white hover:border-oai-brand hover:text-oai-brand transition-colors duration-200"
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" strokeWidth={2} />
                {copy("share.button.label")}
              </button>
            ) : null}
            {onRefresh && (
              <RefreshButton loading={loading} onClick={onRefresh} />
            )}
          </div>
        </div>

        {/* Main Stats */}
        <div className="text-center mb-8">
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wider mb-3">{summaryLabel}</div>
          <div className="relative text-5xl sm:text-6xl md:text-7xl font-bold text-oai-black dark:text-oai-white tracking-tight tabular-nums">
            <div className={showSummarySkeleton ? "invisible" : undefined}>
              {onToggleSummaryFormat ? (
                <button
                  type="button"
                  onClick={onToggleSummaryFormat}
                  title={summaryFullValue || undefined}
                  aria-label={copy("usage.summary.toggle_aria")}
                  className="cursor-pointer rounded-lg leading-none transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oai-brand"
                >
                  {summaryContent}
                </button>
              ) : (
                <span title={summaryFullValue || undefined}>{summaryContent}</span>
              )}
            </div>
            <div className={`absolute inset-0 flex items-center justify-center ${showSummarySkeleton ? "" : "hidden"}`}>
              <SummaryValueSkeleton />
            </div>
          </div>
          {summaryCostValue && (
            <div className="flex items-center justify-center gap-2 mt-4">
              {onCostInfo ? (
                <button
                  type="button"
                  onClick={onCostInfo}
                  className="inline-flex items-center gap-1.5 text-xl font-bold text-oai-brand hover:text-oai-brand-dark dark:hover:text-oai-brand-light transition-colors cursor-pointer"
                  aria-label={copy("usage.overview.cost_breakdown_aria")}
                >
                  {summaryCostValue}
                  <Info size={16} strokeWidth={2} className="opacity-80" />
                </button>
              ) : (
                <span className="text-xl font-bold text-oai-brand">{summaryCostValue}</span>
              )}
            </div>
          )}
          {periodRangeLabel ? (
            <div className="mt-3 flex flex-col items-center gap-1 text-[11px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
              <span className="tabular-nums">{periodRangeLabel}</span>
              {showCrossMonthHint ? (
                <span>{copy("usage.overview.week_cross_month_hint")}</span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Provider Distribution */}
        <div className={showProviderSkeleton ? undefined : "hidden"}>
          <ProviderDistributionSkeleton />
        </div>
        {/* The All card (and the All-models detail behind it) must stay reachable
            even when no provider has tokens — a Qoder-only user would otherwise
            lose the request-only model rows entirely (issue 948 review). */}
        {(providers.length > 0 || requestOnlyProviders.length > 0) && (
          <div className="space-y-6">
            {/* Distribution Bar */}
            {providers.length > 0 && (
            <div
              role="img"
              aria-label={copy("usage.overview.distribution_aria", {
                items: providers
                  .map((provider) =>
                    copy("usage.overview.distribution_item", {
                      label: formatProviderDisplayName(provider.label),
                      percent: formatProviderPercent(provider),
                    }),
                  )
                  .join("，"),
              })}
              className="h-1.5 w-full bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden flex"
            >
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                const displayLabel = formatProviderDisplayName(provider.label);
                const percentLabel = formatProviderPercent(provider);
                return (
                  <motion.div
                    key={provider.label}
                    initial={{ width: 0 }}
                    animate={{ width: `${getProviderPercentValue(provider)}%` }}
                    transition={{ duration: 0.5, delay: 0.45 + idx * 0.04, ease: [0.16, 1, 0.3, 1] }}
                    className="h-full"
                    style={{ backgroundColor: color }}
                    title={`${displayLabel}: ${percentLabel}%`}
                  />
                );
              })}
            </div>
            )}

            {/* Provider Cards — responsive grid keeps cells equal-width so the
                last row never stretches when the count doesn't divide evenly. */}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              <button
                type="button"
                aria-expanded={activeProvider === ALL_PROVIDERS_KEY}
                aria-controls="provider-details-all"
                aria-label={copy("usage.overview.all_tools_card_aria", {
                  tokens: formatPositiveTokens(formatTokens, allUsage) || String(0),
                  cost: formatCost(allCost, currency, rate) || `${getCurrencySymbol(currency)}0`,
                  count: allModels.length,
                })}
                onClick={() =>
                  setExpandedProvider(
                    activeProvider === ALL_PROVIDERS_KEY ? null : ALL_PROVIDERS_KEY,
                  )
                }
                className={`min-w-0 text-left p-3 rounded-lg border transition-colors duration-200 ${
                  activeProvider === ALL_PROVIDERS_KEY
                    ? "border-oai-gray-300 dark:border-oai-gray-600 bg-oai-gray-50 dark:bg-oai-gray-800"
                    : "border-oai-gray-200 dark:border-oai-gray-700 hover:border-oai-gray-300 dark:hover:border-oai-gray-600"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1 min-w-0">
                  <AllToolsIcon size={15} className="shrink-0 text-oai-brand dark:text-oai-white" />
                  <span className="text-sm font-medium text-oai-black dark:text-oai-white truncate">
                    {copy("usage.overview.all_tools")}
                  </span>
                </div>
                <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
                  {FULL_SHARE_LABEL}
                </div>
                <div className="mt-0.5 text-[11px] text-oai-gray-400 dark:text-oai-gray-400 tabular-nums">
                  {copy("usage.overview.model_count", { count: allModels.length })}
                </div>
              </button>
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                const isExpanded = activeProvider === provider.label;
                const displayLabel = formatProviderDisplayName(provider.label);
                const percentLabel = formatProviderPercent(provider);
                // A token-less source reads "0.00%" and looks like an empty card,
                // so it carries its money — or, when it has no money either, its
                // conversation count — on the sub-line instead. Only this case:
                // every card that reports tokens keeps its original two lines.
                // Qoder CN bills credits and reports neither tokens nor cost, so
                // without the request count its card showed nothing but "0.00%".
                const providerCost = formatCost(provider.usd, currency, rate);
                const providerRequests = Math.max(0, Number(provider.requests) || 0);
                const modelCount = copy("usage.overview.model_count", { count: provider.models.length });
                // The TRAE pricing caveat lives on the TRAE card itself (short
                // hint + tooltip), never on the combined totals above. Cost
                // folding for unknown-cache models happens upstream in
                // applyTraeEstimatedCosts, so provider.usd is already the
                // estimate here and no per-card interval math is needed.
                const isTraeCard =
                  String(provider?.source || provider?.label || "").trim().toLowerCase() === "trae";
                const modelCountLabel =
                  provider.usage > 0 || (!providerCost && providerRequests <= 0)
                    ? modelCount
                    : `${modelCount} · ${
                        providerCost || copy("usage.overview.request_count", { count: providerRequests })
                      }`;

                return (
                  <button
                    key={provider.label}
                    aria-expanded={isExpanded}
                    aria-controls={`provider-details-${provider.label}`}
                    aria-label={copy("usage.overview.provider_card_aria", {
                      provider: displayLabel,
                      percent: percentLabel,
                      tokens: formatPositiveTokens(formatTokens, provider.usage) || String(0),
                      cost: formatCost(provider.usd, currency, rate) || `${getCurrencySymbol(currency)}0`,
                      action: copy(isExpanded ? "usage.overview.collapse" : "usage.overview.expand"),
                    })}
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.label)}
                    className={`min-w-0 text-left p-3 rounded-lg border transition-colors duration-200 ${
                      isExpanded
                        ? "border-oai-gray-300 dark:border-oai-gray-600 bg-oai-gray-50 dark:bg-oai-gray-800"
                        : "border-oai-gray-200 dark:border-oai-gray-700 hover:border-oai-gray-300 dark:hover:border-oai-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 mb-1 min-w-0">
                      <ProviderIcon provider={provider.label} size={15} color={color} className="text-oai-gray-700 dark:text-oai-gray-300 shrink-0" />
                      <span className="text-sm font-medium text-oai-black dark:text-oai-white truncate" title={displayLabel}>{displayLabel}</span>
                    </div>
                    <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
                      {percentLabel}%
                    </div>
                    <div
                      className="mt-0.5 text-[11px] text-oai-gray-400 dark:text-oai-gray-400 tabular-nums"
                      title={isTraeCard ? copy("usage.overview.trae_notice_body") : undefined}
                    >
                      {isTraeCard
                        ? `${modelCountLabel} · ${copy("usage.overview.trae_card_hint")}`
                        : modelCountLabel}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* A card toggles its details region; collapsed by default. (Two
                sibling && guards, not a nested ternary — the ui-hardcode
                scanner reads `) : x ? (` fragments as raw JSX text.) */}
            {activeProvider === ALL_PROVIDERS_KEY && (
              <div
                id="provider-details-all"
                role="region"
                aria-label={copy("usage.overview.all_models")}
                className="mt-2"
              >
                {devinContributes && <DevinPricingNotice />}
                {kiroContributes && <KiroEstimateNotice />}
                <AllModelsSection models={allModels} />
              </div>
            )}
            {activeProvider != null && activeProvider !== ALL_PROVIDERS_KEY && (
              <div
                id={`provider-details-${activeProvider}`}
                role="region"
                aria-label={copy("usage.overview.model_details_aria", {
                  provider: activeProvider,
                })}
                className="mt-2"
              >
                {providers
                  .filter((p) => p.label === activeProvider)
                  .map((provider) => {
                    const color = getProviderColor(provider.label, 0);
                    const contextSource = resolveContextBreakdownSource(provider);
                    const sortedModels = [...provider.models].sort((a, b) => {
                      return (b.share || 0) - (a.share || 0);
                    });
                    const providerSource = String(provider?.source || provider?.label || "").trim().toLowerCase();
                    const isTraeProvider = providerSource === "trae" || providerSource === "trae-cn";

                    const providerHeading = contextSource
                      ? contextBreakdownHeading(contextSource)
                      : formatProviderDisplayName(provider.label);
                    return (
                      <React.Fragment key={provider.label}>
                        {isTraeProvider && (
                          <TraePricingNotice
                            estimate={provider?.traeEstimate || null}
                            variant={providerSource === "trae-cn" ? "cn" : "intl"}
                          />
                        )}
                        <ProviderExpandedSection
                          provider={provider}
                          color={color}
                          providerHeading={providerHeading}
                          contextSource={contextSource}
                          from={from}
                          to={to}
                          sortedModels={sortedModels}
                        />
                      </React.Fragment>
                    );
                  })}
              </div>
            )}

          </div>
        )}
        {requestOnlyProviders.length > 0 && (
          <RequestOnlyNotice providers={requestOnlyProviders} />
        )}
      </div>
      </Card>
  );
}

// Token-type labels for the expandable per-model detail. Reuses the
// project-composition copy family so no new i18n keys are needed.
const MODEL_SPLIT_DEFS = [
  { key: "input", labelKey: "dashboard.projects.detail.comp_input" },
  { key: "cached", labelKey: "dashboard.projects.detail.comp_cached" },
  { key: "cacheCreate", labelKey: "dashboard.projects.detail.comp_cache_write" },
  { key: "output", labelKey: "dashboard.projects.detail.comp_output" },
  { key: "reasoning", labelKey: "dashboard.projects.detail.comp_reasoning" },
];

// Narrow containers drop the fixed value-column minimums so the row wraps
// instead of overflowing; sm+ restores the aligned columns. The share column
// only needs room for the percent plus a chevron affordance.
const MODEL_ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-x-3 mb-1.5 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,max-content)_minmax(5.5rem,max-content)_minmax(4.5rem,max-content)]";

/**
 * Renders the five token-type split values (input / cached / cache write /
 * output / reasoning) under an expanded model row.
 */
function ModelTokenSplits({ tokens }) {
  const { formatTokens, formatTokensTooltip } = useTokenFormat();
  return (
    <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1">
      {MODEL_SPLIT_DEFS.map((def) => {
        const value = Math.max(0, Number(tokens?.[def.key]) || 0);
        return (
          <span key={def.key} className="inline-flex items-baseline gap-1 text-[11px] tabular-nums">
            <span className="text-oai-gray-400 dark:text-oai-gray-500">{copy(def.labelKey)}</span>
            <span
              title={formatTokensTooltip(value)}
              className="text-oai-gray-600 dark:text-oai-gray-300"
            >
              {formatTokens(value)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

// upstream PR 975 absorption: Codex bills speed tiers (Fast 2x, Ultrafast 6x)
// on top of the standard rates. The backend reports the observed per-tier
// subsets; Standard is the remainder of the row's totals, so the three lines
// sum to the row's headline cost. Only renders when the backend actually
// observed tier usage. All math/formatting happens in the pure builder below
// so the JSX carries expression nodes only (ui-hardcode scan).
const SPEED_TIER_DEFS = [
  { key: "standard", labelKey: "usage.overview.tier_standard" },
  { key: "priority", labelKey: "usage.overview.tier_fast", multiplierField: "priority_multiplier" },
  { key: "ultrafast", labelKey: "usage.overview.tier_ultrafast", multiplierField: "ultrafast_multiplier" },
];
const SPEED_TIER_TOKEN_COLUMNS = [
  { column: "input_tokens", splitKey: "input" },
  { column: "cached_input_tokens", splitKey: "cached" },
  { column: "cache_creation_input_tokens", splitKey: "cacheCreate" },
  { column: "output_tokens", splitKey: "output" },
  { column: "reasoning_output_tokens", splitKey: "reasoning" },
];

function buildSpeedTierRows(tiers, model, { formatTokens, formatCost, currency, rate }) {
  const tierRows = SPEED_TIER_DEFS.map((def) => {
    const subset = def.key === "standard" ? null : tiers?.[def.key] || {};
    const tokens = {};
    for (const { column, splitKey } of SPEED_TIER_TOKEN_COLUMNS) {
      if (def.key === "standard") {
        tokens[column] = Math.max(
          0,
          (Number(model.tokens?.[splitKey]) || 0)
            - (Number(tiers?.priority?.[column]) || 0)
            - (Number(tiers?.ultrafast?.[column]) || 0),
        );
      } else {
        tokens[column] = Number(subset?.[column]) || 0;
      }
    }
    const cost = def.key === "standard"
      ? Math.max(
          0,
          (Number(model.cost) || 0)
            - (Number(tiers?.priority?.cost_usd) || 0)
            - (Number(tiers?.ultrafast?.cost_usd) || 0),
        )
      : Number(subset?.cost_usd) || 0;
    const multiplier = def.multiplierField ? Number(model.pricing?.[def.multiplierField]) : null;
    // Plain i18n word + a JS-composed suffix: a missing/1x multiplier must not
    // render an unresolved {{multiplier}} placeholder.
    const baseLabel = copy(def.labelKey);
    const label = Number.isFinite(multiplier) && multiplier > 1
      ? `${baseLabel} (${multiplier}\u00d7)`
      : baseLabel;
    const cells = [];
    for (const { column, splitKey } of SPEED_TIER_TOKEN_COLUMNS) {
      const def = MODEL_SPLIT_DEFS.find((item) => item.key === splitKey);
      if (tokens[column] > 0) cells.push({ key: column, value: `${copy(def.labelKey)} ${formatTokens(tokens[column])}` });
    }
    if (cost > 0) cells.push({ key: "cost", value: formatCost(cost, currency, rate) });
    return { key: def.key, label, cells, hasTierUsage: Object.values(tokens).some((value) => value > 0) };
  });
  const anyTierObserved = tierRows.some((row) => row.key !== "standard" && row.hasTierUsage);
  return anyTierObserved ? tierRows : [];
}

function ModelSpeedTiers({ tiers, model }) {
  const { formatTokens } = useTokenFormat();
  const { currency, rate } = useCurrency();
  const rows = buildSpeedTierRows(tiers, model, {
    formatTokens,
    formatCost: (value, cur, rt) => formatCost(value, cur, rt),
    currency,
    rate,
  });
  if (rows.length === 0) return null;
  return (
    <div className="mb-1.5 space-y-0.5" data-speed-tier-block="">
      {rows.map((row) => (
        <div key={row.key} className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] tabular-nums">
          <span className="text-oai-gray-400 dark:text-oai-gray-500">{row.label}</span>
          {row.cells.map((cell) => (
            <span key={cell.key} className="text-oai-gray-600 dark:text-oai-gray-300">{cell.value}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Grid cells of one model row: name, token total, cost and share. The share
 * cell carries a rotating chevron when the row has token splits.
 */
function ModelRowHeader({ model, tokensLabel, costLabel, expandable, isExpanded }) {
  const { formatTokensTooltip } = useTokenFormat();
  return (
    <>
      <span
        className="col-start-1 row-start-1 min-w-0 text-sm text-oai-gray-700 dark:text-oai-gray-300 truncate"
        title={model.name}
      >
        {model.name}
      </span>
      <span
        title={formatTokensTooltip(model.usage)}
        className="col-start-2 row-start-1 text-right whitespace-nowrap text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums"
      >
        {tokensLabel}
      </span>
      <span className="col-start-3 row-start-1 text-right whitespace-nowrap text-sm text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
        {costLabel}
      </span>
      <span className="col-start-4 row-start-1 flex w-full items-center justify-end gap-1 whitespace-nowrap text-sm text-oai-black dark:text-oai-white tabular-nums">
        {model.share}%
        {expandable && (
          <>
            <span className="sr-only">
              {copy(isExpanded ? "usage.overview.collapse" : "usage.overview.expand")}
            </span>
            <ChevronDown
              size={14}
              aria-hidden
              className={`shrink-0 text-oai-gray-400 transition-transform duration-200 ease-out motion-reduce:transition-none dark:text-oai-gray-500 ${
                isExpanded ? "rotate-180" : ""
              }`}
            />
          </>
        )}
      </span>
    </>
  );
}

/**
 * Renders the per-model usage rows for one provider (or the all-models list).
 * Rows whose backend entry carries token-type splits become expandable; the
 * expanded state shows the five split values under the row.
 */
function ModelUsageRows({ models, color }) {
  const { currency, rate } = useCurrency();
  const { formatTokens } = useTokenFormat();
  const [expandedModel, setExpandedModel] = useState(null);

  return (
    <div className="space-y-3">
      {models.map((model) => {
        const tokensLabel = modelTokensCellLabel(model, formatTokens);
        // applyTraeEstimatedCosts marks folded models with ceilingCost — those
        // rows show an estimated price, so the cell says so explicitly.
        const baseCostLabel = formatCost(model.cost, currency, rate);
        const costLabel =
          model.ceilingCost != null && baseCostLabel
            ? `${baseCostLabel} ${copy("usage.overview.trae_row_estimate_marker")}`
            : baseCostLabel;
        const clampedShare = Math.max(0, Math.min(100, Number(model.share) || 0));
        const rowKey = model.id || model.name;
        // A row expands only when the backend supplied token-type splits;
        // rows without them keep the exact legacy non-interactive markup.
        // Split math lives in the .ts helper so this file stays free of
        // inline comparisons that the ui-hardcode scanner would flag.
        const expandable = hasModelTokenSplits(model);
        const isExpanded = expandable && expandedModel === rowKey;
        const gridClassName = MODEL_ROW_GRID;
        const headerProps = { model, tokensLabel, costLabel, expandable, isExpanded };
        return (
          <div key={rowKey} data-model-rank-row>
            {expandable ? (
              <button
                type="button"
                onClick={() => setExpandedModel(isExpanded ? null : rowKey)}
                aria-expanded={isExpanded}
                className={`${gridClassName} w-full cursor-pointer text-left`}
              >
                <ModelRowHeader {...headerProps} />
              </button>
            ) : (
              <div className={gridClassName}>
                <ModelRowHeader {...headerProps} />
              </div>
            )}
            {isExpanded && <ModelTokenSplits tokens={model.tokens} />}
            {isExpanded && model.speedTiers ? (
              <ModelSpeedTiers tiers={model.speedTiers} model={model} />
            ) : null}
            <div
              className="h-[3px] bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuenow={clampedShare}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full transition-[width] duration-500 ease-out"
                style={{
                  width: `${clampedShare}%`,
                  backgroundColor: color,
                  opacity: 0.45,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AllModelsSection({ models }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5">
        <AllToolsIcon size={14} className="shrink-0 text-oai-brand dark:text-oai-white" />
        <span className="text-sm font-medium text-oai-black dark:text-oai-white">
          {copy("usage.overview.all_models")}
        </span>
      </div>
      <p className="mb-4 text-[11px] leading-snug text-oai-gray-500 dark:text-oai-gray-400">
        {copy("usage.overview.all_models_note")}
      </p>
      <ModelUsageRows models={models} color="var(--oai-blue)" />
    </div>
  );
}

function DevinPricingNotice() {
  return (
    <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
      <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">
        {copy("usage.overview.devin_notice_title")}.
      </span>{" "}
      {copy("usage.overview.devin_notice_body")}
    </p>
  );
}

function KiroEstimateNotice() {
  return (
    <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
      <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">
        {copy("usage.overview.kiro_notice_title")}.
      </span>{" "}
      {copy("usage.overview.kiro_notice_body")}
    </p>
  );
}

// TRAE international reports no cache fields for some models (DeepSeek), so
// its API cost is an all-uncached ceiling. applyTraeEstimatedCosts has already
// folded those models to the hit rate the owner achieves on the same model at
// other sources; this notice states the basis and keeps the all-uncached
// ceiling as the reference point.
function TraePricingNotice({ estimate = null, variant = "intl" }) {
  const { currency, rate } = useCurrency();
  const isCn = variant === "cn";
  let estimateLine = null;
  if (estimate && Number.isFinite(estimate.estimatedCost) && estimate.estimatedCost > 0) {
    estimateLine = copy("usage.overview.trae_estimate_line", {
      estimated: formatCost(estimate.estimatedCost, currency, rate),
      high: formatCost(estimate.ceilingCost, currency, rate),
      median: estimate.medianHitRate,
    });
  }
  return (
    <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
      <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">
        {estimateLine
          ? copy(isCn ? "usage.overview.trae_cn_notice_title" : "usage.overview.trae_notice_title")
          : copy(isCn
              ? "usage.overview.trae_cn_notice_title_unestimated"
              : "usage.overview.trae_notice_title_unestimated")}
        .
      </span>{" "}
      {estimateLine
        ? copy(isCn ? "usage.overview.trae_cn_notice_body" : "usage.overview.trae_notice_body")
        : // No estimate ran (no same-model peer evidence this period): saying
          // "cache is estimated" would contradict the measured-0% card.
          copy(isCn
            ? "usage.overview.trae_cn_notice_body_unestimated"
            : "usage.overview.trae_notice_body_unestimated")}
      {estimateLine ? (
        <span className="block mt-0.5">
          {estimateLine}{" "}
          {copy("usage.overview.trae_estimate_basis")}
        </span>
      ) : null}
    </p>
  );
}

// Request-only providers (issue 948: Qoder-style credit-billed transcripts
// with zero tokens) render as one slim notice under the card grid — the grid
// itself stays a pure token-share visualization. Per-model detail lives in
// the All-models list, which already carries their request counts.
function RequestOnlyNotice({ providers }) {
  const items = providers
    .map((provider) =>
      copy("usage.overview.request_only_item", {
        label: formatProviderDisplayName(provider.label),
        count: Math.max(0, Number(provider.requests) || 0),
      }),
    )
    .join(copy("usage.overview.request_only_separator"));
  return (
    <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
      {copy("usage.overview.request_only_note", { items })}
    </p>
  );
}

// Renders a single expanded provider section. Hosts loading state for the
// inline Context Breakdown so the spinner can sit next to the heading instead
// of taking its own row.
function ProviderExpandedSection({ provider, color, providerHeading, contextSource, from, to, sortedModels }) {
  const { formatTokens } = useTokenFormat();
  const [breakdownLoading, setBreakdownLoading] = useState(false);
  const isAntigravity =
    String(provider?.source || provider?.label || "").trim().toLowerCase() === "antigravity";
  const isDevin =
    String(provider?.source || provider?.label || "").trim().toLowerCase() === "devin";
  // Qoder CN and WorkBuddy bill in their own credits rather than tokens, so the
  // numbers the cards would show from local rows are 0. Both banners read the
  // local limits endpoint instead, which carries the official spend / credit
  // ledger for them.
  const providerSource = String(provider?.source || provider?.label || "").trim().toLowerCase();
  // Exact: the international card is a separate source now, and the CN banner
  // ("本地数据滞后 / 估算 tokens") on it would be a false statement about a
  // ledger that is neither estimated nor stale - it is Qoder's own credit bill.
  const isQoderCn = providerSource === "qoder-cn";
  const isQoder = providerSource === "qoder";
  const isWorkbuddy = providerSource === "workbuddy";
  const isWorkbuddyAi = providerSource === "workbuddy-ai";
  // Vyce AI bills on its own site (the proxy responses carry no usage), so
  // the card's token rows come from the differential ledger while the
  // account-level balance / lifetime spend render as the extra below.
  const isVyceai = providerSource === "vyceai";
  // Each card filters to its own ledger edition ("cn" / "intl"): the WorkBuddy
  // AI card carries the international credits, so filtering the domestic card
  // no longer hides them anywhere on the panel.
  const workbuddyEdition = isWorkbuddyAi ? "intl" : "cn";
  // Kiro CLI does not report token counts; the overview shows an estimation
  // notice for it instead of a hard number.
  const isKiro =
    String(provider?.source || provider?.label || "").trim().toLowerCase() === "kiro";

  return (
                      <div>
                        {/* Section header — provider identity. When the provider supports
                            Context Breakdown we replace the bare label with the panel title
                            so we don't render a redundant double heading. The panel's
                            loading spinner sits inline at the right of the heading. */}
                        <div className="flex items-center gap-1.5 mb-3">
                          <ProviderIcon provider={provider.label} size={14} color={color} className="shrink-0" />
                          <span className="text-sm font-medium text-oai-black dark:text-oai-white">{providerHeading}</span>
                          {contextSource && breakdownLoading && (
                            <Loader2
                              size={12}
                              className="text-oai-gray-400 dark:text-oai-gray-500 animate-spin shrink-0"
                              aria-label={copy("dashboard.context_breakdown.loading_aria")}
                            />
                          )}
                        </div>

                        {isQoderCn && <QoderCnOfficialSpend from={from} to={to} />}
                        {isQoder && <QoderIntlCreditsNote />}
                        {(isWorkbuddy || isWorkbuddyAi) && (
                          <WorkbuddyCreditSpend from={from} to={to} edition={workbuddyEdition} />
                        )}
                        {isVyceai && <VyceAiSpend />}

                        {/* Input-side cache hit rate for this provider. Omitted
                            entirely when the source does no prompt caching (rate
                            is null) so we never render a misleading 0%. */}
                        {provider.cacheHitRate != null && (
                          <p className="mb-3 text-[11px] leading-snug text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                            <span className="font-medium text-oai-gray-600 dark:text-oai-gray-300">
                              {copy(
                                provider.traeEstimate
                                  ? "usage.overview.cache_hit_rate_label_est"
                                  : "usage.overview.cache_hit_rate_label",
                              )}
                            </span>{" "}
                            <span className="text-oai-black dark:text-oai-white">{provider.cacheHitRate}%</span>
                            {" · "}
                            {copy("usage.overview.cache_hit_rate_detail", {
                              reused: formatPositiveTokens(formatTokens, provider.cacheReusedTokens) || String(0),
                              input: formatPositiveTokens(formatTokens, provider.cacheInputTokens) || String(0),
                            })}
                          </p>
                        )}

                        {/* Antigravity parses exact tokens and prompt-cache hits from
                            SQLite generation metadata when available, falling back to
                            a ~4-char/token estimate for raw transcripts. */}
                        {isAntigravity && (
                          <p className="mb-3 text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
                            <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">
                              {copy("usage.overview.antigravity_notice_title")}.
                            </span>{" "}
                            {copy("usage.overview.antigravity_notice_body")}
                          </p>
                        )}

                        {/* Devin token counts are real (read from the CLI's local
                            history), but swe-2/swe-2-high/compactor carry no
                            verified pricing, so the dollar figure excludes them —
                            a $0 estimate is not evidence of free usage. */}
                        {isDevin && <DevinPricingNotice />}
                        {isKiro && <KiroEstimateNotice />}

                        {/* Context Breakdown drill-down.
                            Claude: category-based (approx /context).
                            Codex: tool-oriented breakdown. */}
                        {contextSource ? (
                          <div className="mb-4 pb-4 border-b border-oai-gray-200 dark:border-oai-gray-700">
                            <ContextBreakdownPanel
                              from={from}
                              to={to}
                              source={contextSource}
                              referenceTotalTokens={provider.usage}
                              onLoadingChange={setBreakdownLoading}
                            />
                          </div>
                        ) : null}

                        {/* Model rows — text line + thin muted bar as visual rhythm */}
                        <ModelUsageRows models={sortedModels} color={color} />
                      </div>
  );
}
