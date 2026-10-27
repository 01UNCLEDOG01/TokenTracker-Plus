// Local-first fork: no instance receives privileged routing. Every configured
// cloud instance serves its functions through its own `/functions/` proxy
// route; an unconfigured (local-only) runtime yields an empty URL that
// callers must gate on before fetching.
export function functionUrlFor(baseUrl: string, slug: string) {
  const root = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!root) return "";
  return `${root}/functions/${slug}`;
}

export async function fetchFunctionResponse(url: string, init: RequestInit = {}, fetchImpl = fetch) {
  // No legacy-host fallback: the upstream production functions host was
  // removed with the local-first flip, so a 404 is simply surfaced.
  return fetchImpl(url, init);
}
