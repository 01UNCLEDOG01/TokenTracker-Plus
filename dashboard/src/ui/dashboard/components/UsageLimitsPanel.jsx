import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, Gift, Globe } from "lucide-react";
import { Card } from "../../components";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { copy, getCopyLocale } from "../../../lib/copy";
import { getLocalApiAuthHeaders } from "../../../lib/local-api-auth";
import { LIMIT_DISPLAY_MODES } from "../../../hooks/use-limits-display-prefs.js";
import {
  MAX_PET_LIMIT_ROWS,
  petLimitRowKey,
  fetchPetLimitSelectionRemote,
  readPetLimitSelection,
  savePetLimitSelectionRemote,
  togglePetLimitSelection,
  writePetLimitSelection,
} from "../../../lib/pet-limit-selection.js";
import {
  LIMIT_PROVIDER_IDS,
  limitProviderIconKey,
  limitProviderName,
} from "../../../lib/limits-providers.js";
import { computePace, resetToMs, resolveWindowSeconds } from "../../../lib/limit-pace.js";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { buildResetBankRows } from "./usage-limits-reset-bank.js";
import { PROVIDER_LIMIT_SPECS } from "./usage-limits-provider-specs.js";
import { HoverTooltip } from "../../components/HoverTooltip.jsx";

const LIMITS_PROVIDER_ICON_CLASS = "shrink-0 text-oai-black dark:text-oai-white";

const PROVIDER_KEY_ENV = {
  opencodeGo: "OPENCODE_GO_API_KEY",
  commandCode: "COMMAND_CODE_API_KEY",
};

const PROVIDER_KEY_STORE_ID = {
  opencodeGo: "opencode-go",
  commandCode: "command-code",
};

function commandCodeSetupPlatform() {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent || "";
  return /Windows/i.test(ua) ? "windows" : /Linux/i.test(ua) ? "linux" : "macos";
}

function commandCodeLoginSnippet() {
  return commandCodeSetupPlatform() === "windows"
    ? copy("limits.commandCode.setupHint.snippet_login_windows")
    : copy("limits.commandCode.setupHint.snippet_login");
}

// The optional command-line path to the same key. Windows gets `setx` (the
// previous macOS-only launchctl line was dead on Windows) and macOS keeps
// launchctl because a GUI app only sees launchd's environment.
function openCodeGoSetupSnippet() {
  const platform = commandCodeSetupPlatform();
  if (platform === "windows") return copy("limits.opencodeGo.setupHint.snippet_windows");
  if (platform === "linux") return copy("limits.opencodeGo.setupHint.snippet_linux");
  return copy("limits.opencodeGo.setupHint.snippet_macos");
}

// `devin auth login` is registry-owned (limits.devin.setupHint.snippet_login)
// so the setup guide and the reauth tooltip share one source of truth.
function devinLoginSnippet() {
  return copy("limits.devin.setupHint.snippet_login");
}

function formatReset(isoOrUnix) {
  const ts = resetToMs(isoOrUnix);
  if (!Number.isFinite(ts)) return null;
  const diff = ts - Date.now();
  // A window that just rolled over still reads "now"; a timestamp the provider
  // forgot to refresh (months old) must not claim a reset is imminent.
  if (diff <= 0) {
    const staleByMs = -86400000;
    if (diff < staleByMs) return null;
    return copy("shared.time.now");
  }
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * In "used" mode a high percentage is bad (lots of quota burned).
 * In "remaining" mode a high percentage is good (lots of quota left), so the
 * red/amber thresholds are mirrored: low remaining = red.
 */
function barColor(displayPct, mode) {
  const pct = mode === LIMIT_DISPLAY_MODES.REMAINING ? 100 - displayPct : displayPct;
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function readWindowPct(window, field = "used_percent") {
  if (!window) return null;
  if (field === "utilization") return window.utilization;
  return window.used_percent;
}

function readWindowReset(window, field = "reset_at") {
  if (!window) return null;
  if (field === "resets_at") return window.resets_at;
  return window.reset_at;
}

function formatPercentValue(value) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  const rounded = Math.round(pct);
  if (pct > 0 && rounded === 0) return copy("limits.bar.sub_one_percent");
  return String(rounded);
}

function formatCreditAmount(
  value,
  { useGrouping = true, maximumFractionDigits } = {},
) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits:
      maximumFractionDigits ?? (n >= 100 ? 0 : 2),
    useGrouping,
  }).format(n);
}

function buildQuotaDetail(window, maximumFractionDigits) {
  if (!window || typeof window !== "object") return null;
  if (!(Number(window.limit_credits) > 0)) return null;
  const formatOptions = { useGrouping: window.unit !== "calls", maximumFractionDigits };
  const used = formatCreditAmount(window.used_credits, formatOptions);
  const limit = formatCreditAmount(window.limit_credits, formatOptions);
  const remaining = formatCreditAmount(window.remaining_credits, formatOptions);
  if (!used || !limit || !remaining) return null;
  const key = window.unit === "calls"
    ? "limits.qoder_calls.detail"
    : window.unit === "points"
      ? "limits.points.detail"
      : "limits.codex_credits.detail";
  return copy(key, { used, limit, remaining });
}

/** Pace + projection for one window spec, in the active display mode. */
function paceForSpec(spec, mode, now) {
  return computePace({
    usedPercent: readWindowPct(spec.window, spec.pctField),
    windowSeconds: resolveWindowSeconds(spec, spec.window),
    resetMs: resetToMs(readWindowReset(spec.window, spec.resetField)),
    mode,
    now,
  });
}

