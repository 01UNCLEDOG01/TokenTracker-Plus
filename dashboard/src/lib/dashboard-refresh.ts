export const LOCAL_DASHBOARD_REFRESH_OPTIONS = Object.freeze({
  auto: true,
  background: true,
  allLocalSources: true,
});

interface DashboardAggregateRefreshers {
  refreshUsageStats: () => Promise<unknown>;
  refreshUsageLimits: () => Promise<unknown>;
}

// Provider limits can involve several network-bound readers. Start that work
// with the local aggregates, but let the visible dashboard refresh settle as
// soon as local usage is ready.
export async function refreshDashboardAggregates({
  refreshUsageStats,
  refreshUsageLimits,
}: DashboardAggregateRefreshers) {
  const usagePromise = refreshUsageStats();
  void refreshUsageLimits();
  await usagePromise;
}

// Startup pre-warming is deliberately bounded. Account-view reads are not
// cheap: firing every period at once competes with the initial six aggregates
// and turns a warm private backend into a burst of client-side timeouts.
export async function runDashboardPrewarm({
  tasks,
  concurrency = 2,
}: {
  tasks: Array<() => Promise<unknown>>;
  concurrency?: number;
}) {
  const limit = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length));
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < tasks.length) {
      const task = tasks[nextIndex++];
      try {
        await task();
      } catch {
        // Pre-warming is best-effort; the visible panel owns error reporting.
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
}
