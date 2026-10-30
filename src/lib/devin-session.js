"use strict";

// Devin Desktop / bundled CLI local session metadata.
//
// `message_nodes` is the source of truth for per-request usage. Devin replays
// and forks copy nodes, so several rows share one metadata.request_id — the
// request_id is the billing identity, exactly as in the hourly Devin parser.
// We aggregate unique request_id rows and map the provider-reported timing
// (ttft_ms / total_time_ms) into the session-performance schema, which gives
// Devin a real tok/s reading instead of a wall-clock estimate.

const path = require("node:path");
const { readSqliteJsonRowsAsync } = require("./sqlite-reader");

function count(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoFromSeconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
}

function isoOrNull(value) {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function emptyTokens() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
  };
}

async function readDevinSessions(dbPath) {
  if (!dbPath) return [];
  let sessions;
  try {
    sessions = await readSqliteJsonRowsAsync(
      dbPath,
      "SELECT id, title, working_directory, created_at, last_activity_at, model, agent_mode, hidden FROM sessions",
      { readOnly: true, throwOnReadFailure: true },
    );
  } catch {
    return [];
  }
  if (!Array.isArray(sessions) || sessions.length === 0) return [];

  let requestRows;
  try {
    requestRows = await readSqliteJsonRowsAsync(
      dbPath,
      [
        "SELECT",
        "session_id,",
        "json_extract(chat_message,'$.metadata.request_id') AS request_id,",
        "json_extract(chat_message,'$.metadata.generation_model') AS generation_model,",
        "json_extract(chat_message,'$.metadata.started_generation_at') AS started_generation_at,",
        "json_extract(chat_message,'$.metadata.created_at') AS message_created_at,",
        "json_extract(chat_message,'$.metadata.metrics.input_tokens') AS input_tokens,",
        "json_extract(chat_message,'$.metadata.metrics.output_tokens') AS output_tokens,",
        "json_extract(chat_message,'$.metadata.metrics.cache_read_tokens') AS cache_read_tokens,",
        "json_extract(chat_message,'$.metadata.metrics.cache_creation_tokens') AS cache_creation_tokens,",
        "json_extract(chat_message,'$.metadata.metrics.ttft_ms') AS ttft_ms,",
        "json_extract(chat_message,'$.metadata.metrics.total_time_ms') AS total_time_ms",
        "FROM message_nodes",
        "WHERE json_valid(chat_message)",
        "AND json_extract(chat_message,'$.role')='assistant'",
        "AND json_extract(chat_message,'$.metadata.request_id') IS NOT NULL",
      ].join(" "),
      { readOnly: true, throwOnReadFailure: true },
    );
  } catch {
    return [];
  }

  let userTurns;
  try {
    userTurns = await readSqliteJsonRowsAsync(
      dbPath,
      "SELECT session_id, count(*) AS turns FROM message_nodes WHERE json_valid(chat_message) AND json_extract(chat_message,'$.role')='user' GROUP BY session_id",
      { readOnly: true, throwOnReadFailure: true },
    );
  } catch {
    userTurns = [];
  }
  const turnsBySession = new Map((userTurns || []).map((row) => [row.session_id, count(row.turns)]));

  const bySession = new Map();
  const seenRequests = new Set();
  for (const row of requestRows || []) {
    const sessionId = row.session_id;
    const requestId = typeof row.request_id === "string" ? row.request_id.trim() : "";
    if (!sessionId || !requestId || seenRequests.has(requestId)) continue;
    seenRequests.add(requestId);
    let session = bySession.get(sessionId);
    if (!session) {
      session = { calls: 0, tokens: emptyTokens(), models: new Map(), times: [], perf: { output: 0, duration: 0, count: 0, ttftTotal: 0, ttftCount: 0 } };
      bySession.set(sessionId, session);
    }
    session.calls += 1;
    const input = count(row.input_tokens);
    const output = count(row.output_tokens);
    const cacheRead = count(row.cache_read_tokens);
    const cacheWrite = count(row.cache_creation_tokens);
    const total = input + output + cacheRead + cacheWrite;
    session.tokens.input_tokens += input;
    session.tokens.cached_input_tokens += cacheRead;
    session.tokens.cache_creation_input_tokens += cacheWrite;
    session.tokens.output_tokens += output;
    session.tokens.total_tokens += total;
    const model = typeof row.generation_model === "string" && row.generation_model.trim()
      ? row.generation_model.trim()
      : "devin-unknown";
    let modelRow = session.models.get(model);
    if (!modelRow) {
      modelRow = {
        model,
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        usage_events: 0,
      };
      session.models.set(model, modelRow);
    }
    modelRow.usage_events += 1;
    modelRow.input_tokens += input;
    modelRow.cached_input_tokens += cacheRead;
    modelRow.cache_creation_input_tokens += cacheWrite;
    modelRow.output_tokens += output;
    modelRow.total_tokens += total;
    const started = isoOrNull(row.started_generation_at) || isoOrNull(row.message_created_at);
    if (started) session.times.push(Date.parse(started));
    const duration = finite(row.total_time_ms);
    const ttft = finite(row.ttft_ms);
    if (output > 0 && duration > 0) {
      session.perf.output += output;
      session.perf.duration += duration;
      session.perf.count += 1;
      if (ttft > 0) {
        session.perf.ttftTotal += ttft;
        session.perf.ttftCount += 1;
      }
    }
  }

  const rows = [];
  for (const session of sessions) {
    const agg = bySession.get(session.id);
    if (!agg || (!agg.tokens.total_tokens && !agg.calls)) continue;
    const modelRows = [...agg.models.values()].sort((a, b) => b.total_tokens - a.total_tokens);
    const times = agg.times.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    const startedAt = times.length ? new Date(times[0]).toISOString() : isoFromSeconds(session.created_at);
    const endedAt = times.length ? new Date(times[times.length - 1]).toISOString() : isoFromSeconds(session.last_activity_at);
    const activeMs = times.length > 1 ? times[times.length - 1] - times[0] : 0;
    const performance = {
      estimated_output_tokens: agg.perf.output,
      estimated_duration_ms: agg.perf.duration,
      estimated_request_count: agg.perf.count,
      first_response_total_ms: agg.perf.ttftTotal,
      first_response_sample_count: agg.perf.ttftCount,
    };
    rows.push({
      session_id: session.id,
      title: typeof session.title === "string" && session.title.trim() ? session.title.trim() : null,
      project_ref: typeof session.working_directory === "string" && session.working_directory.trim() ? session.working_directory.trim() : null,
      model: modelRows.length === 1 ? modelRows[0].model : modelRows.length > 1 ? "mixed" : "devin-unknown",
      model_usage: modelRows,
      tokens: agg.tokens,
      turns: turnsBySession.get(session.id) || agg.calls,
      model_calls: agg.calls,
      started_at: startedAt,
      ended_at: endedAt,
      active_ms: activeMs,
      performance,
      archived: Number(session.hidden) === 1,
      provenance: {
        source: "local-session-log",
        confidence: "observed",
        content_retained: false,
        usage: "devin-message-nodes-metrics",
      },
    });
  }
  return rows;
}

module.exports = {
  readDevinSessions,
  _isoFromSeconds: isoFromSeconds,
};