function formatExactReset(ms) {
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat(getCopyLocale(), {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/**
 * Hover detail for one window row: pace verdict + the exact local reset time
 * (the bar itself only shows a compact relative countdown). Credits rows also
 * get the raw used/limit/remaining amounts. Lines joined with \n — the
 * Tooltip renders whitespace-pre-line.
 */
function buildWindowHoverDetail(spec, pace, mode) {
  const lines = [explainLineFor(spec, pace, mode)];
  const resetMs = resetToMs(readWindowReset(spec.window, spec.resetField));
  const exact = formatExactReset(resetMs);
  if (exact) {
    lines.push(copy(spec.timeKind === "expiry" ? "limits.hover.expires_at" : "limits.hover.resets_at", { time: exact }));
  }
  const quota = buildQuotaDetail(spec.window, spec.creditPrecision);
  if (quota) lines.push(quota);
  if (spec.note) lines.push(spec.note);
  return lines.join("\n");
}

// Shared with the session browser; see ui/components/HoverTooltip.jsx.
const Tooltip = HoverTooltip;

// Slices of a segmented pool bar share the pool's threshold hue and fade per
// product in API order, like grok.com's usage bar.
const SEGMENT_OPACITIES = [1, 0.65, 0.45, 0.3, 0.2];

function segmentOpacity(index) {
  return SEGMENT_OPACITIES[Math.min(index, SEGMENT_OPACITIES.length - 1)];
}

function PaceMarker({ paceX, paceOver }) {
  return (
    <>
      {/* Notch: a slice of bare track that "cuts" the fill, so the mark reads
          as a marker and stays visible even over a same-colored fill. */}
      <div
        className="absolute top-0 h-full bg-oai-gray-100 dark:bg-oai-gray-700/50"
        style={{ left: `calc(${paceX}% - 3px)`, width: "6px" }}
      />
      <div
        className={`absolute top-0 h-full ${paceOver ? "bg-red-500" : "bg-emerald-500"}`}
        style={{ left: `calc(${paceX}% - 1px)`, width: "2px" }}
      />
    </>
  );
}

function LimitBar({ label, pct, reset, mode = LIMIT_DISPLAY_MODES.USED, pacePercent = null, paceOver = false, title = null, segments = null, picker = null }) {
  const rawUsed = Math.max(0, Math.min(100, Number(pct) || 0));
  const displayPct = mode === LIMIT_DISPLAY_MODES.REMAINING ? 100 - rawUsed : rawUsed;
  const fillColor = barColor(displayPct, mode);
  const rounded = Math.round(displayPct);
  // Sub-1% still matters (e.g. team pool); keep bar/text from collapsing to 0%.
  const widthPct = displayPct > 0 && rounded === 0 ? Math.max(displayPct, 0.35) : displayPct;
  let labelPct = String(rounded);
  if (displayPct > 0 && rounded === 0) {
    labelPct = copy("limits.bar.sub_one_percent");
  }
  const paceX = pacePercent == null ? null : Math.max(0, Math.min(100, pacePercent));
  const segmentWeights = segments?.map((segment) => Math.max(0, Math.min(100, Number(segment.pct) || 0)));
  const segmentTotal = segmentWeights?.reduce((sum, pct) => { return sum + pct; }, 0) || 0;
  const unallocatedUsedWeight = segments ? Math.max(0, rawUsed - segmentTotal) : 0;
  const remainingWeight = Math.max(0, 100 - segmentTotal - unallocatedUsedWeight);
  return (
    <div className="group relative flex items-center gap-2">
      <Tooltip text={title} />
      <span
        data-limit-label=""
        className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400 shrink-0 whitespace-nowrap"
        style={{ width: "var(--tt-limits-label-w)" }}
      >
        {label}
      </span>
      {segments ? (
        <div data-limit-segments="" className="relative flex flex-1 h-1.5 overflow-hidden" style={{ gap: "min(2px, 1%)" }}>
          {segments.map((segment, index) => (
            <div
              key={segment.key}
              data-limit-segment={segment.key}
              className={`${fillColor} min-w-0 rounded-full h-full transition-[flex-grow] duration-500 ease-out`}
              style={{
                flex: `${segmentWeights[index]} 1 0px`,
                opacity: segmentOpacity(index),
              }}
            />
          ))}
          {unallocatedUsedWeight ? <div data-limit-unallocated-used="" className={`${fillColor} min-w-0 rounded-full h-full`} style={{ flex: `${unallocatedUsedWeight} 1 0px`, opacity: segmentOpacity(segments.length) }} /> : null}
          {remainingWeight ? <div data-limit-remainder="" className="min-w-0 rounded-full h-full bg-oai-gray-100 dark:bg-oai-gray-700/50" style={{ flex: `${remainingWeight} 1 0px` }} /> : null}
          {paceX != null && <PaceMarker paceX={paceX} paceOver={paceOver} />}
        </div>
      ) : (
        <div className="relative flex-1 bg-oai-gray-100 dark:bg-oai-gray-700/50 rounded-full h-1.5 overflow-hidden">
          <div
            className={`${fillColor} rounded-full h-full transition-[width] duration-500 ease-out`}
            style={{ width: `${widthPct}%`, minWidth: displayPct > 0 ? "3px" : 0 }}
          />
          {/* 0% 的行留一个浅色起点，避免整条看上去是空白（不是"用过一点"）。 */}
          {displayPct <= 0 ? (
            <div
              data-limit-empty-tick=""
              className="absolute inset-y-0 left-0 w-[3px] rounded-full bg-oai-gray-300/70 dark:bg-oai-gray-600/70"
            />
          ) : null}
          {paceX != null && <PaceMarker paceX={paceX} paceOver={paceOver} />}
        </div>
      )}
      <span className="text-[11px] tabular-nums text-oai-gray-500 dark:text-oai-gray-400 w-9 text-right shrink-0 whitespace-nowrap">
        {labelPct}%
      </span>
      {reset && (
        <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500 w-6 text-right shrink-0">{reset}</span>
      )}
      {picker ? (
        <input
          type="checkbox"
          checked={picker.checked}
          disabled={!picker.checked && picker.full}
          onChange={() => picker.onToggle(picker.providerId, picker.rowKey)}
          aria-label={copy("limits.pet.toggle_aria", { label })}
          title={copy("limits.pet.toggle_hint")}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border-oai-gray-300 accent-emerald-500 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
        />
      ) : null}
    </div>
  );
}

/** Dot + name + share for each slice of a segmented bar, aligned under the bar. */
function LimitSegmentLegend({ segments, fillColor }) {
  return (
    <div
      data-limit-legend=""
      className="-mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug"
      style={{ paddingLeft: "calc(var(--tt-limits-label-w, 0px) + 0.5rem)" }}
    >
      {segments.map((segment, index) => (
        <span key={segment.key} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span
            aria-hidden
            className={`${fillColor} inline-block h-1.5 w-1.5 shrink-0 rounded-full`}
            style={{ opacity: segmentOpacity(index) }}
          />
          <span className="text-oai-gray-500 dark:text-oai-gray-400">{segment.label ?? copy(segment.labelKey)}</span>
          <span className="tabular-nums text-oai-gray-700 dark:text-oai-gray-200">{formatPercentValue(segment.pct)}%</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One window's explanation line. Adds only what the bar doesn't already show:
 * pace status + a current-rate projection. Used %, reset time live on the bar.
 */
function explainLineFor(spec, pace, mode) {
  const label = spec.label ?? copy(spec.labelKey);
  // In remaining mode every percentage flips to "how much is left".
  const remaining = mode === LIMIT_DISPLAY_MODES.REMAINING;
  const projection = (usedPct) => (remaining ? 100 - usedPct : usedPct);
  // No trusted window length (monthly / billing cycle): just the usage.
  if (pace.expectedPercent == null) {
    const used = Math.max(0, Math.min(100, Number(readWindowPct(spec.window, spec.pctField)) || 0));
    const usedLabel = formatPercentValue(projection(used));
    return remaining
      ? copy("limits.explain.remaining", { label, used: usedLabel })
      : copy("limits.explain.used", { label, used: usedLabel });
  }
  if (pace.paceOver) {
    if (pace.runsOutEta) return copy("limits.explain.ahead_eta", { label, eta: pace.runsOutEta });
    const pct = formatPercentValue(projection(pace.projectedEnd ?? 100));
    return copy(remaining ? "limits.explain.ahead_pct_remaining" : "limits.explain.ahead_pct", { label, pct });
  }
  const used = Math.max(0, Math.min(100, Number(readWindowPct(spec.window, spec.pctField)) || 0));
  const pct = formatPercentValue(projection(pace.projectedEnd ?? used));
  return copy(remaining ? "limits.explain.on_track_remaining" : "limits.explain.on_track", { label, pct });
}

function rowHasPaceMarker({ pace }) {
  return pace.pacePercent != null;
}

/** The footnote explains the pace marker, so it follows the rows that draw one. */
function paceFootnoteRemaining(rows, mode) {
  return rows.some((row) => rowHasPaceMarker(row) && (row.mode ?? mode) === LIMIT_DISPLAY_MODES.REMAINING);
}

// 「已用 X% · 重置时间」「已用 A / B · 剩余 C」这些行与每根条的悬浮提示
// 一字不差，展开时也不再重复；展开只保留 pace 标记的图例说明。
function LimitDetail({ rows, mode }) {
  if (rows.length === 0) return null;
  if (!rows.some(rowHasPaceMarker)) return null;
  const remaining = paceFootnoteRemaining(rows, mode);
  return (
    <div className="mt-1 pt-1.5 border-t border-oai-gray-200/70 dark:border-oai-gray-700/50 text-[10.5px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
      {copy(remaining ? "limits.explain.body_remaining" : "limits.explain.body")}
    </div>
  );
}

function ago(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return null;
  const m = Math.floor(diff / 60000);
  if (m < 1) return copy("shared.time.now");
  if (m < 60) return copy("shared.time.m_ago", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return copy("shared.time.h_ago", { n: h });
  const d = Math.floor(h / 24);
  return copy("shared.time.d_ago", { n: d });
}

const STATUS_BADGE_TONES = {
  live: {
    surface: "bg-oai-gray-50 dark:bg-oai-gray-800 border-oai-gray-200/60 dark:border-oai-gray-700/60 text-oai-gray-500 dark:text-oai-gray-400",
    dot: "bg-emerald-500",
    pulse: "bg-emerald-400",
  },
  stale: {
    surface: "bg-oai-gray-50 dark:bg-oai-gray-800 border-oai-gray-200/60 dark:border-oai-gray-700/60 text-oai-gray-500 dark:text-oai-gray-400",
    dot: "bg-amber-500",
    pulse: "bg-amber-400",
  },
  cached: {
    surface: "bg-oai-gray-50 dark:bg-oai-gray-800 border-oai-gray-200/60 dark:border-oai-gray-700/60 text-oai-gray-500 dark:text-oai-gray-400",
    dot: "bg-amber-500",
    pulse: "bg-amber-400",
  },
};

// CLI to run when a provider's stored OAuth token has expired
// (`auth_action_required: "reauth"` on the provider payload). Claude and Codex
// reauth with the bare binary; Command Code reauths with `cmd login`, which is
// registry-owned (limits.commandCode.setupHint.snippet_login) so the tooltip
// and the setup guide stay in sync.
const REAUTH_CLI_COMMANDS = {
  claude: "claude",
  codex: "codex",
  antigravity: "agy",
};

// These cards have no zero-config source at all: their fetcher only reads a
// credentials file the user creates by hand (API key or captured cookie), so
// the "not connected" state must say that plainly instead of implying the tool
// just isn't installed. Everything else reads the tool's own local state.
const MANUAL_CREDENTIAL_IDS = new Set([
  "minimax",
  "agentRouter",
  "apigoto",
  "deepseek",
  "sensenova",
  "qoder",
  "qoderCn",
  "opendesign",
  "mistral",
  "openaiCredits",
]);

function StatusBadge({ label, age = null, tone = "live", tooltip = null }) {
  const colors = STATUS_BADGE_TONES[tone] || STATUS_BADGE_TONES.live;
  const shouldPulse = tone === "live";
  return (
    <div className="relative inline-flex items-center group cursor-help ml-1" onClick={(e) => e.stopPropagation()}>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wider border leading-normal ${colors.surface}`}>
        {shouldPulse ? (
          <span className="relative flex h-1.5 w-1.5">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colors.pulse} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${colors.dot}`} />
          </span>
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
        )}
        {label}{age ? <>&nbsp;·&nbsp;{age}</> : null}
      </span>
      {tooltip ? (
        <span className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-2 -translate-x-1/2 w-48 rounded-md bg-oai-gray-900 dark:bg-oai-gray-800 px-2.5 py-1.5 text-[10px] font-normal text-white text-center opacity-0 scale-95 translate-y-1 group-hover:opacity-100 group-hover:scale-100 group-hover:translate-y-0 transition-all duration-200 cubic-bezier(0.16, 1, 0.3, 1) leading-normal shadow-lg origin-bottom border border-oai-gray-800 dark:border-oai-gray-700">
          {tooltip}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-oai-gray-900 dark:border-t-oai-gray-800" />
        </span>
      ) : null}
    </div>
  );
}

function ToolGroup({ name, providerId, children, expandable = false, expanded = false, onToggle, badge = null, rightAdornment = null, toggleOnHeader = false }) {
  const providerKey = limitProviderIconKey(providerId);
  const header = (
    <div className="flex items-center gap-1.5">
      {providerKey ? (
        <ProviderIcon provider={providerKey} size={14} className={LIMITS_PROVIDER_ICON_CLASS} />
      ) : null}
      <span className="text-sm font-medium text-oai-black dark:text-oai-white">{name}</span>
      {rightAdornment ? <span className="shrink-0">{rightAdornment}</span> : null}
      {badge}
    </div>
  );

  if (!expandable) {
    return (
      <div className="flex flex-col gap-1.5">
        {header}
        {children}
      </div>
    );
  }

  if (toggleOnHeader) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="flex w-full items-center justify-between rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
        >
          {header}
          <ChevronDown size={13} aria-hidden className={`text-oai-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
        {children}
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle?.();
        }
      }}
      // Expanding reveals detail (e.g. Grok's per-product slices), so keyboard
      // focus needs the same visible ring as the card's other toggles.
      className="flex flex-col gap-1.5 -mx-1.5 px-1.5 py-1 rounded-lg cursor-pointer transition-colors hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40 aria-expanded:bg-oai-gray-50 dark:aria-expanded:bg-oai-gray-800/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
    >
      {header}
      {children}
    </div>
  );
}

const DEFAULT_ORDER = LIMIT_PROVIDER_IDS;

function StatusLine({ children, tone = "neutral" }) {
  const color =
    tone === "error"
      ? "text-red-600 dark:text-red-400"
      : "text-oai-gray-500 dark:text-oai-gray-400";
  return <div className={`text-[11px] leading-snug ${color}`}>{children}</div>;
}

// Wallet balances (Trae credits, CodeArts packages, AgentRouter cash) are not
// window quotas: they hold a remaining share, so the callers flip it to the
// used orientation once and hand LimitBar the same used-orientation pct that
// window rows pass — mode flip, threshold color and the 0% tick then behave
// identically on both row kinds.

function LimitWindowSection({ rows, mode, extra = null, expanded = false, picker = null }) {
  const showEmpty = rows.length === 0 && !extra;
  return (
    <>
      {rows.map(({ spec, pace, mode: rowMode = mode }) => {
        const rowPicker = picker ? {
          providerId: picker.providerId,
          rowKey: spec.key,
          checked: picker.selected.includes(petLimitRowKey(picker.providerId, spec.key)),
          full: picker.selected.length >= MAX_PET_LIMIT_ROWS,
          onToggle: picker.onToggle,
        } : null;
        const pct = readWindowPct(spec.window, spec.pctField);
        // The per-product split is detail: collapsed shows the whole pool,
        // expanding the group adds the legend. In remaining mode the shares
        // are portions of the amount used — legend-only, the bar is one fill
        // (upstream PR 904).
        const shareSegments = expanded && spec.productPool && Array.isArray(spec.segments) && spec.segments.length !== 0
          ? spec.segments
          : null;
        const barSegments = shareSegments && rowMode !== LIMIT_DISPLAY_MODES.REMAINING ? shareSegments : null;
        return (
          <React.Fragment key={spec.key}>
            <LimitBar
              label={spec.label ?? copy(spec.labelKey)}
              pct={pct}
              reset={formatReset(readWindowReset(spec.window, spec.resetField))}
              mode={rowMode}
              segments={barSegments}
              pacePercent={pace.pacePercent}
              paceOver={pace.paceOver}
              title={buildWindowHoverDetail(spec, pace, rowMode)}
              picker={rowPicker}
            />
            {shareSegments ? (
              <>
                <LimitSegmentLegend segments={shareSegments} fillColor={barColor(pct, LIMIT_DISPLAY_MODES.USED)} />
                {rowMode === LIMIT_DISPLAY_MODES.REMAINING ? (
                  <div
                    data-limit-share-note=""
                    className="-mt-0.5 text-[11px] leading-snug text-oai-gray-400 dark:text-oai-gray-500"
                    style={{ paddingLeft: "calc(var(--tt-limits-label-w, 0px) + 0.5rem)" }}
                  >
                    {copy("limits.grok.shares_are_used")}
                  </div>
                ) : null}
              </>
            ) : null}
          </React.Fragment>
        );
      })}
      {showEmpty ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
      {extra}
    </>
  );
}

function resetBankHoverDetail(row) {
  if (!Number.isFinite(row.expiresMs)) return null;
  const days = Math.floor((row.expiresMs - Date.now()) / 86400000);
  if (days < 0) return null;
  if (days === 0) return copy("limits.reset_bank.hover_detail_today", { date: row.expiresAt });
  return copy("limits.reset_bank.hover_detail", { date: row.expiresAt, days });
}

function ResetBankRow({ row }) {
  const widthPct = Math.max(0, Math.min(100, Number(row.percent) || 0));
  return (
    <div className="group relative flex items-center gap-2" data-reset-bank-row="">
      <Tooltip text={resetBankHoverDetail(row)} />
      <span
        data-limit-label=""
        className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400 shrink-0 whitespace-nowrap"
        style={{ width: "var(--tt-limits-label-w)" }}
      >
        {row.label}
      </span>
      <div className="relative flex-1 bg-oai-gray-100 dark:bg-oai-gray-700/50 rounded-full h-1.5 overflow-hidden">
        <div
          className="bg-oai-gray-400 dark:bg-oai-gray-500 rounded-full h-full transition-[width] duration-500 ease-out"
          style={{ width: `${widthPct}%`, minWidth: widthPct > 0 ? "3px" : 0 }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500 w-[4.25rem] text-right shrink-0 whitespace-nowrap">
        {row.expiresAt}
      </span>
    </div>
  );
}

function ResetBankSection({ model }) {
  const passiveText = model.kind === "count_only"
    ? copy("limits.codex_reset_bank.count_only", { count: model.availableCount })
    : null;

  return (
    <div className="mt-1 flex flex-col gap-1" data-reset-bank-section={model.kind}>
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
        {copy("limits.codex_reset_bank.title")}
      </div>
      {passiveText ? (
        <div className="text-[11px] leading-snug text-oai-gray-500 dark:text-oai-gray-400">{passiveText}</div>
      ) : (
        model.rows.map((row) => <ResetBankRow key={row.key} row={row} />)
      )}
    </div>
  );
}

// A clean zero hides the whole section; a fetch failure always counts as
// content so errors can't be buried (upstream PR 919, closes issue 888).
// Plain loop, not an arrow chain — the ui-hardcode scanner trips on `>`
// inside JSX-text heuristics.
function zcodeResetBankHasContent(data, now) {
  if (data.error) return true;
  for (const groupKey of ["five_hour", "weekly"]) {
    for (const card of data[groupKey] || []) {
      if (Date.parse(card.expires_at) > now) return true;
    }
  }
  return false;
}

function ZcodeResetBankSection({ data }) {
  const now = Date.now();
  if (!zcodeResetBankHasContent(data, now)) return null;
  const groups = [
    { key: "five_hour", label: copy("limits.label.zcode_5h") },
    { key: "weekly", label: copy("limits.label.zcode_weekly") },
  ].map((group) => ({
    ...group,
    cards: (data[group.key] || []).filter((card) => Date.parse(card.expires_at) > now)
      .slice().sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at)),
  }));
  const liveGroups = [];
  for (const group of groups) {
    if (group.cards.length !== 0) liveGroups.push(group);
  }
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
        {copy("limits.zcode.reset_bank.title")}
      </div>
      {data.error ? (
        <StatusLine tone="error">{copy("shared.error.prefix", { error: data.error })}</StatusLine>
      ) : liveGroups.map((group) => (
        <div key={group.key} className="flex items-center gap-2 text-[11px]">
          <span
            data-limit-label=""
            className="shrink-0 whitespace-nowrap text-oai-gray-500 dark:text-oai-gray-400"
            style={{ width: "var(--tt-limits-label-w)" }}
          >
            {group.label}
          </span>
          <span className="rounded-full bg-oai-gray-100 px-2 py-0.5 tabular-nums text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
            {copy("limits.zcode.reset_bank.count", { count: group.cards.length })}
          </span>
          {group.cards.length ? (
            <span
              className="ml-auto text-right text-[10px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500"
              title={group.cards.map((card) => formatExactReset(Date.parse(card.expires_at))).join("\n")}
            >
              {copy("limits.zcode.reset_bank.earliest", { time: formatExactReset(Date.parse(group.cards[0].expires_at)) })}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * TRAE SOLO's account summary lives at raw.entUsage.usage_summary. Compute it
 * here (kept out of JSX so the UI-hardcode scanner never sees a bare `>`
 * spanning into markup) and render one compact account row plus one quota bar
 * (mode-aware like the window rows, not a fixed green);
 * the per-grant list stays in the payload as data but is not listed.
 */
function traeAccountSummary(data) {
  const available = Number(data.trae_available_points);
  const grants = Array.isArray(data.trae_grants) ? data.trae_grants : [];
  const grantTotal = grants.reduce((sum, grant) => sum + Number(grant?.total || 0), 0);
  const total = Number.isFinite(Number(data.trae_total_points))
    ? Number(data.trae_total_points)
    : grantTotal;
  const used = Number.isFinite(Number(data.trae_used_points))
    ? Number(data.trae_used_points)
    : Math.max(0, total - available);
  const remainingPct = total > 0 && Number.isFinite(available)
    ? Math.max(0, Math.min(100, (available / total) * 100))
    : null;
  const nearestExpireAt = typeof data.trae_nearest_expire_at === "string"
    ? data.trae_nearest_expire_at
    : null;
  return {
    available,
    total,
    used,
    remainingPct,
    nearestExpireAt,
    showUsage: total > 0 && Number.isFinite(used),
  };
}

const formatTraeCredit = (value) => formatCreditAmount(value, { maximumFractionDigits: 2 });

// Wallet rows are pet-pickable like window rows: the row key must match the
// wallet row the pet side emits (pet-quips.js), or a picked wallet would never
// reach the hover card.
// Row keys of the pickable wallet rows (kept in step with pet-quips.js).
const WALLET_ROW_KEYS = ["trae::credits", "traeMain::credits", "codearts::credits", "agentRouter::balance"];

function walletRowPicker(picker, rowKey) {
  if (!picker) return null;
  return {
    providerId: picker.providerId,
    rowKey,
    checked: picker.selected.includes(petLimitRowKey(picker.providerId, rowKey)),
    full: picker.selected.length >= MAX_PET_LIMIT_ROWS,
    onToggle: picker.onToggle,
  };
}

function TraeWalletExtra({ data, picker, mode = LIMIT_DISPLAY_MODES.USED }) {
  const { available, total, used, remainingPct, nearestExpireAt } =
    traeAccountSummary(data);
  // remainingPct is a remaining share; LimitBar wants the used orientation.
  const usedPct = remainingPct == null ? null : 100 - remainingPct;

  return (
    <>
      {usedPct != null ? (
        <LimitBar
          label={copy("limits.label.wallet_credits")}
          pct={usedPct}
          mode={mode}
          picker={walletRowPicker(picker, "credits")}
          title={[
            copy("limits.label.trae_balance", { credits: formatTraeCredit(available) }),
            copy("limits.label.trae_usage", {
              total: formatTraeCredit(total),
              used: formatTraeCredit(used),
            }),
            nearestExpireAt
              ? copy("limits.label.trae_nearest", {
                  credits: formatTraeCredit(Number(data.trae_nearest_points)),
                  date: nearestExpireAt.slice(5, 10),
                })
              : null,
          ].filter(Boolean).join("\n")}
        />
      ) : null}
    </>
  );
}

function CodeArtsWalletExtra({ data, picker, mode = LIMIT_DISPLAY_MODES.USED }) {
  const available = Number(data.codearts_available_credits) || 0;
  const pkg = data.codearts_package;
  const total = Number(pkg?.total) || 0;
  const used = Math.max(0, total - available);
  const remainingPct = total ? Math.max(0, Math.min(100, (available / total) * 100)) : null;
  const usedPct = remainingPct == null ? null : 100 - remainingPct;

  return (
    <>
      {usedPct != null ? (
        <LimitBar
          label={copy("limits.label.wallet_credits")}
          pct={usedPct}
          mode={mode}
          picker={walletRowPicker(picker, "credits")}
          title={[
            copy("limits.label.codearts_wallets", {
              credits: formatCreditAmount(available, { maximumFractionDigits: 2 }),
              date: typeof data.codearts_reset_date === "string" && data.codearts_reset_date ? data.codearts_reset_date : "—",
            }),
            copy("limits.label.trae_usage", {
              total: formatCreditAmount(total, { maximumFractionDigits: 2 }),
              used: formatCreditAmount(used, { maximumFractionDigits: 2 }),
            }),
          ].join("\n")}
        />
      ) : null}
    </>
  );
}

function AgentRouterWalletExtra({ data, picker, mode = LIMIT_DISPLAY_MODES.USED }) {
  const balance = Number(data.agentrouter_balance_usd) || 0;
  const used = Number(data.agentrouter_used_usd) || 0;
  const total = balance + used;
  const remainingPct = total ? Math.max(0, Math.min(100, (balance / total) * 100)) : null;
  const usedPct = remainingPct == null ? null : 100 - remainingPct;

  return (
    <>
      {usedPct != null ? (
        <LimitBar
          label={copy("limits.label.wallet_balance")}
          pct={usedPct}
          mode={mode}
          picker={walletRowPicker(picker, "balance")}
          title={[
            copy("limits.label.agentrouter_balance", {
              balance: formatCreditAmount(balance, { maximumFractionDigits: 2 }),
              used: Number.isFinite(Number(data.agentrouter_used_usd))
                ? formatCreditAmount(used, { maximumFractionDigits: 2 })
                : "—",
            }),
            copy("limits.label.trae_usage", {
              total: "$" + formatCreditAmount(total, { maximumFractionDigits: 2 }),
              used: "$" + formatCreditAmount(used, { maximumFractionDigits: 2 }),
            }),
          ].join("\n")}
        />
      ) : null}
    </>
  );
}

function renderProviderExtra(kind, data, picker = null, mode = LIMIT_DISPLAY_MODES.USED) {
  if (kind === "zcode_reset_bank") {
    if (!data.reset_credits) return null;
    // A spent bank must pass a real null through so the no-data line renders
    // instead of a truthy element that draws nothing (upstream PR 919).
    return zcodeResetBankHasContent(data.reset_credits, Date.now())
      ? <ZcodeResetBankSection data={data.reset_credits} />
      : null;
  }
  if (kind === "codex_meta") {
    // Credit amounts show on hover (LimitBar's title) instead of an
    // always-visible line, matching the compact menu-bar popover.
    const resetModel = buildResetBankRows(data.reset_credits);
    return resetModel ? <ResetBankSection model={resetModel} /> : null;
  }
  if (kind === "kimi_parallel" && data.parallel_limit) {
    return <StatusLine>{copy("limits.label.kimi_parallel", { count: data.parallel_limit })}</StatusLine>;
  }
  if (
    kind === "kiro_credits" &&
    Number.isFinite(Number(data.tracked_credits)) &&
    Number(data.tracked_credit_records) > 0
  ) {
    const credits = formatCreditAmount(data.tracked_credits, {
      maximumFractionDigits: 2,
    });
    return (
      <StatusLine>
        {copy("limits.label.kiro_tracked_credits", {
          credits,
          count: Number(data.tracked_credit_records),
        })}
      </StatusLine>
    );
  }
  if (kind === "sensenova_grant" && Number(data.grant_credits) > 0) {
    // Granted credits are an expiring balance beside the two pools' windows,
    // so they read as a status line rather than a percentage bar.
    return (
      <StatusLine>
        {copy("limits.label.sensenova_grant", {
          credits: formatCreditAmount(Number(data.grant_credits), { maximumFractionDigits: 0 }),
          date: typeof data.grant_expires_at === "string" ? data.grant_expires_at.slice(0, 10) : "",
        })}
      </StatusLine>
    );
  }
  if (kind === "agentrouter_balance" && Number.isFinite(Number(data.agentrouter_balance_usd))) {
    return <AgentRouterWalletExtra data={data} picker={picker} mode={mode} />;
  }
  if (kind === "minimax_balance" && Number.isFinite(Number(data.minimax_balance))) {
    return (
      <StatusLine>
        {copy("limits.label.minimax_balance", {
          currency: typeof data.minimax_currency === "string" ? data.minimax_currency : "",
          balance: formatCreditAmount(Number(data.minimax_balance), { maximumFractionDigits: 2 }),
        })}
      </StatusLine>
    );
  }
  if (kind === "mistral_balance" && Number.isFinite(Number(data.mistral_balance))) {
    return (
      <StatusLine>
        {copy("limits.label.mistral_balance", {
          currency: typeof data.mistral_currency === "string" ? data.mistral_currency : "",
          balance: formatCreditAmount(Number(data.mistral_balance), { maximumFractionDigits: 2 }),
        })}
      </StatusLine>
    );
  }
  if (kind === "minimax_code_points" && Number.isFinite(Number(data.minimax_code_points))) {
    // Points are allowance units, not money (TM convention): no currency
    // conversion, no fake meter — one status line, expiry note when present.
    return (
      <StatusLine>
        {copy("limits.label.minimax_code_points", {
          points: formatCreditAmount(Number(data.minimax_code_points), { maximumFractionDigits: 0 }),
        })}
      </StatusLine>
    );
  }
  if (kind === "openai_credits_balance" && Number.isFinite(Number(data.openai_credits_available))) {
    // A wallet, not a plan: the balance plus the earliest active grant expiry
    // (blank when every remaining grant is perpetual). The meter bar above,
    // when present, only comes from a reconciled grant list.
    return (
      <StatusLine>
        {copy("limits.label.openai_credits_balance", {
          currency: typeof data.openai_credits_currency === "string" ? data.openai_credits_currency : "",
          balance: formatCreditAmount(Number(data.openai_credits_available), { maximumFractionDigits: 2 }),
          date: typeof data.openai_credits_expires_at === "string" ? data.openai_credits_expires_at.slice(0, 10) : "",
        })}
      </StatusLine>
    );
  }
  if (kind === "deepseek_balance" && Number.isFinite(Number(data.deepseek_total_balance))) {
    return (
      <StatusLine>
        {copy("limits.label.deepseek_balance", {
          currency: typeof data.deepseek_currency === "string" ? data.deepseek_currency : "",
          total: formatCreditAmount(Number(data.deepseek_total_balance), { maximumFractionDigits: 2 }),
          granted: formatCreditAmount(Number(data.deepseek_granted_balance), { maximumFractionDigits: 2 }),
        })}
      </StatusLine>
    );
  }
  if (kind === "trae_wallets" && Number.isFinite(Number(data.trae_available_points))) {
    // Older cached payloads carry only the nearest-expiry summary; keep that
    // line until the next fetch supplies trae_grants (then the per-batch bars
    // replace it). An empty grants array means every batch already expired.
    return <TraeWalletExtra data={data} picker={picker} mode={mode} />;
  }
  if (kind === "codearts_wallets" && Number.isFinite(Number(data.codearts_available_credits))) {
    return <CodeArtsWalletExtra data={data} picker={picker} mode={mode} />;
  }
  if (kind === "cline_wallets" && Array.isArray(data.cline_wallets) && data.cline_wallets.length) {
    const summary = data.cline_wallets
      .map((wallet) => wallet.name + " " + formatCreditAmount(Number(wallet.balance), { maximumFractionDigits: 2 }))
      .join(" · ");
    return (
      <StatusLine>
        {copy("limits.label.cline_wallets", { wallets: summary })}
      </StatusLine>
    );
  }
  if (kind === "raccoon_wallets" && Array.isArray(data.raccoon_wallets) && data.raccoon_wallets.length) {
    // 小浣熊 (Raccoon) wallets are balances without a fixed grant to pace
    // against, so they read as one status line: each non-zero wallet's own
    // API-provided name plus the total, no percentage bars.
    const wallets = data.raccoon_wallets.filter((wallet) => Number(wallet?.balance) !== 0);
    const visible = wallets.length ? wallets : data.raccoon_wallets.slice(0, 1);
    const summary = visible
      .map((wallet) => `${wallet.name || wallet.type} ${formatCreditAmount(Number(wallet.balance), { maximumFractionDigits: 0 })}`)
      .join(" · ");
    return (
      <StatusLine>
        {copy("limits.label.raccoon_wallets", {
          wallets: summary,
          total: formatCreditAmount(Number(data.raccoon_available_credits) || 0, { maximumFractionDigits: 0 }),
          unit: typeof data.raccoon_unit === "string" && data.raccoon_unit ? data.raccoon_unit : "",
        })}
      </StatusLine>
    );
  }
  if (kind === "copilot_otel" && !data.otel_has_files && !data.otel_enabled) {
    return <CopilotOtelHint defaultDir={data.otel_default_dir} />;
  }
  return null;
}

function ZcodeStartPlanSection({ data, mode, now }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const labelWidth = useWidestLabelWidth(containerRef);
  const planNames = [...new Set((data.buckets || []).map((bucket) => bucket.plan_name).filter(Boolean))];
  const title = planNames.length ? planNames.join(" · ") : copy("limits.zcode.start_grants");
  const rows = PROVIDER_LIMIT_SPECS.zcode.windows(data)
    .filter((s) => s.window)
    .map((s) => ({ spec: s, pace: paceForSpec(s, mode, now) }));
  return (
    <div className="mt-2 border-t border-oai-gray-200/60 pt-2 dark:border-oai-gray-800">
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}
        onKeyDown={(event) => event.stopPropagation()}
        className="flex w-full items-center gap-1.5 rounded text-xs text-oai-gray-500 transition-colors hover:text-oai-gray-800 dark:text-oai-gray-400 dark:hover:text-oai-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
      >
        <Gift size={13} aria-hidden />
        <span className="min-w-0 truncate" title={title}>{title}</span>
        <ChevronDown size={13} aria-hidden className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          ref={containerRef}
          data-limit-label-group=""
          className="mt-2 flex flex-col gap-1.5"
          style={labelWidth > 0 ? { "--tt-limits-label-w": `${labelWidth}px` } : undefined}
        >
          {data.error ? (
            <StatusLine tone="error">{copy("shared.error.prefix", { error: data.error })}</StatusLine>
          ) : (
            <>
              <LimitWindowSection rows={rows} mode={mode} />
              {(data.buckets || []).filter((bucket) => Number.isFinite(bucket.remaining_units) && Number.isFinite(bucket.total_units)).map((bucket, index) => (
                <div key={bucket.entitlement_id || index} className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
                  {copy("limits.zcode.grant_amount", {
                    remaining: bucket.remaining_units.toLocaleString(getCopyLocale()),
                    total: bucket.total_units.toLocaleString(getCopyLocale()),
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * ZCode queries both regions' balances while running, so the other region's
 * plan snapshot exists in the usage logs even without on-disk credentials for
 * it (absorbed from upstream PR 942). Renders collapsed behind a header toggle;
 * the snapshot line states how old the borrowed numbers are.
 */
function ZcodeOtherRegionSection({ data, mode, now }) {
  const other = data.other_region;
  const [expanded, setExpanded] = useState(false);
  if (!other || !Array.isArray(other.buckets) || !other.buckets.length) return null;
  const regionName = copy(other.region === "zai" ? "limits.zcode.region.zai" : "limits.zcode.region.bigmodel");
  const planLabel = other.plan_label || regionName;
  const rows = other.buckets
    .filter((bucket) => bucket?.window)
    .map((bucket, index) => {
      const spec = {
        key: `other_region_${bucket.entitlement_id || index}`,
        label: bucket.label || bucket.show_name || regionName,
        window: bucket.window,
      };
      return { spec, pace: paceForSpec(spec, mode, now) };
    });
  const snapshotAt = Date.parse(other.log_timestamp);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        data-limit-other-region-toggle=""
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-medium text-oai-gray-500 transition-colors hover:text-oai-gray-700 dark:text-oai-gray-400 dark:hover:text-oai-gray-200"
      >
        <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">
          {copy("limits.zcode.other_region.title", { region: regionName, plan: planLabel })}
        </span>
      </button>
      {expanded ? (
        <div className="mt-1 flex flex-col gap-1.5">
          <LimitWindowSection rows={rows} mode={mode} />
          <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
            {Number.isFinite(snapshotAt)
              ? copy("limits.zcode.other_region.snapshot", { time: formatExactReset(snapshotAt) })
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function renderConfiguredProvider(id, data, title, mode, expanded, onToggle, badge = null, now = Date.now(), onKeySaved = null, petPicker = null) {
  const spec = PROVIDER_LIMIT_SPECS[id];
  if (!spec) return null;
  // Pace is computed once per window here and shared by the bar + the detail.
  // Every window, including a segmented pool, follows the selected display
  // mode (upstream PR 904); the product slices stay "portions of the amount
  // used", so they only add up to the headline in used orientation.
  const rows = spec
    .windows(data)
    .filter((s) => s.window)
    .map((s) => ({ spec: s, pace: paceForSpec(s, mode, now) }));
  const extra = renderProviderExtra(spec.extra, data, petPicker ? { providerId: id, ...petPicker } : null, mode);
  return (
    <ToolGroup
      key={id}
      name={title}
      providerId={id}
      expandable={rows.length > 0}
      expanded={expanded}
      onToggle={onToggle}
      badge={badge}
      toggleOnHeader={id === "zcode"}
    >
      <LimitWindowSection mode={mode} rows={rows} extra={extra} expanded={expanded}
        picker={petPicker ? { providerId: id, ...petPicker } : null} />
      {id === "opencodeGo" || id === "commandCode" ? (
        <EnvCredentialNotice providerId={id} data={data} onSaved={onKeySaved} />
      ) : null}
      {expanded ? <LimitDetail rows={rows} mode={mode} now={now} /> : null}
      {id === "qoderCn" ? (
        <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie">
          <QoderCookieInput namespace="cn" onSaved={onKeySaved} />
        </CollapsibleCredentialSection>
      ) : null}
      {id === "qoder" ? (
        <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie">
          <QoderCookieInput namespace="intl" onSaved={onKeySaved} />
        </CollapsibleCredentialSection>
      ) : null}
      {id === "opendesign" ? (
        <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie">
          <OpenDesignCookieInput onSaved={onKeySaved} />
        </CollapsibleCredentialSection>
      ) : null}
      {id === "mistral" ? (
        <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie">
          <MistralCookieInput onSaved={onKeySaved} />
        </CollapsibleCredentialSection>
      ) : null}
      {id === "openaiCredits" ? (
        <CollapsibleCredentialSection labelKey="limits.cookieToggle.api">
          <OpenaiCreditsCredentialsInput onSaved={onKeySaved} />
        </CollapsibleCredentialSection>
      ) : null}
      {id === "zcode" && data.start_plan?.configured ? (
        <ZcodeStartPlanSection data={data.start_plan} mode={mode} now={now} />
      ) : null}
      {id === "zcode" && data.other_region ? (
        <ZcodeOtherRegionSection data={data} mode={mode} now={now} />
      ) : null}
    </ToolGroup>
  );
}

// Provider row for states without usable limit data (not connected, inactive,
// fetch error).
function renderUnlinkedProvider(id, statusNodes, expanded, onToggle) {
  return (
    <ToolGroup
      key={id}
      name={limitProviderName(id)}
      providerId={id}
      expandable={false}
      expanded={expanded}
      onToggle={onToggle}
    >
      {statusNodes}
    </ToolGroup>
  );
}

function renderProviderGroup(id, data, mode, expanded, onToggle, now = Date.now(), onKeySaved = null, petPicker = null) {
  if (!PROVIDER_LIMIT_SPECS[id]) return null;
  if (!data?.configured) {
    return renderUnlinkedProvider(
      id,
      <>
        <StatusLine>{copy("limits.status.not_connected")}</StatusLine>
        {MANUAL_CREDENTIAL_IDS.has(id) ? (
          <StatusLine>{copy("limits.status.manual_credential")}</StatusLine>
        ) : null}
        {id === "qoderCn" ? (
          <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie" defaultExpanded>
            <QoderCookieInput namespace="cn" onSaved={onKeySaved} />
          </CollapsibleCredentialSection>
        ) : null}
        {id === "qoder" ? (
          <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie" defaultExpanded>
            <QoderCookieInput namespace="intl" onSaved={onKeySaved} />
          </CollapsibleCredentialSection>
        ) : null}
        {id === "opendesign" ? (
          <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie" defaultExpanded>
            <OpenDesignCookieInput onSaved={onKeySaved} />
          </CollapsibleCredentialSection>
        ) : null}
        {id === "mistral" ? (
          <CollapsibleCredentialSection labelKey="limits.cookieToggle.cookie" defaultExpanded>
            <MistralCookieInput onSaved={onKeySaved} />
          </CollapsibleCredentialSection>
        ) : null}
        {id === "openaiCredits" ? (
          <CollapsibleCredentialSection labelKey="limits.cookieToggle.api" defaultExpanded>
            <OpenaiCreditsCredentialsInput onSaved={onKeySaved} />
          </CollapsibleCredentialSection>
        ) : null}
        {id === "opencodeGo" ? <OpenCodeGoSetupHint onSaved={onKeySaved} /> : null}
        {id === "commandCode" ? <CommandCodeSetupHint /> : null}
        {id === "codingPlan" ? <ArkCodingPlanSetupHint /> : null}
        {id === "agentPlan" ? <ArkAgentPlanSetupHint /> : null}
        {id === "devin" ? <DevinSetupHint /> : null}
      </>,
      expanded,
      onToggle,
    );
  }
  if (id === "opencodeGo" && data.subscription_status === "inactive") {
    return renderUnlinkedProvider(
      id,
      <StatusLine>{copy("limits.opencodeGo.status.inactive")}</StatusLine>,
      expanded,
      onToggle,
    );
  }
  // WorkBuddy deletes its IPC endpoint when the desktop client quits, so
  // "not running / not signed in" is an idle state, not a failure. Keep the
  // hint, drop the red error styling reserved for real problems.
  if (data.error && data.reason === "client_not_running") {
    return renderUnlinkedProvider(
      id,
      <StatusLine>{copy("limits.status.client_not_running", { app: limitProviderName(id) })}</StatusLine>,
      expanded,
      onToggle,
    );
  }
  if (data.error) {
    return renderUnlinkedProvider(
      id,
      <>
        <StatusLine tone="error">{copy("shared.error.prefix", { error: data.error })}</StatusLine>
        {id === "kiro"
          ? renderProviderExtra(PROVIDER_LIMIT_SPECS.kiro.extra, data)
          : null}
        {id === "opencodeGo" ? <OpenCodeGoSetupHint onSaved={onKeySaved} /> : null}
        {id === "commandCode" ? <CommandCodeSetupHint /> : null}
        {id === "codingPlan" ? <ArkCodingPlanSetupHint /> : null}
        {id === "agentPlan" ? <ArkAgentPlanSetupHint /> : null}
        {id === "devin" ? <DevinSetupHint /> : null}
        {id === "opendesign" ? <OpenDesignCookieInput onSaved={onKeySaved} /> : null}
      {id === "mistral" ? <MistralCookieInput onSaved={onKeySaved} /> : null}
      {id === "openaiCredits" ? <OpenaiCreditsCredentialsInput onSaved={onKeySaved} /> : null}
      </>,
      expanded,
      onToggle,
    );
  }

  const baseName = limitProviderName(id);
  const title = data.plan_label ? `${baseName} ${data.plan_label}` : baseName;
  let badge = null;
  // Reauth is more actionable than a cached/live freshness badge: the bars
  // will not move again until the user signs in, even if a disk snapshot
  // is still visible.
  if (data.auth_action_required === "reauth") {
    const command =
      id === "commandCode"
        ? commandCodeLoginSnippet()
        : id === "devin"
          ? devinLoginSnippet()
          : REAUTH_CLI_COMMANDS[id];
    badge = (
      <StatusBadge
        label={copy("limits.reauth.badge")}
        age={ago(data.cached_at)}
        tone="stale"
        tooltip={command ? copy("limits.reauth.tooltip", { command }) : null}
      />
    );
  }
  if (!badge && id === "antigravity") {
    if (data.cached) {
      const suffix = ago(data.cached_at);
      badge = <StatusBadge label={copy("limits.label.antigravity_cached")} age={suffix} tone="cached" tooltip={copy("limits.tooltip.antigravity_cached")} />;
    } else {
      badge = <StatusBadge label={copy("limits.label.antigravity_live")} tone="live" tooltip={copy("limits.tooltip.antigravity_live")} />;
    }
  }
  if (!badge && (id === "qoder" || id === "qoderCn") && data.cached) {
    badge = (
      <StatusBadge
        label={copy("limits.label.antigravity_cached")}
        age={ago(data.cached_at)}
        tone="cached"
        tooltip={copy("limits.tooltip.qoder_cached")}
      />
    );
  }
  // Ark plans are refreshed by the local arkcli binary, not by launching an
  // app — a Qoder-specific tooltip would send users to the wrong tool.
  if (!badge && (id === "codingPlan" || id === "agentPlan") && data.cached) {
    badge = (
      <StatusBadge
        label={copy("limits.label.antigravity_cached")}
        age={ago(data.cached_at)}
        tone="cached"
        tooltip={copy("limits.tooltip.ark_cached")}
      />
    );
  }
  const provenance = data.provenance;
  // Fresh data is the norm — flagging it on every provider would fill the
  // panel with a dozen permanently pulsing "Live" badges. Surface provenance
  // only on the exception: data served from a cache that has gone stale.
  // Provider-specific badges (currently Antigravity's cached/live state)
  // already communicate freshness; don't render the same state twice.
  if (provenance?.stale && !badge) {
    badge = <StatusBadge
      label={copy("limits.provenance.stale")}
      age={ago(provenance.captured_at)}
      tone="stale"
      tooltip={copy("limits.provenance.tooltip", { source: provenance.source, confidence: provenance.confidence })}
    />;
  }
  return renderConfiguredProvider(id, data, title, mode, expanded, onToggle, badge, now, onKeySaved, petPicker);
}

function CopilotOtelHint({ defaultDir }) {
  const [copied, setCopied] = useState(false);
  const dir = defaultDir || "$HOME/.copilot/otel";
  const snippet = [
    "export COPILOT_OTEL_ENABLED=true",
    "export COPILOT_OTEL_EXPORTER_TYPE=file",
    `export COPILOT_OTEL_FILE_EXPORTER_PATH="${dir}/copilot-otel-$(date +%Y%m%d).jsonl"`,
  ].join("\n");

  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_e) {
      // Clipboard can be unavailable in embedded or restricted contexts.
    }
  };

  return (
    <div className="mt-1 rounded-md border border-amber-300/60 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 px-2.5 py-2 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="font-medium text-oai-gray-700 dark:text-oai-gray-200">{copy("limits.copilot.otelHint.title")}</div>
      <div className="mt-0.5 leading-snug">{copy("limits.copilot.otelHint.body")}</div>
      <pre className="mt-1.5 overflow-x-auto rounded bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-tight whitespace-pre">{snippet}</pre>
      <button
        type="button"
        onClick={onCopy}
        className="mt-1 inline-flex items-center gap-1 rounded border border-oai-gray-300 dark:border-oai-gray-700 px-1.5 py-0.5 text-[10.5px] text-oai-gray-700 dark:text-oai-gray-200 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors"
      >
        {copied ? copy("limits.copilot.otelHint.copied") : copy("limits.copilot.otelHint.copy")}
      </button>
    </div>
  );
}

function HintStep({ n, children }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-oai-brand/15 text-[9px] font-semibold text-oai-brand">
        {n}
      </span>
      <div className="min-w-0 flex-1 leading-snug">{children}</div>
    </li>
  );
}

function ExternalArrow() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 2.75h4.75V7.5M9.25 2.75 3 9" />
    </svg>
  );
}

// OpenCode Go limits come from OpenCode's official authenticated usage API
// (GET /zen/go/v1/usage, Bearer API key) once the user subscribes. The key is
// pasted straight into the box below and saved by the loopback backend to
// ~/.tokentracker/opencode-go-credentials.json, so it takes effect on the next
// refresh with no environment variable and no restart. The command-line path
// stays as a secondary option for wrapper/headless installs and is now
// platform aware — it used to print a macOS-only `launchctl setenv` line on
// Windows, where it could never work.
function OpenCodeGoSetupHint({ onSaved = null }) {
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(copyTimer.current); };
  }, []);
  const snippet = openCodeGoSetupSnippet();

  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet);
      if (!mounted.current) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch (_e) {
      // Clipboard can be unavailable in embedded or restricted contexts.
    }
  };

  return (
    <div className="mt-1.5 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700/60 bg-oai-gray-50/50 dark:bg-oai-gray-900/20 p-3 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="text-[12px] font-semibold text-oai-gray-800 dark:text-oai-gray-100">{copy("limits.opencodeGo.setupHint.title")}</div>
      <div className="mt-0.5 leading-snug text-oai-gray-500 dark:text-oai-gray-400">{copy("limits.opencodeGo.setupHint.subtitle")}</div>

      <ol className="mt-2.5 space-y-2.5">
        <HintStep n="1">
          <div>{copy("limits.opencodeGo.setupHint.step1")}</div>
          <a
            href="https://opencode.ai"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 transition-colors"
          >
            {copy("limits.opencodeGo.setupHint.cta")}
            <ExternalArrow />
          </a>
        </HintStep>
        <HintStep n="2">
          <div>{copy("limits.opencodeGo.setupHint.step2")}</div>
        </HintStep>
        <HintStep n="3">
          <div>{copy("limits.opencodeGo.setupHint.step3")}</div>
          <ProviderKeyInput provider="opencode-go" onSaved={onSaved} />
        </HintStep>
        <HintStep n="4">
          <div className="flex items-center gap-2">
            <span>{copy("limits.opencodeGo.setupHint.step4")}</span>
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 rounded-md border border-oai-gray-300 dark:border-oai-gray-700 px-2 py-0.5 text-[10.5px] text-oai-gray-700 dark:text-oai-gray-200 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors"
            >
              {copied ? copy("limits.opencodeGo.setupHint.copied") : copy("limits.opencodeGo.setupHint.copy")}
            </button>
          </div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">{snippet}</pre>
          <div className="mt-1 text-[10px] text-oai-gray-400 dark:text-oai-gray-500">{copy("limits.opencodeGo.setupHint.cli_note")}</div>
        </HintStep>
      </ol>
      <CollapsibleCredentialSection labelKey="limits.opencodeGo.cookie.toggle">
        <OpenCodeGoCookieInput onSaved={onSaved} />
      </CollapsibleCredentialSection>
    </div>
  );
}

// Command Code subscription usage comes from the CLI's own alpha endpoints,
// authenticated exactly like the `cmd` CLI itself. Two supported logins: the
// `cmd login` session the CLI stores in ~/.commandcode/auth.json (picked up
// with no restart), or a COMMAND_CODE_API_KEY env var. TokenTracker never
// exposes the credential to the dashboard; the local backend sends it only to
// Command Code's API.
function CommandCodeSetupHint() {
  const [copied, setCopied] = useState(false);
  // Command lines stay identical across locales; they are copy keys per the
  // repo i18n convention (review 594) so the setup guide and the reauth
  // tooltip share one source of truth for `cmd login`.
  const platform = commandCodeSetupPlatform();
  const loginSnippet = commandCodeLoginSnippet();
  const snippet = platform === "windows"
    ? copy("limits.commandCode.setupHint.snippet_env_windows").replaceAll("\\n", "\n")
    : [
    copy("limits.commandCode.setupHint.snippet_read"),
    copy("limits.commandCode.setupHint.snippet_export"),
    ...(platform === "macos" ? [copy("limits.commandCode.setupHint.snippet_setenv")] : []),
  ].join("\n");

  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_e) {
      // Clipboard can be unavailable in embedded or restricted contexts.
    }
  };

  return (
    <div className="mt-1.5 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700/60 bg-oai-gray-50/50 dark:bg-oai-gray-900/20 p-3 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="text-[12px] font-semibold text-oai-gray-800 dark:text-oai-gray-100">
        {copy("limits.commandCode.setupHint.title")}
      </div>
      <div className="mt-0.5 leading-snug text-oai-gray-500 dark:text-oai-gray-400">
        {copy("limits.commandCode.setupHint.subtitle")}
      </div>

      <ol className="mt-2.5 space-y-2.5">
        <HintStep n="1">
          <div>{copy("limits.commandCode.setupHint.step1")}</div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">
            {loginSnippet}
          </pre>
        </HintStep>
        <HintStep n="2">
          <div>{copy("limits.commandCode.setupHint.step2")}</div>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 rounded-md border border-oai-gray-300 dark:border-oai-gray-700 px-2 py-0.5 text-[10.5px] text-oai-gray-700 dark:text-oai-gray-200 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors"
            >
              {copied
                ? copy("limits.commandCode.setupHint.copied")
                : copy("limits.commandCode.setupHint.copy")}
            </button>
          </div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">
            {snippet}
          </pre>
          <div className="mt-1 text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
            {platform === "windows" ? copy("limits.commandCode.setupHint.note_windows")
              : platform === "linux" ? copy("limits.commandCode.setupHint.note_linux")
                : copy("limits.commandCode.setupHint.note_app")}
          </div>
        </HintStep>
      </ol>
    </div>
  );
}

// Devin quota is read through the Devin CLI's saved sign-in on this machine
// — the backend reuses the session token the CLI wrote to its credentials
// file, so all the row needs is the CLI installed and signed in once.
// TokenTracker only ever sends that token to Devin's official quota endpoint.
function DevinSetupHint() {
  const loginSnippet = devinLoginSnippet();

  return (
    <div className="mt-1.5 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700/60 bg-oai-gray-50/50 dark:bg-oai-gray-900/20 p-3 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="text-[12px] font-semibold text-oai-gray-800 dark:text-oai-gray-100">
        {copy("limits.devin.setupHint.title")}
      </div>
      <div className="mt-0.5 leading-snug text-oai-gray-500 dark:text-oai-gray-400">
        {copy("limits.devin.setupHint.subtitle")}
      </div>

      <ol className="mt-2.5 space-y-2.5">
        <HintStep n="1">
          <div>{copy("limits.devin.setupHint.step1")}</div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">
            {loginSnippet}
          </pre>
          <div className="mt-1 text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
            {copy("limits.devin.setupHint.note")}
          </div>
        </HintStep>
      </ol>
    </div>
  );
}

// Ark Coding Plan (火山方舟) quota comes from the official Ark CLI (arkcli)
// running on this machine — there is no public quota endpoint, so the CLI is
// feature-detected at fetch time. When it is missing (or not signed in) the
// provider reports `configured: false` and this inline guide shows how to
// enable it, mirroring the OpenCode Go flow.
function ArkCodingPlanSetupHint() {
  const [copied, setCopied] = useState(false);
  const snippet = [
    "npm install -g @volcengine/ark-cli",
    "arkcli auth login volc-sso   # browser SSO (recommended)",
    "arkcli auth status           # verify the session",
  ].join("\n");

  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_e) {
      // Clipboard can be unavailable in embedded or restricted contexts.
    }
  };

  return (
    <div className="mt-1.5 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700/60 bg-oai-gray-50/50 dark:bg-oai-gray-900/20 p-3 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="text-[12px] font-semibold text-oai-gray-800 dark:text-oai-gray-100">{copy("limits.codingPlan.setupHint.title")}</div>
      <div className="mt-0.5 leading-snug text-oai-gray-500 dark:text-oai-gray-400">{copy("limits.codingPlan.setupHint.subtitle")}</div>

      <ol className="mt-2.5 space-y-2.5">
        <HintStep n="1">
          <div>{copy("limits.codingPlan.setupHint.step1")}</div>
          <a
            href="https://www.volcengine.com/docs/82379/2536875"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 transition-colors"
          >
            {copy("limits.codingPlan.setupHint.cta")}
            <ExternalArrow />
          </a>
        </HintStep>
        <HintStep n="2">
          <div>{copy("limits.codingPlan.setupHint.step2")}</div>
          <div className="mt-0.5 text-oai-gray-500 dark:text-oai-gray-400">{copy("limits.codingPlan.setupHint.step2_remote")}</div>
        </HintStep>
        <HintStep n="3">
          <div className="flex items-center gap-2">
            <span>{copy("limits.codingPlan.setupHint.step3")}</span>
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 rounded-md border border-oai-gray-300 dark:border-oai-gray-700 px-2 py-0.5 text-[10.5px] text-oai-gray-700 dark:text-oai-gray-200 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors"
            >
              {copied ? copy("limits.codingPlan.setupHint.copied") : copy("limits.codingPlan.setupHint.copy")}
            </button>
          </div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">{snippet}</pre>
          <div className="mt-1 text-[10px] text-oai-gray-400 dark:text-oai-gray-500">{copy("limits.codingPlan.setupHint.note_app")}</div>
        </HintStep>
      </ol>
    </div>
  );
}

function ArkAgentPlanSetupHint() {
  const [copied, setCopied] = useState(false);
  // Command lines stay identical across locales; only the inline comments
  // localize. Kept as copy keys per the repo i18n convention (review 563).
  const snippet = [
    copy("limits.agentPlan.setupHint.snippet_install"),
    copy("limits.agentPlan.setupHint.snippet_login"),
    copy("limits.agentPlan.setupHint.snippet_status"),
  ].join("\n");

  const onCopy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_e) {
      // Clipboard can be unavailable in embedded or restricted contexts.
    }
  };

  return (
    <div className="mt-1.5 rounded-lg border border-oai-gray-200 dark:border-oai-gray-700/60 bg-oai-gray-50/50 dark:bg-oai-gray-900/20 p-3 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="text-[12px] font-semibold text-oai-gray-800 dark:text-oai-gray-100">{copy("limits.agentPlan.setupHint.title")}</div>
      <div className="mt-0.5 leading-snug text-oai-gray-500 dark:text-oai-gray-400">{copy("limits.agentPlan.setupHint.subtitle")}</div>

      <ol className="mt-2.5 space-y-2.5">
        <HintStep n="1">
          <div>{copy("limits.agentPlan.setupHint.step1")}</div>
          <a
            href="https://www.volcengine.com/docs/82379/2536875"
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-1 inline-flex items-center gap-1 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 transition-colors"
          >
            {copy("limits.agentPlan.setupHint.cta")}
            <ExternalArrow />
          </a>
        </HintStep>
        <HintStep n="2">
          <div>{copy("limits.agentPlan.setupHint.step2")}</div>
          <div className="mt-0.5 text-oai-gray-500 dark:text-oai-gray-400">{copy("limits.agentPlan.setupHint.step2_remote")}</div>
        </HintStep>
        <HintStep n="3">
          <div className="flex items-center gap-2">
            <span>{copy("limits.agentPlan.setupHint.step3")}</span>
            <button
              type="button"
              onClick={onCopy}
              className="shrink-0 rounded-md border border-oai-gray-300 dark:border-oai-gray-700 px-2 py-0.5 text-[10.5px] text-oai-gray-700 dark:text-oai-gray-200 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors"
            >
              {copied ? copy("limits.agentPlan.setupHint.copied") : copy("limits.agentPlan.setupHint.copy")}
            </button>
          </div>
          <pre className="mt-1.5 overflow-x-auto rounded-md bg-oai-gray-100 dark:bg-oai-gray-900/60 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed whitespace-pre">{snippet}</pre>
          <div className="mt-1 text-[10px] text-oai-gray-400 dark:text-oai-gray-500">{copy("limits.agentPlan.setupHint.note_app")}</div>
        </HintStep>
      </ol>
    </div>
  );
}

/**
 * Width of the widest rendered row label, so every label column matches it.
 * Mirrors the macOS popover behavior: bars stay aligned without reserving
 * space for labels that aren't on screen, and longer labels (Spark,
 * localized strings) still fit without truncation.
 */
function useWidestLabelWidth(containerRef) {
  const [labelWidth, setLabelWidth] = useState(0);
  // Re-measure only when the measured input (label texts × canvas font)
  // actually changes. The effect deliberately has no dependency array (it
  // must observe every committed DOM), which makes a bare setState here one
  // half of any nested-update storm (React issue 185) another effect can start —
  // measuring identical inputs must schedule nothing at all.
  const measuredSignatureRef = useRef("");
  const [fontEpoch, setFontEpoch] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    if (!fonts) return undefined;
    // A late-loading webfont changes measureText widths without changing the
    // font string; force one re-measure when a load settles.
    const onLoadingDone = () => setFontEpoch((epoch) => epoch + 1);
    fonts.addEventListener("loadingdone", onLoadingDone);
    return () => fonts.removeEventListener("loadingdone", onLoadingDone);
  }, []);
  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const labels = [...root.querySelectorAll("[data-limit-label]")]
      .filter((label) => label.closest("[data-limit-label-group]") === root);
    // An empty frame (provider data mid-swap) must not zero the column width.
    if (labels.length === 0) return;
    let max = 0;
    let ctx = null;
    try {
      ctx = document.createElement("canvas").getContext("2d");
    } catch (_e) {
      ctx = null;
    }
    let font = "";
    if (ctx) {
      const style = window.getComputedStyle(labels[0]);
      font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ctx.font = font;
      for (const el of labels) {
        max = Math.max(max, ctx.measureText(el.textContent).width);
      }
    }
    const signature = `${fontEpoch}|${font}|${labels.map((el) => el.textContent).join("\n")}`;
    if (measuredSignatureRef.current === signature) return;
    measuredSignatureRef.current = signature;
    const next = Math.ceil(max);
    setLabelWidth((prev) => (prev === next ? prev : next));
  });
  return labelWidth;
}

// Loopback endpoint per provider key file. Saving is one-way: the backend
// stores the key locally and the dashboard never reads it back.
const PROVIDER_KEY_ENDPOINT = {
  "opencode-go": "/functions/tokentracker-opencode-go-key",
};

async function saveProviderApiKey(provider, value) {
  const endpoint = PROVIDER_KEY_ENDPOINT[provider];
  if (!endpoint) throw new Error(`Unsupported provider key store: ${provider}`);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...(await getLocalApiAuthHeaders()),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ apiKey: value }),
  });
  if (!res.ok) {
    // Surface the backend's reason ("invalid_api_key", "invalid_cookie",
    // "write_failed", a 404 when the running server predates the route)
    // instead of a bare "save failed" the user cannot act on.
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

function ProviderKeyInput({ provider, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(false);
  const [detail, setDetail] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const value = apiKey.trim();
    if (!value || status === "saving") return;
    setStatus("saving");
    setError(false);
    setDetail("");
    try {
      await saveProviderApiKey(provider, value);
      setApiKey("");
      setStatus("saved");
      onSaved?.();
    } catch (err) {
      setStatus("idle");
      setError(true);
      setDetail(err?.message || "");
    }
  };

  return (
    <form
      className="mt-1.5 space-y-1.5"
      onSubmit={onSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => {
            setApiKey(e.target.value);
            setStatus("idle");
            setError(false);
          }}
          placeholder={copy("limits.apiKey.placeholder")}
          aria-label={copy("limits.apiKey.placeholder")}
          autoComplete="new-password"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-oai-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-oai-gray-800 outline-none focus:border-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
        />
        <button
          type="submit"
          disabled={!apiKey.trim() || status === "saving"}
          className="shrink-0 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 disabled:opacity-50 transition-colors"
        >
          {status === "saving"
            ? copy("limits.apiKey.saving")
            : status === "saved"
              ? copy("limits.apiKey.saved")
              : copy("limits.apiKey.save")}
        </button>
      </div>
      <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
        {error
          ? copy("limits.apiKey.save_failed_detail", { detail: detail || "unknown" })
          : copy("limits.apiKey.local_note")}
      </div>
    </form>
  );
}

// Cookie alternative for users who never created an API key: the signed-in
// opencode.ai `auth` cookie (the legacy scrape path, already implemented in
// src/lib/opencode-go-limits.js) is all the workspace page needs. It shares the
// credentials file with the key, but the key is tried first, so an existing
// rejected key has to be cleared before the cookie can be used.
function OpenCodeGoCookieInput({ onSaved }) {
  const [cookie, setCookie] = useState("");
  const [status, setStatus] = useState("idle");
  const [detail, setDetail] = useState("");

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const value = cookie.trim();
    if (!value || status === "saving") return;
    setStatus("saving");
    setDetail("");
    try {
      const res = await fetch("/functions/tokentracker-opencode-go-key", {
        method: "POST",
        headers: {
          ...(await getLocalApiAuthHeaders()),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ cookie: value }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || `HTTP ${res.status}`);
      }
      setCookie("");
      setStatus("saved");
      onSaved?.();
    } catch (err) {
      setDetail(err?.message || "");
      setStatus("failed");
    }
  };

  const onClear = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await fetch("/functions/tokentracker-opencode-go-key", {
        method: "POST",
        headers: {
          ...(await getLocalApiAuthHeaders()),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ clear: true }),
      });
      setStatus("idle");
      setDetail("");
      onSaved?.();
    } catch (_e) {
      setStatus("failed");
      setDetail("clear_failed");
    }
  };

  return (
    <form className="mt-1.5 space-y-1.5" onSubmit={onSubmit} onClick={(e) => e.stopPropagation()}>
      <textarea
        value={cookie}
        onChange={(e) => { setCookie(e.target.value); setStatus("idle"); setDetail(""); }}
        placeholder={copy("limits.opencodeGo.cookie.placeholder")}
        aria-label={copy("limits.opencodeGo.cookie.placeholder")}
        rows={2}
        spellCheck={false}
        className="w-full rounded-md border border-oai-gray-300 bg-white px-2 py-1 font-mono text-[10.5px] text-oai-gray-800 outline-none focus:border-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!cookie.trim() || status === "saving"}
          className="rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 disabled:opacity-50 transition-colors"
        >
          {status === "saving"
            ? copy("limits.apiKey.saving")
            : status === "saved"
              ? copy("limits.apiKey.saved")
              : copy("limits.opencodeGo.cookie.save")}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-md border border-oai-gray-300 px-2 py-1 text-oai-gray-600 hover:bg-oai-gray-100 dark:border-oai-gray-700 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800 transition-colors"
        >
          {copy("limits.opencodeGo.cookie.clear")}
        </button>
      </div>
      <div className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500">
        {status === "failed"
          ? copy("limits.apiKey.save_failed_detail", { detail: detail || "unknown" })
          : copy("limits.opencodeGo.cookie.hint")}
      </div>
    </form>
  );
}

// A key can still arrive through the process environment (wrapper scripts,
// headless installs). Show where it came from and how to stop exporting it
// globally, because the env value shadows any key saved in the panel.
function EnvCredentialNotice({ providerId, data, onSaved }) {
  if (data?.credential_source !== "env") return null;
  const envName = PROVIDER_KEY_ENV[providerId];
  const storeId = PROVIDER_KEY_STORE_ID[providerId];
  // Only providers with a working save endpoint can offer the "save it here
  // instead" box; without one the notice would be a dead end.
  if (!envName || !storeId || !PROVIDER_KEY_ENDPOINT[storeId]) return null;
  return (
    <div className="mt-1.5 rounded-md border border-amber-300/60 bg-amber-50/60 px-2 py-1.5 text-[10.5px] leading-snug text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <div>{copy("limits.apiKey.env_note", { env: envName })}</div>
      <ProviderKeyInput provider={storeId} onSaved={onSaved} />
      {commandCodeSetupPlatform() === "macos" ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[10px] dark:bg-oai-gray-900/60">
            {copy("limits.apiKey.env_unset_command", { env: envName })}
          </code>
          <span>{copy("limits.apiKey.env_unset_note")}</span>
        </div>
      ) : null}
    </div>
  );
}

// Paste box for the hand-copied open-design.ai Cookie. Same contract as the
// Qoder box: a session credential only the user's own browser holds, saved by
// the loopback backend to the same file the usage fetch reads
// (opendesign-credentials.json). Never echoed back; sent only to the local API.
// Credential paste boxes (Qoder CN/Intl, OpenDesign, Mistral, OpenAI credits)
// collapse to a one-line toggle by default: five boxes each carrying an input
// row plus a multi-line hint buried the quota bars the page exists for. The
// form mounts lazily on expand; an unlinked card expands by default because
// there the paste box IS the setup action, not decoration.
function CollapsibleCredentialSection({ labelKey, defaultExpanded = false, children }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="mt-1.5">
      <button
        type="button"
        data-credential-toggle=""
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((value) => !value);
        }}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11px] font-medium text-oai-gray-500 transition-colors hover:text-oai-gray-700 dark:text-oai-gray-400 dark:hover:text-oai-gray-200"
      >
        <ChevronDown size={13} aria-hidden className={`shrink-0 text-oai-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        <span className="truncate">{copy(labelKey)}</span>
      </button>
      {expanded ? children : null}
    </div>
  );
}

function OpenDesignCookieInput({ onSaved }) {
  const [cookie, setCookie] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const value = cookie.trim();
    if (!value || status === "saving") return;
    setStatus("saving");
    setError(false);
    try {
      const res = await fetch("/functions/tokentracker-opendesign-cookie", {
        method: "POST",
        headers: {
          ...(await getLocalApiAuthHeaders()),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ cookie: value }),
      });
      if (!res.ok) throw new Error();
      setCookie("");
      setStatus("saved");
      onSaved?.();
    } catch (_e) {
      setStatus("idle");
      setError(true);
    }
  };

  return (
    <form
      className="mt-1.5 space-y-1.5"
      onSubmit={onSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={cookie}
          onChange={(e) => {
            setCookie(e.target.value);
            setStatus("idle");
            setError(false);
          }}
          placeholder={copy("limits.opendesignCookie.placeholder")}
          aria-label={copy("limits.opendesignCookie.placeholder")}
          autoComplete="new-password"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-oai-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-oai-gray-800 outline-none focus:border-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
        />
        <button
          type="submit"
          disabled={!cookie.trim() || status === "saving"}
          className="shrink-0 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 disabled:opacity-50 transition-colors"
        >
          {status === "saving"
            ? copy("limits.qoderCookie.saving")
            : status === "saved"
              ? copy("limits.qoderCookie.saved")
              : copy("limits.qoderCookie.save")}
        </button>
      </div>
      <div className="text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
        {error ? copy("limits.qoderCookie.save_failed") : copy("limits.opendesignCookie.note")}
      </div>
    </form>
  );
}

// Paste box for the hand-copied Mistral Admin Cookie. Same contract as the
// OpenDesign box: a session credential only the user's own browser holds,
// saved by the loopback backend to the same file the usage fetch reads
// (mistral-credentials.json). Never echoed back; sent only to the local API.
function MistralCookieInput({ onSaved }) {
  const [cookie, setCookie] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const value = cookie.trim();
    if (!value || status === "saving") return;
    setStatus("saving");
    setError(false);
    try {
      const res = await fetch("/functions/tokentracker-mistral-cookie", {
        method: "POST",
        headers: {
          ...(await getLocalApiAuthHeaders()),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ cookie: value }),
      });
      if (!res.ok) throw new Error();
      setCookie("");
      setStatus("saved");
      onSaved?.();
    } catch (_e) {
      setStatus("idle");
      setError(true);
    }
  };

  return (
    <form
      className="mt-1.5 space-y-1.5"
      onSubmit={onSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={cookie}
          onChange={(e) => {
            setCookie(e.target.value);
            setStatus("idle");
            setError(false);
          }}
          placeholder={copy("limits.mistralCookie.placeholder")}
          aria-label={copy("limits.mistralCookie.placeholder")}
          autoComplete="new-password"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-oai-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-oai-gray-800 outline-none focus:border-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
        />
        <button
          type="submit"
          disabled={!cookie.trim() || status === "saving"}
          className="shrink-0 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 disabled:opacity-50 transition-colors"
        >
          {status === "saving"
            ? copy("limits.qoderCookie.saving")
            : status === "saved"
              ? copy("limits.qoderCookie.saved")
              : copy("limits.qoderCookie.save")}
        </button>
      </div>
      <div className="text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
        {error ? copy("limits.qoderCookie.save_failed") : copy("limits.mistralCookie.note")}
      </div>
    </form>
  );
}

// Two-field paste box for the OpenAI Platform session credentials: the
// Authorization header value and the OpenAI-Organization id, both copied from
// the billing page's credit_grants request in DevTools. Saved by the loopback
// backend to openai-credits-credentials.json — the same file the usage fetch
// reads. Never echoed back; sent only to the local API.
function OpenaiCreditsCredentialsInput({ onSaved }) {
  const [sessionBearer, setSessionBearer] = useState("");
  const [organization, setOrganization] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const token = sessionBearer.trim();
    const org = organization.trim();
    if (!token || !org || status === "saving") return;
    setStatus("saving");
    setError(false);
    try {
      const res = await fetch("/functions/tokentracker-openai-credits-credentials", {
        method: "POST",
        headers: {
          ...(await getLocalApiAuthHeaders()),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ sessionBearer: token, organization: org }),
      });
      if (!res.ok) throw new Error();
      setSessionBearer("");
      setOrganization("");
      setStatus("saved");
      onSaved?.();
    } catch (_e) {
      setStatus("idle");
      setError(true);
    }
  };

  const inputClassName = "min-w-0 flex-1 rounded-md border border-oai-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-oai-gray-800 outline-none focus:border-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100";
  return (
    <form
      className="mt-1.5 space-y-1.5"
      onSubmit={onSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={sessionBearer}
          onChange={(e) => {
            setSessionBearer(e.target.value);
            setStatus("idle");
            setError(false);
          }}
          placeholder={copy("limits.openaiCredits.session_placeholder")}
          aria-label={copy("limits.openaiCredits.session_placeholder")}
          autoComplete="new-password"
          spellCheck={false}
          className={inputClassName}
        />
        <input
          type="password"
          value={organization}
          onChange={(e) => {
            setOrganization(e.target.value);
            setStatus("idle");
            setError(false);
          }}
          placeholder={copy("limits.openaiCredits.org_placeholder")}
          aria-label={copy("limits.openaiCredits.org_placeholder")}
          autoComplete="new-password"
          spellCheck={false}
          className={inputClassName}
        />
        <button
          type="submit"
          disabled={!sessionBearer.trim() || !organization.trim() || status === "saving"}
          className="shrink-0 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 disabled:opacity-50 transition-colors"
        >
          {status === "saving"
            ? copy("limits.qoderCookie.saving")
            : status === "saved"
              ? copy("limits.qoderCookie.saved")
              : copy("limits.qoderCookie.save")}
        </button>
      </div>
      <div className="text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
        {error ? copy("limits.qoderCookie.save_failed") : copy("limits.openaiCredits.note")}
      </div>
    </form>
  );
}

// Paste box for the hand-copied Qoder website cookie. The cookie is a session
// credential only the user's own browser holds, so it cannot be auto-collected
// (the httpOnly session cookie is invisible to page JS and to the tray). The
// user pastes the whole Cookie header from DevTools; it is saved by the
// loopback backend to the same file the usage fetch reads, so the next refresh
// picks it up. Never echoed back; sent only to the local API.
function QoderCookieInput({ namespace = "cn", onSaved }) {
  const [cookie, setCookie] = useState("");
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const value = cookie.trim();
    if (!value || status === "saving") return;
    setStatus("saving");
    setError(false);
    try {
      const res = await fetch("/functions/tokentracker-qoder-cookie", {
        method: "POST",
        headers: {
          ...(await getLocalApiAuthHeaders()),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ namespace, cookie: value }),
      });
      if (!res.ok) throw new Error();
      setCookie("");
      setStatus("saved");
      onSaved?.();
    } catch (_e) {
      setStatus("idle");
      setError(true);
    }
  };

  return (
    <form
      className="mt-1.5 space-y-1.5"
      onSubmit={onSubmit}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={cookie}
          onChange={(e) => {
            setCookie(e.target.value);
            setStatus("idle");
            setError(false);
          }}
          placeholder={copy("limits.qoderCookie.placeholder")}
          aria-label={copy("limits.qoderCookie.placeholder")}
          autoComplete="new-password"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-oai-gray-300 bg-white px-2 py-1 font-mono text-[11px] text-oai-gray-800 outline-none focus:border-oai-brand dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-gray-100"
        />
        <button
          type="submit"
          disabled={!cookie.trim() || status === "saving"}
          className="shrink-0 rounded-md bg-oai-brand/10 px-2 py-1 font-medium text-oai-brand hover:bg-oai-brand/15 disabled:opacity-50 transition-colors"
        >
          {status === "saving"
            ? copy("limits.qoderCookie.saving")
            : status === "saved"
              ? copy("limits.qoderCookie.saved")
              : copy("limits.qoderCookie.save")}
        </button>
      </div>
      <div className="text-[10px] leading-snug text-oai-gray-400 dark:text-oai-gray-500">
        {error ? copy("limits.qoderCookie.save_failed") : copy("limits.qoderCookie.note")}
      </div>
    </form>
  );
}

// OpenCode Go limits come from OpenCode's official authenticated usage API
// (GET /zen/go/v1/usage, Bearer OPENCODE_GO_API_KEY) once the user subscribes.
// The key is entered here and stored by the backend in a 0600 file — never in
// the launch environment, whose global scope is what leaked it into other apps
// (issue 837). The panel only ever sends the key to the loopback backend.
export function UsageLimitsPanel({ claude, codex, cursor, gemini, kimi, kiro, grok, antigravity, apigoto, sensenova, copilot, zcode, opencodeGo, commandCode, qoder, qoderCn, codingPlan, agentPlan, devin, workbuddy, workbuddyAi, raccoon, deepseek, minimax, trae, traeMain, codearts, clinePass, agentRouter, opendesign, mistral, openaiCredits, minimaxCode, order, visibility, displayMode, onProviderKeySaved = null }) {
  const dataById = { claude, codex, cursor, gemini, kimi, kiro, grok, antigravity, apigoto, sensenova, copilot, zcode, opencodeGo, commandCode, qoder, qoderCn, codingPlan, agentPlan, devin, workbuddy, workbuddyAi, raccoon, deepseek, minimax, trae, traeMain, codearts, clinePass, agentRouter, opendesign, mistral, openaiCredits, minimaxCode };
  // Dead-key purge: a picked key that matches no rendered row (a legacy key we
  // could not migrate, or a provider since unconfigured) still counts against
  // the six-row cap and would lock the picker. Prune it and persist the
  // pruned list — the pet then shows exactly what the checkboxes show.
  //
  // Pruning needs POSITIVE evidence. A configured provider whose windows are
  // momentarily absent (a failed refresh, a cached gap, a daily grant that has
  // not landed yet) has not proven its row is gone — pruning on absence ate
  // the user's picks on every partial refresh and silently rewrote the shared
  // pet-prefs file. Providers without healthy window rows therefore protect
  // their picked keys instead of surrendering them.
  useEffect(() => {
    const known = new Set(WALLET_ROW_KEYS);
    const healthyRows = new Set();
    for (const [id, provider] of Object.entries(dataById)) {
      if (provider?.configured !== true || provider?.error != null) continue;
      const spec = PROVIDER_LIMIT_SPECS[id];
      if (!spec?.windows) continue;
      let rows = [];
      try {
        rows = spec.windows(provider).filter((s) => s.window);
      } catch {
        continue;
      }
      if (rows.length === 0) continue;
      healthyRows.add(id);
      for (const s of rows) known.add(petLimitRowKey(id, s.key));
    }
    setPetLimitRows((prev) => {
      const pruned = prev.filter((key) => {
        const providerId = key.slice(0, key.indexOf("::"));
        if (providerId && !healthyRows.has(providerId)) return true;
        return known.has(key);
      });
      if (pruned.length === prev.length) return prev;
      return writePetLimitSelection(pruned);
    });
  }, [dataById.claude, dataById.codex, dataById.cursor, dataById.gemini, dataById.kimi, dataById.kiro, dataById.grok, dataById.antigravity, dataById.apigoto, dataById.sensenova, dataById.copilot, dataById.zcode, dataById.opencodeGo, dataById.commandCode, dataById.qoder, dataById.qoderCn, dataById.codingPlan, dataById.agentPlan, dataById.devin, dataById.workbuddy, dataById.workbuddyAi, dataById.minimax, dataById.trae, dataById.traeMain, dataById.codearts, dataById.agentRouter, dataById.opendesign, dataById.mistral, dataById.openaiCredits, dataById.minimaxCode, dataById.raccoon]);
  const containerRef = useRef(null);
  const labelWidth = useWidestLabelWidth(containerRef);
  const [expandedId, setExpandedId] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  // 宠物悬浮窗勾选：默认 null（走前 6 行），一旦勾过就按 localStorage 的列表来。
  const [petLimitRows, setPetLimitRows] = useState(() => readPetLimitSelection() || []);
  // 勾选的权威存储在本地 API（宠物窗口是另一个 WebView2 profile，读不到本窗口
  // localStorage），挂载时对齐一次：远端有值就采纳，远端为空且本窗口存过旧的
  // 勾选就把它迁移上去——升级后第一次打开限额页，悬浮卡即可接上原选择。
  useEffect(() => {
    let alive = true;
    fetchPetLimitSelectionRemote().then((remote) => {
      if (!alive) return;
      if (remote !== null) {
        // [] = the user unchecked everything: adopt it, do not resurrect the
        // window's stale localStorage copy.
        setPetLimitRows((prev) => (JSON.stringify(prev) === JSON.stringify(remote) ? prev : remote));
        return;
      }
      const local = readPetLimitSelection();
      if (local && local.length > 0) void savePetLimitSelectionRemote(local);
    });
    return () => {
      alive = false;
    };
  }, []);
  const togglePetLimitRow = useCallback((providerId, rowKey) => {
    setPetLimitRows((prev) => {
      const { list } = togglePetLimitSelection(prev, petLimitRowKey(providerId, rowKey));
      return writePetLimitSelection(list);
    });
  }, []);
  const effectiveOrder = [...new Set((Array.isArray(order) && order.length > 0 ? order : DEFAULT_ORDER)
    .map((id) => id))];
  const effectiveMode = displayMode === LIMIT_DISPLAY_MODES.REMAINING
    ? LIMIT_DISPLAY_MODES.REMAINING
    : LIMIT_DISPLAY_MODES.USED;
  const modeLabel = effectiveMode === LIMIT_DISPLAY_MODES.REMAINING
    ? copy("limits.settings.display_mode_remaining")
    : copy("limits.settings.display_mode_used");

  // Refresh countdowns/remaining labels once a minute without re-fetching.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const groups = effectiveOrder
    .filter((id) => !visibility || visibility[id] !== false)
    .map((id) => {
      return renderProviderGroup(
        id,
        dataById[id],
        effectiveMode,
        expandedId === id,
        () => setExpandedId((prev) => (prev === id ? null : id)),
        now,
        // Saving a pasted key refreshes the limits, so the card flips from
        // "not connected" to its windows without a manual page reload.
        onProviderKeySaved,
        { selected: petLimitRows, onToggle: togglePetLimitRow },
      );
    })
    .filter(Boolean);

  return (
    <FadeIn delay={0.15}>
      <Card>
        <div
          ref={containerRef}
          data-limit-label-group=""
          className="flex flex-col gap-3"
          style={labelWidth > 0 ? { "--tt-limits-label-w": `${labelWidth}px` } : undefined}
        >
          <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
            {copy("limits.panel.title")}{copy("limits.panel.mode_separator")}{modeLabel}
          </h3>
          {groups.length > 0 ? groups : <StatusLine>{copy("limits.status.all_hidden")}</StatusLine>}
        </div>
      </Card>
    </FadeIn>
  );
}
