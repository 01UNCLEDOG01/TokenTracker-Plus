"use strict";

// AutoClaw and Cola each embed an OpenCode-lineage runtime and keep every
// conversation as a JSONL file, one record per line:
//
//   {"type":"message","message":{"role":"assistant","provider":...,"model":...,
//     "timestamp":<epoch ms>,"responseId":"...",
//     "usage":{"input":N,"output":N,"cacheRead":N,"cacheWrite":N,
//              "reasoningTokens":N,"totalTokens":N,"cost":{...}}}}
//
// Verified on this machine before writing anything: both spell the timestamp as
// epoch milliseconds, both carry the same `cost` breakdown, and they differ on
// exactly one key - AutoClaw writes `reasoningTokens`, Cola writes `reasoning`.
// Everything else about the usage object matches.
//
// One trap the adapter has to get right: these files' `totalTokens` is
// input+output+cacheRead+cacheWrite and does NOT include reasoning (an AutoClaw
// record reads 18969/542/13504/0 with reasoningTokens 463, totalTokens 33015).
// The Claude record shape folds reasoning into output_tokens, so the adapter does
// the same - otherwise these sources would carry a different total from every
// other one that uses the shared scanner.
//
// They are two products with two billing relationships, so each keeps its own
// source key; neither is folded into the standalone OpenCode bucket.

const fs = require("node:fs");
const path = require("node:path");

// session-analytics is required lazily, inside the scan wrappers below.
// Requiring it at module load would make this file part of a cycle
// (rollout -> agent-jsonl-sessions -> session-analytics -> rollout), and Node
// then hands back a half-built exports object. Only the adapter is needed at
// load time - the sync parser uses that alone - so the heavier import waits.

const AUTOCLAW_SOURCE = "autoclaw";
const COLA_SOURCE = "cola";

