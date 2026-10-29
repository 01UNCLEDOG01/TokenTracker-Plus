"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  parseMagpieIncremental,
  resolveMagpieUsageLogPath,
} = require("../src/lib/rollout.js");

// Magpie (yetone/magpie) appends one JSON row per gateway round trip to
// ~/.config/magpie/usage.jsonl. Counters are disjoint: `in` is fresh prompt
// tokens, `cache_read`/`cache_write` are separate, `out` is the completion.
// Probe rows carry a `kind` (model_list / provider_test / api_detect) and are
// not usage, whatever their status. Non-2xx rows carry no billed counters.

function row(overrides = {}) {
  return {
    t: "2026-10-29T03:41:32.4064335+08:00",
    agent: "Python-urllib",
    provider: "agent2api",
    host: "127.0.0.1:3065",
    model: "glm-5.3-flash",
    req: "agent2api/glm-5.3-flash",
    served: "glm-5.3-flash",
    in: 1000,
    out: 200,
    cache_read: 5000,
    cache_write: 300,
    ms: 700,
    status: 200,
    ep: "/v1/messages",
    ...overrides,
  };
}

function writeLog(filePath, rows, { trailingNewline = true, pad = "" } = {}) {
  const body = rows.map((entry) => JSON.stringify(entry)).join("\n");
  fs.writeFileSync(filePath, body + (rows.length && trailingNewline ? "\n" : "") + pad);
}

function readQueueRows(queuePath) {
  const raw = fs.readFileSync(queuePath, "utf8").trim();
  return raw ? raw.split(/\n/).map((line) => JSON.parse(line)) : [];
}

