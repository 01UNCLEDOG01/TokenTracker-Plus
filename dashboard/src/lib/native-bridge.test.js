import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCachedNativeSettings,
  hasNativeCapability,
  isBridgeAvailable,
  isPetBridgeAvailable,
  notifyNativeThemeChanged,
  requestNativePetSettings,
  setNativePetSetting,
} from "./native-bridge.js";

/** The macOS host answers getSettings by dispatching native:settings. */
function dispatchSettings(detail) {
  window.dispatchEvent(new CustomEvent("native:settings", { detail }));
}

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

describe("native settings capabilities", () => {
  it("caches the macOS getSettings reply so capability gates can read it synchronously", () => {
    delete window.webkit;
    delete window.chrome;
    dispatchSettings({
      platform: "macos",
      petBridge: true,
      quotaWindow: true,
      widgetGallerySupported: false,
      trayIconStyles: ["clawd", "cat", "bot", "pet", "static"],
      islandModes: ["island"],
      petActionLockSupported: false,
    });
    expect(getCachedNativeSettings()).toMatchObject({
      platform: "macos",
      petBridge: true,
      quotaWindow: true,
      widgetGallerySupported: false,
    });
    expect(hasNativeCapability("petBridge")).toBe(true);
    expect(hasNativeCapability("quotaWindow")).toBe(true);
    // false capabilities must NOT read as present (B2b hides the gallery on it).
    expect(hasNativeCapability("widgetGallerySupported")).toBe(false);
    expect(hasNativeCapability("unknownCapability")).toBe(false);
    // Capability false values must stay false: PetPage hides the 动作 picker on
    // petActionLockSupported:false and filters 自由悬浮 against islandModes.
    expect(getCachedNativeSettings()).toMatchObject({
      islandModes: ["island"],
      petActionLockSupported: false,
    });
    expect(hasNativeCapability("petActionLockSupported")).toBe(false);
  });

  it("treats a WKWebView host that advertises petBridge as a native pet host", () => {
    window.webkit = { messageHandlers: { nativeBridge: { postMessage: vi.fn() } } };
    delete window.chrome;
    dispatchSettings({ platform: "macos", petBridge: false });
    expect(isPetBridgeAvailable()).toBe(false);
    dispatchSettings({ platform: "macos", petBridge: true });
    expect(isPetBridgeAvailable()).toBe(true);
  });

  it("keeps the Windows WebView2 marker as a native pet host", () => {
    delete window.webkit;
    window.chrome = { webview: { postMessage: vi.fn() } };
    expect(isPetBridgeAvailable()).toBe(true);
  });

  it("is not a pet host in a plain browser or without the capability", () => {
    delete window.webkit;
    delete window.chrome;
    dispatchSettings({ platform: "macos", quotaWindow: true });
    expect(isPetBridgeAvailable()).toBe(false);
  });

  it("routes the pet channel through the WKWebView messageHandlers bridge", () => {
    const postMessage = vi.fn();
    window.webkit = { messageHandlers: { nativeBridge: { postMessage } } };
    delete window.chrome;
    expect(requestNativePetSettings()).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "getPetSettings" });
    expect(setNativePetSetting("monitor", true)).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "setPetSetting",
      key: "monitor",
      value: true,
    });
  });
});
