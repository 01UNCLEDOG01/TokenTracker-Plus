"use strict";

// Local-only usage snapshot transfer. A single-machine fork has no cloud to
// sync through, so moving usage between machines means exporting a JSON
// snapshot and importing it on the other side. The rules are deliberately
// conservative: preview first, never overwrite an existing (source, model,
// hour) key, cap the payload, and refuse a snapshot exported by this machine.
//
// 2026-11-10: long-lived queues outgrew the one-shot readFileSync — a 540MB
// queue.jsonl blows past Node's max string length (0x1fffffe8) and both the
// settings GET and the export died with ERR_STRING_TOO_LONG. Everything now
// streams the queue line by line, and the export keeps only the newest rows
// that fit the payload cap (truncated snapshot + window metadata) so the same
// UI can page through the remainder with `before` (export older batches).

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const MAX_BYTES = 5 * 1024 * 1024;
const SNAPSHOT_KIND = "tokentracker-local-usage";
const SNAPSHOT_VERSION = 1;
// Headroom for the snapshot envelope (machine id, exported_at, window metadata)
// on top of the serialized rows; keeps the final buffer under maxBytes.
const ENVELOPE_SLACK_BYTES = 4096;
// Rows batched into chunks so the sliding window can drop old data in bulk
// instead of shifting a huge array for every incoming row.
const WINDOW_CHUNK_ROWS = 512;
const READ_CHUNK_BYTES = 1 << 20;

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

function isValidRow(row) {
  return Boolean(row && row.source && row.model && row.hour_start);
}

// Stream the queue without materializing it. visit(row) runs for every valid
// row; malformed lines are skipped exactly like the old readRows did.
// Returns { lines, valid, bytes } — bytes falls back to stat so it stays the
// exact file size even if a line lands mid-write.
async function scanQueue(home, visit) {
  const qp = queuePath(home);
  let bytes = 0;
  try { bytes = fs.statSync(qp).size; } catch { return { lines: 0, valid: 0, bytes: 0 }; }
  let handle;
  try {
    handle = await fsp.open(qp, "r");
  } catch {
    return { lines: 0, valid: 0, bytes: 0 };
  }
  let lines = 0;
  let valid = 0;
  try {
    const stream = handle.createReadStream({ encoding: "utf8", highWaterMark: READ_CHUNK_BYTES });
    let buf = "";
    const handleLine = (line) => {
      if (!line.trim()) return;
      lines += 1;
      try {
        const row = JSON.parse(line);
        if (isValidRow(row)) {
          valid += 1;
          if (visit) visit(row);
        }
      } catch { /* skip malformed */ }
    };
    for await (const chunk of stream) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    }
    if (buf) handleLine(buf);
  } finally {
    await handle.close();
  }
  return { lines, valid, bytes };
}

async function collectExistingKeys(home) {
  const existing = new Set();
  await scanQueue(home, (row) => existing.add(rowKey(row)));
  return existing;
}

function queueSignature(home) {
  try {
    const stat = fs.statSync(queuePath(home));
    return `${stat.size}:${stat.mtimeMs}`;
  } catch {
    return "missing";
  }
}

