"use strict";

// Local-only usage snapshot transfer. A single-machine fork has no cloud to
// sync through, so moving usage between machines means exporting a JSON
// snapshot and importing it on the other side. The rules are deliberately
// conservative: preview first, never overwrite an existing (source, model,
// hour) key, cap the payload, and refuse a snapshot exported by this machine.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BYTES = 5 * 1024 * 1024;
const SNAPSHOT_KIND = "tokentracker-local-usage";
const SNAPSHOT_VERSION = 1;

function trackerDir(home = os.homedir()) {
  const override = process.env.TOKENTRACKER_HOME;
  if (override) return path.join(path.resolve(override), "tracker");
  return path.join(home, ".tokentracker", "tracker");
}

function queuePath(home) {
  return path.join(trackerDir(home), "queue.jsonl");
}

function readMachine(home) {
  const file = path.join(trackerDir(home), "transfer-identity.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed.id === "string" && parsed.id) return parsed;
  } catch { /* create below */ }
  const machine = {
    id: crypto.randomBytes(8).toString("hex"),
    name: os.hostname() || "this-machine",
    created_at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(machine));
  } catch { /* read-only home: keep the ephemeral id */ }
  return machine;
}

function readRows(home) {
  const raw = fs.readFileSync(queuePath(home), "utf8");
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && row.source && row.model && row.hour_start) rows.push(row);
    } catch { /* skip malformed */ }
  }
  return rows;
}

function queueSignature(home) {
  try {
    const stat = fs.statSync(queuePath(home));
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

function buildSnapshot({ home } = {}) {
  const machine = readMachine(home);
  const rows = readRows(home);
  const snapshot = {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    exported_at: new Date().toISOString(),
    machine: { id: machine.id, name: machine.name },
    rows,
  };
  const size = Buffer.byteLength(JSON.stringify(snapshot));
  if (size > MAX_BYTES) {
    const err = new Error("snapshot too large");
    err.code = "too_large";
    throw err;
  }
  return { snapshot, bytes: size };
}

function rowKey(row) {
  return `${String(row.source).toLowerCase()}|${row.model}|${row.hour_start}`;
}

function validateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") throw Object.assign(new Error("bad snapshot"), { code: "invalid_snapshot" });
  if (snapshot.kind !== SNAPSHOT_KIND || snapshot.version !== SNAPSHOT_VERSION) {
    throw Object.assign(new Error("unsupported snapshot"), { code: "invalid_snapshot" });
  }
  if (!snapshot.machine || typeof snapshot.machine.id !== "string" || !snapshot.machine.id) {
    throw Object.assign(new Error("missing machine"), { code: "invalid_snapshot" });
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length === 0) {
    throw Object.assign(new Error("empty snapshot"), { code: "invalid_snapshot" });
  }
  const size = Buffer.byteLength(JSON.stringify(snapshot));
  if (size > MAX_BYTES) throw Object.assign(new Error("snapshot too large"), { code: "too_large" });
  for (const row of snapshot.rows) {
    if (!row || !row.source || !row.model || !row.hour_start) {
      throw Object.assign(new Error("bad row"), { code: "invalid_queue" });
    }
  }
}

function previewSnapshot(snapshot, { home } = {}) {
  validateSnapshot(snapshot);
  const machine = readMachine(home);
  if (snapshot.machine.id === machine.id) {
    throw Object.assign(new Error("self import"), { code: "self_import" });
  }
  const existing = new Set(readRows(home).map(rowKey));
  const seen = new Set();
  let fresh = 0;
  let duplicate = 0;
  for (const row of snapshot.rows) {
    const key = rowKey(row);
    if (existing.has(key) || seen.has(key)) duplicate += 1;
    else {
      seen.add(key);
      fresh += 1;
    }
  }
  const token = crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshot))
    .update(queueSignature(home))
    .digest("hex");
  return {
    machine: snapshot.machine,
    exported_at: snapshot.exported_at,
    rows: snapshot.rows.length,
    fresh,
    duplicate,
    before: existing.size,
    after: existing.size + fresh,
    token,
  };
}

function importSnapshot(snapshot, token, { home } = {}) {
  const preview = previewSnapshot(snapshot, { home });
  if (!token || token !== preview.token) {
    throw Object.assign(new Error("preview changed"), { code: "preview_changed" });
  }
  const qp = queuePath(home);
  const existing = new Set(readRows(home).map(rowKey));
  const append = [];
  for (const row of snapshot.rows) {
    const key = rowKey(row);
    if (existing.has(key)) continue;
    existing.add(key);
    append.push(JSON.stringify(row));
  }
  if (append.length) {
    const backup = `${qp}.bak-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-import`;
    fs.copyFileSync(qp, backup);
    fs.appendFileSync(qp, `${append.join("\n")}\n`);
  }
  return { imported: append.length, skipped: snapshot.rows.length - append.length, before: preview.before, after: existing.size };
}

function describeLocalUsage({ home } = {}) {
  const machine = readMachine(home);
  const rows = readRows(home);
  let bytes = 0;
  try { bytes = fs.statSync(queuePath(home)).size; } catch { /* missing */ }
  return { machine: { id: machine.id, name: machine.name }, rows: rows.length, bytes, max_bytes: MAX_BYTES };
}

module.exports = {
  MAX_BYTES,
  SNAPSHOT_KIND,
  SNAPSHOT_VERSION,
  trackerDir,
  buildSnapshot,
  previewSnapshot,
  importSnapshot,
  describeLocalUsage,
  rowKey,
};
