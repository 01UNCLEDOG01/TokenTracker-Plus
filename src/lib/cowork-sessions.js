"use strict";

// 团结 Cowork (Tuanjie Cowork / Codely) keeps every conversation as an
// append-only JSONL under ~/.codely-cli/tmp/<instance-hash>/chats/<uuid>.jsonl,
// one record per line:
//
//   {"t":"...","seq":12,"msg":{"id":"<uuid>","timestamp":"2026-10-06T04:59:19.577Z",
//     "type":"gemini","model":"codely-air","content":"...",
//     "tokens":{"input":N,"output":N,"cached":N,"thoughts":N,"tool":N,"total":N}},
//    "instanceId":"..."}
//
// Measured on this machine before writing anything (664 token-bearing records
// across 4 files, 2026-08-19 .. 2026-10-06):
//
//   * `total` equals `input + output` in 664/664 records, so the file's own
//     total is the number to trust; it is NOT re-derived here.
//   * `cached` is a SUBSET of `input` in 664/664 records (never larger), which is
//     why the adapter splits input into fresh + cached instead of adding cached
//     on top. Adding it would inflate every record by the cached amount.
//   * `thoughts` was 0 in 664/664 records, so whether it is a subset of output
//     or an addition to it is UNVERIFIABLE here. output_tokens is therefore left
//     whole and thoughts is reported in the detail block only, which keeps
//     total == input + output intact. If a future build ever reports a non-zero
//     thoughts as an ADDITION, this mapping under-counts by that amount -
//     re-measure before trusting a Codely number that involves reasoning.
//   * `tool` was 0 in every record and has no counterpart in the canonical
//     shape, so it is not carried.
//
// Dedup key is `msg.id`. Measured: 664 records but only 462 distinct ids - the
// same record is written twice in the SAME file, so a naive sum reads exactly
// 2x on the affected days. Cross-checking that deduped 2026-10-06 figure
// (37,948,230) against Codely's own in-app usage page confirmed it to within
// ~0.7%, which is what makes this the authoritative local source.
//
// Deliberately NOT read:
//
//   * ~/.codely-cli/tmp/*/tasks/*.jsonl - 110 files, measured 0 of them carrying
//     a `tokens` field. Reading them is 23x the I/O for nothing.
//   * ~/.codely/dev_data/devdata.sqlite (`tokens_generated`) and
//     ~/.codely/dev_data/0.2.0/tokensGenerated.jsonl - both stop at 2026-08-20
//     while chats continue to 2026-10-06, and they overlap the chats window
//     (both carry 2026-08-19), so adding them would double-count that day.
//
// No price is attached. Codely bills against an internal credit balance whose
// per-credit money value is not published - see curated-overrides.json. The
// 0.25x / 0.1x shown next to the model names in the picker are relative to an
// undocumented baseline, so they are not applied either.

const fs = require("node:fs");
const path = require("node:path");

const TUANJIE_COWORK_SOURCE = "tuanjie-cowork";

function listChatFiles(root, depth = 0, out = []) {
  if (!root || depth > 4) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listChatFiles(full, depth + 1, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl") &&
      path.basename(path.dirname(full)).toLowerCase() === "chats") {
      out.push(full);
    }
  }
  return out;
}

function resolveCoworkChatFiles({ env = {}, home } = {}) {
  const override = env.TOKENTRACKER_TUANJIE_COWORK_HOME;
  const root = override
    ? path.resolve(String(override))
    : path.join(String(home || ""), ".codely-cli", "tmp");
  return listChatFiles(root).sort();
}

// Adapt one line into the record shape scanClaudeSession reads.
//
// A record whose `msg` carries no tokens is dropped: it is not a metered
// round-trip, and there is no user/assistant turn accounting to preserve here
// (the canonical scanner's turn logic is built for the role-based shape this
// source does not use - measured `msg.type` is always "gemini").
function toCoworkSessionRecord(entry) {
  if (!entry || typeof entry !== "object") return null;
  const msg = entry.msg;
  if (!msg || typeof msg !== "object") return null;
  const tokens = msg.tokens;
  if (!tokens || typeof tokens !== "object") return null;

  const input = Number(tokens.input) || 0;
  const output = Number(tokens.output) || 0;
  const cached = Number(tokens.cached) || 0;
  const thoughts = Number(tokens.thoughts) || 0;
  if (input + output <= 0) return null;

  // `cached` never exceeds `input` on this machine, but a malformed record must
  // not produce a negative fresh-input count.
  const cacheRead = Math.min(cached, input);

  return {
    type: "assistant",
    timestamp: msg.timestamp,
    message: {
      // The dedup key. Without it the doubled write described at the top of this
      // file would be counted twice, so an absent id is never invented - the
      // scanner skips such a record instead.
      id: typeof msg.id === "string" && msg.id ? msg.id : undefined,
      model: msg.model,
      content: [],
      usage: {
        input_tokens: input - cacheRead,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: 0,
        // Left whole on purpose - see the `thoughts` note at the top.
        output_tokens: output,
        output_tokens_details: { reasoning_tokens: thoughts },
      },
    },
  };
}

function scanCoworkChat(filePath) {
  const { scanClaudeSession } = require("./session-analytics");
  return scanClaudeSession(filePath, { source: TUANJIE_COWORK_SOURCE, adaptRecord: toCoworkSessionRecord });
}

module.exports = {
  TUANJIE_COWORK_SOURCE,
  resolveCoworkChatFiles,
  toCoworkSessionRecord,
  scanCoworkChat,
};