// Cursor Composer 会话解析测试：用临时 SQLite 复刻真实三源结构，
// 不依赖也不触碰真实 state.vscdb（schema 2026-11-02 在真库上探明）。

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { parseComposerSessions } = require("../src/lib/cursor-composer-sessions");

function buildFakeDb(dir) {
  const dbPath = path.join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)");
  db.exec(
    "CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)",
  );
  db.exec(
    "CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, workspaceId TEXT, createdAt INTEGER, " +
      "lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, recency INTEGER, checkpointAt INTEGER, " +
      "subagentTypeName TEXT, value TEXT)",
  );

  const put = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");
  const header = db.prepare(
    "INSERT INTO composerHeaders (composerId, createdAt, lastUpdatedAt, isArchived, isSubagent, value) VALUES (?, ?, ?, ?, ?, ?)",
  );

  // 会话 A：两条用户气泡 + 三条 AI 气泡（其中两条带非零 token，一条零值）
  const cidA = "aaaaaaaa-0000-4000-8000-000000000001";
  header.run(cidA, 1000, 2000, 0, 0, JSON.stringify({ name: "重构登录模块", composerId: cidA }));
  put.run(
    `composerData:${cidA}`,
    JSON.stringify({
      fullConversationHeadersOnly: [
        { bubbleId: "a1", type: 1, startedAtMs: 1500, completedAtMs: 1510 },
        { bubbleId: "a2", type: 2, startedAtMs: 1520, completedAtMs: 1600 },
        { bubbleId: "a3", type: 1, startedAtMs: 1610, completedAtMs: 1620 },
        { bubbleId: "a4", type: 2, startedAtMs: 1630, completedAtMs: 1700 },
        { bubbleId: "a5", type: 2, startedAtMs: 1710, completedAtMs: 1800 },
      ],
    }),
  );
  put.run(`bubbleId:${cidA}:a2`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 1000, outputTokens: 200 } }));
  put.run(`bubbleId:${cidA}:a4`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 500, outputTokens: 50 } }));
  put.run(`bubbleId:${cidA}:a5`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 0, outputTokens: 0 } }));

  // 会话 B：无 name → 回退 Composer <id前8位>；一条 AI 气泡带 token
  const cidB = "bbbbbbbb-0000-4000-8000-000000000002";
  header.run(cidB, 2000, 3000, 0, 0, JSON.stringify({ composerId: cidB }));
  put.run(`composerData:${cidB}`, JSON.stringify({ fullConversationHeadersOnly: [{ bubbleId: "b1", type: 2 }] }));
  put.run(`bubbleId:${cidB}:b1`, JSON.stringify({ type: 2, tokenCount: { inputTokens: 42, outputTokens: 7 } }));

  // 会话 C：已归档 → 应被排除
  const cidC = "cccccccc-0000-4000-8000-000000000003";
  header.run(cidC, 500, 600, 1, 0, JSON.stringify({ name: "已归档会话", composerId: cidC }));
  put.run(`composerData:${cidC}`, JSON.stringify({ fullConversationHeadersOnly: [] }));

  // 会话 D：子代理 → 应被排除
  const cidD = "dddddddd-0000-4000-8000-000000000004";
  header.run(cidD, 500, 700, 0, 1, JSON.stringify({ name: "sub", composerId: cidD }));
  put.run(`composerData:${cidD}`, JSON.stringify({ fullConversationHeadersOnly: [] }));

  // 会话 E：composerData 缺失 → 计入 skipped
  const cidE = "eeeeeeee-0000-4000-8000-000000000005";
  header.run(cidE, 400, 800, 0, 0, JSON.stringify({ name: "无数据", composerId: cidE }));

  db.close();
  return dbPath;
}

test("parseComposerSessions：聚合 token/轮次、排除归档与子代理、缺数据计 skipped", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-sessions-"));
  const dbPath = buildFakeDb(dir);
  try {
    const { sessions, scanned, skipped } = parseComposerSessions({ dbPath });
    assert.equal(scanned, 3); // A/B/E（C 归档、D 子代理被 WHERE 排除）
    assert.equal(skipped, 1); // E 无 composerData
    assert.equal(sessions.length, 2);
    // 按 lastUpdatedAt 倒序：B(3000) > A(2000) > D 排除 → [B, A, E? no—E skipped]
    assert.equal(sessions[0].composerId, "bbbbbbbb-0000-4000-8000-000000000002");
    assert.equal(sessions[0].name, "Composer bbbbbbbb");
    assert.deepEqual(sessions[0].turns, { user: 0, ai: 1 });
    assert.equal(sessions[0].inputTokens, 42);
    assert.equal(sessions[0].outputTokens, 7);

    const a = sessions.find((s) => s.composerId === "aaaaaaaa-0000-4000-8000-000000000001");
    assert.equal(a.name, "重构登录模块");
    assert.deepEqual(a.turns, { user: 2, ai: 3 });
    assert.equal(a.inputTokens, 1500);
    assert.equal(a.outputTokens, 250);
    assert.equal(a.firstBubbleAtMs, 1500);
    assert.equal(a.lastBubbleAtMs, 1800);
    assert.equal(a.truncated, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("parseComposerSessions：损坏 JSON 行被跳过、dbPath 缺失报错", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-sessions-bad-"));
  const dbPath = path.join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value TEXT)");
  db.exec("CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, createdAt INTEGER, lastUpdatedAt INTEGER, isArchived INTEGER, isSubagent INTEGER, value TEXT)");
  db.prepare("INSERT INTO composerHeaders (composerId, createdAt, lastUpdatedAt, value) VALUES (?, ?, ?, ?)").run(
    "ffff0000-0000-4000-8000-000000000006",
    100,
    200,
    "not-json{{{",
  );
  db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run("composerData:ffff0000", "{broken");
  db.close();

  const { sessions, skipped } = parseComposerSessions({ dbPath });
  assert.equal(sessions.length, 0);
  assert.equal(skipped, 1);
  assert.throws(() => parseComposerSessions({ dbPath: path.join(dir, "missing.vscdb") }), /not found/i);
  fs.rmSync(dir, { recursive: true, force: true });
});
