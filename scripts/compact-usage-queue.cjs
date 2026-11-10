#!/usr/bin/env node
// Usage-queue compaction (owner call 2026-11-11: 得治一下).
//
// queue.jsonl is append-only by contract (kimi-model-repair precedent); the
// same (source, model, hour) bucket is re-appended on every restart/replay, so
// a long-lived queue is ~99% byte-identical duplicates — 540MB on the owner's
// machine for 9k live buckets. This tool rewrites the queue to exactly the
// row set the live readers fold out of it:
//   - usage rows: folded with the REAL reader hooks (local-api readQueueData:
//     normalizeQueueRow + resolveQueueRow), so post-compaction aggregation is
//     provably identical, not "probably identical";
//   - control rows (kind: account_session_state / account_sync_watermark and
//     any other upload-side control record): kept per upload-queue snapshotKey
//     with the same newer-stamp rule, because upload-queue and the cloud
//     ingest edge consume them even though the usage reader skips them.
//
// Safety rails:
//   - holds sync.lock when run as a CLI (same lock the sync loop uses);
//   - verifies the fold is conserved before touching the file: the candidate
//     bytes folded back through readQueueData must equal the pre-compaction
//     rows line-for-line, token sums included; any mismatch aborts with the
//     original untouched;
//   - byte-level backup queue.jsonl.bak-20261111-compact before the atomic swap;
//   - upload cursor: state.offset is reset to 0 when it no longer points at a
//     valid prefix (cloud ingest upserts by the same keys, so a full replay is
//     idempotent; cloud sync is currently disabled on this machine anyway);
//   - reader snapshot cache (.snapshot.json) is removed so the next read
//     rebuilds from the new file.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { openLock } = require("../src/lib/fs");
const { snapshotKey } = require("../src/lib/upload-queue");
const { readQueueData, resolveQueueRow, normalizeQueueRow, queueRowFoldKey } = require("../src/lib/local-api");

const TOKEN_SUM_FIELDS = [
  "input_tokens", "cached_input_tokens", "cache_creation_input_tokens",
  "output_tokens", "reasoning_output_tokens", "total_tokens",
  "billable_total_tokens",
];

function trackerDir() {
  const override = process.env.TOKENTRACKER_HOME;
  if (override) return path.join(path.resolve(override), "tracker");
  return path.join(os.homedir(), ".tokentracker", "tracker");
}

function sumTokens(rows) {
  const sums = {};
  for (const field of TOKEN_SUM_FIELDS) sums[field] = 0;
  for (const row of rows) {
    for (const field of TOKEN_SUM_FIELDS) sums[field] += Number(row?.[field]) || 0;
  }
  return sums;
}

// Control rows keep the upload-side rule: per snapshotKey, the strictly newer
// stamp wins (verifiedMs null rows keep their first observation).
function foldControlRows(lines) {
  const kept = new Map();
  let order = 0;
  for (const { bytes, snapshot } of lines) {
    if (snapshot == null) continue;
    order += 1;
    const previous = kept.get(snapshot.key);
    if (!previous || (snapshot.verifiedMs !== null && snapshot.verifiedMs > previous.verifiedMs)) {
      kept.set(snapshot.key, { bytes, verifiedMs: snapshot.verifiedMs, order });
    }
  }
  return [...kept.values()].sort((a, b) => a.order - b.order).map((entry) => entry.bytes);
}

async function scanControlLines(queuePath) {
  const controlLines = [];
  const handle = await fsp.open(queuePath, "r");
  try {
    const stream = handle.createReadStream({ encoding: "utf8", highWaterMark: 1 << 20 });
    let buf = "";
    for await (const chunk of stream) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (!row || typeof row !== "object") continue;
        // Usage rows carry an hour bucket and no kind field; everything else
        // is a control record that upload-queue/cloud consume separately.
        if (!Object.hasOwn(row, "kind")) continue;
        const snapshot = snapshotKey(Buffer.from(line + "\n", "utf8"));
        if (snapshot != null) controlLines.push({ bytes: line + "\n", snapshot });
      }
    }
  } finally {
    await handle.close();
  }
  return controlLines;
}

