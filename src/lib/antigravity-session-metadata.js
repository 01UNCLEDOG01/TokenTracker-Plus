"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

const SUMMARY_MAX_CODE_POINTS = 96;
const RUNNING_STALE_MS = 10 * 60_000;
const summaryCache = new Map();

function cleanSummaryTitle(value) {
  if (typeof value !== "string") return null;
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  if (!chars.length) return null;
  return chars.length <= SUMMARY_MAX_CODE_POINTS
    ? chars.join("")
    : `${chars.slice(0, SUMMARY_MAX_CODE_POINTS - 1).join("")}…`;
}

function catalogTime(value) {
  if (typeof value !== "string" || !value.trim()) return 0;
  const ms = Date.parse(value.includes(" ") ? value.replace(" ", "T") : value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function firstWorkspacePath(value) {
  if (!value) return null;
  let uris = value;
  if (typeof value === "string") {
    try {
      uris = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(uris)) return null;
  for (const uri of uris) {
    if (typeof uri !== "string" || !uri.trim()) continue;
    try {
      const parsed = new URL(uri);
      if (parsed.protocol === "file:") return fileURLToPath(parsed);
    } catch {
      /* Ignore a malformed workspace URI; one valid sibling can still win. */
    }
  }
  return null;
}

function summaryDbForConversationDb(conversationDbPath) {
  const root = path.dirname(path.dirname(conversationDbPath));
  return path.join(root, "conversation_summaries.db");
}

function fileStamp(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}:${stat.mtimeMs}`;
  } catch (error) {
    return error?.code === "ENOENT" ? "" : null;
  }
}

function readSummaryRows(summaryDbPath) {
  const stamp = `${fileStamp(summaryDbPath)}|${fileStamp(`${summaryDbPath}-wal`)}`;
  if (!stamp) return new Map();
  const cached = summaryCache.get(summaryDbPath);
  if (cached?.stamp === stamp) return cached.rows;
  let db;
  const rows = new Map();
  try {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(summaryDbPath, { readOnly: true });
    const columns = new Set(
      db.prepare("PRAGMA table_info(conversation_summaries)").all().map((row) => String(row.name)),
    );
    if (!columns.has("conversation_id")) return rows;
    const selected = [
      "conversation_id",
      "title",
      "preview",
      "agent_name",
      "status",
      "not_fully_idle",
      "last_user_input_time",
      "last_modified_time",
      "workspace_uris",
      "parent_conversation_id",
    ].filter((column) => columns.has(column));
    for (const row of db.prepare(
      `SELECT ${selected.join(",")} FROM conversation_summaries`,
    ).all()) {
      const id = typeof row.conversation_id === "string" ? row.conversation_id.trim() : "";
      if (id) rows.set(id, row);
    }
  } catch {
    return rows;
  } finally {
    try { db?.close(); } catch { /* A failed close must not fail collection. */ }
  }
  summaryCache.set(summaryDbPath, { stamp, rows });
  while (summaryCache.size > 64) summaryCache.delete(summaryCache.keys().next().value);
  return rows;
}

function normalizeTurn(row, nowMs = Date.now()) {
  const status = typeof row?.status === "string" ? row.status : "";
  const modifiedAt = catalogTime(row?.last_modified_time);
  const inputAt = catalogTime(row?.last_user_input_time);
  if (status === "CASCADE_RUN_STATUS_RUNNING") {
    const activityAt = Math.max(modifiedAt, inputAt);
    if (!activityAt || nowMs - activityAt > RUNNING_STALE_MS) {
      return { liveStatus: "unknown", turnEnded: null, lastActivityAt: modifiedAt, lastUserInputAt: inputAt };
    }
    return { liveStatus: "running", turnEnded: false, lastActivityAt: modifiedAt, lastUserInputAt: inputAt };
  }
  if (status === "CASCADE_RUN_STATUS_IDLE" && Number(row?.not_fully_idle) === 0 && inputAt) {
    return { liveStatus: "idle", turnEnded: true, lastActivityAt: modifiedAt, lastUserInputAt: inputAt };
  }
  return {
    liveStatus: null,
    turnEnded: null,
    lastActivityAt: modifiedAt,
    lastUserInputAt: inputAt,
  };
}

function readAntigravitySessionMetadata({
  conversationDbPath,
  conversationId,
  nowMs = Date.now(),
} = {}) {
  if (!conversationDbPath || !conversationId) return null;
  const summaryDbPath = summaryDbForConversationDb(conversationDbPath);
  const row = readSummaryRows(summaryDbPath).get(conversationId);
  if (!row) return null;
  const turn = normalizeTurn(row, nowMs);
  return {
    title: cleanSummaryTitle(row.title) || cleanSummaryTitle(row.agent_name),
    preview: cleanSummaryTitle(row.preview),
    workspace: firstWorkspacePath(row.workspace_uris),
    parentSessionId: typeof row.parent_conversation_id === "string" && row.parent_conversation_id.trim()
      ? row.parent_conversation_id.trim()
      : null,
    source: "antigravity-conversation-summaries",
    ...turn,
  };
}

module.exports = {
  RUNNING_STALE_MS,
  cleanSummaryTitle,
  firstWorkspacePath,
  normalizeTurn,
  readAntigravitySessionMetadata,
  summaryDbForConversationDb,
};
