import { createClient } from "@insforge/sdk";
import { functionUrlFor } from "./function-url";
import { validateInsforgeDeployment } from "./insforge-deployment-config.mjs";

/**
 * Local-first fork: no bundled cloud fallback. Cloud features require an
 * explicitly configured InsForge instance injected at runtime (the local
 * server sets `window.__TOKENTRACKER_RUNTIME_CONFIG__`) or `VITE_INSFORGE_*`
 * build-time variables for a self-hosted deployment. With neither present,
 * `getInsforgeRemoteUrl` returns "" and all cloud UI is hidden.
 *
 * The historical production fallback pointed at the upstream project's
 * InsForge instance and was removed with the local-first flip.
 */
const PROD_INSFORGE_BASE_URL = "";
const PROD_INSFORGE_ANON_KEY = "";

export const INSFORGE_INSTANCE_CHANGED_EVENT = "tt.insforgeInstanceChanged";
const INSTANCE_STORAGE_KEY = "tt.insforge.instance";
type RuntimeConfiguration = {
  baseUrl?: string; anonKey?: string; dashboardUrl?: string; configurationError?: string;
  localHistory?: boolean; localOnly?: boolean;
};
declare global {
  interface Window { __TOKENTRACKER_RUNTIME_CONFIG__?: RuntimeConfiguration; }
}

function localHost() {
  return typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
}
export function getInsforgeConfiguration() {
  const runtime = typeof window === "undefined" ? undefined : window.__TOKENTRACKER_RUNTIME_CONFIG__;
  if (runtime !== undefined) {
    // The CLI injects `localOnly: true` with an empty baseUrl for its normal
    // single-machine / offline run. That descriptor is a VALID "no cloud"
    // state, not a misconfiguration: the operator never provided a backend, so
    // there is nothing to validate and nothing to warn about. Only an explicit
    // `configurationError` (malformed self-hosted config) or a descriptor that
    // claims a usable deployment without a baseUrl is an error worth surfacing.
    if (runtime?.localOnly === true && !runtime.configurationError && !runtime.baseUrl) {
      return { baseUrl: "", anonKey: "", errorCode: null, source: "runtime" as const };
    }
    if (!runtime || runtime.configurationError || !runtime.baseUrl) {
      return { baseUrl: "", anonKey: "", errorCode: "runtime_configuration_error", source: "runtime" as const };
    }
    return { ...validateInsforgeDeployment({ baseUrl: runtime.baseUrl, anonKey: runtime.anonKey,
      strictPair: true, defaultBaseUrl: PROD_INSFORGE_BASE_URL, defaultAnonKey: PROD_INSFORGE_ANON_KEY }), source: "runtime" as const };
  }
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return { ...validateInsforgeDeployment({
    baseUrl: env?.VITE_INSFORGE_BASE_URL || env?.VITE_TOKENTRACKER_BACKEND_BASE_URL,
    anonKey: env?.VITE_INSFORGE_ANON_KEY || env?.VITE_TOKENTRACKER_BACKEND_ANON_KEY,
    defaultBaseUrl: PROD_INSFORGE_BASE_URL, defaultAnonKey: PROD_INSFORGE_ANON_KEY,
  }), source: "build" as const };
}
export function getInsforgeConfigurationError(): string | null {
  return getInsforgeConfiguration().errorCode;
}
/**
 * Single-machine build: the CLI's runtime descriptor marks itself local-only.
 * Cloud navigation, account chrome, and cloud settings are hidden; a local
 * profile provides the visible identity instead.
 */
export function isLocalOnlyDeployment(): boolean {
  if (typeof window === "undefined") return false;
  return window.__TOKENTRACKER_RUNTIME_CONFIG__?.localOnly === true;
}

export function getInsforgeRemoteUrl(): string { return getInsforgeConfiguration().baseUrl; }
export function getInsforgeAnonKey(): string { return getInsforgeConfiguration().anonKey; }
/**
 * A cloud backend exists only when the resolved base URL is non-empty. An empty
 * base URL is the local-only/offline state: `errorCode` is null there by
 * design, so `!errorCode` alone must never be read as "cloud configured".
 */
