import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postNativeMessage } from "./native-bridge.js";

vi.mock("./native-bridge.js", () => ({ postNativeMessage: vi.fn(() => true) }));

describe("local startup timing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("performance", { mark: vi.fn(), now: () => 125 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("records each allowed stage once and passes only timing to the host", async () => {
    const { markStartupStage } = await import("./startup-performance.js");
    markStartupStage("shell-visible");
    markStartupStage("shell-visible");
    markStartupStage("dashboard-data-ready");
    markStartupStage("untrusted-value");
    expect(performance.mark.mock.calls).toEqual([
      ["tokentracker:shell-visible"], ["tokentracker:dashboard-data-ready"],
    ]);
    expect(postNativeMessage.mock.calls).toEqual([
      [{ type: "startupTiming", stage: "shell-visible", elapsedMs: 125 }],
      [{ type: "startupTiming", stage: "dashboard-data-ready", elapsedMs: 125 }],
    ]);
  });

  it("does not interrupt rendering if performance marks are unavailable", async () => {
    performance.mark.mockImplementation(() => { throw new Error("unsupported"); });
    const { markStartupStage } = await import("./startup-performance.js");
    expect(() => markStartupStage("shell-visible")).not.toThrow();
    expect(postNativeMessage).not.toHaveBeenCalled();
  });
});
