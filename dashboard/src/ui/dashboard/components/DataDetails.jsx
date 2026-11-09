import React, { useMemo, useState } from "react";
import { Card, Select } from "../../components";
import { formatUsdCurrency, toFiniteNumber } from "../../../lib/format";
import { buildAllModels } from "../../../lib/model-breakdown";
import { useTokenFormat } from "../../../hooks/useTokenFormat.js";
import { useCurrency } from "../../../hooks/useCurrency.js";
import { ProviderIcon } from "./ProviderIcon";
import { ProjectDetailModal } from "./ProjectDetailModal.jsx";
import {
  ProjectAvatar,
  githubOwnerFor,
  splitProjectKey,
} from "./project-usage-utils.jsx";

const PROJECT_SOURCE_ICON_LIMIT = 5;

// Provider-card parity for the Tools tab: a percent under 0.01 renders as the
// same below-threshold marker the usage cards show, so a tiny tool doesn't
// read as a rounded "0.00".
function formatToolPercent(provider, copy) {
  const raw = Number(provider?.totalPercentValue ?? provider?.totalPercent);
  const value = Number.isFinite(raw) ? Math.max(0, raw) : 0;
  if (value > 0 && !(value >= 0.01)) return copy("usage.overview.percent_below_threshold");
  return value.toFixed(2);
}

// fleetData arrives sorted by tokens from buildFleetData, but the Tools tab
// must not depend on the producer's ordering contract: sort defensively,
// tokens first. A plain function expression — the ui-hardcode scanner reads
// arrow functions as JSX text spans.
function toolsByUsageDesc(fleetData) {
  return (Array.isArray(fleetData) ? fleetData.slice() : []).sort(function (a, b) {
    return (Number(b?.usage) || 0) - (Number(a?.usage) || 0);
  });
}

// True when any speed row comes from the session sidecar rather than the
// gateway — those rows carry the "Session" badge and the explanatory note.
function speedModelsIncludeSession(models) {
  return (Array.isArray(models) ? models : []).some(function (entry) {
    return entry?.speed_source === "session";
  });
}