// Fold with the reader's exact semantics (raw fold key from queueRowFoldKey,
// resolveQueueRow on normalize()-ed rows) while remembering each fold key's
// winning RAW line. The reader's fold over these survivors reproduces
// rowsBefore exactly: same keys, same winner, nothing new to merge.
async function foldRawSurvivors(queuePath) {
  const survivors = new Map(); // foldKey -> { raw: string, norm: row }
  const order = [];
  const handle = await fsp.open(queuePath, "r");
  try {
    const stream = handle.createReadStream({ encoding: "utf8", highWaterMark: 1 << 20 });
    let buf = "";
    for await (const chunk of stream) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        if (!row || typeof row !== "object") continue;
        const key = queueRowFoldKey(row);
        if (key === null) continue; // control rows handled separately
        const norm = normalizeQueueRow(row);
        const existing = survivors.get(key);
        const winner = resolveQueueRow(existing?.norm, norm);
        if (winner === norm) {
          if (!existing) order.push(key);
          survivors.set(key, { raw: line + "\n", norm });
        }
      }
    }
  } finally {
    await handle.close();
  }
  const rawSurvivors = order.map((key) => Buffer.from(survivors.get(key).raw, "utf8"));
  const rowsBefore = order.map((key) => survivors.get(key).norm);
  return { rawSurvivors, rowsBefore };
}

