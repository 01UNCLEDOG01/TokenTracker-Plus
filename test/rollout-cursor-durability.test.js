"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseClaudeIncremental } = require("../src/lib/rollout");
const { warnProviderParseFailure, setAutoParseFailureLogDir } = require("../src/commands/sync");

// P0-3（审计 2026-10-25）回归：appendFile 失败时游标与 queuedKey 不得先于落盘推进，
// 修复后下一轮整段重发（读取侧按 key 幂等去重），不再永久少计。

function writeClaudeSession(dir, name) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify({
    type: "assistant",
    timestamp: "2026-09-07T03:00:00Z",
    message: {
      id: `m-${name}`,
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 420, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 518 },
    },
  }) + "\n");
  return file;
}

test("P0-3: failed append leaves cursors untouched, retry re-sends the batch idempotently", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-cursor-durability-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const file = writeClaudeSession(dir, "session-a.jsonl");
  const queuePath = path.join(dir, "queue.jsonl");
  // queuePath 是目录 → appendFile 必然 EISDIR，等价于「落盘失败」的最坏情况。
  fs.mkdirSync(queuePath);

  const cursors = {};
  await assert.rejects(
    parseClaudeIncremental({ projectFiles: [file], queuePath, cursors, source: "claude" }),
    (err) => err && (err.code === "EISDIR" || /EISDIR|permitted|directory/i.test(String(err.message))),
  );

  // 失败轮：游标不得推进（这批文件下轮从头重读），hourly 状态不得写回 cursors。
  assert.equal(cursors.files[file], undefined);
  assert.equal(cursors.hourly, undefined);

  // 修复队列路径后重跑：整段重发成功，游标推进、queuedKey 打戳。
  fs.rmSync(queuePath, { recursive: true, force: true });
  fs.writeFileSync(queuePath, "");
  await parseClaudeIncremental({ projectFiles: [file], queuePath, cursors, source: "claude" });

  const rows = fs.readFileSync(queuePath, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(rows.length > 0);
  const totals = rows.map((line) => JSON.parse(line).total_tokens || 0).reduce((a, b) => a + b, 0);
  assert.equal(totals, 420 + 100 + 20 + 518);
  const st = fs.statSync(file);
  assert.equal(cursors.files[file].offset, st.size);
  const bucket = Object.values(cursors.hourly?.buckets || {})[0];
  assert.ok(bucket && typeof bucket.queuedKey === "string");

  // 幂等：同 cursors 再跑一轮，queuedKey 相同 → 不再追加任何行。
  const before = fs.readFileSync(queuePath, "utf8");
  await parseClaudeIncremental({ projectFiles: [file], queuePath, cursors, source: "claude" });
  assert.equal(fs.readFileSync(queuePath, "utf8"), before);
});

test("D1: auto-mode parse failures leave a diagnostic marker; non-auto stays on stderr", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-auto-parse-marker-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prevDir = path.join(dir, "tracker");
  fs.mkdirSync(prevDir, { recursive: true });
  setAutoParseFailureLogDir(prevDir);

  const boom = new Error("EBUSY: resource busy");
  warnProviderParseFailure("Codex", boom, { auto: true });
  warnProviderParseFailure("Codex", boom, { auto: true });
  warnProviderParseFailure("Claude", new Error("bad json"), { auto: true });

  const marker = JSON.parse(fs.readFileSync(path.join(prevDir, "sync.parse-failures.json"), "utf8"));
  assert.equal(marker.failures.Codex.count, 2);
  assert.match(marker.failures.Codex.last_message, /EBUSY/);
  assert.equal(marker.failures.Claude.count, 1);

  // 非 auto：只走 stderr，不写标记文件。
  const before = fs.readFileSync(path.join(prevDir, "sync.parse-failures.json"), "utf8");
  warnProviderParseFailure("Gemini", new Error("nope"), {});
  assert.equal(fs.readFileSync(path.join(prevDir, "sync.parse-failures.json"), "utf8"), before);

  setAutoParseFailureLogDir(null);
});
