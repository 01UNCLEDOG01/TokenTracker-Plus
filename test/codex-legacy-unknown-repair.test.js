"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  codexLegacyUnknownHours,
  planCodexLegacyUnknownRetractions,
  repairCodexLegacyUnknownDuplicates,
  CODEX_LEGACY_UNKNOWN_REPAIR_KEY,
} = require("../src/commands/sync");
const { parseRolloutIncremental } = require("../src/lib/rollout");

const HOUR = "2026-08-11T19:00:00.000Z";
const HOUR_2 = "2026-08-11T20:00:00.000Z";

function row(source, model, hourStart, totals) {
  return {
    source,
    model,
    hour_start: hourStart,
    input_tokens: totals.input || 0,
    cached_input_tokens: totals.cached || 0,
    cache_creation_input_tokens: 0,
    output_tokens: totals.output || 0,
    reasoning_output_tokens: totals.reasoning || 0,
    total_tokens: totals.total || 0,
    billable_total_tokens: totals.total || 0,
    total_cost_usd: 0,
    conversation_count: totals.conv || 0,
  };
}

async function latestRows(queuePath, source = "codex") {
  const rows = new Map();
  const raw = await fs.readFile(queuePath, "utf8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (parsed.source !== source) continue;
    rows.set(`${parsed.model}|${parsed.hour_start}`, parsed);
  }
  return rows;
}

test("legacy hours are exactly the groups whose only bucket is unknown", () => {
  const hourly = {
    buckets: {
      [`codex|unknown|${HOUR}`]: { totals: { total_tokens: 100 } },
      [`codex|deepseek-v4-flash|${HOUR_2}`]: { totals: { total_tokens: 20 } },
      [`codex|unknown|${HOUR_2}`]: { totals: { total_tokens: 10 } },
      [`claude|unknown|${HOUR}`]: { totals: { total_tokens: 5 } },
    },
  };
  assert.deepEqual([...codexLegacyUnknownHours(hourly)], [HOUR]);
});

test("only unknown rows that duplicate summed or single model rows are retracted", () => {
  const rowsByHour = new Map([
    [HOUR, new Map([
      ["unknown", row("codex", "unknown", HOUR, { input: 30, cached: 60, total: 70, conv: 3 })],
      ["gpt-5.6-sol", row("codex", "gpt-5.6-sol", HOUR, { input: 10, total: 30, conv: 1 })],
      ["deepseek-v4-flash", row("codex", "deepseek-v4-flash", HOUR, { input: 30, cached: 60, total: 70, conv: 3 })],
    ])],
    [HOUR_2, new Map([
      ["unknown", row("codex", "unknown", HOUR_2, { input: 7, total: 30, conv: 3 })],
      ["gpt-5.6-sol", row("codex", "gpt-5.6-sol", HOUR_2, { input: 2, total: 10, conv: 1 })],
      ["deepseek-v4-flash", row("codex", "deepseek-v4-flash", HOUR_2, { input: 5, total: 20, conv: 2 })],
    ])],
  ]);
  assert.deepEqual(
    planCodexLegacyUnknownRetractions(new Set([HOUR, HOUR_2]), rowsByHour),
    [HOUR, HOUR_2],
  );

  const genuine = new Map([
    ["unknown", row("codex", "unknown", HOUR, { input: 7, total: 7, conv: 1 })],
    ["deepseek-v4-flash", row("codex", "deepseek-v4-flash", HOUR, { input: 5, total: 20, conv: 1 })],
  ]);
  assert.deepEqual(
    planCodexLegacyUnknownRetractions(new Set([HOUR]), new Map([[HOUR, genuine]])),
    [],
  );

  const onlyUnknown = new Map([
    ["unknown", row("codex", "unknown", HOUR, { input: 5, total: 20, conv: 1 })],
  ]);
  assert.deepEqual(
    planCodexLegacyUnknownRetractions(new Set([HOUR]), new Map([[HOUR, onlyUnknown]])),
    [],
  );
});