// Core compaction, exported for tests: sandbox queues run the exact same path
// as the live machine. holdLock receives a release callback when run as a CLI.
async function compactUsageQueue({ queuePath, statePath, log = () => {}, holdLock } = {}) {
  const stat = fs.statSync(queuePath);
  log(`[compact] queue: ${queuePath} (${(stat.size / 1e6).toFixed(1)} MB)`);
  try {
    // 1) Fold with the live reader hooks, but KEEP THE RAW SURVIVING LINE for
    //    output: writing normalize()-ed rows back would collapse model-alias
    //    keys (normalize merges aliases; the fold key is the RAW field) and
    //    change row counts on the next read — the 2026-11-11 verification
    //    catch. resolveQueueRow decides on normalized rows, exactly like the
    //    reader does; we just store the winner's original bytes.
    const { rawSurvivors, rowsBefore } = await foldRawSurvivors(queuePath);
    if (!Array.isArray(rowsBefore) || rowsBefore.length === 0) {
      throw new Error("reader produced no rows — refusing to compact an empty/failed read");
    }
    const controlLines = await scanControlLines(queuePath);
    const controlBytes = foldControlRows(controlLines);
    log(`[compact] folded rows: ${rowsBefore.length}; control rows kept: ${controlBytes.length}`);

    // 2) Build the compacted file: control rows first (readers skip them),
    //    then one normalized line per folded usage row.
    const outLines = [
      ...controlBytes.map((bytes) => bytes.toString("utf8").replace(/\n$/, "")),
      ...rowsBefore.map((row) => JSON.stringify(row)),
    ];
    const payload = outLines.join("\n") + "\n";

    // 3) Verify equivalence on the candidate bytes BEFORE touching anything.
    const verifyPath = `${queuePath}.compact-verify-${process.pid}`;
    await fsp.writeFile(verifyPath, payload, "utf8");
    const rowsAfter = await readQueueData(verifyPath);
    const sumsBefore = sumTokens(rowsBefore);
    const sumsAfter = sumTokens(rowsAfter);
    const beforeJson = JSON.stringify(rowsBefore);
    const afterJson = JSON.stringify(rowsAfter);
    let ok = rowsAfter.length === rowsBefore.length && beforeJson === afterJson;
    for (const field of TOKEN_SUM_FIELDS) {
      if (sumsBefore[field] !== sumsAfter[field]) ok = false;
    }
    if (!ok) {
      const diffs = TOKEN_SUM_FIELDS.filter((field) => sumsBefore[field] !== sumsAfter[field])
        .map((field) => `${field}: ${sumsBefore[field]} -> ${sumsAfter[field]}`);
      throw new Error(`verification FAILED (rows ${rowsBefore.length} -> ${rowsAfter.length})${diffs.length ? "; " + diffs.join("; ") : ""}`);
    }
    await fsp.unlink(verifyPath).catch(() => {});
    log("[compact] verification passed: folded rows byte-equivalent, token sums conserved.");

    // 4) Backup + atomic swap.
    const backup = `${queuePath}.bak-20261111-compact`;
    if (!fs.existsSync(backup)) {
      await fsp.copyFile(queuePath, backup);
      log(`[compact] backup: ${backup}`);
    } else {
      log(`[compact] backup already exists, not overwriting: ${backup}`);
    }
    const tmpPath = `${queuePath}.compact.${process.pid}`;
    await fsp.writeFile(tmpPath, payload, "utf8");
    await fsp.rename(tmpPath, queuePath);
    log(`[compact] new size: ${(Buffer.byteLength(payload) / 1e6).toFixed(2)} MB (was ${(stat.size / 1e6).toFixed(1)} MB)`);

    // 5) Invalidate the reader snapshot cache; reset the upload cursor when
    //    the old offset no longer fits the new file (cloud ingest upserts by
    //    the same keys, so a full replay is idempotent).
    await fsp.unlink(`${queuePath}.snapshot.json`).catch(() => {});
    let state = {};
    try { state = JSON.parse(await fsp.readFile(statePath, "utf8")); } catch { /* fresh */ }
    if (Number(state.offset) > 0) {
      state.offset = 0;
      state.updatedAt = new Date().toISOString();
      await fsp.writeFile(statePath, JSON.stringify(state, null, 1), "utf8");
      log("[compact] upload offset reset to 0 (full replay; cloud upserts are idempotent).");
    } else {
      log("[compact] upload offset already 0 — nothing to reset.");
    }

    // 6) Post-swap sanity: the live reader must fold the new file to the same
    //    rows once more (cache invalidated by the new signature).
    const rowsRecheck = await readQueueData(queuePath);
    if (JSON.stringify(rowsRecheck) !== beforeJson) {
      throw new Error("POST-SWAP MISMATCH — restore from the backup and investigate");
    }
    log(`[compact] done. Reader re-verified post-swap: ${rowsRecheck.length} rows identical.`);
    return {
      rowsBefore: rowsBefore.length,
      rowsRecheck: rowsRecheck.length,
      controlKept: controlBytes.length,
      oldBytes: stat.size,
      newBytes: Buffer.byteLength(payload),
    };
  } finally {
    if (typeof holdLock === "function") await holdLock();
  }
}

async function main() {
  const dir = trackerDir();
  const queuePath = path.join(dir, "queue.jsonl");
  const statePath = path.join(dir, "queue.state.json");
  const lock = await openLock(path.join(dir, "sync.lock"), { quietIfLocked: true });
  if (!lock) {
    console.error("[compact] sync.lock is held by another process — retry when sync is idle.");
    process.exit(1);
  }
  try {
    const result = await compactUsageQueue({
      queuePath,
      statePath,
      log: (line) => console.log(line),
      holdLock: async () => { await lock.close?.(); },
    });
    console.log(`[compact] summary: ${result.rowsBefore} rows (${result.controlKept} control) / ${(result.oldBytes / 1e6).toFixed(1)} MB -> ${(result.newBytes / 1e6).toFixed(2)} MB`);
  } catch (error) {
    console.error("[compact] failed:", error?.message || error);
    process.exitCode = 1;
  } finally {
    // close() is idempotent-safe via holdLock; a second close is a no-op.
    await lock.close?.().catch?.(() => {}) ?? undefined;
  }
}

module.exports = { compactUsageQueue, scanControlLines, sumTokens, trackerDir, TOKEN_SUM_FIELDS };

if (require.main === module) {
  main();
}
