"use strict";

/**
 * 商汤小浣熊（Raccoon Office / box-agent）会话层。
 *
 * 数据源：`~/.office-raccoon/agent/log/sessions/<session-id>.jsonl`
 * 一行一事件，`schema_version = "box-agent-session-trace/v1"`。站主口径是
 * 「只算在这个软件里用掉的量」，所以这里只读它自己的 agent 轨迹，不碰
 * agent2api、也不碰旁边的 2.6 GB runtime（box-agent / PortableGit）。
 *
 * 本机实测（2026-10-29，唯一会话文件 607 MB / 2,715 行 / 534 次 llm.response）：
 *
 *   * 只有 `llm.response` 带计量：`data.model` +
 *     `data.usage{prompt_tokens, completion_tokens, total_tokens, cached_tokens}`。
 *     `prompt_tokens` **含** cached（OpenAI 语义），所以新增输入 = prompt - cached，
 *     合计 = prompt + completion —— 与 `tokenTotals()` 的
 *     `total = input + cached + cache_write + output` 逐位一致。
 *   * `data.timing{first_event_ms, first_content_ms, ttfb_ms, duration_ms}` 是上游自测，
 *     速率用它算 —— 不用墙钟，否则用户思考时间会被算成生成时间。
 *   * 会话 id 在**顶层** `session_id`（不是 `data.session_id`），与文件名同名；
 *     `session.start.data.workspace` 是项目根（如 `D:\TokenTrackerPlus`）；
 *     `data.title` 只有 `"Box-Agent"` 这类产品名，不是会话标题。
 *   * `turn.input` 事件确实带真实用户 prompt（`data.content`），但按站主定的口径
 *     「会话层只取 workspace 做标题/项目」，这里**不落 prompt 正文**；读不出标题就
 *     交给前端回退项目名，不凭空造。
 *
 * 为什么必须增量读：单文件已到 607 MB 且只追加不重写。整文件重读会让每次
 * dashboard 刷新都拖几百 MB IO，所以这里按「上次消费到的字节偏移」只读尾部，
 * 未成行的尾巴留在内存里等下一次拼接（进程重启后退化为一次全读）。
 */

const fs = require("node:fs");
const path = require("node:path");

const RACCOON_SOURCE = "raccoon";
const SESSIONS_SUBDIR = path.join(".office-raccoon", "agent", "log", "sessions");
// 8 MB 一块：本机单行最长约 220 KB，一块能装下几十行；再大只是白占内存。
const CHUNK_BYTES = 8 * 1024 * 1024;

const incrementalCache = new Map();
const incrementalStats = { fullReads: 0, incrementalReads: 0, unparsedLines: 0 };

function resetRaccoonIncrementalCacheForTests() {
  incrementalCache.clear();
  incrementalStats.fullReads = 0;
  incrementalStats.incrementalReads = 0;
  incrementalStats.unparsedLines = 0;
}

function getRaccoonIncrementalStatsForTests() {
  return { ...incrementalStats };
}