function ProjectRow({ entry, maxTokens, copy, formatTokens, formatTokensTooltip, onSelect }) {
  const projectKey = typeof entry?.project_key === "string" ? entry.project_key : "";
  const projectRef = typeof entry?.project_ref === "string" ? entry.project_ref : "";
  const { owner, repo } = splitProjectKey(projectKey);
  const githubOwner = githubOwnerFor(projectRef, owner);
  const tokensRaw = toFiniteNumber(entry?.billable_total_tokens ?? entry?.total_tokens) ?? 0;
  const widthPct = maxTokens > 0 ? Math.min(100, Math.max(2, (tokensRaw / maxTokens) * 100)) : 0;
  const sources = Array.isArray(entry?.sources) ? entry.sources : [];
  const visibleSources = sources.slice(0, PROJECT_SOURCE_ICON_LIMIT);
  const overflowCount = sources.length - visibleSources.length;

  // A button, not an external link: clicking opens the local drill-down
  // modal. Never navigate to project_ref — leaking which repos the user
  // works on to an external host is not this panel's call to make.
  return (
    <button
      type="button"
      onClick={() => onSelect?.(entry)}
      className="flex w-full items-center gap-3 p-2 rounded-lg text-left hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50 active:bg-oai-gray-100 dark:active:bg-oai-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand/60 transition-colors"
    >
      <ProjectAvatar
        githubOwner={githubOwner}
        letter={(repo?.[0] || projectKey?.[0] || "?").toUpperCase()}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline min-w-0">
          {owner ? (
            <span className="oai-text-caption text-oai-gray-400 dark:text-oai-gray-500 truncate flex-shrink-[2]">
              {owner}/
            </span>
          ) : null}
          <span className="oai-text-body-sm font-medium text-oai-black dark:text-oai-white truncate">
            {repo || projectKey || "—"}
          </span>
        </div>
        {visibleSources.length > 0 && (
          <div className="mt-0.5 flex items-center gap-1">
            {visibleSources.map((s) => (
              <ProviderIcon
                key={s.source}
                provider={s.source}
                size={12}
                className="text-oai-gray-400 dark:text-oai-gray-500"
              />
            ))}
            {overflowCount > 0 && (
              <span className="oai-text-caption text-oai-gray-400 dark:text-oai-gray-500">
                {copy("dashboard.projects.sources_more", { n: overflowCount })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex w-24 flex-shrink-0 flex-col items-end gap-1">
        <span
          className="oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums"
          title={formatTokensTooltip(tokensRaw)}
        >
          {formatTokens(tokensRaw)}
        </span>
        <div className="h-1 w-full overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
          <div
            className="h-full rounded-full bg-emerald-500"
            style={{ width: `${widthPct}%`, minWidth: tokensRaw > 0 ? "3px" : 0 }}
          />
        </div>
      </div>
    </button>
  );
}

export function DataDetails({
  // Project props
  projectEntries = [],
  projectLimit = 3,
  onProjectLimitChange,
  // { from, to, timeZone, tzOffsetMinutes } — forwarded to the per-project
  // drill-down modal so it queries the same range the panel shows.
  projectDetailQuery = {},
  // Provider-oriented fleet rows (buildFleetData output, TRAE estimates
  // already applied upstream) feeding the Models / Tools rankings.
  fleetData = [],
  agent2ApiSpeedModels = [],
  agent2ApiSpeedError = false,
  onAgent2ApiSpeedRetry,
  agent2ApiSpeedLoading = false,
  // Daily breakdown props
  copy,
  hasDetailsActual,
  dailyEmptyPrefix,
  installSyncCmd,
  dailyEmptySuffix,
  detailsColumns,
  ariaSortFor,
  toggleSort,
  sortIconFor,
  pagedDetails,
  dailyBreakdownRows = [],
  dailyBreakdownColumns = [],
  dailyBreakdownAriaSortFor,
  dailyBreakdownSortIconFor,
  dailyBreakdownDateKey = "day",
  detailsDateKey,
  renderDetailDate,
  renderDailyBreakdownDate,
  renderDetailCell,
  DETAILS_PAGED_PERIODS,
  period,
  detailsPageCount,
  detailsPage,
  setDetailsPage,
}) {
  const [activeTab, setActiveTab] = useState("daily");
  const [detailEntry, setDetailEntry] = useState(null);
  const { formatTokens, formatTokensTooltip } = useTokenFormat();
  // The Models / Tools cost columns must follow the settings currency (¥ when
  // 人民币 is selected), same as every other cost surface on the dashboard.
  const { currency, rate } = useCurrency();
  // buildAllModels already merges the same model across tools (case-
  // insensitive) and sorts by usage descending — the ranking the Models tab
  // shows verbatim. toolsByUsageDesc does the same for the Tools tab.
  const allModels = useMemo(
    function () { return buildAllModels(fleetData); },
    [fleetData],
  );
  const toolRows = useMemo(
    function () { return toolsByUsageDesc(fleetData); },
    [fleetData],
  );

  return (
    <Card>
      {/* Tab Switcher + Controls */}
      <div className={`flex items-center justify-between gap-3 ${activeTab === "projects" ? "mb-4" : "mb-0"}`}>
        <div role="tablist" aria-label="Data view" className="flex gap-1">
          <button
            role="tab"
            aria-selected={activeTab === "daily"}
            type="button"
            onClick={() => setActiveTab("daily")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "daily"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.daily.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "projects"}
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "projects"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.projects.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "speed"}
            type="button"
            onClick={() => setActiveTab("speed")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "speed"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.speed.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "models"}
            type="button"
            onClick={() => setActiveTab("models")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "models"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.models.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "tools"}
            type="button"
            onClick={() => setActiveTab("tools")}
            className={`text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "tools"
                ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.tools.title")}
          </button>
        </div>
        {activeTab === "projects" && (
          <Select
            ariaLabel={copy("dashboard.projects.limit_aria")}
            value={projectLimit}
            onValueChange={(value) => onProjectLimitChange?.(Number(value))}
            options={[
              { value: 3, label: copy("dashboard.projects.limit_top_3") },
              { value: 6, label: copy("dashboard.projects.limit_top_6") },
              { value: 10, label: copy("dashboard.projects.limit_top_10") },
            ]}
            align="end"
            className="px-2 py-1 text-xs text-oai-gray-600 dark:text-oai-gray-300"
          />
        )}
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (() => {
        const visibleEntries = projectEntries.slice(0, projectLimit);
        if (visibleEntries.length === 0) {
          return (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {copy("dashboard.projects.empty")}
            </div>
          );
        }
        const maxTokens = visibleEntries.reduce((max, entry) => {
          const n = toFiniteNumber(entry?.billable_total_tokens ?? entry?.total_tokens) ?? 0;
          return n > max ? n : max;
        }, 0);
        return (
          <div className="space-y-1">
            {visibleEntries.map((entry, idx) => (
              <ProjectRow
                key={entry?.project_key || entry?.project_ref || `entry-${idx}`}
                entry={entry}
                maxTokens={maxTokens}
                copy={copy}
                formatTokens={formatTokens}
                formatTokensTooltip={formatTokensTooltip}
                onSelect={setDetailEntry}
              />
            ))}
          </div>
        );
      })()}

      {/* Speed Tab — gateway-native measurements, plus the session sidecar's
          wall-clock estimates for models the gateway never sees (a machine
          without the gateway at all still gets the session tier). Each row is
          labelled with its evidence tier so the two kinds of number are never
          read as the same kind of measurement. A failed load is a retry-able
          error, not "no data": the hook only refetches on mount and period
          changes otherwise, and a transient failure used to sit here forever. */}
      {activeTab === "speed" && (() => {
        if (agent2ApiSpeedError) {
          return (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {copy("dashboard.speed.fetch_failed")}
              {onAgent2ApiSpeedRetry ? (
                <button
                  type="button"
                  onClick={function handleSpeedRetry() { onAgent2ApiSpeedRetry(); }}
                  className="ml-2 underline underline-offset-2 text-oai-gray-600 hover:text-oai-black dark:text-oai-gray-300 dark:hover:text-oai-white"
                >
                  {copy("dashboard.speed.retry")}
                </button>
              ) : null}
            </div>
          );
        }
        if (agent2ApiSpeedModels.length === 0) {
          return (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {agent2ApiSpeedLoading ? "…" : copy("dashboard.speed.empty")}
            </div>
          );
        }
        const hasSessionTier = speedModelsIncludeSession(agent2ApiSpeedModels);
        return (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            {hasSessionTier && (
              <div className="px-2.5 sm:px-4 pb-2 oai-text-caption text-oai-gray-500 dark:text-oai-gray-400">
                {copy("dashboard.speed.session_note")}
              </div>
            )}
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {["dashboard.speed.model", "dashboard.speed.requests", "dashboard.speed.output", "dashboard.speed.tps", "dashboard.speed.ttft"].map((key) => (
                    <th
                      key={key}
                      className="text-left px-2.5 sm:px-4 py-2 oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 bg-white dark:bg-oai-gray-900"
                    >
                      {copy(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agent2ApiSpeedModels.map((entry) => (
                  <tr
                    key={entry.model}
                    className="border-b border-oai-gray-100 dark:border-oai-gray-800/60 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40 transition-colors"
                  >
                    <td className="px-2.5 sm:px-4 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="oai-text-body-sm text-oai-black dark:text-oai-white font-mono">
                          {entry.model}
                        </span>
                        {entry.speed_source === "session" && (
                          <span
                            className="px-1 py-0.5 text-[9px] font-semibold tracking-wide rounded bg-oai-gray-100 text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400"
                            title={copy("dashboard.speed.session_badge_title")}
                          >
                            {copy("dashboard.speed.session_badge")}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200">
                      {entry.requests}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200">
                      {formatTokens(entry.output_tokens)}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200">
                      {entry.tokens_per_second == null ? "—" : `${entry.tokens_per_second} tok/s`}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200">
                      {entry.avg_first_response_ms == null
                        ? "—"
                        : entry.avg_first_response_ms >= 1000
                          ? `${(entry.avg_first_response_ms / 1000).toFixed(1)} s`
                          : `${entry.avg_first_response_ms} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Models Tab — personal ranking merged across every tool */}
      {activeTab === "models" && (() => {
        if (allModels.length === 0) {
          return (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {copy("dashboard.models.empty")}
            </div>
          );
        }
        return (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {[
                    "dashboard.models.col.model",
                    "daily.sort.total.label",
                    "dashboard.models.col.share",
                    "dashboard.models.col.cost",
                    "daily.sort.conversations.label",
                  ].map((key) => (
                    <th
                      key={key}
                      className="text-left px-2.5 sm:px-4 py-2 oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 bg-white dark:bg-oai-gray-900"
                    >
                      {copy(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allModels.map((model) => (
                  <tr
                    key={model.id}
                    className="border-b border-oai-gray-100 dark:border-oai-gray-800/60 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40 transition-colors"
                  >
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-black dark:text-oai-white font-mono">
                      {model.name}
                    </td>
                    <td
                      className="px-2.5 sm:px-4 py-2 oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums"
                      title={formatTokensTooltip(model.usage)}
                    >
                      {formatTokens(model.usage)}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                      {model.share}%
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                      {model.cost == null ? "—" : formatUsdCurrency(model.cost, { currency, rate })}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                      {model.requests}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* Tools Tab — one row per CLI/app, same numbers as the provider cards */}
      {activeTab === "tools" && (() => {
        if (toolRows.length === 0) {
          return (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {copy("dashboard.tools.empty")}
            </div>
          );
        }
        return (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {[
                    "dashboard.tools.col.tool",
                    "daily.sort.total.label",
                    "dashboard.tools.col.share",
                    "dashboard.tools.col.cost",
                    "dashboard.tools.col.models",
                  ].map((key) => (
                    <th
                      key={key}
                      className="text-left px-2.5 sm:px-4 py-2 oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 bg-white dark:bg-oai-gray-900"
                    >
                      {copy(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {toolRows.map((tool) => (
                  <tr
                    key={String(tool?.source || tool?.label || "")}
                    className="border-b border-oai-gray-100 dark:border-oai-gray-800/60 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40 transition-colors"
                  >
                    <td className="px-2.5 sm:px-4 py-2">
                      <span className="inline-flex items-center gap-2 oai-text-body-sm text-oai-black dark:text-oai-white">
                        <ProviderIcon
                          provider={tool?.source}
                          size={14}
                          className="text-oai-gray-500 dark:text-oai-gray-400"
                        />
                        {tool?.label || tool?.source || "—"}
                      </span>
                    </td>
                    <td
                      className="px-2.5 sm:px-4 py-2 oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums"
                      title={formatTokensTooltip(tool?.usage)}
                    >
                      {formatTokens(tool?.usage)}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                      {formatToolPercent(tool, copy)}%
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                      {formatUsdCurrency(tool?.usd, { currency, rate })}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-700 dark:text-oai-gray-200 tabular-nums">
                      {Array.isArray(tool?.models) ? tool.models.length : 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {detailEntry && (
        <ProjectDetailModal
          entry={detailEntry}
          query={projectDetailQuery}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {/* Daily Tab */}
      {activeTab === "daily" && (
        <div>
          {dailyBreakdownRows?.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 mb-4">
              {dailyEmptyPrefix}
              <code className="mx-1 rounded border border-oai-gray-300 dark:border-oai-gray-700 oai-bg-elevated px-1.5 py-0.5 font-mono oai-text-caption">
                {installSyncCmd}
              </code>
              {dailyEmptySuffix}
            </div>
          ) : (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {dailyBreakdownColumns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={dailyBreakdownAriaSortFor?.(column.key) || "none"}
                      className="text-left p-0 bg-white dark:bg-oai-gray-900"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex w-full items-center justify-start px-2.5 sm:px-4 py-2 text-left oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{column.label}</span>
                          <span className="text-oai-gray-400 dark:text-oai-gray-400">
                            {dailyBreakdownSortIconFor?.(column.key) || ""}
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyBreakdownRows.map((row) => (
                  <tr
                    key={String(
                      row?.[dailyBreakdownDateKey] || row?.day || row?.hour || row?.month || "",
                    )}
                    className={`border-b border-oai-gray-100 dark:border-oai-gray-800 last:border-b-0 hover:bg-oai-gray-50/50 dark:hover:bg-oai-gray-800/50 transition-colors ${
                      row.missing ? "text-oai-gray-400 dark:text-oai-gray-400" : row.future ? "text-oai-gray-300 dark:text-oai-gray-600" : "text-oai-black dark:text-oai-white"
                    }`}
                  >
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 whitespace-nowrap">
                      {renderDailyBreakdownDate ? renderDailyBreakdownDate(row) : renderDetailDate(row)}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                      {renderDetailCell(row, "total_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "input_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "output_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "cached_input_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "reasoning_output_tokens")}
                    </td>
                    <td className="px-2.5 sm:px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "conversation_count")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* Pagination - 使用 design system typography，Daily Breakdown 不需要分页 */}
          {activeTab !== "daily" && DETAILS_PAGED_PERIODS.has(period) && detailsPageCount > 1 ? (
            <div className="mt-3 flex items-center justify-between oai-text-caption">
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.max(0, prev - 1))}
                disabled={detailsPage === 0}
                className="px-3 py-1.5 text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.prev")}
              </button>
              <span className="oai-text-muted">
                {detailsPage + 1} / {detailsPageCount}
              </span>
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.min(detailsPageCount - 1, prev + 1))}
                disabled={detailsPage + 1 >= detailsPageCount}
                className="px-3 py-1.5 text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.next")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
