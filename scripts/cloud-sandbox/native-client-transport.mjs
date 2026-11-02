export const REALM = "tokentracker-native-sandbox-v1";
// Local-first fork: the sandbox backend is an explicit input. Without
// TT_SANDBOX_BACKEND / TT_SANDBOX_FUNCTIONS the constants are empty and the
// tools that consume them must refuse to run instead of dialing a bundled
// (upstream) host.
export const BACKEND = process.env.TT_SANDBOX_BACKEND || "";
export const FUNCTIONS = process.env.TT_SANDBOX_FUNCTIONS || "";
export const GATEWAY = FUNCTIONS ? FUNCTIONS + "/tokentracker-native-sandbox-gateway" : "";
const FUNCTIONS_ALLOWED = new Set(["tokentracker-device-token-issue", "tokentracker-device-rename", "tokentracker-ingest",
  "tokentracker-device-flow-authorize", "tokentracker-device-flow-grant", "tokentracker-device-flow-poll",
  ...["summary", "daily", "hourly", "monthly", "heatmap", "model-breakdown", "devices"].map(name => "tokentracker-account-" + name)]);
const AUTH_METHODS = new Map([["/api/auth/public-config", "GET"], ["/api/auth/sessions", "POST"], ["/api/auth/refresh", "POST"],
  ["/api/auth/sessions/current", "GET"], ["/api/auth/oauth/exchange", "POST"], ["/api/auth/logout", "POST"]]);
const LOCAL_READ = new Set(["tokentracker-usage-summary", "tokentracker-usage-daily", "tokentracker-usage-hourly", "tokentracker-usage-monthly",
  "tokentracker-usage-heatmap", "tokentracker-usage-model-breakdown", "tokentracker-usage-category-breakdown", "tokentracker-usage-limits",
  "tokentracker-user-status", "tokentracker-achievements", "tokentracker-machine-id", "tokentracker-cloud-sync-pref"]);
const LOCAL_RAM_POST = new Set(["tokentracker-cloud-session", "tokentracker-local-sync", "tokentracker-cloud-sync-pref"]);
function fail(code = "native_sandbox_route_blocked") { return Response.json({ error: code }, { status: 503 }); }
export function classifyNativeSandboxFunction(input, localOrigin) {
  try {
    const url = input instanceof URL ? input : new URL(input, localOrigin);
    if (![BACKEND, FUNCTIONS, localOrigin].includes(url.origin) || url.username || url.password || url.hash) return null;
    const match = url.origin === FUNCTIONS ? url.pathname.match(/^\/(tokentracker-[a-z-]+)$/)
      : url.pathname.match(/^\/(?:api\/)?functions\/(tokentracker-[a-z-]+)$/);
    return match && FUNCTIONS_ALLOWED.has(match[1]) ? match[1] : null;
  } catch { return null; }
}
export function assertPublicProfile(profile) {
  if (profile?.schemaVersion !== 1 || profile.realm !== REALM || profile.environment !== "sandbox" ||
    profile.backendBaseUrl !== BACKEND || profile.gatewayUrl !== GATEWAY || profile.protocol !== "tokentracker-qa" ||
    profile.auth?.issuerUnchanged !== true || profile.auth?.brokerRequired !== true) throw Error("native_sandbox_profile_invalid");
  const site = new URL(profile.returnSiteOrigin);
  if (site.protocol !== "https:" || site.origin !== profile.returnSiteOrigin || site.username || site.password) throw Error("native_sandbox_profile_invalid");
  return Object.freeze({ realm: REALM, environment: "sandbox", backendBaseUrl: BACKEND, gatewayUrl: GATEWAY,
    returnSiteOrigin: site.origin, protocol: "tokentracker-qa" });
}

// Called by the QA native server or an early, mandatory WebView fetch hook.
// Auth stays on the real issuer via the native-local broker; this module
// never implements cookies, refresh, login or session restoration itself.
export function createNativeSandboxTransport({ profile, localOrigin, fetchImpl, authBrokerFetch, localFetch }) {
  assertPublicProfile(profile);
  const local = new URL(localOrigin);
  if (local.origin !== localOrigin || local.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(local.hostname) ||
    typeof fetchImpl !== "function" || typeof authBrokerFetch !== "function") throw Error("native_sandbox_transport_invalid");
  return async (input, init = {}) => {
    const existing = input instanceof Request ? input : null;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, localOrigin);
    const method = String(init.method || existing?.method || "GET").toUpperCase();
    if (![BACKEND, FUNCTIONS, localOrigin].includes(url.origin) || url.username || url.password || url.hash) return fail();
    if (url.pathname.startsWith("/api/auth/")) {
      const expected = AUTH_METHODS.get(url.pathname) || (/^\/api\/auth\/oauth\/(google|github)$/.test(url.pathname) ? "GET" : null);
      if (![BACKEND, localOrigin].includes(url.origin) || expected !== method) return fail();
      return authBrokerFetch(input, init);
    }
    const name = classifyNativeSandboxFunction(url, localOrigin);
    if (!name) {
      const localFunction = url.pathname.match(/^\/(?:api\/)?functions\/(tokentracker-[a-z-]+)$/)?.[1];
      if (url.origin === localOrigin && localFetch &&
        (localFunction && (method === "GET" && LOCAL_READ.has(localFunction) || method === "POST" && LOCAL_RAM_POST.has(localFunction)) ||
        ["GET", "HEAD"].includes(method) && !/^\/(api|functions)(\/|$)/.test(url.pathname))) return localFetch(input, init);
      return fail();
    }
    if (url.searchParams.has("fn") || url.searchParams.has("mode") || url.searchParams.has("environment")) return fail();
    const target = new URL(GATEWAY); target.searchParams.set("fn", name);
    for (const [key, value] of url.searchParams) target.searchParams.append(key, value);
    const sourceHeaders = new Headers(init.headers || existing?.headers);
    const authorization = sourceHeaders.get("Authorization");
    if (!authorization) return fail("native_sandbox_sign_in_required");
    const headers = new Headers({ Authorization: authorization, "X-TokenTracker-Sandbox-Realm": REALM });
    const contentType = sourceHeaders.get("Content-Type"); if (contentType) headers.set("Content-Type", contentType);
    const body = init.body !== undefined ? init.body : existing && !["GET", "HEAD"].includes(method) ? await existing.clone().text() : undefined;
    return fetchImpl(target, { method, headers, body, signal: init.signal || existing?.signal, redirect: "error", credentials: "omit", cache: "no-store" });
  };
}
