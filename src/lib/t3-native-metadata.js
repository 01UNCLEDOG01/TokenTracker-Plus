"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_TITLES = new Set(["new thread", "start a new conversation"]);

function t3Home({ home = os.homedir(), env = process.env } = {}) {
  const configured = String(env.T3CODE_HOME || "").trim();
  if (configured === "~") return home;
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return path.join(home, configured.slice(2));
  }
  return configured ? path.resolve(configured) : path.join(home, ".t3");
}

function discoverT3Databases(options = {}) {
  const root = t3Home(options);
  return [...new Set([
    path.join(root, "userdata", "statev2.sqlite"),
    path.join(root, "userdata", "state.sqlite"),
    path.join(root, "dev", "userdata", "statev2.sqlite"),
    path.join(root, "dev", "userdata", "state.sqlite"),
    path.join(root, "dev", "statev2.sqlite"),
    path.join(root, "dev", "state.sqlite"),
  ])].filter((file) => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  });
}

function cleanTitle(value) {
  if (typeof value !== "string") return null;
  const chars = Array.from(value.replace(/\s+/g, " ").trim());
  if (!chars.length || DEFAULT_TITLES.has(chars.join("").toLowerCase())) return null;
  return chars.length <= 96 ? chars.join("") : `${chars.slice(0, 95).join("")}…`;
}

function readProviderBindings(dbPath) {
  const bindings = new Map();
  try {
    const settings = JSON.parse(
      fs.readFileSync(path.join(path.dirname(dbPath), "settings.json"), "utf8"),
    );
    for (const [id, instance] of Object.entries(settings.providerInstances || {})) {
      if (instance?.driver !== "acpRegistry" || !instance?.config || Array.isArray(instance.config)) continue;
      const agentId = String(instance.config.agentId || "").toLowerCase();
      if (agentId === "kiro") bindings.set(id, "kiro");
      else if (agentId.includes("antigravity")) bindings.set(id, "antigravity");
    }
  } catch {
    /* No sidecar settings: direct drivers still match below. */
  }
  return bindings;
}

function accountingClient(row, bindings) {
  const driver = String(row?.driver || "").toLowerCase();
  if (driver === "antigravity" || driver === "kiro") return driver;
  if (driver === "acpregistry") return bindings.get(String(row?.provider_instance_id || "")) || null;
  return null;
}

function readT3NativeMetadata(nativeIds, {
  home = os.homedir(),
  env = process.env,
  dbPaths = discoverT3Databases({ home, env }),
} = {}) {
  const wanted = new Set(Array.from(nativeIds || []).map(String).filter(Boolean));
  const result = new Map();
  if (!wanted.size || !dbPaths.length) return result;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require("node:sqlite"));
  } catch {
    return result;
  }

  for (const dbPath of dbPaths) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const tables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => String(row.name)),
      );
      if (!tables.has("orchestration_v2_projection_threads")
        || !tables.has("orchestration_v2_projection_provider_threads")) continue;
      const threadColumns = new Set(
        db.prepare("PRAGMA table_info(orchestration_v2_projection_threads)").all().map((row) => String(row.name)),
      );
      const providerColumns = new Set(
        db.prepare("PRAGMA table_info(orchestration_v2_projection_provider_threads)").all().map((row) => String(row.name)),
      );
      if (!threadColumns.has("thread_id") || !threadColumns.has("title")
        || !providerColumns.has("thread_id") || !providerColumns.has("driver")
        || !providerColumns.has("payload_json")) continue;
      const instanceSelect = providerColumns.has("provider_instance_id")
        ? "p.provider_instance_id"
        : "NULL";
      const strength = `(CASE WHEN json_valid(p.payload_json)
        THEN json_extract(p.payload_json, '$.nativeThreadRef.strength') END)`;
      const nativeId = `(CASE WHEN json_valid(p.payload_json)
        THEN json_extract(p.payload_json, '$.nativeThreadRef.nativeId') END)`;
      const parentThread = `(CASE WHEN json_valid(t.payload_json)
        THEN json_extract(t.payload_json, '$.lineage.parentThreadId') END)`;
      const rows = db.prepare(`
        SELECT p.driver, ${instanceSelect} AS provider_instance_id,
          ${nativeId} AS native_id, p.thread_id, t.title,
          ${parentThread} AS parent_thread_id
        FROM orchestration_v2_projection_provider_threads p
        JOIN orchestration_v2_projection_threads t ON t.thread_id = p.thread_id
        WHERE ${nativeId} IS NOT NULL
          AND ${strength} = 'strong'
          ${threadColumns.has("deleted_at") ? "AND t.deleted_at IS NULL" : ""}
      `).all();
      const bindings = readProviderBindings(dbPath);
      const byThread = new Map();
      for (const row of rows) {
        const client = accountingClient(row, bindings);
        const id = typeof row.native_id === "string" ? row.native_id.trim() : "";
        if (!client || !id) continue;
        byThread.set(`${client}\0${row.thread_id}`, row);
      }
      for (const row of rows) {
        const client = accountingClient(row, bindings);
        const id = typeof row.native_id === "string" ? row.native_id.trim() : "";
        if (!client || !id || !wanted.has(id)) continue;
        const title = cleanTitle(row.title);
        const parent = row.parent_thread_id
          ? byThread.get(`${client}\0${row.parent_thread_id}`)
          : null;
        const metadata = {
          title,
          parentSessionId: parent?.native_id || null,
          threadId: row.thread_id,
          client,
        };
        const key = `${client}\0${id}`;
        const previous = result.get(key);
        if (!previous || (metadata.title && !previous.title)) result.set(key, metadata);
      }
    } catch {
      /* Missing/locked/incompatible T3 stores are non-fatal. */
    } finally {
      try { db?.close(); } catch { /* non-fatal */ }
    }
  }
  return result;
}

module.exports = {
  cleanTitle,
  discoverT3Databases,
  readT3NativeMetadata,
  t3Home,
};
