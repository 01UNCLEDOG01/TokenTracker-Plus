// Local-first fork: no instance receives privileged routing. Every configured
// cloud instance serves its functions through its own `/functions/` proxy
// route; an unconfigured (local-only) runtime yields an empty URL that
// callers must gate on before fetching.
function runtimeDescriptor(): { baseUrl?: string; localOnly?: boolean } | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as { __TOKENTRACKER_RUNTIME_CONFIG__?: { baseUrl?: string; localOnly?: boolean } })
    .__TOKENTRACKER_RUNTIME_CONFIG__;
}

function isLocalHostPage() {
  return typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
}

export function functionUrlFor(baseUrl: string, slug: string) {
  const root = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!root) return "";
  // Desktop app on localhost: the WebView's TLS store does not trust a
  // self-hosted instance's private CA, so browser→instance calls fail with
  // "Load failed" (leaderboard, avatar, account views). Route cloud
  // functions through the local server, which holds the CA trust, instead.
  const runtime = runtimeDescriptor();
  // The SDK's functions client joins this base with `/${slug}` itself, so an
  // empty slug must not leave a trailing slash (that yields a doubled
  // separator and an empty first path segment).
  if (isLocalHostPage() && runtime && runtime.localOnly !== true) {
    return slug ? `${window.location.origin}/api/cloud/functions/${slug}` : `${window.location.origin}/api/cloud/functions`;
  }
  return `${root}/functions/${slug}`;
}

export async function fetchFunctionResponse(url: string, init: RequestInit = {}, fetchImpl = fetch) {
  // No legacy-host fallback: the upstream production functions host was
  // removed with the local-first flip, so a 404 is simply surfaced.
  return fetchImpl(url, init);
}
