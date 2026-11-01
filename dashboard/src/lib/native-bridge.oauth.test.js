import { afterEach, describe, expect, it, vi } from "vitest";

import { getNativeOAuthBridge } from "./native-bridge.js";

describe("getNativeOAuthBridge", () => {
  afterEach(() => {
    delete window.webkit;
  });

  it("is null in a normal browser", () => {
    expect(getNativeOAuthBridge()).toBeNull();
  });

  it("uses the nativeOAuth handler when present", () => {
    const handler = { postMessage: vi.fn() };
    window.webkit = { messageHandlers: { nativeOAuth: handler } };
    expect(getNativeOAuthBridge()).toBe(handler);
  });
});
