import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_DASHBOARD_REFRESH_OPTIONS,
  refreshDashboardAggregates,
  runDashboardPrewarm,
} from "./dashboard-refresh";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("dashboard refresh", () => {
  it("uses the bounded all-local sync profile", () => {
    expect(LOCAL_DASHBOARD_REFRESH_OPTIONS).toEqual({
      auto: true,
      background: true,
      allLocalSources: true,
    });
  });

  it("does not keep the visible refresh waiting for provider limits", async () => {
    const usage = deferred();
    const limits = deferred();
    const refreshUsageStats = vi.fn(() => usage.promise);
    const refreshUsageLimits = vi.fn(() => limits.promise);

    const refresh = refreshDashboardAggregates({ refreshUsageStats, refreshUsageLimits });
    expect(refreshUsageStats).toHaveBeenCalledOnce();
    expect(refreshUsageLimits).toHaveBeenCalledOnce();

    let settled = false;
    void refresh.then(() => {
      settled = true;
    });
    usage.resolve();
    await refresh;
    expect(settled).toBe(true);

    // The quota request is deliberately still pending at this point.
    limits.resolve();
  });

  it("bounds startup pre-warm concurrency and continues after a failed task", async () => {
    let active = 0;
    let maxActive = 0;
    const completed: number[] = [];
    const tasks = [0, 1, 2, 3, 4].map((index) => async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      completed.push(index);
      if (index === 1) throw new Error("optional pre-warm failed");
    });

    await runDashboardPrewarm({ tasks, concurrency: 2 });

    expect(maxActive).toBe(2);
    expect(completed).toHaveLength(5);
    expect(new Set(completed)).toEqual(new Set([0, 1, 2, 3, 4]));
  });
});
