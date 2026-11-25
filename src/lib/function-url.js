// Local-first fork: no instance receives privileged routing. Every configured
// cloud instance (self-hosted or otherwise) serves its functions through its
// own `/functions/` proxy route, and an unconfigured (local-only) runtime
// yields an empty URL that callers must gate on before fetching.
const { instanceFetch } = require("./instance-ca");

function functionUrlFor(baseUrl, slug) {
  const root = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!root) return "";
  return `${root}/functions/${slug}`;
}

const defaultFetchImpl = (url, init) => instanceFetch(url, init);

async function fetchFunctionResponse(url, init = {}, fetchImpl = defaultFetchImpl) {
  // No legacy-host fallback: the upstream production functions host was
  // removed with the local-first flip, so a 404 is simply surfaced.
  // Private self-hosted instances use the same CA-aware direct transport as
  // account reads; otherwise script-launched uploads inherit a proxy and lose
  // the instance CA, leaving the queue stuck on a generic "fetch failed".
  return fetchImpl(url, init);
}

module.exports = { functionUrlFor, fetchFunctionResponse };
