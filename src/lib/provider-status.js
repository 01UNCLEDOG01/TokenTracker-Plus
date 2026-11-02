// Provider service-status probes (Statuspage.io-style), CodexBar-inspired.
//
// Answers "is the provider itself down?" so the limits panel can explain
// upstream failures instead of leaving users guessing (issue: users read a
// red/stale Claude limits row as a TokenTracker bug during Anthropic
// incidents). Fail-soft by design: a probe failure never breaks the limits
// response — callers get the last good reading or null, never a throw.
//
// Statuspage.io contract (`/api/v2/status.json`):
//   { "page": { "updated_at": ISO }, "status": { "indicator": "none|minor|major|critical", "description": "..." } }

const { parseDeepSeekStatusPage } = require("./deepseek-status");

const STATUS_PROBE_TIMEOUT_MS = 6_000;
// Status pages change on incident timescales; 5 minutes keeps the limits
// poll (2-min TTL upstream) from hammering statuspage.io every cycle.
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
// Serve a stale last-good reading for up to 30 minutes when probes fail, so a
// transient network blip doesn't flap the incident row on and off.
const STATUS_LAST_GOOD_MAX_AGE_MS = 30 * 60 * 1000;

const STATUS_PAGE_SPECS = {
  claude: {
    // status.anthropic.com 302-redirects here; use the canonical host directly.
    apiUrl: "https://status.claude.com/api/v2/status.json",
    pageUrl: "https://status.claude.com",
  },
  deepseek: {
    // Flashcat-hosted Next.js page: no public JSON API and no CORS. Relayed
    // server-side here; `format` switches the fetch to HTML + RSC parsing.
    apiUrl: "https://status.deepseek.com/",
    pageUrl: "https://status.deepseek.com",
    format: "deepseek-rsc",
  },
  opencode: {
    // #973 absorption (upstream PR 973): status.opencode.ai ships a custom
    // JSON feed (`{ updatedAt, status, components[] }`, model-level breakdown)
    // with no CORS headers, so the local app relays and parses it.
    apiUrl: "https://status.opencode.ai/api/status",
    pageUrl: "https://status.opencode.ai",
    format: "opencode-json",
  },
};

const VALID_INDICATORS = new Set(["none", "minor", "major", "critical"]);
// Severity order used to escalate an overall indicator to the worst component.
const VALID_INDICATORS_ORDER = ["none", "minor", "major", "critical"];

// OpenCode's feed uses its own status vocabulary. Anything unrecognized maps
// to "minor" rather than "none" — an unknown state must never fake green
// (upstream #973 semantics).
const OPENCODE_INDICATOR_MAP = {
  operational: "none",
  degraded: "minor",
  degraded_performance: "minor",
  partial_outage: "major",
  major_outage: "critical",
  outage: "critical",
};

/**
 * Convert OpenCode's `{ updatedAt, status, components[] }` feed into the
 * Statuspage.io shape the shared normalizer expects. Throws on malformed
 * payloads so the probe surfaces as an error instead of a fake-green row.
 * The indicator is the worse of the overall status and every component, so a
 * single degraded service can never hide behind an "operational" top field.
 */
function parseOpencodeStatusPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenCode status payload is not an object");
  }
  if (typeof payload.status !== "string" || !payload.status) {
    throw new Error("OpenCode status payload has no status field");
  }
  let worst = OPENCODE_INDICATOR_MAP[payload.status] || "minor";
  const broken = [];
  for (const component of Array.isArray(payload.components) ? payload.components : []) {
    if (!component || typeof component !== "object") continue;
    const name = typeof component.service === "string" ? component.service : "unknown";
    const state = typeof component.status === "string" ? component.status : "";
    if (!state) {
      broken.push(`${name}: unknown`);
      if (worst === "none") worst = "minor";
      continue;
    }
    const indicator = OPENCODE_INDICATOR_MAP[state] || "minor";
    if (indicator !== "none") broken.push(`${name}: ${state}`);
    if (VALID_INDICATORS_ORDER.indexOf(indicator) > VALID_INDICATORS_ORDER.indexOf(worst)) {
      worst = indicator;
    }
  }
  const updatedAtMs = Number(payload.updatedAt);
  return {
    page: { updated_at: Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : undefined },
    status: {
      indicator: worst,
      description: broken.length ? broken.join("; ") : "",
    },
  };
}



// providerId -> { data, fetchedAtMs } (data may be null after a failed probe
// with no last-good to fall back on).
let statusCache = new Map();

function normalizeStatusPayload(payload, spec, nowMs) {
  const indicator = payload?.status?.indicator;
  if (typeof indicator !== "string" || !VALID_INDICATORS.has(indicator)) return null;
  const description = typeof payload?.status?.description === "string"
    ? payload.status.description.trim()
    : "";
  const updatedAt = typeof payload?.page?.updated_at === "string" && payload.page.updated_at
    ? payload.page.updated_at
    : new Date(nowMs).toISOString();
  return {
    indicator,
    description: description || null,
    updated_at: updatedAt,
    url: spec.pageUrl,
  };
}

/**
 * Fetch a provider's public service status. Never throws; returns
 * `{ indicator, description, updated_at, url }` or null when the provider has
 * no status page, the probe fails with no usable last-good reading, or the
 * payload is malformed.
 */
async function fetchProviderServiceStatus(providerId, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const spec = STATUS_PAGE_SPECS[providerId];
  if (!spec) return null;

  const cached = statusCache.get(providerId);
  if (cached && nowMs - cached.fetchedAtMs < STATUS_CACHE_TTL_MS) {
    return cached.data;
  }

  let data = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STATUS_PROBE_TIMEOUT_MS);
    try {
      const isDeepSeek = spec.format === "deepseek-rsc";
      const isOpenCode = spec.format === "opencode-json";
      const res = await fetchImpl(spec.apiUrl, {
        method: "GET",
        headers: { Accept: isDeepSeek ? "text/html" : "application/json" },
        signal: controller.signal,
      });
      if (res.ok) {
        const payload = isDeepSeek
          ? parseDeepSeekStatusPage(await res.text())
          : isOpenCode
            ? parseOpencodeStatusPayload(await res.json())
            : await res.json();
        data = normalizeStatusPayload(payload, spec, nowMs);
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (_error) {
    // fall through to last-good handling below
  }

  if (!data && cached?.data && nowMs - cached.fetchedAtMs < STATUS_LAST_GOOD_MAX_AGE_MS) {
    // Probe failed: keep serving the previous reading (without refreshing its
    // clock, so a dead status page eventually ages out to null).
    return cached.data;
  }

  statusCache.set(providerId, { data, fetchedAtMs: nowMs });
  return data;
}

function resetProviderStatusCache() {
  statusCache = new Map();
}

module.exports = {
  fetchProviderServiceStatus,
  resetProviderStatusCache,
  STATUS_PAGE_SPECS,
  parseOpencodeStatusPayload,
};
