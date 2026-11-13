const OAUTH_CALLBACK_SETTLE_MS = 150;

/**
 * A cold start races the embedded server (and, through its proxy, the
 * self-hosted instance): the dashboard can mount while the loopback server is
 * still booting, or while the instance is briefly unreachable, and the proxy
 * answers 502/503 (or the fetch rejects outright). Treat those as "not ready
 * yet" rather than "signed out" — a one-shot restore that gives up on the first
 * transient error leaves the user staring at the login form for the rest of the
 * window's life even though the persisted session is perfectly valid.
 */
export const TRANSIENT_RETRY_DELAYS_MS = [400, 1200, 2800];

/**
 * Refresh is a rotating-token POST: replaying it is only safe when the request
 * provably never reached the instance. The local proxy answers 502/503/504 for
 * "could not talk to the instance" and 429 for throttling, so those three are
 * retryable. A status-less failure (fetch rejected) means the response was
 * lost — the rotation may well have happened upstream, so a blind replay would
 * burn the token or trip reuse detection. That case is left to the caller's
 * next out-of-band retry (window focus / boot re-check), which starts from a
 * freshly persisted relay session.
 */
const REFRESH_REPLAYABLE_STATUSES = new Set([429, 502, 503, 504]);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function statusOf(error) {
  if (!error || typeof error !== "object") return 0;
  const status = Number(error.statusCode ?? error.status);
  return Number.isFinite(status) ? status : 0;
}

function canRecoverSession(error) {
  if (!error) return true;
  // No status means the request never got an answer (network/TLS/socket
  // failure). That is not proof of a dead session, so try the refresh path.
  const status = statusOf(error);
  return status === 401 || status === 403 || status === 0;
}

/** Not-ready-yet failures for read-only calls: no status at all, or 5xx/429. */
function isTransientReadFailure(error) {
  if (!error) return false;
  const status = statusOf(error);
  return status === 0 || status === 429 || status >= 500;
}

/** Refresh may only be replayed when it cannot have rotated anything upstream. */
function isReplayableRefreshFailure(error) {
  if (!error) return false;
  return REFRESH_REPLAYABLE_STATUSES.has(statusOf(error));
}

async function withRetry(run, { retryOn, wait, isActive, retryDelaysMs }) {
  let result = await run();
  for (const retryDelayMs of retryDelaysMs) {
    if (!retryOn(result?.error)) return result;
    if (!isActive()) return result;
    await wait(Math.max(0, Number(retryDelayMs) || 0));
    if (!isActive()) return result;
    result = await run();
  }
  return result;
}

/**
 * Restore a session after a fresh embedded-browser launch.
 *
 * InsForge normally restores a valid httpOnly session cookie from
 * getCurrentUser(). On macOS, the dashboard WebView is intentionally released
 * when its window closes, so a restart can begin with no WebView cookies even
 * though the local API still holds its persisted refresh token. In that narrow
 * recovery path, explicitly call refreshSession() once so the local API can
 * mint and relay a new browser session.
 *
 * Transient transport failures are retried a few times before the caller is
 * told there is no user; a real auth answer (401/403) goes straight to the
 * refresh step, and the refresh itself is only replayed when it provably never
 * reached the instance.
 */
export async function restoreInsforgeUser(auth, options = {}) {
  const settleDelayMs = Math.max(0, Number(options.settleDelayMs ?? OAUTH_CALLBACK_SETTLE_MS) || 0);
  const wait = options.wait ?? delay;
  const isActive = options.isActive ?? (() => true);
  const retryDelaysMs = Array.isArray(options.retryDelaysMs) ? options.retryDelaysMs : TRANSIENT_RETRY_DELAYS_MS;
  const baseRetry = { wait, isActive, retryDelaysMs };

  let current = await withRetry(() => auth.getCurrentUser(), { ...baseRetry, retryOn: isTransientReadFailure });
  if (current?.data?.user || !canRecoverSession(current?.error)) return current;
  if (!isActive()) return current;

  // Preserve the OAuth callback race workaround before attempting recovery.
  if (!current?.error && settleDelayMs > 0) {
    await wait(settleDelayMs);
    if (!isActive()) return current;
    current = await auth.getCurrentUser();
    if (current?.data?.user || !canRecoverSession(current?.error)) return current;
  }

  if (!isActive()) return current;
  if (typeof auth.refreshSession !== "function") return current;
  const refreshed = await withRetry(() => auth.refreshSession(), { ...baseRetry, retryOn: isReplayableRefreshFailure });
  if (refreshed?.error) return current;

  return auth.getCurrentUser();
}
