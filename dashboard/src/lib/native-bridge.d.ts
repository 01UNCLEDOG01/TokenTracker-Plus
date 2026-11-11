export function saveCloudUsageExport(options: {
  filename: string;
  content: string;
  format: "csv" | "json";
  signal?: AbortSignal;
}): Promise<null | { saved: true; filename: string }>;

/**
 * Latest `native:settings` payload. The native host answers `getSettings` by
 * dispatching a `native:settings` CustomEvent; this module caches that detail so
 * capability probes (`isPetBridgeAvailable`, `hasNativeCapability`) can answer
 * synchronously during render, before any hook has mounted.
 */
export interface NativeHostSettings {
  /** Host identity. Absent on hosts older than the capability contract. */
  platform?: "macos" | "windows";
  /** The WKWebView host answers the pet settings channel. */
  petBridge?: boolean;
  /** The desktop quota panel is available (macOS B3c). */
  quotaWindow?: boolean;
  /** The bundled WidgetKit gallery is usable (false: the appex is not shipped). */
  widgetGallerySupported?: boolean;
  /** Island forms the host can actually show; macOS advertises ["island"] only. */
  islandModes?: Array<"island" | "float">;
  /** The host implements the pet pose action lock. */
  petActionLockSupported?: boolean;
  /** Menu-bar icon styles the host can render. */
  trayIconStyles?: string[];
  [key: string]: unknown;
}

export function getCachedNativeSettings(): NativeHostSettings | null;

/** True when the cached `getSettings` reply advertises the given capability. */
export function hasNativeCapability(name: string): boolean;

export function isNativeApp(): boolean;
export function isNativeEmbed(): boolean;
export function isBridgeAvailable(): boolean;

/** True when the host answers the desktop-pet settings channel. */
export function isPetBridgeAvailable(): boolean;
export function requestNativePetSettings(): boolean;
export function setNativePetSetting(key: string, value: unknown): boolean;
export function refreshNativePetCatalog(): boolean;