test("magpie parser counts only billed gateway round trips with disjoint counters", async () => {
  const dir = mkdtemp();
  try {
    const logPath = path.join(dir, "usage.jsonl");
    const queuePath = path.join(dir, "queue.jsonl");
    writeLog(logPath, [
      row({ in: 1000, out: 200, cache_read: 5000, cache_write: 300 }),
      // Same half-hour bucket, a second success.
      row({ in: 10, out: 5, cache_read: 0, cache_write: 0 }),
      // Probe/control rows: never usage.
      row({ kind: "model_list", model: "", in: 0, out: 0, cache_read: 0, cache_write: 0 }),
      row({ kind: "provider_test", source: "probe", in: 0, out: 0, cache_read: 0, cache_write: 0 }),
      // Failure with counters: not billed, must be skipped.
      row({ status: 500, in: 999, out: 999 }),
      // 200 but empty round trip.
      row({ in: 0, out: 0, cache_read: 0, cache_write: 0 }),
      // A client that self-meters (its own ledger has input+cache) → dropped
      // from the gateway card: the client's ledger already counts it.
      row({ agent: "deepseek-harness", in: 700, out: 70, cache_read: 0, cache_write: 0 }),
      // ZCode cannot self-certify input for self-added providers → credited
      // to the zcode card instead of dropped.
      row({ agent: "ZCode", in: 900, out: 90, cache_read: 0, cache_write: 0 }),
      // Claude Code cannot self-certify behind a gateway (input 0 in its
      // transcripts) → credited to the claude card.
      row({ agent: "claude-code", model: "glm-5.3-flash", served: "glm-5.3-flash", in: 300, out: 30, cache_read: 0, cache_write: 0 }),
    ]);
    fs.appendFileSync(logPath, "{not json}\n");

    const cursors = {};
    const first = await parseMagpieIncremental({ logPath, cursors, queuePath });
    assert.equal(first.recordsProcessed, 9, "nine parseable rows (probes/failures included)");
    assert.equal(first.eventsAggregated, 4, "two magpie rows + one zcode credit + one claude credit");
    assert.equal(first.bucketsQueued, 3);

    const rows = readQueueRows(queuePath);
    assert.equal(rows.length, 3);
    const queued = rows.find((entry) => entry.source === "magpie");
    const credited = rows.find((entry) => entry.source === "claude");
    const zcode = rows.find((entry) => entry.source === "zcode");
    assert.equal(queued.source, "magpie");
    assert.equal(queued.model, "glm-5.3-flash");
    assert.equal(queued.hour_start, "2026-10-28T19:30:00.000Z", "03:41+08:00 is the 19:30Z half-hour");
    assert.equal(queued.input_tokens, 1010);
    assert.equal(queued.cached_input_tokens, 5000);
    assert.equal(queued.cache_creation_input_tokens, 300);
    assert.equal(queued.output_tokens, 205);
    assert.equal(queued.total_tokens, 6515);
    assert.equal(
      queued.total_tokens,
      queued.input_tokens + queued.cached_input_tokens + queued.cache_creation_input_tokens + queued.output_tokens,
    );
    assert.equal(queued.conversation_count, 2);
    assert.equal(credited.source, "claude", "Claude Code gateway rows land on the claude card");
    assert.equal(credited.total_tokens, 330);
    assert.equal(credited.conversation_count, 0, "credit adds no conversation");
    assert.equal(zcode.total_tokens, 900, "ZCode rows land on the zcode card, input-only");
    assert.ok(
      !rows.some((entry) => entry.source === "magpie" && entry.input_tokens === 900),
      "ZCode rows must not reach the gateway card",
    );
    assert.ok(
      !rows.some((entry) => entry.input_tokens === 700),
      "deepseek-harness rows are dropped entirely",
    );

    assert.equal(cursors.magpie.version, 1);
    assert.ok(cursors.magpie.size > 0);

    // Re-running without new bytes must not re-aggregate.
    const second = await parseMagpieIncremental({ logPath, cursors, queuePath });
    assert.equal(second.recordsProcessed, 0);
    assert.equal(second.eventsAggregated, 0);
    assert.equal(readQueueRows(queuePath).length, 3, "no buckets re-emitted, no new rows");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("magpie parser leaves a partial tail unconsumed and picks it up once complete", async () => {
  const dir = mkdtemp();
  try {
    const logPath = path.join(dir, "usage.jsonl");
    const queuePath = path.join(dir, "queue.jsonl");
    const full = JSON.stringify(row({ in: 7, out: 3, cache_read: 0, cache_write: 0 }));
    const cut = Math.floor(full.length / 2);
    fs.writeFileSync(logPath, full.slice(0, cut));

    const cursors = {};
    const first = await parseMagpieIncremental({ logPath, cursors, queuePath });
    assert.equal(first.eventsAggregated, 0, "a half-written line is not counted");
    assert.equal(cursors.magpie.size, 0, "no complete line has been consumed");

    fs.writeFileSync(logPath, full + "\n");
    const second = await parseMagpieIncremental({ logPath, cursors, queuePath });
    assert.equal(second.eventsAggregated, 1);
    const [queued] = readQueueRows(queuePath);
    assert.equal(queued.input_tokens, 7);
    assert.equal(queued.output_tokens, 3);
    assert.equal(queued.total_tokens, 10);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("magpie parser restarts from 0 when the log is truncated or replaced", async () => {
  const dir = mkdtemp();
  try {
    const logPath = path.join(dir, "usage.jsonl");
    const queuePath = path.join(dir, "queue.jsonl");
    writeLog(logPath, [row({ in: 100, out: 10 }), row({ in: 200, out: 20 })]);
    const cursors = {};
    const first = await parseMagpieIncremental({ logPath, cursors, queuePath });
    assert.equal(first.eventsAggregated, 2);

    // A rotation/rewrite leaves a smaller file; the cursor must reset instead
    // of resuming past the end and silently counting nothing.
    writeLog(logPath, [row({ in: 5, out: 1, t: "2026-10-30T10:00:00+08:00" })]);
    const second = await parseMagpieIncremental({ logPath, cursors, queuePath });
    assert.equal(second.eventsAggregated, 1);
    const rows = readQueueRows(queuePath);
    assert.ok(rows.some((entry) => entry.hour_start === "2026-10-30T02:00:00.000Z" && entry.input_tokens === 5));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("magpie log path honours TOKENTRACKER_MAGPIE_LOG and defaults to the XDG config dir", () => {
  const home = path.join(os.tmpdir(), "tt-magpie-home");
  const env = { USERPROFILE: home, APPDATA: path.join(home, "AppData", "Roaming") };
  assert.equal(
    resolveMagpieUsageLogPath({ home, env }),
    path.join(home, ".config", "magpie", "usage.jsonl"),
  );
  const override = path.join(home, "custom", "usage.jsonl");
  assert.equal(
    resolveMagpieUsageLogPath({ home, env: { ...env, TOKENTRACKER_MAGPIE_LOG: override } }),
    path.resolve(override),
  );
});

function mkdtemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tt-magpie-"));
}
