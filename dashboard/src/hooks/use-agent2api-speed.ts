import { useCallback, useEffect, useState } from "react";
import { getAgent2ApiSpeed } from "../lib/api";
import { useLatestRequestGuard } from "./use-latest-request-guard";

// Measured per-model token speed from the Agent2API gateway's own request
// ledger (duration_ms / first_response_ms are gateway-native fields, not
// timestamp deltas). Local-only: the gateway database lives on this machine.
export function useAgent2ApiSpeed({
  from,
  to,
  timeZone,
  tzOffsetMinutes,
  enabled = true,
}: any = {}) {
  const [models, setModels] = useState<any[]>([]);
  const [available, setAvailable] = useState(true);
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
      setAvailable(payload?.available !== false);
    } catch {
      if (!isCurrent()) return;
      setModels([]);
      setAvailable(false);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [beginRequest, enabled, from, to, timeZone, tzOffsetMinutes]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { models, available, loading, refresh };
}
