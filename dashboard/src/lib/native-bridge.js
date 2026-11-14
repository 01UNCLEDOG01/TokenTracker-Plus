/**
 * Bridge helpers for talking to the Windows WebView2 host via
 * the Windows WebView2 host via
 * `window.chrome.webview`. The native side dispatches a `native:settings`
 * CustomEvent on `window` whenever state changes.
 *
 * Safe no-ops in browser/cloud mode.
 */

const NATIVE_APP_KEY = "tokentracker_native_app";

// Module-level cache for native system appearance.
// An always-on listener (installed at module load) keeps this fresh,
// so React components don't depend on lifecycle ordering to receive
// `native:systemAppearanceChanged` events.
let nativeSystemDark = null; // null = unknown, true/false = native push received
const nativeSystemListeners = new Set();

// Latest `native:settings` payload from the host. Cached at module level (like
// the system-appearance value above) because capability probes run during render,
// before any hook has requested settings: the macOS WKWebView host advertises
// `petBridge` here instead of exposing the WebView2-only `window.chrome.webview`.
let nativeSettingsDetail = null;

if (typeof window !== "undefined") {
  window.addEventListener("native:settings", (event) => {
    if (event?.detail && typeof event.detail === "object") nativeSettingsDetail = event.detail;
  });

  window.addEventListener("native:systemAppearanceChanged", (event) => {
    const d = event?.detail?.isDark;
    if (typeof d !== "boolean") return;
    nativeSystemDark = d;
    // Defensive: also write .dark directly so the page reflects the change
    // even before React re-renders — but only when the dashboard follows the
    // system (upstream TT #1113, 2026-11-13). When the user pinned light/dark,
    // the push merely refreshes the cache; writing the class here would hijack
    // the pinned theme and React would never revert it (resolvedTheme does not
    // change). ThemeProvider's applyThemeToDOM still converges on system mode.
    try {
      const theme = localStorage.getItem("tokentracker-theme") || "system";
      if (theme === "system") {
        const root = document.documentElement;
        if (d) root.classList.add("dark");
        else root.classList.remove("dark");
      }
    } catch { /* ignore */ }
    nativeSystemListeners.forEach((cb) => {
      try { cb(d); } catch { /* ignore listener errors */ }
    });
  });
}

/** Latest `native:settings` payload from the host, or null if none arrived yet. */
export function getCachedNativeSettings() {
  return nativeSettingsDetail;
}

/** True when the host answered `getSettings` with a capability = true. */
export function hasNativeCapability(name) {
  return nativeSettingsDetail?.[name] === true;
}

/** Latest system appearance pushed by native, or null if none yet. */
export function getCachedNativeSystemDark() {
  return nativeSystemDark;
}

/** Subscribe to native system appearance changes. Returns unsubscribe fn. */
export function subscribeNativeSystemAppearance(callback) {
  nativeSystemListeners.add(callback);
  return () => nativeSystemListeners.delete(callback);
}

export function isNativeApp() {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("app") === "1") {
      try { window.localStorage.setItem(NATIVE_APP_KEY, "1"); } catch { /* ignore */ }
      return true;
    }
    return window.localStorage.getItem(NATIVE_APP_KEY) === "1";
  } catch {
    return false;
  }
}

/** True when running inside a WKWebView embed whose native bridge is always present. */
export function isNativeEmbed() {
  if (typeof window === "undefined") return false;
  return Boolean(window.webkit?.messageHandlers?.nativeBridge);
}

/**
 * True when running inside the Windows tray app's WebView2 host
 * (`window.chrome.webview` exists only there) in native-app mode. Used to hide
 * macOS-only features (e.g. the Widgets page) on Windows.
 */
export function isNativeWindowsApp() {
  if (typeof window === "undefined") return false;
  return Boolean(window.chrome?.webview) && isNativeApp();
}

/**
 * The handler that opens OAuth in the system browser, or null in a normal
 * browser. Windows exposes it via the WebView2 host bridge.
 */
