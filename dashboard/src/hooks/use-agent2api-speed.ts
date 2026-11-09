import { useCallback, useEffect, useState } from "react";
import { getAgent2ApiSpeed } from "../lib/api";
import { useLatestRequestGuard } from "./use-latest-request-guard";

// Measured per-model token speed, two evidence tiers merged by the server:
// the Agent2API gateway's own request ledger (duration_ms / first_response_ms
// are gateway-native fields) plus the session sidecar's wall-clock estimates
// for models the gateway never sees — so a machine without the gateway at all
// still gets the sessions page's numbers here. Local-only: both data sources
// live on this machine.
//
// `error` is deliberately separate from "no rows": a failed fetch used to pin
// the tab on the gateway-blame empty copy forever, because this hook's only
// fetch triggers are mount and a period change (no auto-refresh rode along).
export function useAgent2ApiSpeed({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  enabled = true,
}: any = {}) {
  const [models, setModels] = useState<any[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const beginRequest = useLatestRequestGuard([from, to, timeZone, tzOffsetMinutes]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    const isCurrent = beginRequest();
    setLoading(true);
    try {
      const payload = await getAgent2ApiSpeed({ from, to, timeZone, tzOffsetMinutes });
      if (!isCurrent()) return;
      setModels(Array.isArray(payload?.models) ? payload.models : []);
      setError(false);
    } catch {
      if (!isCurrent()) return;
      setModels([]);
      setError(true);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest, enabled, from, to, timeZone, tzOffsetMinutes]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { models, error, loading, refresh };
}