function listJsonlFiles(root, depth = 0, out = []) {
  if (!root || depth > 4) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listJsonlFiles(full, depth + 1, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

// `.../<uuid>.trajectory.jsonl` sits next to the session file and is the same
// conversation's step-by-step trace. It repeats usage the session file already
// records, so reading both would double-count every round-trip.
function isSessionFile(file) {
  return !/\.trajectory\.jsonl$/i.test(String(file));
}

function resolveAutoClawSessionFiles({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_AUTOCLAW_HOME;
  const root = override
    ? path.resolve(String(override))
    : path.join(String(home || ""), ".openclaw-autoclaw", "agents");
  return listJsonlFiles(root).filter(isSessionFile).sort();
}

function resolveColaSessionFiles({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_COLA_HOME;
  const root = override
    ? path.resolve(String(override))
    : path.join(String(home || ""), ".cola", "sessions");
  return listJsonlFiles(root).filter(isSessionFile).sort();
}

// The two spellings, in one place so a future format change is a one-line fix
// rather than two divergent readers.
function reasoningTokensOf(usage) {
  const value = usage?.reasoningTokens ?? usage?.reasoning;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function claudeShapedUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage.input) || 0;
  const output = Number(usage.output) || 0;
  const cacheRead = Number(usage.cacheRead) || 0;
  const cacheWrite = Number(usage.cacheWrite) || 0;
  const reasoning = reasoningTokensOf(usage);
  if (input + output + cacheRead + cacheWrite + reasoning <= 0) return null;
  return {
    input_tokens: input,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    // Reasoning is a subset of output here, so it is folded in rather than
    // added on the side - the same convention every other source uses.
    output_tokens: output + reasoning,
    output_tokens_details: { reasoning_tokens: reasoning },
  };
}

// Adapt one line into the record shape scanClaudeSession reads.
//
// A user record carries no usage but is NOT dropped: the shared scanner opens a
// turn on it and only flushes a bucket when the turn closes, so an adapter that
// kept only assistant replies would read every one of these files as zero usage.
// Its own turn accounting - retries, prompt repeats, edit counts - is built from
// exactly those records.
//
// An assistant record without usage is dropped: a metered round-trip the scanner
// cannot price would otherwise open a turn that never bills.
function toAgentSessionRecord(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type !== "message") return null;
  const message = entry.message;
  if (!message || typeof message !== "object") return null;
  const role = String(message.role || "").toLowerCase();

  if (role === "user") {
    return {
      type: "user",
      timestamp: message.timestamp,
      message: { content: message.content },
    };
  }
  if (role !== "assistant") return null;
  const usage = claudeShapedUsage(message.usage);
  if (!usage) return null;

  // responseId is the provider's round-trip id and is the dedup key that keeps a
  // re-read of an appended file from counting the same reply twice. Falling back
  // to nothing would make every re-read double, so an absent id is not patched
  // with a guess.
  return {
    type: "assistant",
    timestamp: message.timestamp,
    message: {
      id: typeof message.responseId === "string" && message.responseId ? message.responseId : undefined,
      model: message.model,
      content: Array.isArray(message.content) ? message.content : [],
      usage,
    },
  };
}

function scanAgentSession(filePath, source, adaptRecord = toAgentSessionRecord) {
  const { scanClaudeSession } = require("./session-analytics");
  return scanClaudeSession(filePath, { source, adaptRecord });
}

const scanAutoClawSession = (filePath) => scanAgentSession(filePath, AUTOCLAW_SOURCE);
const scanColaSession = (filePath) => scanAgentSession(filePath, COLA_SOURCE);

// ── Junie (JetBrains) ────────────────────────────────────────────────────────
// ~/.junie/sessions/<session-id>/events.jsonl — one JSON event per line:
//   {"timestampMs": <epoch ms — the call's END>, "event": {"agentEvent": {
//     "kind": "LlmResponseMetadataEvent", "agent": {"name": ...},
//     "modelUsage": [{"model": ..., "inputTokens"|"input": N,
//       "outputTokens"|"output": N, "cacheInputTokens"|...|"cacheRead": N,
//       "cacheCreateTokens"|...|"cacheWrite": N,
//       "reasoningTokens"|...: N, "time": <latency ms>, "cost": N}]}}}
// User turns ride "UserPromptEvent" lines. Spec: junhoyeo/tokscale sessions/
// junie.rs (TM's parsing engine); no live Junie install on the build machine,
// so the field aliases follow the tokscale reader verbatim.
//
// One LlmResponseMetadataEvent can carry SEVERAL modelUsage rows (planner +
// executor models in one response), so the adapter returns an array — the
// shared scanners (scanClaudeSession / parseAgentJsonlIncremental) fan a
// returned array out into one record per row.
//
// Junie records carry no round-trip id, so the dedup id is composed from the
// row itself (session + end timestamp + model + token counts + row index),
// byte-stable across rescans of an append-only file — the same key shape
// tokscale uses. session id comes from the path; the sync engine passes it.
const JUNIE_SOURCE = "junie";

function junieSessionIdFromPath(filePath) {
  return path.basename(path.dirname(String(filePath || ""))) || "unknown";
}

function junieNumber(usage, keys) {
  for (const key of keys) {
    const value = Number(usage?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function junieEventKind(entry) {
  return String(entry?.event?.agentEvent?.kind || entry?.kind || "");
}

function toJunieRecords(entry, filePath) {
  if (!entry || typeof entry !== "object") return null;
  const kind = junieEventKind(entry);
  const timestampMs = Number(entry.timestampMs);

  if (kind === "UserPromptEvent") {
    // The prompt body's field name is not verified against a live install, so
    // no content is synthesized — the session scanner drops content-less user
    // records (turn accounting degrades) while the timestamp still bounds the
    // session window. Usage rows below are the ledger; nothing is invented.
    return [{
      type: "user",
      timestamp: Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : undefined,
      message: { content: null },
    }];
  }
  if (kind !== "LlmResponseMetadataEvent") return null;

  const agentEvent = entry.event?.agentEvent;
  const rows = Array.isArray(agentEvent?.modelUsage) ? agentEvent.modelUsage : null;
  if (!rows || rows.length === 0) return null;
  const sessionId = junieSessionIdFromPath(filePath);

  const records = [];
  for (let index = 0; index < rows.length; index++) {
    const usageRow = rows[index];
    if (!usageRow || typeof usageRow !== "object") continue;
    const model = typeof usageRow.model === "string" && usageRow.model ? usageRow.model : null;
    if (!model) continue;
    const input = junieNumber(usageRow, ["inputTokens", "input"]);
    const output = junieNumber(usageRow, ["outputTokens", "output"]);
    const cacheRead = junieNumber(usageRow, ["cacheInputTokens", "cacheReadInputTokens", "cacheRead"]);
    const cacheWrite = junieNumber(usageRow, ["cacheCreateTokens", "cacheCreationInputTokens", "cacheWrite"]);
    const reasoning = junieNumber(usageRow, ["reasoningTokens", "reasoningOutputTokens", "thinkingTokens"]);
    const cost = Number(usageRow.cost);
    if (input + output + cacheRead + cacheWrite + reasoning <= 0
      && !(Number.isFinite(cost) && cost > 0)) continue;

    // timestampMs records the call's END; `time` is its latency. Back-calculate
    // the start anchor only from an explicit end timestamp — the mtime fallback
    // is not a per-call completion time and subtracting would shift the row
    // into the wrong day (same rule as tokscale #890 for Copilot end-times).
    const durationMs = junieNumber(usageRow, ["time"]);
    const hasExplicitEnd = Number.isFinite(timestampMs) && timestampMs > 0;
    const startMs = hasExplicitEnd && durationMs > 0 ? timestampMs - durationMs : (hasExplicitEnd ? timestampMs : undefined);

    // Row index is this row's position WITHIN the event's modelUsage array —
    // derived from the event itself, so a replayed identical event reproduces
    // the same key and collapses; distinct rows stay distinct.
    const dedupId = `junie:${sessionId}:${Number.isFinite(timestampMs) ? timestampMs : ""}:${model}:${input}:${output}:${cacheRead}:${cacheWrite}:${reasoning}:${Number.isFinite(cost) ? cost.toFixed(12) : "0"}:${index}`;

    records.push({
      type: "assistant",
      timestamp: startMs,
      message: {
        id: dedupId,
        model,
        content: [],
        usage: {
          input_tokens: input,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: cacheWrite,
          output_tokens: output + reasoning,
          output_tokens_details: { reasoning_tokens: reasoning },
        },
      },
    });
  }
  return records.length > 0 ? records : null;
}

function resolveJunieSessionFiles({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_JUNIE_HOME;
  const root = override
    ? path.resolve(String(override))
    : path.join(String(home || ""), ".junie", "sessions");
  // events.jsonl sits one level below the session id — depth 2 covers it and
  // any future per-session subdirectories.
  return listJsonlFiles(root, 0, []).filter((file) => path.basename(file) === "events.jsonl").sort();
}

const scanJunieSession = (filePath) => scanAgentSession(filePath, JUNIE_SOURCE, toJunieRecords);

// ── OpenCodeReview ───────────────────────────────────────────────────────────
// ~/.opencodereview/sessions/<encoded-repo-path>/<session-id>.jsonl — one JSON
// record per line:
//   {"type":"session_start","cwd": "..."}
//   {"type":"llm_response","timestamp": <RFC3339 or epoch>, "duration_ms": N,
//    "model": "...", "usage": {"prompt_tokens": N, "completion_tokens": N,
//    "cache_read_tokens": N, "cache_write_tokens": N}}
// Spec: junhoyeo/tokscale sessions/opencodereview.rs.
const OPENCODE_REVIEW_SOURCE = "opencodereview";

function opencodeReviewTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toOpenCodeReviewRecord(entry, filePath) {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type === "session_start") {
    // Carries the workspace cwd for project attribution; no prompt body, so
    // the session scanner drops it after reading cwd (same posture as Junie's
    // content-less user records).
    return {
      type: "user",
      cwd: typeof entry.cwd === "string" ? entry.cwd : undefined,
      message: { content: null },
    };
  }
  if (entry.type !== "llm_response") return null;
  const usage = entry.usage;
  if (!usage || typeof usage !== "object") return null;
  const input = Number(usage.prompt_tokens) || 0;
  const output = Number(usage.completion_tokens) || 0;
  const cacheRead = Number(usage.cache_read_tokens) || 0;
  const cacheWrite = Number(usage.cache_write_tokens) || 0;
  if (input + output + cacheRead + cacheWrite <= 0) return null;

  const sessionId = path.basename(String(filePath || ""), ".jsonl") || "unknown";
  const model = typeof entry.model === "string" && entry.model ? entry.model : "unknown";
  const endMs = opencodeReviewTimestamp(entry.timestamp);
  const durationMs = Number(entry.duration_ms);
  // `timestamp` is the call's END; back-calculate the start anchor from
  // duration_ms only when the timestamp is the record's own (see junie note).
  const timestamp = endMs !== null && Number.isFinite(durationMs) && durationMs > 0
    ? endMs - durationMs
    : endMs === null ? undefined : endMs;
  const dedupId = `opencodereview:${sessionId}:${endMs === null ? "" : endMs}:${model}:${input}:${output}:${cacheRead}:${cacheWrite}`;

  return {
    type: "assistant",
    timestamp,
    message: {
      id: dedupId,
      model,
      content: [],
      usage: {
        input_tokens: input,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
        output_tokens: output,
      },
    },
  };
}

function resolveOpenCodeReviewSessionFiles({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_OPENCODE_REVIEW_HOME;
  const root = override
    ? path.resolve(String(override))
    : path.join(String(home || ""), ".opencodereview", "sessions");
  return listJsonlFiles(root).sort();
}

const scanOpenCodeReviewSession = (filePath) => scanAgentSession(filePath, OPENCODE_REVIEW_SOURCE, toOpenCodeReviewRecord);

// ── Amp (Sourcegraph) ────────────────────────────────────────────────────────
// Amp does NOT write JSONL: `~/.local/share/amp/threads/` holds one whole-file
// JSON thread per file (legacy local export shape). The usage ledger lives on
// the thread object, so Amp rides its own incremental parser
// (parseAmpIncremental in rollout.js) — the resolvers here only feed it and
// the sessions-page scanner.
const AMP_SOURCE = "amp";

function resolveAmpThreadFiles({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_AMP_HOME;
  const root = override
    ? path.resolve(String(override))
    : path.join(String(home || ""), ".local", "share", "amp", "threads");
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    files.push(path.join(root, entry.name));
  }
  return files.sort();
}

// Sessions-page scanner: map the thread's reconciled usage rows onto one
// synthetic assistant record per row (same claude-shaped contract the JSONL
// adapters feed scanClaudeSession). tokscale's reconciliation — ledger events
// first, message usage fills ledger gaps, matched rows merge — is implemented
// in parseAmpThreadUsage so the sync parser and this scanner agree.
function parseAmpThreadUsage(thread, { fileMtimeMs = 0 } = {}) {
  const toks = (tokens) => ({
    input: Number(tokens?.input) || 0,
    output: Number(tokens?.output) || 0,
    cacheRead: Number(tokens?.cacheRead) || 0,
    cacheWrite: Number(tokens?.cacheWrite) || 0,
  });
  const creditsOf = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const tsFrom = (value, fallbackMs) => {
    const parsed = opencodeReviewTimestamp(value);
    return parsed !== null ? parsed : (Number.isFinite(fallbackMs) && fallbackMs > 0 ? fallbackMs : null);
  };

  const threadId = typeof thread?.id === "string" && thread.id ? thread.id : "unknown";
  const threadCreatedMs = Number(thread?.created) || 0;
  const ledgerEvents = Array.isArray(thread?.usageLedger?.events) ? thread.usageLedger.events : [];
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];

  const ledgerRecords = ledgerEvents.map((event, index) => ({
    model: typeof event?.model === "string" && event.model ? event.model : null,
    tokens: toks(event?.tokens),
    credits: creditsOf(event?.credits),
    timestamp: tsFrom(event?.timestamp, threadCreatedMs || fileMtimeMs),
    toMessageId: Number.isFinite(Number(event?.toMessageId)) ? Number(event.toMessageId) : null,
    key: `amp:${threadId}:ledger:${index}`,
  })).filter((row) => row.model && (row.tokens.input + row.tokens.output + row.tokens.cacheRead + row.tokens.cacheWrite > 0));

  const messageRecords = messages.flatMap((message, index) => {
    const usage = message?.usage;
    if (!usage || typeof usage !== "object") return [];
    const tokens = {
      input: Number(usage.inputTokens) || 0,
      output: Number(usage.outputTokens) || 0,
      cacheRead: Number(usage.cacheReadInputTokens) || 0,
      cacheWrite: Number(usage.cacheCreationInputTokens) || 0,
    };
    if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite <= 0) return [];
    return [{
      model: typeof usage.model === "string" && usage.model ? usage.model : null,
      tokens,
      credits: creditsOf(usage.credits),
      timestamp: tsFrom(usage.timestamp, threadCreatedMs || fileMtimeMs),
      toMessageId: Number.isFinite(Number(message.messageId)) ? Number(message.messageId) : null,
      key: `amp:${threadId}:message:${index}`,
    }];
  }).filter((row) => row.model);

  // Reconciliation (tokscale amp.rs): the ledger is authoritative; each
  // message record merges into the first unconsumed ledger row with the same
  // model and token counts (searching forward only), and only message rows
  // with no ledger match add themselves. Ledger rows keep their own timestamp.
  const consumed = new Array(ledgerRecords.length).fill(false);
  const merged = ledgerRecords.map((row) => ({ ...row }));
  const unmatched = [];
  let searchStart = 0;
  for (const messageRecord of messageRecords) {
    let matched = -1;
    for (let i = searchStart; i < merged.length; i++) {
      if (consumed[i]) continue;
      const candidate = merged[i];
      if (candidate.model !== messageRecord.model) continue;
      if (candidate.toMessageId !== null && messageRecord.toMessageId !== null
        && candidate.toMessageId !== messageRecord.toMessageId) continue;
      if (candidate.tokens.input !== messageRecord.tokens.input
        || candidate.tokens.output !== messageRecord.tokens.output
        || candidate.tokens.cacheRead !== messageRecord.tokens.cacheRead
        || candidate.tokens.cacheWrite !== messageRecord.tokens.cacheWrite) continue;
      matched = i;
      break;
    }
    if (matched >= 0) {
      consumed[matched] = true;
      // The message record may carry the timestamp a ledger row lacks.
      if (merged[matched].timestamp === null && messageRecord.timestamp !== null) {
        merged[matched].timestamp = messageRecord.timestamp;
      }
      searchStart = matched + 1;
    } else {
      unmatched.push(messageRecord);
    }
  }

  return [...merged, ...unmatched]
    .filter((row) => row.timestamp !== null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((row) => ({
      type: "assistant",
      timestamp: row.timestamp,
      message: {
        id: row.key,
        model: row.model,
        content: [],
        usage: {
          input_tokens: row.tokens.input,
          cache_read_input_tokens: row.tokens.cacheRead,
          cache_creation_input_tokens: row.tokens.cacheWrite,
          output_tokens: row.tokens.output,
        },
      },
    }));
}

const scanAmpSession = (filePath) => {
  const { scanClaudeSession } = require("./session-analytics");
  let thread = null;
  let fileMtimeMs = 0;
  try {
    thread = JSON.parse(fs.readFileSync(filePath, "utf8"));
    fileMtimeMs = fs.statSync(filePath).mtimeMs;
  } catch { return null; }
  if (!thread || typeof thread !== "object") return null;
  const records = parseAmpThreadUsage(thread, { fileMtimeMs });
  // The thread file is whole-file JSON, not line-delimited, so the reconciled
  // rows are serialized into synthetic lines and fed to the shared scanner
  // through its rawLines seam; the adapter is the identity (the rows are
  // already Claude-shaped).
  return scanClaudeSession(filePath, {
    source: AMP_SOURCE,
    rawLines: records.map((record) => JSON.stringify(record)),
    adaptRecord: (parsed) => parsed,
  });
};

module.exports = {
  AUTOCLAW_SOURCE,
  COLA_SOURCE,
  resolveAutoClawSessionFiles,
  resolveColaSessionFiles,
  toAgentSessionRecord,
  claudeShapedUsage,
  scanAutoClawSession,
  scanColaSession,
  JUNIE_SOURCE,
  resolveJunieSessionFiles,
  toJunieRecords,
  scanJunieSession,
  OPENCODE_REVIEW_SOURCE,
  resolveOpenCodeReviewSessionFiles,
  toOpenCodeReviewRecord,
  scanOpenCodeReviewSession,
  AMP_SOURCE,
  resolveAmpThreadFiles,
  parseAmpThreadUsage,
  scanAmpSession,
};