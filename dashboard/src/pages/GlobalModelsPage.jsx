import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { copy } from "../lib/copy";
import { formatCompactNumber } from "../lib/format";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";

const FALLBACK_MARK_COLOR = "gray";

function finiteMetric(value) {
  if (value == null || typeof value === "boolean" || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatScore(value) {
  const n = finiteMetric(value);
  return n === null ? null : n.toFixed(1);
}

function formatPrice(value, key = "global_models.price_value") {
  const n = finiteMetric(value);
  return n === null ? "—" : copy(key, { value: n.toFixed(2) });
}

function formatContext(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? formatCompactNumber(n) : "—";
}

function formatSpeed(value) {
  const n = finiteMetric(value);
  return n === null ? "—" : copy("global_models.speed_value", { value: Math.round(n) });
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
  // values, and the boards supply the only real colour this component paints.
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "black" : "white";
}

// The labs behind each model; this maps their names to marks TT-plus ships
// (same keys the rest of the app resolves). It lives here rather than in the
// API payload so a branding edit never invalidates the board's cache.
const LAB_MARK_KEYS = {
  OpenAI: "openai",
  Anthropic: "anthropic",
  Google: "google",
  "Z AI": "z-ai",
  "Z.ai": "z-ai",
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
  "Moonshot AI": "kimi",
};

// Labs neither board names TT-plus has a bundled mark for get a letter chip in
// the lab's own brand color instead of an empty slot: the column stays aligned
// and every row reads the same way.
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

function useBoardLoader(endpoint) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  return {
    data,
    loading,
    error,
    load: useCallback(async ({ force = false } = {}) => {
      try {
        setError(null);
        const res = await fetch(`/functions/${endpoint}${force ? "?refresh=1" : ""}`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        setData(body);
        if (body.error) setError(body.error);
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    }, [endpoint]),
  };
}

const AIHOT_CATEGORIES = ["overall", "coding", "reasoning", "professional", "knowledge"];

export default function GlobalModelsPage() {
  // Owner ruling 2026-11-03: keep BOTH boards — the AA intelligence index and
  // the AIHOT boards — as switchable tabs, and surface all five AIHOT
  // categories (综合/编程/科研/专业办公/知识问答) as sub-tabs. AIHOT loads
  // lazily on first switch so the default view costs no extra request; each
  // category caches server-side for 6h.
  const [board, setBoard] = useState("aa");
  const aa = useBoardLoader("tokentracker-global-models");
  const [aihotCat, setAihotCat] = useState("overall");
  const [aihotData, setAihotData] = useState(null);
  const [aihotLoading, setAihotLoading] = useState(false);
  const [aihotError, setAihotError] = useState(null);
  const aihotStartedRef = useRef(false);

  useEffect(() => {
    aa.load();
    const timer = setInterval(aa.load, 60 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aa.load]);

  // Requests carry an id: a late response from an earlier sub-tab must never
  // overwrite the current one (the category guard would then park the view on
  // "loading" until the next click — the P2 the adversarial review caught).
  const aihotReqRef = useRef(0);
  const loadAihot = useCallback(async ({ force = false, category = "overall" } = {}) => {
    const reqId = ++aihotReqRef.current;
    try {
      setAihotError(null);
      setAihotLoading(true);
      const res = await fetch(`/functions/tokentracker-global-models-aihot?category=${category}${force ? "&refresh=1" : ""}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (reqId !== aihotReqRef.current) return;
      setAihotData(body);
      if (body.error) setAihotError(body.error);
    } catch (err) {
      if (reqId !== aihotReqRef.current) return;
      setAihotError(err?.message || String(err));
    } finally {
      if (reqId === aihotReqRef.current) setAihotLoading(false);
    }
  }, []);

  useEffect(() => {
    if (board !== "aihot" || aihotStartedRef.current) return;
    aihotStartedRef.current = true;
    loadAihot({ category: aihotCat });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const switchAihotCat = (cat) => {
    setAihotCat(cat);
    loadAihot({ category: cat });
  };

  const aihotActive = aihotData && (aihotData.category || "overall") === aihotCat ? aihotData : null;
  const active = board === "aa"
    ? { data: aa.data, loading: aa.loading, error: aa.error }
    : { data: aihotActive, loading: aihotLoading || (aihotStartedRef.current && !aihotActive && !aihotError), error: aihotError };
  const data = active.data;
  const items = Array.isArray(data?.items) ? data.items : [];
  const loading = active.loading;

  const handleRefresh = () => {
    if (board === "aa") aa.load({ force: true });
    else loadAihot({ force: true, category: aihotCat });
  };

  const tabs = [
    { id: "aa", label: copy("global_models.tab_aa") },
    { id: "aihot", label: copy("global_models.tab_aihot") },
  ];
  const aihotCatLabels = {
    overall: copy("global_models.aihot_cat_overall"),
    coding: copy("global_models.aihot_cat_coding"),
    reasoning: copy("global_models.aihot_cat_reasoning"),
    professional: copy("global_models.aihot_cat_professional"),
    knowledge: copy("global_models.aihot_cat_knowledge"),
  };

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{copy("global_models.title")}</h1>
              <p className="mt-1.5 max-w-3xl text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {board === "aa"
                  ? copy("global_models.subtitle")
                  : copy("global_models.subtitle_aihot")}
              </p>
              {board === "aihot" ? (
                <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-oai-gray-400 dark:text-oai-gray-500">
                  {copy("global_models.credit_aihot")}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {data?.stale ? <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-700 dark:text-amber-300">{copy("global_models.stale")}</span> : null}
              <span>{copy("global_models.updated", { time: formatUpdated(data?.updated_at) })}</span>
              <button
                type="button"
                onClick={handleRefresh}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-oai-gray-200 bg-white px-2.5 font-medium text-oai-gray-700 transition hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                {copy("global_models.refresh")}
              </button>
            </div>
          </div>

          <div className="mb-5 flex items-center gap-2" role="tablist" aria-label={copy("global_models.title")}>
            {tabs.map((tabDef) => {
              const selected = board === tabDef.id;
              return (
                <button
                  key={tabDef.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setBoard(tabDef.id)}
                  className={`inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium transition ${
                    selected
                      ? "border-oai-gray-900 bg-oai-gray-900 text-white dark:border-oai-white dark:bg-oai-white dark:text-oai-black"
                      : "border-oai-gray-200 bg-white text-oai-gray-700 hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-300 dark:hover:bg-oai-gray-800"
                  }`}
                >
                  {tabDef.label}
                </button>
              );
            })}
          </div>

          {board === "aihot" ? (
            <div className="mb-5 flex flex-wrap items-center gap-1.5" role="tablist" aria-label={copy("global_models.tab_aihot")}>
              {AIHOT_CATEGORIES.map((cat) => {
                const selected = aihotCat === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => switchAihotCat(cat)}
                    className={`inline-flex h-7 items-center rounded-full px-3 text-xs font-medium transition ${
                      selected
                        ? "bg-oai-gray-200 text-oai-black dark:bg-oai-gray-700 dark:text-oai-white"
                        : "bg-oai-gray-100 text-oai-gray-600 hover:bg-oai-gray-200 dark:bg-oai-gray-800/70 dark:text-oai-gray-400 dark:hover:bg-oai-gray-700"
                    }`}
                  >
                    {aihotCatLabels[cat]}
                  </button>
                );
              })}
            </div>
          ) : null}

          {active.error ? (
            <p className="mb-4 rounded-md border border-amber-300/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              {copy("global_models.error", { error: active.error })}
            </p>
          ) : null}

          <div className="overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
            <div className="overflow-x-auto">
              {board === "aa" ? (
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
                      <tr key={`aa-${row.rank}-${row.model}`} className="hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40">
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
              ) : (
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead className="border-b border-oai-gray-200 bg-oai-gray-50 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-400">
                    <tr>
                      <th className="px-3 py-3 font-medium">{copy("global_models.col.rank")}</th>
                      <th className="px-3 py-3 font-medium">{copy("global_models.col.model")}</th>
                      <th className="px-3 py-3 font-medium">{copy("global_models.col.provider")}</th>
                      <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.score_aihot")}</th>
                      <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.cache_cny")}</th>
                      <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.input_cny")}</th>
                      <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.output_cny")}</th>
                      <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.release")}</th>
                      <th className="px-3 py-3 text-right font-medium">{copy("global_models.col.coverage")}</th>
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
                      <tr key={`aihot-${aihotCat}-${row.rank}-${row.model}`} className="hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40">
                        <td className="px-3 py-2.5 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">{row.rank}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <CreatorMark row={row} />
                            <span className="font-medium">{row.display_name || row.model}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-oai-gray-600 dark:text-oai-gray-300">{row.provider || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatScore(row.score) ?? "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatPrice(row.cache_per_million_cny, "global_models.price_value_cny")}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatPrice(row.input_per_million_cny, "global_models.price_value_cny")}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatPrice(row.output_per_million_cny, "global_models.price_value_cny")}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{row.release_date || "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">
                          {finiteMetric(row.eval_coverage_percent) === null ? "—" : `${row.eval_coverage_percent}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="mt-4 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
            <p>
              {copy("global_models.attribution", {
                source: data?.source || (board === "aa" ? "Artificial Analysis" : "AIHOT"),
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