export function getNativeOAuthBridge() {
  if (typeof window === "undefined") return null;
  const handler = window.webkit?.messageHandlers?.nativeOAuth;
  return handler ? handler : null;
}

function getHandler() {
  if (typeof window === "undefined") return null;
  return window.webkit?.messageHandlers?.nativeBridge ?? null;
}

export function isBridgeAvailable() {
  if (typeof window === "undefined") return false;
  return Boolean(getHandler() || window.chrome?.webview);
}

function post(message) {
  const handler = getHandler();
  if (handler) {
    try {
      handler.postMessage(message);
      return true;
    } catch (err) {
      console.warn("[tokentracker] nativeBridge post failed:", err);
      return false;
    }
  }

  // WebView2 exposes a single JSON message channel instead of WKWebView's
  // messageHandlers namespace. Keep the public bridge API identical so native
  // settings work on both desktop platforms.
  if (typeof window !== "undefined" && window.chrome?.webview) {
    try {
      window.chrome.webview.postMessage(typeof message === "string" ? message : JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** Post a generic message to either native host. */
export function postNativeMessage(message) {
  return post(message);
}

const CLOUD_EXPORT_EVENT = "tokentracker:cloud-export-result";
const CLOUD_EXPORT_MAX_BYTES = 5 * 1024 * 1024;
const CLOUD_EXPORT_NAME = /^tokentracker-cloud-[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.(csv|json)$/;

function cloudExportError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Native saves acknowledge the actual write. Browser callers use their Blob fallback. */
export function saveCloudUsageExport({ filename, content, format, signal }) {
  const native = typeof window !== "undefined" && (
    isNativeEmbed() || isNativeWindowsApp() || isNativeApp()
  );
  if (!native) return Promise.resolve(null);
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if ((format !== "csv" && format !== "json") || typeof filename !== "string"
    || !CLOUD_EXPORT_NAME.test(filename) || !filename.endsWith(`.${format}`)
    || typeof content !== "string" || !content || content.includes("\0")
    || new TextEncoder().encode(content).byteLength > CLOUD_EXPORT_MAX_BYTES) {
    return Promise.reject(cloudExportError("invalid_export"));
  }

  const win = window.chrome?.webview;
  if (window.__TOKENTRACKER_CLOUD_EXPORT__ !== true
    || typeof win?.postMessage !== "function") {
    return Promise.reject(cloudExportError("unsupported"));
  }
  const requestId = crypto.randomUUID();
  const stem = filename.slice(0, -(format.length + 1));
  const payload = { type: "saveCloudUsageExport", requestId, filename, content, format };
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener(CLOUD_EXPORT_EVENT, receive);
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(result);
    };
    const abort = () => finish(new DOMException("Aborted", "AbortError"));
    const acknowledge = (detail) => {
      if (!detail || detail.requestId !== requestId) return;
      const savedName = detail.filename;
      const collisionName = typeof savedName === "string" && savedName.startsWith(`${stem}-`)
        && /^-[1-9]\d{0,2}\.(csv|json)$/.test(savedName.slice(stem.length)) && savedName.endsWith(`.${format}`);
      if (detail.saved === true && (savedName === filename || collisionName)) {
        finish(null, { saved: true, filename: detail.filename });
      } else {
        const code = ["invalid_export", "forbidden_source", "save_failed", "unsupported"]
          .includes(detail.errorCode) ? detail.errorCode : "save_failed";
        finish(cloudExportError(code));
      }
    };
    const receive = (event) => acknowledge(event.detail);
    window.addEventListener(CLOUD_EXPORT_EVENT, receive);
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(cloudExportError("save_timeout")), 15000);
    if (signal?.aborted) { abort(); return; }
    try {
      if (typeof win?.postMessage === "function") win.postMessage(JSON.stringify(payload));
      else finish(cloudExportError("unsupported"));
    } catch {
      finish(cloudExportError("save_failed"));
    }
  });
}

export function notifyNative({ title, body, id }) {
  return postNativeMessage({ type: "notify", title, body, id });
}

export function requestNativeSettings() {
  return post({ type: "getSettings" });
}

export function setNativeSetting(key, value) {
  return post({ type: "setSetting", key, value });
}

export function nativeAction(name) {
  return post({ type: "action", name });
}

export function requestNativeSystemAppearance() {
  return post({ type: "getSystemAppearance" });
}

/**
 * macOS Dashboard 窗口：与 Web 主题同步 NSWindow.appearance。
 * `theme === "system"` 时原生侧将窗口 appearance 置为跟随系统；系统切换时再由原生推送 `native:systemAppearanceChanged`（WKWebView 内 matchMedia 常不刷新）。
 * @param {"light" | "dark"} resolvedTheme
 * @param {"light" | "dark" | "system"} theme
 */
export function syncNativeChromeAppearance(resolvedTheme, theme) {
  if (!isNativeEmbed()) return;
  const isDark = resolvedTheme === "dark";
  post({ type: "setChromeAppearance", isDark, theme: theme ?? "system" });
}

/**
 * Windows 托盘宿主：主题一变就把偏好写进原生设置，宿主随即重绘桌宠 / 额度 / 监视器
 * 三个小窗。必须用 `nativeSetting` 这个形状：Windows 的 DashboardWindow 先把消息当
 * JSON 解析，只认 nativeAction / nativeSetting / getPetSettings / setPetSetting / notify，
 * 其余直接 return —— 纯文本的 `case "theme"` 永远走不到，因为 post() 在 WebView2 上
 * 一律 JSON.stringify（2026-10-27 实测：发 {type:"theme"} 被静默丢弃，`native-settings.json`
 * 里的 Theme 一直停在旧值）。
 * macOS 的 permitsNativeMessage 不认识 nativeSetting，会 return false 丢掉，不影响那边
 * 已有的 setChromeAppearance 同步。
 */
export function notifyNativeThemeChanged(theme) {
  if (!isBridgeAvailable()) return false;
  return post({ type: "nativeSetting", key: "tokentracker-theme", value: theme ?? "system" });
}

/**
 * Subscribe to native settings updates. Returns an unsubscribe function.
 * The handler is invoked with the settings object (`detail` of the CustomEvent).
 */
export function onNativeSettings(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (event) => {
    if (event && event.detail && typeof event.detail === "object") {
      handler(event.detail);
    }
  };
  window.addEventListener("native:settings", listener);
  return () => window.removeEventListener("native:settings", listener);
}

/**
 * Desktop-pet settings are supported by either native host.
 *
 * Historical marker was `window.chrome.webview` — WebView2 only — which left the
 * pet page dead in the macOS app even though its NativeBridge answers the pet
 * channel. The WKWebView host now advertises the capability in `getSettings`
 * (`petBridge: true`), so a capability reply counts as a native pet host. Ask for
 * settings before relying on this (see use-pet-settings); the cached reply makes
 * the probe react once it arrives.
 */
export function isPetBridgeAvailable() {
  if (typeof window === "undefined") return false;
  if (window.chrome?.webview) return true;
  return nativeSettingsDetail?.petBridge === true;
}

function postPetMessage(message) {
  // Both hosts answer the same message shapes; `post` already routes WKWebView
  // messageHandlers (object payload) and WebView2 (JSON string).
  return post(message);
}

export function requestNativePetSettings() {
  return postPetMessage({ type: "getPetSettings" });
}

export function setNativePetSetting(key, value) {
  return postPetMessage({ type: "setPetSetting", key, value });
}

export function refreshNativePetCatalog() {
  return postPetMessage({ type: "refreshPetCatalog" });
}

export function onNativePetSettings(handler) {
  if (typeof window === "undefined") return () => {};
  const listener = (event) => {
    if (event?.detail && typeof event.detail === "object") handler(event.detail);
  };
  window.addEventListener("native:petSettings", listener);
  return () => window.removeEventListener("native:petSettings", listener);
}