function resolveRaccoonSessionsDir({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_RACCOON_HOME;
  if (override) return path.resolve(String(override));
  if (!home) return null;
  return path.join(String(home), SESSIONS_SUBDIR);
}

// Only this one level: everything below it (runtime/, PortableGit, …) is
// hundreds of megabytes of binaries with no usage in them.
function resolveRaccoonSessionFiles({ env = {}, home } = {}) {
  const dir = resolveRaccoonSessionsDir({ env, home });
  if (!dir) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function emptyModelTotals() {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    usage_events: 0,
    duration_ms: 0,
    first_content_ms: 0,
    first_content_samples: 0,
  };
}

function emptyAggregate() {
  return {
    sessionId: null,
    workspace: null,
    startedAt: null,
    endedAt: null,
    turns: 0,
    calls: 0,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    durationMs: 0,
    firstContentMs: 0,
    firstContentSamples: 0,
    modelTotals: new Map(),
    seenCalls: new Set(),
    unparsedLines: 0,
  };
}

function touchBounds(agg, timestamp) {
  if (typeof timestamp !== "string" || !timestamp) return;
  if (!agg.startedAt || timestamp < agg.startedAt) agg.startedAt = timestamp;
  if (!agg.endedAt || timestamp > agg.endedAt) agg.endedAt = timestamp;
}

// One parsed line in, aggregate mutated. Kept separate from the IO so the
// mapping can be exercised against a fixture without a real 600 MB file.
function consumeRaccoonEvent(agg, record) {
  if (!record || typeof record !== "object") return;
  const event = typeof record.event === "string" ? record.event : "";
  touchBounds(agg, record.timestamp);
  if (event === "session.start") {
    const data = record.data || {};
    if (!agg.sessionId && typeof record.session_id === "string" && record.session_id) {
      agg.sessionId = record.session_id;
    }
    if (!agg.workspace && typeof data.workspace === "string" && data.workspace.trim()) {
      agg.workspace = data.workspace.trim();
    }
    return;
  }
  if (event === "turn.input") {
    agg.turns += 1;
    return;
  }
  if (event !== "llm.response") return;
  const data = record.data || {};
  const usage = data.usage || {};
  // A call id makes the sum idempotent: the same response written twice (the
  // failure mode that made Codely read exactly 2x) is counted once.
  const callId = typeof record.llm_call_id === "string" ? record.llm_call_id : "";
  if (callId) {
    if (agg.seenCalls.has(callId)) return;
    agg.seenCalls.add(callId);
  }
  const prompt = finite(usage.prompt_tokens);
  const completion = finite(usage.completion_tokens);
  if (prompt + completion <= 0) return;
  const cached = Math.min(finite(usage.cached_tokens), prompt);
  const input = prompt - cached;

  const model = typeof data.model === "string" && data.model.trim() ? data.model.trim() : "unknown";
  const timing = data.timing || {};
  const duration = finite(timing.duration_ms);
  const firstContent = finite(timing.first_content_ms);

  agg.calls += 1;
  agg.inputTokens += input;
  agg.cachedTokens += cached;
  agg.outputTokens += completion;
  agg.durationMs += duration;
  if (firstContent > 0) {
    agg.firstContentMs += firstContent;
    agg.firstContentSamples += 1;
  }

  let totals = agg.modelTotals.get(model);
  if (!totals) {
    totals = emptyModelTotals();
    agg.modelTotals.set(model, totals);
  }
  totals.input_tokens += input;
  totals.cached_input_tokens += cached;
  totals.output_tokens += completion;
  totals.total_tokens += input + cached + completion;
  totals.usage_events += 1;
  totals.duration_ms += duration;
  if (firstContent > 0) {
    totals.first_content_ms += firstContent;
    totals.first_content_samples += 1;
  }
}

// 607 MB of trace, of which 99% of the bytes sit in payload/tool lines that
// carry no usage. Both the event name and the timestamp are written in the
// first ~120 bytes of every line, so a 512-byte head decides whether the line
// is worth a full JSON.parse. Without this the first scan spent ~4.8 s
// re-parsing request payloads it then threw away.
const INTERESTING_EVENT = /"event"\s*:\s*"(?:llm\.response|session\.start|turn\.input)"/;
const TIMESTAMP_PREFIX = /"timestamp"\s*:\s*"([^"]{4,40})"/;
const HEAD_BYTES = 512;

function consumeRaccoonLine(agg, line) {
  if (!line) return;
  const head = line.length > HEAD_BYTES ? line.slice(0, HEAD_BYTES) : line;
  const scope = head.includes('"event"') ? head : line;
  if (!INTERESTING_EVENT.test(scope)) {
    // Still feed the bounds: start/end of a session is decided by its first and
    // last event, whatever kind they are.
    const stamp = TIMESTAMP_PREFIX.exec(head);
    if (stamp) touchBounds(agg, stamp[1]);
    return;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(line);
  } catch {
    agg.unparsedLines += 1;
    incrementalStats.unparsedLines += 1;
  }
  if (parsed) consumeRaccoonEvent(agg, parsed);
}

function consumeRaccoonText(agg, text) {
  if (!text) return;
  let start = 0;
  while (start <= text.length) {
    const end = text.indexOf("\n", start);
    const line = end === -1 ? text.slice(start) : text.slice(start, end);
    if (line.trim()) consumeRaccoonLine(agg, line);
    if (end === -1) break;
    start = end + 1;
  }
}