test("repair appends zero retractions for duplicated legacy unknown rows only", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codex-legacy-unknown-"));
  try {
    const queuePath = path.join(dir, "queue.jsonl");
    await fs.writeFile(queuePath, [
      row("codex", "unknown", HOUR, { input: 40, cached: 60, total: 100, conv: 1 }),
      row("codex", "deepseek-v4-flash", HOUR, { input: 40, cached: 60, total: 100, conv: 1 }),
      row("codex", "unknown", HOUR_2, { input: 5, cached: 5, total: 10, conv: 1 }),
      row("codex", "deepseek-v4-flash", HOUR_2, { input: 10, cached: 10, total: 20, conv: 1 }),
      row("claude", "unknown", HOUR, { input: 1, total: 1, conv: 1 }),
    ].map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");

    const cursors = {
      hourly: {
        version: 3,
        modelAttributionPolicy: { codex: "observed" },
        buckets: {
          [`codex|unknown|${HOUR}`]: { totals: { total_tokens: 100 }, queuedKey: "100|0|0|0|0|100|100|0|1" },
          [`codex|unknown|${HOUR_2}`]: { totals: { total_tokens: 10 }, queuedKey: "5|5|0|0|0|10|10|0|1" },
        },
        groupQueued: {},
      },
      migrations: {},
    };

    assert.equal(await repairCodexLegacyUnknownDuplicates({ cursors, queuePath }), true);
    const rows = await latestRows(queuePath);
    assert.equal(rows.get(`unknown|${HOUR}`).total_tokens, 0);
    assert.equal(rows.get(`deepseek-v4-flash|${HOUR}`).total_tokens, 100);
    // Genuine unattributed tokens (10 vs the 20 model tokens) stay.
    assert.equal(rows.get(`unknown|${HOUR_2}`).total_tokens, 10);
    assert.equal(await latestRows(queuePath, "claude").then((m) => m.get(`unknown|${HOUR}`).total_tokens), 1);
    assert.equal(cursors.migrations[CODEX_LEGACY_UNKNOWN_REPAIR_KEY].retracted, 1);
    assert.equal(cursors.hourly.buckets[`codex|unknown|${HOUR}`], undefined);
    assert.ok(cursors.hourly.buckets[`codex|unknown|${HOUR_2}`]);

    const size = (await fs.stat(queuePath)).size;
    assert.equal(await repairCodexLegacyUnknownDuplicates({ cursors, queuePath }), false);
    assert.equal((await fs.stat(queuePath)).size, size);

    // The observed parser must not re-emit the bucket it still considers queued.
    const settle = await parseRolloutIncremental({ rolloutFiles: [], cursors, queuePath });
    assert.equal(settle.bucketsQueued, 0);
    assert.equal((await fs.stat(queuePath)).size, size);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a previously zeroed legacy hour still loses its stale bucket", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codex-legacy-unknown-zeroed-"));
  try {
    const queuePath = path.join(dir, "queue.jsonl");
    await fs.writeFile(queuePath, [
      row("codex", "unknown", HOUR, { input: 0, cached: 0, total: 0, conv: 0 }),
      row("codex", "deepseek-v4-flash", HOUR, { input: 40, cached: 60, total: 100, conv: 1 }),
    ].map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
    const cursors = {
      hourly: {
        version: 3,
        modelAttributionPolicy: { codex: "observed" },
        buckets: {
          [`codex|unknown|${HOUR}`]: { totals: { total_tokens: 100 }, queuedKey: "old" },
        },
        groupQueued: {},
      },
      migrations: {},
    };
    const size = (await fs.stat(queuePath)).size;
    assert.equal(await repairCodexLegacyUnknownDuplicates({ cursors, queuePath }), true);
    assert.equal((await fs.stat(queuePath)).size, size);
    assert.equal(cursors.hourly.buckets[`codex|unknown|${HOUR}`], undefined);
    assert.equal(cursors.migrations[CODEX_LEGACY_UNKNOWN_REPAIR_KEY].retracted, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("pending upgrade with no legacy buckets does not burn the migration key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codex-legacy-unknown-pending-empty-"));
  try {
    const queuePath = path.join(dir, "queue.jsonl");
    await fs.writeFile(queuePath, "", "utf8");
    const cursors = {
      hourly: {
        version: 1,
        buckets: {},
        groupQueued: { [`codex|${HOUR}`]: "old-group-key" },
      },
      migrations: {},
    };
    assert.equal(await repairCodexLegacyUnknownDuplicates({ cursors, queuePath }), false);
    assert.equal(cursors.migrations[CODEX_LEGACY_UNKNOWN_REPAIR_KEY], undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("a still-pending observed upgrade does not burn the migration key", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codex-legacy-unknown-pending-"));
  try {
    const queuePath = path.join(dir, "queue.jsonl");
    await fs.writeFile(queuePath, [
      row("codex", "unknown", HOUR, { input: 5, cached: 5, total: 10, conv: 1 }),
      row("codex", "deepseek-v4-flash", HOUR, { input: 10, cached: 10, total: 20, conv: 1 }),
    ].map((value) => JSON.stringify(value)).join("\n") + "\n", "utf8");
    const cursors = {
      hourly: {
        version: 2,
        buckets: {
          [`codex|unknown|${HOUR}`]: { totals: { total_tokens: 10 }, queuedKey: null },
        },
        groupQueued: { [`codex|${HOUR}`]: "old-group-key" },
      },
      migrations: {},
    };
    // Genuine unattributed tokens (10 vs 20 model tokens): nothing to retract.
    assert.equal(await repairCodexLegacyUnknownDuplicates({ cursors, queuePath }), false);
    assert.equal(cursors.migrations[CODEX_LEGACY_UNKNOWN_REPAIR_KEY], undefined);
    assert.ok(cursors.hourly.buckets[`codex|unknown|${HOUR}`]);

    // Once the upgrade settles, the same scan may finalize.
    cursors.hourly.modelAttributionPolicy = { codex: "observed" };
    delete cursors.hourly.groupQueued[`codex|${HOUR}`];
    assert.equal(await repairCodexLegacyUnknownDuplicates({ cursors, queuePath }), true);
    assert.equal(cursors.migrations[CODEX_LEGACY_UNKNOWN_REPAIR_KEY].retracted, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
