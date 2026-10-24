"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { gzipSync, gunzipSync } = require("node:zlib");
const { createHash } = require("node:crypto");

const TEXT_FIELDS = [
  "session_hash", "session_id", "parent_session_id", "source", "project_key", "project_ref", "model",
  "started_at", "ended_at", "usage_precision", "usage_source", "cost_source",
];
const NUMBER_FIELDS = [
  "total_tokens", "active_ms", "duration_ms", "turns", "edit_turns", "retry_turns", "subagent_calls",
  "usage_events", "model_calls", "tool_calls", "tool_failures", "error_count", "compaction_count",
  "credits", "cost_usd", "provider_cost_usd", "api_duration_ms", "context_tokens_used", "context_window_tokens",
];
const BOOLEAN_FIELDS = ["usage_is_incomplete", "cost_is_partial", "productive", "first_pass", "one_shot"];
const TOKEN_FIELDS = [
  "input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens",
  "total_tokens", "billable_total_tokens", "long_context_input_tokens", "long_context_cached_input_tokens",
  "long_context_cache_creation_input_tokens", "long_context_output_tokens", "long_context_reasoning_output_tokens",
  "priority_input_tokens", "priority_cached_input_tokens", "priority_cache_creation_input_tokens",
  "priority_output_tokens", "priority_reasoning_output_tokens", "ultrafast_input_tokens", "ultrafast_cached_input_tokens",
  "ultrafast_cache_creation_input_tokens", "ultrafast_output_tokens", "ultrafast_reasoning_output_tokens",
  "priority_long_context_input_tokens", "priority_long_context_cached_input_tokens", "priority_long_context_cache_creation_input_tokens",
  "priority_long_context_output_tokens", "priority_long_context_reasoning_output_tokens", "ultrafast_long_context_input_tokens",
  "ultrafast_long_context_cached_input_tokens", "ultrafast_long_context_cache_creation_input_tokens", "ultrafast_long_context_output_tokens",
  "ultrafast_long_context_reasoning_output_tokens", "usage_events", "rerouted_usage_events", "long_context_usage_events",
  "priority_usage_events", "ultrafast_usage_events",
];
const PERFORMANCE_FIELDS = [
  "estimated_output_tokens", "estimated_duration_ms", "estimated_request_count", "estimated_tokens_per_second",
  "first_response_total_ms", "first_response_sample_count", "first_response_ms",
];

function numbers(value, keys) {
  const out = {};
  for (const key of keys) {
    if (Number.isFinite(value?.[key]) && value[key] >= 0) out[key] = value[key];
  }
  return out;
}

function usageRow(value, bucket = false) {
  const out = numbers(value, TOKEN_FIELDS);
  if (typeof value?.model === "string") out.model = value.model;
  if (bucket && typeof value?.timestamp === "string") out.timestamp = value.timestamp;
  if (!bucket && value?.performance) out.performance = numbers(value.performance, PERFORMANCE_FIELDS);
  return out;
}

function snapshotSession(row) {
  if (!row?.session_hash || !row?.source) return null;
  const out = { archive_version: 1, parser_version: row.parser_version ?? row.version, ...numbers(row, NUMBER_FIELDS) };
  for (const key of TEXT_FIELDS) {
    if (typeof row[key] === "string") out[key] = row[key];
  }
  for (const key of BOOLEAN_FIELDS) {
    if (typeof row[key] === "boolean") out[key] = row[key];
  }
  out.tokens = numbers(row.tokens || row, TOKEN_FIELDS);
  out.performance = numbers(row.performance, PERFORMANCE_FIELDS);
  if (Array.isArray(row.model_usage)) out.model_usage = row.model_usage.map((value) => usageRow(value));
  if (Array.isArray(row.usage_buckets)) out.usage_buckets = row.usage_buckets.map((value) => usageRow(value, true));
  out.fragment_hash = row.fragment_hash || createHash("sha256").update(row._cache_key || row.session_hash).digest("hex");
  if (Array.isArray(row._archive_usage_events)) {
    out._archive_usage_events = row._archive_usage_events.map((event) => ({
      ...usageRow(event, true), hash: event.hash,
    }));
  }
  return out;
}

