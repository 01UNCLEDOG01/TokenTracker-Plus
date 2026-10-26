import { afterEach, describe, expect, it, vi } from "vitest";
import { isBridgeAvailable, notifyNativeThemeChanged } from "./native-bridge.js";

const original = { webkit: window.webkit, chrome: window.chrome };
afterEach(() => {
  if (original.webkit === undefined) delete window.webkit; else window.webkit = original.webkit;
  if (original.chrome === undefined) delete window.chrome; else window.chrome = original.chrome;
});

describe("notifyNativeThemeChanged", () => {
  it("sends the theme nudge over the WebView2 JSON channel on Windows", () => {
    const postMessage = vi.fn();
    delete window.webkit;
    window.chrome = { webview: { postMessage } };
    expect(isBridgeAvailable()).toBe(true);
    expect(notifyNativeThemeChanged()).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ type: "theme" });
  });

  it("sends an object to the WKWebView handler on macOS", () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { nativeBridge: { postMessage } } };
    delete window.chrome;
    expect(notifyNativeThemeChanged()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "theme" });
  });

  it("is a silent no-op in a plain browser", () => {
    delete window.webkit;
    delete window.chrome;
    expect(isBridgeAvailable()).toBe(false);
    expect(notifyNativeThemeChanged()).toBe(false);
  });
});
