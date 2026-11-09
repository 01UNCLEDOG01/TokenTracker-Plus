const fs = require("node:fs/promises");
const { createHash } = require("node:crypto");
const { StringDecoder } = require("node:string_decoder");
const { setImmediate: yieldToRequests } = require("node:timers/promises");

const CHUNK_BYTES = 64 * 1024;

function signature(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
}

// One in-flight read per path shares the dashboard's request fan-out. Parsing
// yields between bounded chunks so a cold/replaced queue cannot monopolize the
// HTTP event loop. Keep committed newline-terminated rows separate from a tail
// that a concurrent writer may still be completing.
//
// The queue is an append log, so a later row for the same key normally supersedes
// an earlier one. `resolve(existing, incoming)` lets a reader narrow that rule
// when a later append can legitimately carry no data for the key.
function createAsyncQueueReader({ parseRow, resolve, label, maxEntries = 4 }) {
  const keep = typeof resolve === "function" ? resolve : (existing, incoming) => incoming;
  const cache = new Map();
  const pending = new Map();

  const HASH_CHUNK_BYTES = 512 * 1024;
  const HASH_YIELD_BYTES = 2 * 1024 * 1024;
  async function hashPrefix(file, length) {
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    let position = 0;
    let bytesSinceYield = 0;
    while (position < length) {
      const { bytesRead } = await file.read(buffer, 0, Math.min(HASH_CHUNK_BYTES, length - position), position);
      if (!bytesRead) throw new Error("Queue truncated during validation");
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      bytesSinceYield += bytesRead;
      if (bytesSinceYield >= HASH_YIELD_BYTES) {
        bytesSinceYield = 0;
        await yieldToRequests();
      }
    }
    return hash;
  }

  async function fastSampledHash(file, length) {
    if (length <= 1024 * 1024) {
      return (await hashPrefix(file, length)).digest("hex");
    }
    const sampleSize = 64 * 1024;
    const buf = Buffer.allocUnsafe(sampleSize);
    const hash = createHash("sha256");
    hash.update(String(length));
    const headRead = await file.read(buf, 0, Math.min(sampleSize, length), 0);
    hash.update(buf.subarray(0, headRead.bytesRead));
    const tailPos = Math.max(0, length - sampleSize);
    const tailRead = await file.read(buf, 0, Math.min(sampleSize, length - tailPos), tailPos);
    hash.update(buf.subarray(0, tailRead.bytesRead));
    return hash.digest("hex");
  }

  async function load(queuePath) {
    let cached = cache.get(queuePath);
    if (!cached) {
      try {
        const snapPath = `${queuePath}.snapshot.json`;
        const snapRaw = await fs.readFile(snapPath, "utf8");
        const snap = JSON.parse(snapRaw);
        if (snap?.identity && snap?.size && snap.consumedBytes > 0) {
          cached = {
            signature: snap.signature, identity: snap.identity, size: snap.size,
            consumedBytes: snap.consumedBytes, digest: snap.digest,
            committedDigest: snap.committedDigest, sampleDigest: snap.sampleDigest,
            committedSampleDigest: snap.committedSampleDigest,
            seen: new Map(snap.seenEntries || []), rows: snap.rows || [],
          };
          cache.set(queuePath, cached);
        }
      } catch {}
    }
    let file;
    try {
      file = await fs.open(queuePath, "r");
      // Stat the opened file, rather than a path which can be atomically replaced
      // between stat and open. Its signature always describes the bytes we read.
      const stat = await file.stat({ bigint: true });
      const nextSignature = signature(stat);
      const identity = `${stat.dev}:${stat.ino}`;
      const size = Number(stat.size);
      if (cached?.signature === nextSignature) {
        // Windows can reuse mtime/ctime for same-size writes anywhere in the
        // file. For small files (<=1MB, including tests), validate exact hash.
        // For large files (>1MB), check fast sampled head+tail hash to avoid multi-second stalls.
        if (size <= 1024 * 1024) {
          const hash = await hashPrefix(file, size);
          if (hash.digest("hex") === cached.digest) return cached.rows;
        } else {
          const sample = await fastSampledHash(file, size);
          if (sample === cached.sampleDigest) return cached.rows;
        }
      }
      let offset = 0;
      let seen = new Map();
      let hash = createHash("sha256");
      if (cached && cached.identity === identity && size > cached.size && cached.consumedBytes > 0) {
        // Growth can include an interior rewrite. For small files (<=1MB), verify prefix hash exactly.
        // For large files (>1MB), verify sampled prefix hash before parsing the tail.
        if (cached.consumedBytes <= 1024 * 1024) {
          const prefixHash = await hashPrefix(file, cached.consumedBytes);
          if (prefixHash.copy().digest("hex") === cached.committedDigest) {
            offset = cached.consumedBytes;
            seen = cached.seen;
            hash = prefixHash;
          }
        } else {
          const sample = await fastSampledHash(file, cached.consumedBytes);
          if (sample === cached.committedSampleDigest) {
            offset = cached.consumedBytes;
            seen = cached.seen;
            hash = createHash("sha256").update(cached.committedDigest);
          }
        }
      }
      let committedHash = hash.copy();

      const changes = new Map();
      let malformed = 0;
      function parse(line, target) {
        if (!line.trim()) return;
        try {
          const entry = parseRow(JSON.parse(line));
          if (entry) target.set(entry.key, keep(target.get(entry.key), entry.row));
        } catch { malformed++; }
      }

      const decoder = new StringDecoder("utf8");
      const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
      let remainder = "";
      let position = offset;
      let consumedBytes = offset;
      while (position < size) {
        const length = Math.min(CHUNK_BYTES, size - position);
        const { bytesRead } = await file.read(buffer, 0, length, position);
        if (!bytesRead) throw new Error("Queue truncated during read");
        const newline = buffer.lastIndexOf(0x0a, bytesRead - 1);
        const chunk = buffer.subarray(0, bytesRead);
        if (newline >= 0) {
          consumedBytes = position + newline + 1;
          committedHash = hash.copy().update(chunk.subarray(0, newline + 1));
        }
        hash.update(chunk);
        position += bytesRead;
        remainder += decoder.write(chunk);
        let start = 0;
        let end;
        while ((end = remainder.indexOf("\n", start)) !== -1) {
          parse(remainder.slice(start, end), changes);
          start = end + 1;
        }
        remainder = remainder.slice(start);
        await yieldToRequests();
      }
      remainder += decoder.end();
      // Both merges re-apply the hook: within a single map parse() already did
      // the comparing, but folding a chunk map into the committed map (or the
      // provisional tail into either) crosses maps.
      for (const [key, row] of changes) seen.set(key, keep(seen.get(key), row));
      const tail = new Map();
      parse(remainder, tail);
      // Legacy files without a final newline are readable, but their provisional
      // key never enters the committed map (completion may change that key).
      let rows;
      if (tail.size) {
        const merged = new Map(seen);
        for (const [key, row] of tail) merged.set(key, keep(merged.get(key), row));
        rows = Array.from(merged.values());
      } else {
        rows = Array.from(seen.values());
      }
      const sampleDigest = size > 1024 * 1024 ? await fastSampledHash(file, size) : null;
      const committedSampleDigest = consumedBytes > 1024 * 1024 ? await fastSampledHash(file, consumedBytes) : null;
      cache.delete(queuePath);
      const snapshotEntry = {
        signature: nextSignature, identity, size, consumedBytes,
        digest: hash.digest("hex"), committedDigest: committedHash.digest("hex"),
        sampleDigest, committedSampleDigest, seen, rows,
      };
      cache.set(queuePath, snapshotEntry);

      const nowMs = Date.now();
      const shouldSaveSnapshot = size > 1024 * 1024 && rows.length > 0 &&
        (!snapshotEntry.lastSnapshotSavedAt || (nowMs - snapshotEntry.lastSnapshotSavedAt > 60000) || (size - (snapshotEntry.lastSnapshotSize || 0) > 128 * 1024));

      if (shouldSaveSnapshot) {
        snapshotEntry.lastSnapshotSavedAt = nowMs;
        snapshotEntry.lastSnapshotSize = size;
        const snapPath = `${queuePath}.snapshot.json`;
        const tmpPath = `${snapPath}.tmp.${Date.now()}`;
        const snapPayload = JSON.stringify({
          signature: nextSignature, identity, size, consumedBytes,
          digest: snapshotEntry.digest, committedDigest: snapshotEntry.committedDigest,
          sampleDigest, committedSampleDigest,
          seenEntries: Array.from(seen.entries()), rows,
        });
        try {
          await fs.writeFile(tmpPath, snapPayload, "utf8");
          await fs.rename(tmpPath, snapPath);
        } catch {
          await fs.unlink(tmpPath).catch(() => {});
        }
      }
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      if (malformed) console.error(`[LocalAPI] ${label}: skipped ${malformed} malformed line(s)`);
      return rows;
    } catch (error) {
      if (error.code === "ENOENT") {
        cache.delete(queuePath);
        fs.unlink(`${queuePath}.snapshot.json`).catch(() => {});
        return [];
      }
      console.error(`[LocalAPI] ${label}: failed to read queue:`, error.message);
      return cached?.rows || [];
    } finally {
      if (file) await file.close();
    }
  }

  return function read(queuePath) {
    if (pending.has(queuePath)) return pending.get(queuePath);
    const task = load(queuePath).finally(() => pending.delete(queuePath));
    pending.set(queuePath, task);
    return task;
  };
}

module.exports = { createAsyncQueueReader };