// Newest-window export: keep appending rows and drop whole chunks from the
// front once the payload budget is exceeded, so the snapshot always carries
// the most recent rows that fit. `before` is an INCLUSIVE hour_start upper
// bound so the UI can page backwards through a queue too large for one file:
// the client passes the previous batch's window.from back in, the boundary
// hour is re-sent and import dedup absorbs the overlap — an exclusive bound
// would silently drop rows of the boundary hour that sat before the window.
async function buildSnapshot({ home, maxBytes = MAX_BYTES, before } = {}) {
  const machine = readMachine(home);
  const budget = Math.max(1024, maxBytes - ENVELOPE_SLACK_BYTES);
  const chunks = [];
  let chunk = [];
  let chunkBytes = 0;
  let windowBytes = 0;
  let selected = 0;

  const dropOverflow = () => {
    while (windowBytes > budget && chunks.length > 1) {
      windowBytes -= chunks.shift().bytes;
    }
  };
  const flushChunk = () => {
    if (!chunk.length) return;
    chunks.push({ rows: chunk, bytes: chunkBytes });
    windowBytes += chunkBytes;
    chunk = [];
    chunkBytes = 0;
    dropOverflow();
  };

  await scanQueue(home, (row) => {
    if (before != null && !(String(row.hour_start) <= before)) return;
    selected += 1;
    const size = Buffer.byteLength(JSON.stringify(row)) + 1;
    chunk.push({ row, size });
    chunkBytes += size;
    if (chunk.length >= WINDOW_CHUNK_ROWS) flushChunk();
  });
  flushChunk();

  const rows = [];
  let rowsBytes = 0;
  for (const c of chunks) {
    for (const item of c.rows) {
      rows.push(item.row);
      rowsBytes += item.size;
    }
  }
  // One chunk always fits the budget by construction; trim defensively
  // instead of shipping an over-cap file if that ever stops holding.
  while (rowsBytes > budget && rows.length) {
    const dropped = rows.shift();
    rowsBytes -= Buffer.byteLength(JSON.stringify(dropped)) + 1;
  }

  const truncated = rows.length < selected;
  const snapshot = {
    kind: SNAPSHOT_KIND,
    version: SNAPSHOT_VERSION,
    exported_at: new Date().toISOString(),
    machine: { id: machine.id, name: machine.name },
    rows,
    total_rows: selected,
    truncated,
  };
  if (rows.length) {
    let from = rows[0].hour_start;
    let to = rows[0].hour_start;
    for (const row of rows) {
      if (String(row.hour_start) < from) from = row.hour_start;
      if (String(row.hour_start) > to) to = row.hour_start;
    }
    snapshot.window = { from, to };
  }
  const size = Buffer.byteLength(JSON.stringify(snapshot));
  if (size > maxBytes) {
    const err = new Error("snapshot too large");
    err.code = "too_large";
    throw err;
  }
  return { snapshot, bytes: size, truncated, total_rows: selected };
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
    if (!isValidRow(row)) {
      throw Object.assign(new Error("bad row"), { code: "invalid_queue" });
    }
  }
}

async function previewSnapshot(snapshot, { home } = {}) {
  validateSnapshot(snapshot);
  const machine = readMachine(home);
  if (snapshot.machine.id === machine.id) {
    throw Object.assign(new Error("self import"), { code: "self_import" });
  }
  const existing = await collectExistingKeys(home);
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

async function importSnapshot(snapshot, token, { home } = {}) {
  const preview = await previewSnapshot(snapshot, { home });
  if (!token || token !== preview.token) {
    throw Object.assign(new Error("preview changed"), { code: "preview_changed" });
  }
  const qp = queuePath(home);
  const existing = await collectExistingKeys(home);
  const append = [];
  for (const row of snapshot.rows) {
    const key = rowKey(row);
    if (existing.has(key)) continue;
    existing.add(key);
    append.push(JSON.stringify(row));
  }
  if (append.length) {
    // Fresh machines have no queue yet — there is nothing to back up.
    if (fs.existsSync(qp)) {
      const backup = `${qp}.bak-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-import`;
      fs.copyFileSync(qp, backup);
    } else {
      fs.mkdirSync(path.dirname(qp), { recursive: true });
    }
    fs.appendFileSync(qp, `${append.join("\n")}\n`);
  }
  return { imported: append.length, skipped: snapshot.rows.length - append.length, before: preview.before, after: existing.size };
}

async function describeLocalUsage({ home } = {}) {
  const machine = readMachine(home);
  const { valid, bytes } = await scanQueue(home);
  return { machine: { id: machine.id, name: machine.name }, rows: valid, bytes, max_bytes: MAX_BYTES };
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
