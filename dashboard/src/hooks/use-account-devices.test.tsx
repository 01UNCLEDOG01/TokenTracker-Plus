import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAccountDevices } from "../lib/api";
import { runAccountDeviceFetch, useAccountDevices } from "./use-account-devices";

vi.mock("../lib/api", () => ({ fetchAccountDevices: vi.fn() }));
vi.mock("../lib/auth-token", () => ({
  resolveAuthAccessToken: async (t: any) => t || "test-token",
}));

describe("useAccountDevices", () => {
  beforeEach(() => vi.mocked(fetchAccountDevices).mockReset());

  it("returns devices in account view", async () => {
    vi.mocked(fetchAccountDevices).mockResolvedValue({
      from: "2026-06-01", to: "2026-06-30",
      devices: [{ id: "d1", device_name: "MacBook", platform: "darwin", total_tokens: 10 }],
    });
    const { result } = renderHook(() =>
      useAccountDevices({
        from: "2026-06-01", to: "2026-06-30", timeZone: "UTC",
        accountView: true, accountAccessToken: "jwt",
      }),
    );
    await waitFor(() => expect(result.current.devices).toHaveLength(1));
    expect(result.current.devices[0]).toMatchObject({ id: "d1", device_name: "MacBook" });
  });

  it("returns empty and does not fetch outside account view", async () => {
    const { result } = renderHook(() =>
      useAccountDevices({ from: "2026-06-01", to: "2026-06-30", accountView: false, accountAccessToken: null }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.devices).toEqual([]);
    expect(fetchAccountDevices).not.toHaveBeenCalled();
  });

  describe("runAccountDeviceFetch", () => {
    it("retries transient failures and returns the successful attempt", async () => {
      const calls: number[] = [];
      const transient: any = new Error("edge warming");
      transient.status = 503;
      const value = await runAccountDeviceFetch(
        async () => {
          calls.push(1);
          if (calls.length < 3) throw transient;
          return { devices: [{ id: "d1" }] };
        },
        { delays: [1, 1] },
      );
      expect(value.devices).toHaveLength(1);
      expect(calls).toHaveLength(3);
    });

    it("gives up after the retry budget and rethrows the last error", async () => {
      const boom: any = new Error("edge down");
      boom.status = 502;
      const task = vi.fn().mockRejectedValue(boom);
      await expect(runAccountDeviceFetch(task, { delays: [1, 1] })).rejects.toThrow("edge down");
      expect(task).toHaveBeenCalledTimes(3);
    });

    it("never retries a rejected token", async () => {
      const unauthorized: any = new Error("Unauthorized");
      unauthorized.status = 401;
      const task = vi.fn().mockRejectedValue(unauthorized);
      await expect(runAccountDeviceFetch(task, { delays: [1, 1] })).rejects.toThrow("Unauthorized");
      expect(task).toHaveBeenCalledTimes(1);
    });
  });
});
