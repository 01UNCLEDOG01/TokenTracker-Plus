import { afterEach, describe, expect, it, vi } from "vitest";
import { isBridgeAvailable, notifyNativeThemeChanged } from "./native-bridge.js";

const original = { webkit: window.webkit, chrome: window.chrome };
afterEach(() => {
  if (original.webkit === undefined) delete window.webkit; else window.webkit = original.webkit;
  if (original.chrome === undefined) delete window.chrome; else window.chrome = original.chrome;
});

describe("notifyNativeThemeChanged", () => {
  it("sends the theme as a nativeSetting over the WebView2 JSON channel on Windows", () => {
    const postMessage = vi.fn();
    delete window.webkit;
    window.chrome = { webview: { postMessage } };
    expect(isBridgeAvailable()).toBe(true);
    expect(notifyNativeThemeChanged("light")).toBe(true);
    expect(postMessage).toHaveBeenCalledTimes(1);
    // Windows parses every message as JSON and ignores unknown types, so the
    // payload must be the shape its handler knows (nativeSetting), not {type:"theme"}.
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      type: "nativeSetting",
      key: "tokentracker-theme",
      value: "light",
    });
  });

  it("sends the same shape to the WKWebView handler on macOS", () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { nativeBridge: { postMessage } } };
    delete window.chrome;
    expect(notifyNativeThemeChanged("dark")).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "nativeSetting",
      key: "tokentracker-theme",
      value: "dark",
    });
  });

  it("is a silent no-op in a plain browser", () => {
    delete window.webkit;
    delete window.chrome;
    expect(isBridgeAvailable()).toBe(false);
    expect(notifyNativeThemeChanged("light")).toBe(false);
  });
});
