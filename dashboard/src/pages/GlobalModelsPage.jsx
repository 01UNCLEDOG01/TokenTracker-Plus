import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { copy } from "../lib/copy";
import { ProviderIcon } from "../ui/dashboard/components/ProviderIcon.jsx";

function formatPrice(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "—";
}

function formatShare(value) {
  const n = Number(value);
  return Number.isFinite(n) ? copy("global_models.percent", { value: n.toFixed(1) }) : "—";
}

function formatScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "—";
}

function formatUpdated(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : "—";
}

export default function GlobalModelsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/functions/tokentracker-global-models", { cache: "no-store" });
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
    const timer = setInterval(load, 15 * 60 * 1000);
    return () => clearInterval(timer);
  }, [load]);

  const items = Array.isArray(data?.items) ? data.items : [];
  const attribution = Array.isArray(data?.attribution) ? data.attribution : [];

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
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
                onClick={load}
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
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead className="border-b border-oai-gray-200 bg-oai-gray-50 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:text-oai-gray-400">
                  <tr>
                    <th className="px-4 py-3 font-medium">{copy("global_models.col.rank")}</th>
                    <th className="px-4 py-3 font-medium">{copy("global_models.col.model")}</th>
                    <th className="px-4 py-3 font-medium">{copy("global_models.col.provider")}</th>
                    <th className="px-4 py-3 text-right font-medium">{copy("global_models.col.score")}</th>
                    <th className="px-4 py-3 text-right font-medium">{copy("global_models.col.aa")}</th>
                    <th className="px-4 py-3 text-right font-medium">{copy("global_models.col.share")}</th>
                    <th className="px-4 py-3 text-right font-medium">{copy("global_models.col.price")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-oai-gray-100 dark:divide-oai-gray-800">
                  {loading && items.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-oai-gray-500 dark:text-oai-gray-400">{copy("global_models.loading")}</td></tr>
                  ) : null}
                  {!loading && items.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-10 text-center text-oai-gray-500 dark:text-oai-gray-400">{copy("global_models.empty")}</td></tr>
                  ) : null}
                  {items.map((row) => (
                    <tr key={`${row.rank}-${row.model}`} className="hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/40">
                      <td className="px-4 py-3 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">{row.rank}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ProviderIcon provider={row.provider} size={18} />
                          <span className="font-medium">{row.display_name || row.model}</span>
                          {row.provisional ? <span className="rounded bg-oai-gray-100 px-1.5 py-0.5 text-[10px] text-oai-gray-500 dark:bg-oai-gray-800 dark:text-oai-gray-400">{copy("global_models.provisional")}</span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 capitalize text-oai-gray-600 dark:text-oai-gray-300">{row.provider || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">{formatScore(row.composite)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatScore(row.signals?.aa_intelligence)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatShare(row.signals?.openrouter_share_pct)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">
                        {copy("global_models.price_value", { input: formatPrice(row.input_per_million_usd), output: formatPrice(row.output_per_million_usd) })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
            <p>{copy("global_models.source")}</p>
            <ul className="mt-1 list-disc pl-5">
              {attribution.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