function fileIdentity(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.dev}:${stat.ino}:${Math.floor(Number(stat.birthtimeMs) || 0)}`;
  } catch {
    return null;
  }
}

// Read [offset, size) in chunks, feeding only complete lines and keeping the
// trailing fragment for the next call. Cutting at a newline also guarantees a
// multi-byte UTF-8 sequence is never split across the decode boundary.
function readRaccoonAggregate(filePath) {
  const key = path.resolve(filePath);
  const stat = fs.statSync(filePath);
  const identity = fileIdentity(filePath);
  const cached = incrementalCache.get(key);
  const reusable = cached && cached.identity === identity && stat.size >= cached.offset;
  const state = reusable
    ? cached
    : { identity, offset: 0, pending: Buffer.alloc(0), agg: emptyAggregate() };
  if (state.offset === stat.size) {
    incrementalCache.set(key, state);
    return state.agg;
  }

  const fd = fs.openSync(filePath, "r");
  let position = state.offset;
  try {
    while (position < stat.size) {
      const want = Math.min(CHUNK_BYTES, stat.size - position);
      const chunk = Buffer.allocUnsafe(want);
      const read = fs.readSync(fd, chunk, 0, want, position);
      if (read <= 0) break;
      position += read;
      let buffer = read === want ? chunk : chunk.subarray(0, read);
      if (state.pending.length) {
        buffer = Buffer.concat([state.pending, buffer]);
        state.pending = Buffer.alloc(0);
      }
      const cut = buffer.lastIndexOf(0x0a);
      if (cut === -1) {
        // A single line longer than one chunk: hold it rather than decode a
        // torn character.
        state.pending = Buffer.from(buffer);
        continue;
      }
      state.pending = Buffer.from(buffer.subarray(cut + 1));
      consumeRaccoonText(state.agg, buffer.subarray(0, cut).toString("utf8"));
    }
  } finally {
    fs.closeSync(fd);
  }
  state.offset = position;
  incrementalCache.set(key, state);
  if (reusable) incrementalStats.incrementalReads += 1;
  else incrementalStats.fullReads += 1;
  return state.agg;
}

function topModel(agg) {
  let best = null;
  let bestCalls = -1;
  for (const [model, totals] of agg.modelTotals) {
    if (totals.usage_events > bestCalls ||
        (totals.usage_events === bestCalls && best !== null && model < best)) {
      best = model;
      bestCalls = totals.usage_events;
    }
  }
  return best;
}

/**
 * Turn one file's aggregate into the canonical session row.
 *
 * `helpers` is injected rather than required so this module never imports
 * session-analytics (which imports it back): production passes the real
 * finalize/repricing primitives, tests pass stubs.
 */
function raccoonRecordFromAggregate(agg, filePath, helpers) {
  const {
    finalizeRecord,
    sessionHash,
    projectKey,
    sessionStorageUsage,
    normalizeSessionModel,
    normalizePerformance,
    version,
  } = helpers;
  const identity = agg.sessionId || path.basename(filePath, ".jsonl");
  const projectRef = agg.workspace || null;
  const model = normalizeSessionModel(topModel(agg)) || "unknown";
  const projectName = projectKey(projectRef, filePath);
  const tokens = {
    input_tokens: agg.inputTokens,
    cached_input_tokens: agg.cachedTokens,
    cache_creation_input_tokens: 0,
    output_tokens: agg.outputTokens,
    reasoning_output_tokens: 0,
    total_tokens: agg.inputTokens + agg.cachedTokens + agg.outputTokens,
  };
  const modelUsage = [...agg.modelTotals.entries()]
    .sort((a, b) => b[1].usage_events - a[1].usage_events || String(a[0]).localeCompare(String(b[0])))
    .map(([name, totals]) => ({
      model: normalizeSessionModel(name) || "unknown",
      input_tokens: totals.input_tokens,
      cached_input_tokens: totals.cached_input_tokens,
      cache_creation_input_tokens: 0,
      output_tokens: totals.output_tokens,
      reasoning_output_tokens: 0,
      total_tokens: totals.total_tokens,
      usage_events: totals.usage_events,
      performance: normalizePerformance({
        estimated_output_tokens: totals.output_tokens,
        estimated_duration_ms: totals.duration_ms,
        estimated_request_count: totals.usage_events,
        first_response_total_ms: totals.first_content_ms,
        first_response_sample_count: totals.first_content_samples,
      }),
    }));
  return finalizeRecord({
    version,
    session_hash: sessionHash(RACCOON_SOURCE, identity),
    session_id: agg.sessionId || null,
    // The vendor's own `title` is a product name ("Box-Agent"), not a
    // conversation title; the approved recipe takes the workspace instead, and
    // the UI falls back to the project name anyway. Nothing is invented here.
    title: projectName,
    source: RACCOON_SOURCE,
    ...sessionStorageUsage([filePath]),
    project_key: projectName,
    project_ref: projectRef,
    model,
    model_usage: modelUsage,
    started_at: agg.startedAt,
    ended_at: agg.endedAt,
    active_ms: agg.durationMs,
    turns: agg.turns,
    edit_turns: 0,
    retry_turns: 0,
    subagent_calls: 0,
    subagent_types: {},
    tokens,
    performance: normalizePerformance({
      estimated_output_tokens: agg.outputTokens,
      estimated_duration_ms: agg.durationMs,
      estimated_request_count: agg.calls,
      first_response_total_ms: agg.firstContentMs,
      first_response_sample_count: agg.firstContentSamples,
    }),
    usage_precision: "reported",
    provenance: {
      source: "local-session-log",
      confidence: "observed",
      retry_confidence: "inferred",
      content_retained: false,
    },
  });
}

module.exports = {
  RACCOON_SOURCE,
  resolveRaccoonSessionsDir,
  resolveRaccoonSessionFiles,
  consumeRaccoonEvent,
  consumeRaccoonText,
  readRaccoonAggregate,
  raccoonRecordFromAggregate,
  resetRaccoonIncrementalCacheForTests,
  getRaccoonIncrementalStatsForTests,
};
