"use strict";

// One-shot repair for the pre-2026-10-29 gateway attribution: Agent2API
// credited every client's rows to its own card. Clients this tracker parses
// itself were therefore double-counted (DSH), and ZCode's missing input never
// reached the zcode card. This module only plans and applies the arithmetic on
// bucket totals; I/O (queue append, cursors, backups) lives in
// scripts/migrate-gateway-attribution.cjs.
//
// Semantics match the live parsers exactly:
//   · removal model = client_model || upstream_model (what the old parser used
//     for non-Claude rows);
//   · credit model  = upstream_model || client_model;
//   · zcode credit  = input + cache only (its own ledger logs completion);
//   · claude rows   = tokens stay, only the phantom conversation is removed
//     (the old credit added 1 per request; the transcript already counted it).

const { canonicalModelName } = require("./model-canonical");
const { gatewayClientSource, gatewayCreditTotals } = require("./rollout");

const GATEWAY_SOURCE = "agent2api";

function bucketStart(tsMs) {
  const dt = new Date(Number(tsMs));
  if (!Number.isFinite(dt.getTime())) return null;
  const halfMinute = dt.getUTCMinutes() >= 30 ? 30 : 0;
  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), dt.getUTCHours(), halfMinute, 0, 0),
  ).toISOString();
}

function modelKey(value) {
  const raw = String(value || "").trim();
  return canonicalModelName(raw) || "unknown";
}

function key(source, model, hourStart) {
  return `${source}|${modelKey(model)}|${hourStart}`;
}

function addDelta(map, bucketKey, delta) {
  const current = map.get(bucketKey) || { input: 0, cached: 0, output: 0, total: 0, conv: 0 };
  map.set(bucketKey, {
    input: current.input + (delta.input || 0),
    cached: current.cached + (delta.cached || 0),
    output: current.output + (delta.output || 0),
    total: current.total + (delta.total || 0),
    conv: current.conv + (delta.conv || 0),
  });
}

function planGatewayAttributionRepair({ requests, buckets }) {
  const removals = new Map();
  const credits = new Map();
  let applied = 0;
  let skipped = 0;

  for (const row of requests || []) {
    if (Number(row?.status) !== 200) continue;
    const clientSource = gatewayClientSource(row.client);
    if (!clientSource) continue;
    const hourStart = bucketStart(row.ts);
    if (!hourStart) continue;
    const prompt = Math.max(0, Number(row.prompt_tokens) || 0);
    // Same formula as the live parser: cache is taken as reported (no clamp
    // against prompt), fresh input is what is left over.
    const cache = Math.max(0, Number(row.cache_read_tokens) || 0);
    const output = Math.max(0, Number(row.completion_tokens) || 0);
    const input = Math.max(0, prompt - cache);

    if (clientSource === "claude") {
      addDelta(removals, key("claude", row.upstream_model || row.client_model, hourStart), { conv: 1 });
      applied += 1;
      continue;
    }

    const removalKey = key(GATEWAY_SOURCE, row.client_model || row.upstream_model, hourStart);
    if (!buckets.has(removalKey)) {
      // History already pruned or the bucket never reached the queue: nothing
      // to take back. Counted for the summary, not treated as an error.
      skipped += 1;
      continue;
    }
    addDelta(removals, removalKey, {
      input,
      cached: cache,
      output,
      total: prompt + output,
      conv: 1,
    });

    if (clientSource === "zcode") {
      const credit = gatewayCreditTotals("zcode", {
        input,
        cacheRead: cache,
        cacheWrite: 0,
        output,
      });
      addDelta(credits, key("zcode", row.upstream_model || row.client_model, hourStart), {
        input: credit.totals.input_tokens,
        cached: credit.totals.cached_input_tokens,
        output: credit.totals.output_tokens,
        total: credit.totals.total_tokens,
        conv: credit.totals.conversation_count,
      });
    }
    applied += 1;
  }

  return { removals, credits, applied, skipped };
}

function subtractTotals(totals, delta) {
  totals.input_tokens = Math.max(0, (Number(totals.input_tokens) || 0) - delta.input);
  totals.cached_input_tokens = Math.max(0, (Number(totals.cached_input_tokens) || 0) - delta.cached);
  totals.output_tokens = Math.max(0, (Number(totals.output_tokens) || 0) - delta.output);
  totals.conversation_count = Math.max(0, (Number(totals.conversation_count) || 0) - delta.conv);
  totals.total_tokens = Math.max(
    0,
    (Number(totals.total_tokens) || 0) - delta.total,
  );
  totals.billable_total_tokens = Math.max(
    0,
    (Number(totals.billable_total_tokens) || 0) - delta.total,
  );
}

function addTotals(totals, delta) {
  totals.input_tokens = (Number(totals.input_tokens) || 0) + delta.input;
  totals.cached_input_tokens = (Number(totals.cached_input_tokens) || 0) + delta.cached;
  totals.output_tokens = (Number(totals.output_tokens) || 0) + delta.output;
  totals.conversation_count = (Number(totals.conversation_count) || 0) + delta.conv;
  totals.total_tokens = (Number(totals.total_tokens) || 0) + delta.total;
  totals.billable_total_tokens = (Number(totals.billable_total_tokens) || 0) + delta.total;
}

// Applies the plan to a Map<key, totals> in place. Credits for a bucket that
// only ever existed on the client side still apply: that input is real usage.
// Returns the set of touched keys and any clamp warnings.
function applyGatewayAttributionRepair({ buckets, plan }) {
  const touched = new Set();
  const warnings = [];

  for (const [bucketKey, delta] of plan.removals) {
    const totals = buckets.get(bucketKey);
    if (!totals) continue;
    const before = Number(totals.total_tokens) || 0;
    subtractTotals(totals, delta);
    if (before < delta.total) {
      warnings.push(`${bucketKey}: removal ${delta.total} exceeded bucket ${before}, clamped`);
    }
    touched.add(bucketKey);
  }

  for (const [bucketKey, delta] of plan.credits) {
    let totals = buckets.get(bucketKey);
    if (!totals) {
      totals = {
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        billable_total_tokens: 0,
        total_cost_usd: 0,
        conversation_count: 0,
      };
      buckets.set(bucketKey, totals);
    }
    addTotals(totals, delta);
    touched.add(bucketKey);
  }

  // Totals stay self-consistent because every delta moves billable together
  // with total; billable is never overwritten wholesale, since other writers
  // (pricing, credits) maintain it for their own sources.
  return { touched, warnings };
}

module.exports = {
  GATEWAY_SOURCE,
  planGatewayAttributionRepair,
  applyGatewayAttributionRepair,
  bucketStart,
  modelKey,
};
