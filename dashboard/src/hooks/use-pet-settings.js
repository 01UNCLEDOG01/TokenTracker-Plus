import { useCallback, useEffect, useState } from "react";
import {
  isNativeApp,
  isPetBridgeAvailable,
  onNativePetSettings,
  onNativeSettings,
  requestNativePetSettings,
  requestNativeSettings,
  setNativePetSetting,
} from "../lib/native-bridge";
import { BOT_COLOR_CHOICES } from "../lib/bot-appearance.js";
import { normalizePetCharacter } from "../lib/pet-personality";

const DEFAULTS = {
  visible: false,
  character: "clawd",
  size: "medium",
  botColor: "auto",
  actionLock: undefined,
};

export function usePetSettings() {
  // The Linux app loads the dashboard without `?app=1`, so it can't pass isNativeApp().
  //
  // Availability is a capability, not a transport sniff: Windows exposes
  // `window.chrome.webview`, while the macOS WKWebView host advertises
  // `petBridge: true` in its `getSettings` reply. The reply is asynchronous, so
  // seed from the cached capability and re-evaluate on every settings push —
  // otherwise the page would stay permanently disabled on macOS.
  const [bridgeAvailable, setBridgeAvailable] = useState(isPetBridgeAvailable);
  const [settings, setSettings] = useState(DEFAULTS);
  // False until the host's first reply; `settings` is only DEFAULTS until then.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    const sync = () => setBridgeAvailable(isPetBridgeAvailable());
    sync();
    const unsubscribe = onNativeSettings(sync);
    // A WKWebView host only reveals petBridge after answering getSettings; the
    // WebView2 host ignores the extra request but answers the pet channel anyway.
    requestNativeSettings();
    return unsubscribe;
  }, []);

  const available = isNativeApp() && bridgeAvailable;

  useEffect(() => {
    if (!available) return undefined;
    const unsubscribe = onNativePetSettings((next) => {
      setLoaded(true);
      setSettings({
        visible: Boolean(next.visible),
        character: normalizePetCharacter(next.character),
        size: ["small", "medium", "large"].includes(next.size) ? next.size : "medium",
        botColor: BOT_COLOR_CHOICES.includes(next.botColor) ? next.botColor : "auto",
        // Capability probe: hosts that predate the Token Monitor pill omit the
        // field, and the page hides the toggle rather than shipping a control
        // that would silently do nothing.
        monitor: typeof next.monitor === "boolean" ? next.monitor : undefined,
        // Same probe for the action picker: hosts predating the「动作」lock omit
        // the field, and the page hides the picker instead of a dead control.
        actionLock: typeof next.actionLock === "string" ? next.actionLock : undefined,
        islandMode: typeof next.islandMode === "boolean" ? next.islandMode : undefined,
        quota: typeof next.quota === "boolean" ? next.quota : undefined,
        trayStyle: typeof next.trayStyle === "string" ? next.trayStyle : undefined,
      });
    });
    requestNativePetSettings();
    return unsubscribe;
  }, [available]);

  // Always apply the optimistic local update so the page reflects the choice
  // immediately (and previews work on the plain web build); only the native
  // post is gated on bridge availability.
  const setSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
    if (available) setNativePetSetting(key, value);
  }, [available]);

  return { available, loaded, settings, setSetting };
}
