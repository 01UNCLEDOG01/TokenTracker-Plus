const fs = require("node:fs");
const path = require("node:path");
const { getTrackerRootDir } = require("./tracker-paths");
const { resolveConnection, connectionFetchOptions } = require("./vyceai-limits");

// Vyce AI usage ingestion — turn the account-level modelUsage totals from
// /v1/me into real source rows, so Vyce gets the same usage-page card as
// every other tool (share %, model count, expandable detail, heatmap).
//
// Vyce keeps NO per-call/per-day history server-side and its proxied
// responses carry no usage (Codex logs stay flat), so the only ledger this
// can build is a differential of the cumulative modelUsage counters:
//
//   state.json  { models: { "<model>": { input, output } }, updatedAt }
//   delta       = current cumulative − previous cumulative
//   reset       = any negative component → the whole current cumulative is
//                 treated as this period's usage (site counter reset)
//
// Deltas land in the current UTC-hour bucket (no timestamps exist to do
// better — same choice the qoder estimate rows make for official-bill
// days). The queue aggregates price every row through computeRowCost with
// the official price list, so promo-pool models the site bills $0 still
// contribute their real list-price value — never a silent zero.
//
// First run adopts the current cumulative as this period's usage (real
// tokens the user really spent, landing once at "now").

const VYCEAI_ME_URL = "https://vyceai.com/v1/me";
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

function defaultStatePath(home) {
  return path.join(getTrackerRootDir({ home }), "tracker", "vyceai-usage-state.json");
}

function readState(statePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return raw && typeof raw.models === "object" && raw.models ? raw : { models: {} };
  } catch {
    return { models: {} };
  }
}

async function persistVyceaiUsageRows({
  queuePath,
  statePath = null,
  home = os.homedir(),
  env = process.env,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const stateFile = statePath || defaultStatePath(home);
  const connection = resolveConnection(home, env);
  if (!connection) return { appended: 0, reason: "no-credentials" };

  let payload;
  try {
    const res = await fetchImpl(VYCEAI_ME_URL, {
      headers: { Authorization: `Bearer ${connection.apiKey}` },
      ...connectionFetchOptions(connection.proxy, timeoutMs),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch {
    // Ingestion is best-effort: a blip just skips this cycle, state untouched.
    return { appended: 0, reason: "fetch-failed" };
  }
  const modelUsage =
    payload?.modelUsage && typeof payload?.modelUsage === "object" && !Array.isArray(payload.modelUsage)
      ? payload.modelUsage
      : null;
  if (!modelUsage) return { appended: 0, reason: "no-model-usage" };

  const state = readState(stateFile);
  const hourStart = new Date(nowMs).toISOString().slice(0, 13) + ":00:00.000Z";
  const rows = [];
  const nextModels = {};

  for (const [rawModel, usage] of Object.entries(modelUsage)) {
    const model = String(rawModel || "").trim() || "unknown";
    const input = Math.max(0, Number(usage?.inputTokens) || 0);
    const output = Math.max(0, Number(usage?.outputTokens) || 0);
    const prev = state.models[model] || { input: 0, output: 0 };
    let dIn = input - prev.input;
    let dOut = output - prev.output;
    if (dIn < 0 || dOut < 0) {
      // Counter reset: everything currently on the books is this period.
      dIn = input;
      dOut = output;
    }
    nextModels[model] = { input, output };
    const total = dIn + dOut;
    if (total <= 0) continue;
    rows.push({
      source: "vyceai",
      model,
      hour_start: hourStart,
      input_tokens: dIn,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: dOut,
      reasoning_output_tokens: 0,
      total_tokens: total,
      billable_total_tokens: total,
      total_cost_usd: 0,
      conversation_count: 0,
    });
  }

  if (rows.length === 0) {
    // Still persist the advanced cumulative so a no-op cycle cannot loop.
    await fs.promises.writeFile(
      stateFile,
      JSON.stringify({ models: nextModels, updatedAt: new Date(nowMs).toISOString() }, null, 2) + "\n",
      "utf8",
    );
    return { appended: 0, reason: "no-delta" };
  }

  await fs.promises.appendFile(queuePath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  await fs.promises.writeFile(
    stateFile,
    JSON.stringify({ models: nextModels, updatedAt: new Date(nowMs).toISOString() }, null, 2) + "\n",
    "utf8",
  );
  return { appended: rows.length };
}

module.exports = { persistVyceaiUsageRows, defaultStatePath };
