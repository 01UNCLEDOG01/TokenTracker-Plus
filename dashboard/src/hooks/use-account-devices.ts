import { useCallback, useEffect, useState } from "react";
import { resolveAuthAccessToken } from "../lib/auth-token";
import { fetchAccountDevices } from "../lib/api";
import { useLatestRequestGuard } from "./use-latest-request-guard";

// 瞬时失败重试间隔（毫秒）。2026-11-13 站主报「设备分布卡片有时加载不出来」：
// 这个 hook 一次失败就把 devices 清空，卡片按「≥2 行」判定直接从页面上消失，
// 而一次网络抖动 / 实例刚重启 / edge 8s 超时都会触发它——看起来就是随机消失。
const RETRY_DELAYS = [600, 1500];

/** 5xx、429、以及没有 HTTP 状态的网络类错误值得重试；401/403/404 不重试。 */
function isTransientAccountError(error: any): boolean {
  const status = Number(error?.status);
  if (!Number.isFinite(status)) return true;
  if (status === 0 || status === 429) return true;
  return status >= 500;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 带瞬时重试地执行一次取数；重试用尽时把最后一次错误抛给调用方。 */
export async function runAccountDeviceFetch<T>(
  task: () => Promise<T>,
  { delays = RETRY_DELAYS, isTransient = isTransientAccountError } = {} as { delays?: number[]; isTransient?: (e: any) => boolean },
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await task();
    } catch (e) {
      if (attempt >= delays.length || !isTransient(e)) throw e;
      await wait(delays[attempt]);
    }
  }
}

/**
 * Lists the signed-in account's active devices with per-device usage totals
 * for [from, to]. Only fetches in account view (cross-device cloud reads);
 * outside it the dashboard is single-device and there is nothing to compare.
 */
export function useAccountDevices({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  accountView = false,
  accountAccessToken = null,
  accountRevision = 0,
}: any = {}) {
  const enabled = Boolean(accountView && accountAccessToken);
  const [devices, setDevices] = useState<any[]>([]);
  // Account-level sources (e.g. Cursor) have no device attribution; the edge
  // returns their account-wide totals separately so the card can still show
  // them (otherwise its total is short of the dashboard total by their share).
  const [accountSources, setAccountSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const beginRequest = useLatestRequestGuard([
    enabled,
    from,
    to,
    timeZone,
    tzOffsetMinutes,
    accountAccessToken,
    accountRevision,
  ]);

  const refresh = useCallback(async () => {
    const isCurrent = beginRequest();
    if (!enabled) {
      setDevices([]);
      setAccountSources([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await resolveAuthAccessToken(accountAccessToken);
      if (!isCurrent()) return;
      const res = await runAccountDeviceFetch(() =>
        fetchAccountDevices({ from, to, timeZone, tzOffsetMinutes, accessToken: token }),
      );
      if (!isCurrent()) return;
      setDevices(Array.isArray(res?.devices) ? res.devices : []);
      setAccountSources(Array.isArray(res?.account_sources) ? res.account_sources : []);
      setError(null);
    } catch (e: any) {
      if (!isCurrent()) return;
      // 重试用尽仍失败（或前置步骤抛错）：只记录错误，**保留上一份成功数据**——
      // 卡片不能因为一次瞬时失败整块消失（范围切换时下面的 effect 已先清空）。
      setError(e?.message || String(e));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [enabled, accountAccessToken, from, to, timeZone, tzOffsetMinutes, accountRevision, beginRequest]);

  useEffect(() => {
    // Device totals are range-bound; clear them before loading a new range so
    // the selector cannot expose an old range under the current period.
    setDevices([]);
    setAccountSources([]);
    setError(null);
    if (enabled) setLoading(true);
    void refresh().catch(() => {});
  }, [enabled, refresh]);

  return { devices, accountSources, loading, error, refresh };
}
