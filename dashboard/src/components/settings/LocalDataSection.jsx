import React, { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "../../lib/copy";
import { getLocalApiAuthHeaders } from "../../lib/local-api-auth";
import { Button } from "../../ui/components/Button.jsx";
import { SectionCard, SettingsRow } from "./Controls.jsx";

const ENDPOINT = "/functions/tokentracker-local-usage";

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function call(method, body) {
  const headers = { ...(await getLocalApiAuthHeaders()), "Content-Type": "application/json" };
  const response = await fetch(ENDPOINT, {
    method,
    headers,
    cache: "no-store",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "transfer_failed"), { code: data.code });
  return data;
}

/** Export/import this machine's queue as a snapshot; import only adds keys. */
export function LocalDataSection() {
  const fileInput = useRef(null);
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setStats(await call("GET"));
  }, []);

  useEffect(() => {
    load().catch(() => setError(copy("settings.local_data.error")));
  }, [load]);

  async function exportSnapshot() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const { snapshot } = await call("POST", { action: "export" });
      const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tokentracker-local-${snapshot.machine.id.slice(0, 12)}-${snapshot.exported_at.slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(copy("settings.local_data.exported"));
    } catch {
      setError(copy("settings.local_data.error"));
    } finally {
      setBusy(false);
    }
  }

  async function selectFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    setStatus("");
    setPending(null);
    try {
      const snapshot = JSON.parse(await file.text());
      const preview = await call("POST", { action: "preview", snapshot });
      setPending({ snapshot, preview });
    } catch (err) {
      setError(err?.code === "self_import" ? copy("settings.local_data.self") : copy("settings.local_data.error"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    setBusy(true);
    setError("");
    try {
      const result = await call("POST", {
        action: "import",
        snapshot: pending.snapshot,
        token: pending.preview.token,
      });
      setPending(null);
      setStatus(copy("settings.local_data.done", { imported: result.imported.toLocaleString() }));
      window.location.reload();
    } catch {
      setError(copy("settings.local_data.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title={copy("settings.local_data.title")}>
        <p className="py-3 text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {copy("settings.local_data.scope")}
        </p>
        {stats && (
          <p className="pb-3 text-xs text-oai-gray-400">
            {copy("settings.local_data.stats", {
              rows: Number(stats.rows || 0).toLocaleString(),
              size: formatBytes(stats.bytes),
            })}
          </p>
        )}
        <SettingsRow
          label={copy("settings.local_data.export")}
          control={
            <Button variant="secondary" size="sm" disabled={busy} onClick={exportSnapshot}>
              {copy("settings.local_data.export")}
            </Button>
          }
        />
        <SettingsRow
          label={copy("settings.local_data.import")}
          control={
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileInput.current?.click()}>
              {copy("settings.local_data.choose")}
            </Button>
          }
        />
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label={copy("settings.local_data.choose")}
          onChange={selectFile}
        />
      </SectionCard>

      {pending && (
        <SectionCard title={copy("settings.local_data.preview")}>
          <p className="py-3 text-sm text-oai-gray-600 dark:text-oai-gray-300">
            {copy("settings.local_data.preview_line", {
              fresh: pending.preview.fresh.toLocaleString(),
              dup: pending.preview.duplicate.toLocaleString(),
            })}
          </p>
          <div className="flex flex-wrap gap-2 pb-3">
            <Button size="sm" disabled={busy || pending.preview.fresh === 0} onClick={confirmImport}>
              {copy("settings.local_data.confirm")}
            </Button>
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setPending(null)}>
              {copy("settings.local_data.cancel")}
            </Button>
          </div>
        </SectionCard>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm text-oai-gray-500">
          {status}
        </p>
      )}
    </div>
  );
}