function sessionArchivePath(home) {
  return path.join(home, ".tokentracker", "tracker", "sessions.archive.jsonl.gz");
}

function readSessionArchive(home) {
  let content;
  try {
    content = gunzipSync(fs.readFileSync(sessionArchivePath(home))).toString("utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return content.split("\n").filter((line) => line.trim()).map((line) => {
    const row = JSON.parse(line);
    if (row.archive_version !== 1) throw new Error("Unsupported session archive version");
    return snapshotSession(row);
  }).filter(Boolean);
}

function uncoveredFragment(row, covered) {
  if (!row._archive_usage_events?.length || !covered?.size) return row;
  const events = row._archive_usage_events.filter((event) => !covered.has(event.hash));
  if (events.length === row._archive_usage_events.length) return row;
  if (!events.length) return null;
  const models = new Map(), buckets = new Map(), totals = {};
  for (const event of events) {
    const model = models.get(event.model) || { model: event.model };
    const key = `${event.model}|${event.timestamp}`;
    const bucket = buckets.get(key) || { model: event.model, timestamp: event.timestamp };
    for (const field of TOKEN_FIELDS) {
      if (!Number.isFinite(event[field])) continue;
      totals[field] = (totals[field] || 0) + event[field];
      model[field] = (model[field] || 0) + event[field];
      bucket[field] = (bucket[field] || 0) + event[field];
    }
    model.usage_events = (model.usage_events || 0) + 1;
    models.set(event.model, model);
    buckets.set(key, bucket);
  }
  return {
    ...row, tokens: totals, total_tokens: totals.total_tokens || 0,
    model_usage: [...models.values()], usage_buckets: [...buckets.values()],
    _archive_usage_events: events, performance: {}, turns: 0, edit_turns: 0,
    retry_turns: 0, subagent_calls: 0, active_ms: 0, duration_ms: 0,
  };
}

function reconcileSessionArchive(current, previous) {
  const snapshots = new Map(previous.map(snapshotSession).filter(Boolean).map((row) => [row.fragment_hash, row]));
  const present = new Set(), coveredBySession = new Map();
  for (const row of current) {
    const snapshot = snapshotSession(row);
    if (!snapshot) continue;
    const previous = snapshots.get(snapshot.fragment_hash);
    // Old Antigravity schemas counted the model enum as the sole input counter.
    const enumCorrection = row.source === "antigravity" && (previous?.parser_version ?? 33) <= 33 &&
      row.version >= 34 && previous?.total_tokens === row.native_model_enum &&
      previous?.tokens?.input_tokens === row.native_model_enum &&
      !previous?.tokens?.cached_input_tokens && !previous?.tokens?.cache_creation_input_tokens &&
      !previous?.tokens?.output_tokens && !previous?.tokens?.reasoning_output_tokens;
    if (!enumCorrection && !snapshot.total_tokens && previous?.total_tokens > 0 && !snapshot.credits) continue;
    present.add(snapshot.fragment_hash);
    snapshots.set(snapshot.fragment_hash, snapshot);
    const covered = coveredBySession.get(row.session_hash) || new Set();
    for (const event of row._archive_usage_events || []) covered.add(event.hash);
    coveredBySession.set(row.session_hash, covered);
  }
  const retained = [];
  for (const [key, row] of snapshots) {
    if (present.has(key)) continue;
    const uncovered = uncoveredFragment(row, coveredBySession.get(row.session_hash));
    if (!uncovered) { snapshots.delete(key); continue; }
    snapshots.set(key, uncovered);
    retained.push({ ...uncovered, archived: true, session_store_bytes: 0 });
  }
  return { snapshots: [...snapshots.values()], retained };
}

function serializeSessionArchive(rows) {
  return gzipSync(rows.map((row) => JSON.stringify(snapshotSession(row))).join("\n") + (rows.length ? "\n" : ""));
}

module.exports = { sessionArchivePath, readSessionArchive, snapshotSession, reconcileSessionArchive, serializeSessionArchive };