function hasInsforgeCloudBackend(config: { baseUrl?: string; errorCode?: string | null }): boolean {
  return !config.errorCode && Boolean(config.baseUrl);
}
export function isCloudInsforgeConfigured(): boolean { return hasInsforgeCloudBackend(getInsforgeConfiguration()); }
export function getInsforgeInstanceFingerprint(): string {
  return getInsforgeConfiguration().baseUrl;
}
export function isOfficialInsforgeInstance(): boolean {
  // Local-first: an unconfigured (or local-only) deployment must not masquerade
  // as the official instance — which no longer exists and resolves to "" — and
  // activate official-only behaviors. An empty base URL is "no cloud", never
  // "the official instance".
  const config = getInsforgeConfiguration();
  return hasInsforgeCloudBackend(config) && config.baseUrl === PROD_INSFORGE_BASE_URL;
}
export function getInsforgeConnectionHost(): string | null {
  const config = getInsforgeConfiguration();
  if (!hasInsforgeCloudBackend(config) || config.baseUrl === PROD_INSFORGE_BASE_URL) return null;
  return new URL(config.baseUrl).host;
}

let insforgeClientSingleton: ReturnType<typeof createClient> | null = null;
let clientIdentity = "";
let restoreBlocked = false;

// The SDK's current session is in memory; PKCE and legacy auth keys belong
// to its own namespace. Provider preferences and local usage are untouched.
function clearSdkBrowserStorage() {
  if (typeof window === "undefined") return;
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
      for (const key of keys) {
        if (key && (/^insforge(?:[_:.-]|$)/i.test(key) || key === "tt.cloud.return")) storage.removeItem(key);
      }
    } catch { /* A disabled store cannot retain SDK PKCE for this session. */ }
  }
}
export function resetInsforgeClientForInstanceChange() {
  (insforgeClientSingleton as any)?.tokenManager?.clearSession?.();
  insforgeClientSingleton = null;
  clientIdentity = "";
  restoreBlocked = true;
  clearSdkBrowserStorage();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(INSFORGE_INSTANCE_CHANGED_EVENT));
}
export function shouldRestoreInsforgeSession(): boolean { return !restoreBlocked; }
export function allowInsforgeSessionRestore(): void { restoreBlocked = false; }
export function isCurrentInsforgeClient(client: unknown): boolean {
  const config = getInsforgeConfiguration();
  return hasInsforgeCloudBackend(config) && client === insforgeClientSingleton && clientIdentity === `${config.baseUrl}\0${config.anonKey}`;
}

export function getOrCreateInsforgeClient(): ReturnType<typeof createClient> | null {
  const config = getInsforgeConfiguration();
  if (!hasInsforgeCloudBackend(config)) {
    if (insforgeClientSingleton) resetInsforgeClientForInstanceChange();
    return null;
  }
  const identity = `${config.baseUrl}\0${config.anonKey}`;
  if (insforgeClientSingleton && clientIdentity === identity) return insforgeClientSingleton;
  let previousBase = "";
  try { previousBase = localStorage.getItem(INSTANCE_STORAGE_KEY) || ""; } catch { /* No persisted instance. */ }
  // Local-first: there is no bundled official instance, so a missing persisted
  // marker means a brand-new profile, not an instance switch — OAuth callback
  // detection and session restore must work on the very first load. The old
  // third arm (!previousBase && baseUrl !== PROD) would have treated every
  // first-time configured instance as a switch and blocked both.
  const changed = Boolean((clientIdentity && clientIdentity !== identity) ||
    (previousBase && previousBase !== config.baseUrl));
  if (changed) resetInsforgeClientForInstanceChange();
  try { localStorage.setItem(INSTANCE_STORAGE_KEY, config.baseUrl); } catch { /* Restoration stays conservative. */ }
  const expectedBase = config.baseUrl;
  const markLocalProxy = config.source === "runtime" && localHost();
  insforgeClientSingleton = createClient({
    baseUrl: localHost() ? window.location.origin : config.baseUrl,
    functionsUrl: functionUrlFor(config.baseUrl, "").replace(/\/$/, ""),
    anonKey: config.anonKey,
    auth: { detectOAuthCallback: !changed },
    ...(markLocalProxy ? { fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, window.location.origin);
      if (url.origin !== window.location.origin) return fetch(input, init);
      const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      headers.set("x-tokentracker-instance", expectedBase);
      return fetch(input, { ...init, headers });
    } } : {}),
  });
  clientIdentity = identity;
  return insforgeClientSingleton;
}
