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

// 整量备份上传：body 是 gzip 二进制，动作与令牌走 header（body 不是 JSON）。
async function callRaw(action, file, token) {
  const headers = {
    ...(await getLocalApiAuthHeaders()),
    "Content-Type": "application/gzip",
    "x-tokentracker-backup-action": action,
    ...(token ? { "x-tokentracker-import-token": token } : {}),
  };
  const response = await fetch(ENDPOINT, { method: "POST", headers, cache: "no-store", body: file });
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
  // 队列超过单文件上限时分批搬运：记录上一批窗口，把 window.from 作为闭区间
  // 上界传回服务端（边界小时的行会重发一次，导入端按 key 去重兜底）；
  // 新窗口起点没有前移时视为没有更早数据，避免原地循环。
  const [olderBatch, setOlderBatch] = useState(null);

  const load = useCallback(async () => {
    setStats(await call("GET"));
  }, []);

  useEffect(() => {
    load().catch(() => setError(copy("settings.local_data.error")));
  }, [load]);

  async function exportSnapshot(before) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await call("POST", before ? { action: "export", before } : { action: "export" });
      const { snapshot } = result;
      if (!snapshot.rows.length) {
        setOlderBatch(null);
        setStatus(copy("settings.local_data.no_older"));
        return;
      }
      const blob = new Blob([JSON.stringify(snapshot)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tokentracker-local-${snapshot.machine.id.slice(0, 12)}-${snapshot.exported_at.slice(0, 10)}.json`;
      link.click();
      // function 表达式而非箭头函数：ui-hardcode 扫描器会把 JSX 外的 `=>` 误当
      // JSX 文本起点（仓库已知坑，见 AGENTS 教训），用 function 绕开。
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      const nextFrom = result.truncated ? snapshot.window?.from : null;
      setOlderBatch(nextFrom && (before == null || nextFrom < before) ? { before: nextFrom } : null);
      setStatus(
        result.truncated
          ? copy("settings.local_data.exported_window", {
              rows: snapshot.rows.length.toLocaleString(),
              total: Number(result.total_rows || 0).toLocaleString(),
              from: snapshot.window?.from?.slice(0, 10) || "",
            })
          : copy("settings.local_data.exported"),
      );
    } catch {
      setError(copy("settings.local_data.error"));
    } finally {
      setBusy(false);
    }
  }

  // 整机搬迁主路径：整个队列 gzip 成一个 .json.gz（540MB → 几十 MB），
  // 分批窗口快照降级为兜底。pg_dump 式「压缩整量导出 + 恢复端去重」。
  async function exportFullBackup() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const headers = { ...(await getLocalApiAuthHeaders()), "Content-Type": "application/json" };
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({ action: "export_full" }),
      });
      if (!response.ok) throw new Error(`export_full HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `tokentracker-local-full-${String(stats?.machine?.id || "machine").slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.json.gz`;
      link.click();
      // function 表达式而非箭头函数：ui-hardcode 扫描器会把 JSX 外的 `=>` 误当
      // JSX 文本起点（仓库已知坑，见 AGENTS 教训），用 function 绕开。
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setStatus(copy("settings.local_data.export_full_done", { size: formatBytes(blob.size) }));
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
      if (/\.g?z(ip)?$/i.test(file.name)) {
        // 整量备份：二进制 gzip 直接上传，动作放 header（body 不是 JSON）。
        const preview = await callRaw("preview_full", file);
        setPending({ mode: "full", file, preview });
      } else {
        const snapshot = JSON.parse(await file.text());
        const preview = await call("POST", { action: "preview", snapshot });
        setPending({ mode: "windowed", snapshot, preview });
      }
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
      let result;
      if (pending.mode === "full") {
        result = await callRaw("import_full", pending.file, pending.preview.token);
      } else {
        result = await call("POST", {
          action: "import",
          snapshot: pending.snapshot,
          token: pending.preview.token,
        });
      }
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
          label={copy("settings.local_data.export_full")}
          control={
            <Button variant="secondary" size="sm" disabled={busy} onClick={exportFullBackup}>
              {copy("settings.local_data.export_full")}
            </Button>
          }
        />
        <SettingsRow
          label={copy("settings.local_data.export")}
          control={
            <div className="flex items-center gap-2">
              {olderBatch && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => exportSnapshot(olderBatch.before)}>
                  {copy("settings.local_data.export_older")}
                </Button>
              )}
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => exportSnapshot()}>
                {copy("settings.local_data.export")}
              </Button>
            </div>
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
          accept=".json,.gz,.gzip,application/json,application/gzip"
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
