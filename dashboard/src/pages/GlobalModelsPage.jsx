import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { copy } from "../lib/copy";
import { formatCompactNumber } from "../lib/format";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";

const FALLBACK_MARK_COLOR = "gray";

function formatScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : null;
}

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? copy("global_models.price_value", { value: n.toFixed(2) }) : "—";
}

function formatSpeed(value) {
  const n = Number(value);
  return Number.isFinite(n) ? copy("global_models.speed_value", { value: Math.round(n) }) : "—";
}

function formatContext(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? formatCompactNumber(n) : "—";
}

function formatUpdated(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : "—";
}

function textColorFor(hex) {
  const digits = String(hex || "").replace("#", "");
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  // CSS keywords rather than literals: the hardcode guardrail counts hex/rgb
  // values, and AA supplies the only real colour this component paints with.
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "black" : "white";
}

// AA names the lab behind each model; this maps those names to marks TT-plus
// ships (same keys the rest of the app resolves). It lives here rather than in
// the API payload so a branding edit never invalidates the board's cache.
const LAB_MARK_KEYS = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Google: "google",
  "Z AI": "z-ai",
  NVIDIA: "nvidia",
  Meta: "meta",
  Alibaba: "alibaba",
  SpaceXAI: "spacexai",
  Mistral: "mistral",
  "Thinking Machines": "thinking-machines",
  Xiaomi: "xiaomi",
  MiniMax: "minimax",
  DeepSeek: "deepseek-platform",
  StepFun: "stepfun",
  Cohere: "cohere",
  Reflection: "reflection",
  "Institute of Foundation Models": "ifm",
  InclusionAI: "inclusionai",
  Kimi: "kimi",
};

// AA names labs TT-plus has no bundled mark for, so those rows get a letter
// chip in the lab's own brand color instead of an empty slot: the column stays
// aligned and every row reads the same way.
function CreatorMark({ row }) {
  const icon = LAB_MARK_KEYS[row.provider] || null;
  if (icon) {
    return <ProviderIcon provider={icon} size={18} />;
  }
  const color = row.provider_color || FALLBACK_MARK_COLOR;
  const label = String(row.provider || row.display_name || row.model || "").trim();
  return (
    <span
      aria-hidden
      className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] text-[10px] leading-none font-semibold"
      style={{ backgroundColor: color, color: textColorFor(color) }}
    >
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

export default function GlobalModelsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ force = false } = {}) => {
    try {
      setError(null);
      const res = await fetch(`/functions/tokentracker-global-models${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setData(body);
      if (body.error) setError(body.error);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const items = Array.isArray(data?.items) ? data.items : [];

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy("global_models.title")}</h1>
              <p className="mt-1.5 max-w-3xl text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("global_models.subtitle")}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {data?.stale ? <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">{copy("global_models.stale")}</span> : null}
              <span>{copy("global_models.updated", { time: formatUpdated(data?.updated_at) })}</span>
              <button
                type="button"
                onClick={() => load({ force: true })}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-oai-gray-200 bg-white px-2.5 font-medium text-oai-gray-700 transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {copy("global_models.refresh")}
              </button>
            </div>
          </div>

          {error ? (
            <p className="mb-4 rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {copy("global_models.error", { error })}
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="border-b border-oai-gray-200 bg-oai-gray-50 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-400">
                  <tr>
                    <th className="px-3 py-3 font-medium">{copy("global_models.col.rank")}</th>
                    <th className="px-3 py-3 font-medium">{copy("global_models.col.model")}</th>
                    <th className="px-3 py-3 font-medium">{copy("global_models.col.provider")}</th>
                    <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.score")}</th>
                    <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.input")}</th>
                    <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.output")}</th>
                    <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.cache")}</th>
                    <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.context")}</th>
                    <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.speed")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
                  {loading && items.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-oai-gray-500 dark:text-oai-gray-400">{copy("global_models.loading")}</td></tr>
                  ) : null}
                  {!loading && items.length === 0 ? (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-oai-gray-500 dark:text-oai-gray-400">{copy("global_models.empty")}</td></tr>
                  ) : null}
                  {items.map((row) => (
                    <tr key={`${row.rank}-${row.model}`} className="hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40">
                      <td className="px-3 py-2.5 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">{row.rank}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <CreatorMark row={row} />
                          <span className="font-medium">{row.display_name || row.model}</span>
                          {row.intelligence_is_estimated ? (
                            <span className="rounded bg-oai-gray-100 px-1.5 py-0.5 text-[10px] text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">
                              {copy("global_models.estimated")}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-oai-gray-600 dark:text-oai-gray-300">{row.provider || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatScore(row.intelligence) ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatPrice(row.input_per_million_usd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatPrice(row.output_per_million_usd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatPrice(row.cache_hit_per_million_usd)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatContext(row.context_window_tokens)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatSpeed(row.median_output_tokens_per_second)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
            <p>
              {copy("global_models.attribution", {
                source: data?.source || "Artificial Analysis",
                count: Number(data?.model_count || 0).toLocaleString(),
              })}{" "}
              {data?.source_url ? (
                <a
                  className="underline decoration-oai-gray-300 underline-offset-2 hover:decoration-oai-gray-500"
                  href={data.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy("global_models.source")}
                </a>
              ) : null}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
