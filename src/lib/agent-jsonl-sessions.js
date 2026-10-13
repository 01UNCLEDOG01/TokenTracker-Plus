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

function scanAgentSession(filePath, source) {
  const { scanClaudeSession } = require("./session-analytics");
  return scanClaudeSession(filePath, { source, adaptRecord: toAgentSessionRecord });
}

const scanAutoClawSession = (filePath) => scanAgentSession(filePath, AUTOCLAW_SOURCE);
const scanColaSession = (filePath) => scanAgentSession(filePath, COLA_SOURCE);

module.exports = {
  AUTOCLAW_SOURCE,
  COLA_SOURCE,
  resolveAutoClawSessionFiles,
  resolveColaSessionFiles,
  toAgentSessionRecord,
  claudeShapedUsage,
  scanAutoClawSession,
  scanColaSession,
};