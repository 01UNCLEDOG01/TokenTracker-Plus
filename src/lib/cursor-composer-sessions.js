// Cursor Composer 会话层解析（只读）——v1 聚合版
//
// 数据源（真实 state.vscdb，三张表/两类键，2026-11-02 在真实库上探明）：
//   composerHeaders        会话头：composerId / createdAt / lastUpdatedAt /
//                          value(JSON，内含 name 会话标题) / isArchived / isSubagent
//   cursorDiskKV composerData:<id>    JSON：fullConversationHeadersOnly（气泡顺序、
//                          type 1=用户 2=AI、createdAt、startedAtMs/completedAtMs）
//   cursorDiskKV bubbleId:<cid>:<bid> 逐气泡 JSON：tokenCount {inputTokens, outputTokens}
//
// 已知边界（2026-11-02 实测）：
//   - AI 气泡里 modelInfo 普遍为 null：模型归属暂不可得，聚合不标模型；
//   - 非零 token 只出现在部分 AI 气泡（工具/思考气泡为零值是常态），合计只累加非零项；
//   - Cursor 运行中可安全读取（readOnly 打开，WAL 快照语义）。
//
// 管线接入待办：session-analytics 的会话聚合（identity/merge 语义）另批处理，
// 本模块先作为独立只读聚合层，供 CLI / 会话页后续消费。

const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_SESSION_LIMIT = 200;
const MAX_BUBBLES_PER_SESSION = 500;

function parseJsonObject(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function headerName(headerJson, composerId) {
  const name = headerJson && typeof headerJson.name === "string" ? headerJson.name.trim() : "";
  return name || `Composer ${String(composerId).slice(0, 8)}`;
}

/**
 * 解析 Cursor Composer 会话聚合。
 * @param {object} options
 * @param {string} options.dbPath  state.vscdb 绝对路径（cursor-config 的 stateDbPath）
 * @param {number} [options.limit] 最多返回最近 N 个会话（按 lastUpdatedAt 倒序）
 * @returns {{sessions: Array, scanned: number, skipped: number}}
 */
function parseComposerSessions({ dbPath, limit = DEFAULT_SESSION_LIMIT } = {}) {
  if (!dbPath) throw new Error("parseComposerSessions requires dbPath");
  if (!fs.existsSync(dbPath)) throw new Error(`Cursor state.vscdb not found: ${dbPath}`);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const selectBubble = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
    const selectComposerData = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?");
    const headers = db
      .prepare(
        "SELECT composerId, createdAt, lastUpdatedAt, value FROM composerHeaders " +
          "WHERE (isArchived IS NULL OR isArchived = 0) AND (isSubagent IS NULL OR isSubagent = 0) " +
          "ORDER BY lastUpdatedAt DESC LIMIT ?",
      )
      .all(Number(limit) > 0 ? Number(limit) : DEFAULT_SESSION_LIMIT);

    const sessions = [];
    let skipped = 0;

    for (const header of headers) {
      const composerId = header.composerId;
      const headerJson = parseJsonObject(header.value);
      const dataJson = parseJsonObject(
        (selectComposerData.get(`composerData:${composerId}`) || { value: null }).value,
      );
      if (!dataJson) {
        skipped += 1;
        continue;
      }

      const conversationHeaders = Array.isArray(dataJson.fullConversationHeadersOnly)
        ? dataJson.fullConversationHeadersOnly
        : [];
      let userTurns = 0;
      let aiTurns = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let firstAtMs = null;
      let lastAtMs = null;

      // 气泡条数设上限：超长会话（>500 气泡）统计尾部截断，避免单会话拖垮整轮。
      const window = conversationHeaders.slice(0, MAX_BUBBLES_PER_SESSION);
      for (const entry of window) {
        if (!entry || typeof entry.bubbleId !== "string") continue;
        if (entry.type === 1) userTurns += 1;
        else if (entry.type === 2) aiTurns += 1;
        if (typeof entry.startedAtMs === "number") {
          if (firstAtMs === null || entry.startedAtMs < firstAtMs) firstAtMs = entry.startedAtMs;
        }
        if (typeof entry.completedAtMs === "number") {
          if (lastAtMs === null || entry.completedAtMs > lastAtMs) lastAtMs = entry.completedAtMs;
        }
        if (entry.type !== 2) continue;
        // KV 行的键可能按本地 bubbleId 或服务端 serverBubbleId 落库（两者常不同），
        // 先查本地 id，未命中再查 server id。
        let bubble = parseJsonObject(
          (selectBubble.get(`bubbleId:${composerId}:${entry.bubbleId}`) || { value: null }).value,
        );
        if (!bubble && typeof entry.serverBubbleId === "string" && entry.serverBubbleId !== entry.bubbleId) {
          bubble = parseJsonObject(
            (selectBubble.get(`bubbleId:${composerId}:${entry.serverBubbleId}`) || { value: null }).value,
          );
        }
        if (!bubble) continue;
        const tokenCount = bubble.tokenCount;
        if (!tokenCount || typeof tokenCount !== "object") continue;
        const input = Number(tokenCount.inputTokens) || 0;
        const output = Number(tokenCount.outputTokens) || 0;
        inputTokens += input;
        outputTokens += output;
      }

      sessions.push({
        composerId,
        name: headerName(headerJson, composerId),
        createdAtMs: Number(header.createdAt) || null,
        lastUpdatedAtMs: Number(header.lastUpdatedAt) || null,
        firstBubbleAtMs: firstAtMs,
        lastBubbleAtMs: lastAtMs,
        turns: { user: userTurns, ai: aiTurns },
        bubblesInDb: conversationHeaders.length,
        bubblesAggregated: Math.min(window.length, conversationHeaders.length),
        inputTokens,
        outputTokens,
        truncated: conversationHeaders.length > MAX_BUBBLES_PER_SESSION,
      });
    }

    return { sessions, scanned: headers.length, skipped };
  } finally {
    db.close();
  }
}

module.exports = { parseComposerSessions, DEFAULT_SESSION_LIMIT, MAX_BUBBLES_PER_SESSION };
