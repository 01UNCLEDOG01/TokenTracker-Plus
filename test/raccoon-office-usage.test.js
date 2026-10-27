const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { raccoonOfficeUsageRows } = require("../src/lib/raccoon-office-usage.js");

function fixture(lines) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "raccoon-office-"));
  const dir = path.join(home, ".office-raccoon", "agent", "log", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"), "utf8");
  return home;
}

const response = (timestamp, model, usage) => ({
  schema_version: "box-agent-session-trace/v1",
  timestamp,
  event: "llm.response",
  data: { provider: "openai", model, usage },
});

test("aggregates llm.response usage into hourly raccoon rows", () => {
  const home = fixture([
    { event: "session.start", timestamp: "2026-10-27T05:05:48.104Z", data: {} },
    response("2026-10-27T05:06:05.923Z", "sn-deepseek-v4-1-flash-1017", {
      prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cached_tokens: 800,
    }),
    response("2026-10-27T05:06:30.000Z", "sn-deepseek-v4-1-flash-1017", {
      prompt_tokens: 500, completion_tokens: 100, total_tokens: 600, cached_tokens: 0,
    }),
    response("2026-10-27T06:10:00.000Z", "sn-deepseek-v4-1-flash-1017", {
      prompt_tokens: 300, completion_tokens: 50, total_tokens: 350, cached_tokens: 100,
    }),
  ]);

  const rows = raccoonOfficeUsageRows({ home });
  assert.equal(rows.length, 2, "two hour buckets");
  const [first, second] = rows;
  assert.equal(first.source, "raccoon");
  assert.equal(first.model, "sn-deepseek-v4-1-flash-1017");
  assert.equal(first.hour_start, "2026-10-27T05:00:00.000Z");
  // 1000-800 + 500-0 fresh input, 800 cached, 200+100 output, 1200+600 total
  assert.equal(first.input_tokens, 700);
  assert.equal(first.cached_input_tokens, 800);
  assert.equal(first.output_tokens, 300);
  assert.equal(first.total_tokens, 1800);
  assert.equal(first.conversation_count, 1, "one contributing session file");
  assert.equal(second.hour_start, "2026-10-27T06:00:00.000Z");
  assert.equal(second.total_tokens, 350);
});

test("ignores rows without usage and survives a missing directory", () => {
  const home = fixture([
    { event: "llm.response", timestamp: "2026-10-27T05:06:05.923Z", data: { model: "m" } },
    { event: "tool.call", timestamp: "2026-10-27T05:06:06.000Z", data: {} },
  ]);
  assert.deepEqual(raccoonOfficeUsageRows({ home }), []);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "raccoon-empty-"));
  assert.deepEqual(raccoonOfficeUsageRows({ home: empty }), []);
});

test("reassembles lines that straddle the reader's 1 MB chunks", () => {
  // The real trace blows past Node's ~512 MB string cap within days, so the
  // reader works in fixed chunks. A single line longer than a chunk, with
  // multi-byte characters landing on chunk boundaries, must still be counted
  // exactly once — the failure mode this replaced was silently zero rows.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "raccoon-big-"));
  const dir = path.join(home, ".office-raccoon", "agent", "log", "sessions");
  fs.mkdirSync(dir, { recursive: true });
  const pad = "浣熊tokenusage".repeat(120000); // mixed 3-byte and 1-byte UTF-8
  const events = [];
  for (let i = 0; i < 6; i += 1) {
    events.push(response(`2026-10-27T05:${String(i).padStart(2, "0")}:00.000Z`, "m", {
      prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cached_tokens: 40,
    }));
    events.push({ event: "context.snapshot", timestamp: "2026-10-27T05:00:00.000Z", data: { blob: pad } });
  }
  const file = path.join(dir, "big.jsonl");
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n"), "utf8");
  assert.ok(fs.statSync(file).size > 3 * 1024 * 1024, "fixture must span several 1 MB chunks");

  const rows = raccoonOfficeUsageRows({ home });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].total_tokens, 660, "six calls of 110, none lost or double counted");
  assert.equal(rows[0].input_tokens, 360);
  assert.equal(rows[0].cached_input_tokens, 240);
  assert.equal(rows[0].output_tokens, 60);
});

test("caches by file fingerprint but re-reads when the log grows", () => {
  const home = fixture([
    response("2026-10-27T05:06:05.923Z", "m", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cached_tokens: 0 }),
  ]);
  const first = raccoonOfficeUsageRows({ home });
  assert.equal(first[0].total_tokens, 15);
  const file = path.join(home, ".office-raccoon", "agent", "log", "sessions", "s1.jsonl");
  fs.appendFileSync(file, "\n" + JSON.stringify(response("2026-10-27T05:20:00.000Z", "m", {
    prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, cached_tokens: 0,
  })), "utf8");
  const grown = raccoonOfficeUsageRows({ home });
  assert.equal(grown[0].total_tokens, 40, "same hour bucket now carries both calls");
});
