"use strict";

// 商汤小浣熊 (Office Raccoon) desktop app keeps a full agent trace under
// ~/.office-raccoon/agent/log/sessions/<session-id>.jsonl. Every model call is
// an `llm.response` event carrying the provider's own counters:
//
//   {"event":"llm.response","timestamp":"2026-10-27T05:27:05.245Z",
//    "data":{"model":"sn-deepseek-v4-1-flash-1017",
//            "usage":{"prompt_tokens":85576,"completion_tokens":7924,
//                     "total_tokens":93500,"cached_tokens":84864}}}
//
// That is usage produced INSIDE this app (it talks to SenseTime directly, not
// through the agent2api gateway), so it becomes its own `raccoon` source
// rather than hiding inside another card. Built at read time like JoyCode and
// the Qoder credit rows: the queue never sees these files.
//
// prompt_tokens is inclusive of cached_tokens (same convention as OpenAI), so
// the disjoint input is prompt - cached. total = prompt + completion, matching
// the gateway reader's arithmetic.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function raccoonOfficeSessionsDir({ home = os.homedir() } = {}) {
  return path.join(home, ".office-raccoon", "agent", "log", "sessions");
}

let cache = null;

function hourStartFor(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function raccoonOfficeUsageRows({ home = os.homedir() } = {}) {
  const dir = raccoonOfficeSessionsDir({ home });
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const stat = [];
  for (const name of names) {
    try {
      const info = fs.statSync(path.join(dir, name));
      stat.push(`${name}:${info.size}:${info.mtimeMs}`);
    } catch {
      // file rotated away mid-scan; the next pass picks it up
    }
  }
  const cacheKey = `${dir}|${stat.join("|")}`;
  if (cache && cache.key === cacheKey) return cache.rows;

  const buckets = new Map();
  for (const name of names) {
    let text;
    try {
      text = fs.readFileSync(path.join(dir, name), "utf8");
    } catch {
      continue;
    }
    let countedSession = new Set();
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event?.event !== "llm.response") continue;
      const usage = event.data?.usage;
      if (!usage) continue;
      const hourStart = hourStartFor(event.timestamp);
      if (!hourStart) continue;
      const model = String(event.data?.model || "").trim() || "unknown";
      const prompt = Math.max(0, Number(usage.prompt_tokens) || 0);
      const output = Math.max(0, Number(usage.completion_tokens) || 0);
      const cached = Math.min(prompt, Math.max(0, Number(usage.cached_tokens) || 0));
      const input = prompt - cached;
      const total = prompt + output;
      if (total <= 0) continue;
      const key = `${model}|${hourStart}`;
      const bucket = buckets.get(key) || {
        model,
        hour_start: hourStart,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        sessions: new Set(),
      };
      bucket.input_tokens += input;
      bucket.cached_input_tokens += cached;
      bucket.output_tokens += output;
      bucket.total_tokens += total;
      bucket.sessions.add(name);
      buckets.set(key, bucket);
      countedSession.add(name);
    }
  }

  const rows = [...buckets.values()]
    .map((bucket) => ({
      source: "raccoon",
      model: bucket.model,
      hour_start: bucket.hour_start,
      input_tokens: bucket.input_tokens,
      cached_input_tokens: bucket.cached_input_tokens,
      cache_creation_input_tokens: 0,
      output_tokens: bucket.output_tokens,
      reasoning_output_tokens: 0,
      total_tokens: bucket.total_tokens,
      total_cost_usd: 0,
      cost_usd: 0,
      // Calls are not conversations: count the session files that contributed.
      conversation_count: bucket.sessions.size,
      usage_precision: "reported",
    }))
    .sort((a, b) => String(a.hour_start).localeCompare(String(b.hour_start)));

  cache = { key: cacheKey, rows };
  return rows;
}

module.exports = { raccoonOfficeUsageRows, raccoonOfficeSessionsDir };
