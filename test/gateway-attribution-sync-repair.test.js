"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  repairGatewayClientAttribution,
  rebuildAgent2ApiCardFromUnknown,
  parseAgent2ApiIncremental,
  GATEWAY_ATTRIBUTION_REPAIR_KEY,
  AGENT2API_CARD_REBUILD_KEY,
} = require("../src/lib/rollout.js");

const HOUR = "2026-10-16T09:00:00.000Z";
const TS = Date.UTC(2026, 9, 16, 9, 5, 0);

function totals({ input = 0, cached = 0, output = 0, conv = 0 } = {}) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_creation_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + cached + output,
    billable_total_tokens: input + cached + output,
    total_cost_usd: 0,
    conversation_count: conv,
  };
}

function writeDb(dbPath, rows) {
  const db = new DatabaseSync(dbPath);
  // Real schema: `model` (what the parser aliases as upstream_model), plus the
  // explicit `client_model` / `upstream_model` columns the repair reads.
  db.exec(
    "CREATE TABLE requests (row_id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, client TEXT, "
      + "model TEXT, client_model TEXT, upstream_model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, "
      + "cache_read_tokens INTEGER, status INTEGER)",
  );
  const insert = db.prepare(
    "INSERT INTO requests (ts, client, client_model, upstream_model, model, prompt_tokens, completion_tokens, cache_read_tokens, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const row of rows) insert.run(row[0], row[1], row[2], row[3], row[3], row[4], row[5], row[6], row[7]);
  db.close();
}

test("sync repair re-attributes historical agent2api rows exactly once", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-gw-repair-"));
  try {
    const dbPath = path.join(dir, "agent2api.db");
    const queuePath = path.join(dir, "queue.jsonl");
    writeDb(dbPath, [
      // ZCode → leaves agent2api, credits input+cache to zcode.
      [TS, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 300_000, 10_000, 250_000, 200],
      // DSH → leaves agent2api, no credit (its own ledger has it).
      [TS, "deepseek-harness", "sn-deepseek-v4-1-flash", "sn-deepseek-v4-1-flash", 100_000, 5_000, 0, 200],
      // Claude Code → tokens stay, phantom conversation removed.
      [TS, "Claude Code", "deepseek-flash", "deepseek-v4-1-flash", 600_000, 20_000, 500_000, 200],
      // Unknown client → untouched.
      [TS, "other", "glm-5.3-flash", "glm-5.3-flash", 1_000, 100, 0, 200],
    ]);

    const cursors = {
      version: 1,
      migrations: {},
      hourly: {
        version: 3,
        buckets: {
          [`agent2api|glm-5.3-flash|${HOUR}`]: {
            totals: totals({ input: 1_100_000, cached: 1_250_000, output: 60_000, conv: 5 }),
            queuedKey: "old-1",
          },
          [`agent2api|deepseek-v4.1-flash|${HOUR}`]: {
            totals: totals({ input: 100_000, cached: 900_000, output: 20_000, conv: 2 }),
            queuedKey: "old-2",
          },
          [`claude|deepseek-v4.1-flash|${HOUR}`]: {
            totals: totals({ input: 100_000, cached: 500_000, output: 20_000, conv: 3 }),
            queuedKey: "old-3",
          },
        },
      },
    };

    const result = await repairGatewayClientAttribution({ cursors, queuePath, dbPath, maxRowId: 4 });
    assert.equal(result.skipped, false);
    assert.equal(result.removals, 3);
    assert.equal(result.credits, 1);
    assert.equal(result.bucketsQueued, 4);
    assert.ok(cursors.migrations[GATEWAY_ATTRIBUTION_REPAIR_KEY]);

    const rows = fs.readFileSync(queuePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const byKey = Object.fromEntries(rows.map((row) => [`${row.source}|${row.model}|${row.hour_start}`, row]));

    const gateway = byKey[`agent2api|glm-5.3-flash|${HOUR}`];
    assert.equal(gateway.input_tokens, 1_100_000 - 50_000);
    assert.equal(gateway.cached_input_tokens, 1_250_000 - 250_000);
    assert.equal(gateway.output_tokens, 60_000 - 10_000);
    assert.equal(gateway.conversation_count, 4);

    const dshBucket = byKey[`agent2api|deepseek-v4.1-flash|${HOUR}`];
    assert.equal(dshBucket.total_tokens, 1_020_000 - 105_000);

    const claude = byKey[`claude|deepseek-v4.1-flash|${HOUR}`];
    assert.equal(claude.total_tokens, 620_000, "claude tokens unchanged");
    assert.equal(claude.conversation_count, 2, "phantom conversation removed");

    const zcode = byKey[`zcode|glm-5.3-flash|${HOUR}`];
    assert.ok(zcode, "zcode credit bucket appended");
    assert.equal(zcode.input_tokens, 50_000);
    assert.equal(zcode.cached_input_tokens, 250_000);
    assert.equal(zcode.output_tokens, 0, "ZCode's own output is not duplicated");
    assert.equal(zcode.conversation_count, 0);

    // Cursor state carries the same corrected totals, so the next sync cannot
    // re-emit the old numbers.
    assert.equal(cursors.hourly.buckets[`agent2api|glm-5.3-flash|${HOUR}`].totals.input_tokens, 1_050_000);
    assert.equal(cursors.hourly.buckets[`zcode|glm-5.3-flash|${HOUR}`].totals.total_tokens, 300_000);

    // Idempotent: the migration key stops a second pass.
    const again = await repairGatewayClientAttribution({ cursors, queuePath, dbPath, maxRowId: 4 });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already-applied");
    assert.equal(fs.readFileSync(queuePath, "utf8").trim().split("\n").length, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sync repair marks done when the database is absent", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-gw-repair-missing-"));
  try {
    const cursors = { migrations: {}, hourly: { version: 3, buckets: {} } };
    const result = await repairGatewayClientAttribution({
      cursors,
      queuePath: path.join(dir, "queue.jsonl"),
      dbPath: path.join(dir, "absent.db"),
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "no-database");
    assert.equal(cursors.migrations[GATEWAY_ATTRIBUTION_REPAIR_KEY], undefined,
      "an install that adds Agent2API later must still get the repair");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the repair never re-credits rows the current parser already attributed", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-gw-interplay-"));
  try {
    const dbPath = path.join(dir, "agent2api.db");
    const queuePath = path.join(dir, "queue.jsonl");
    writeDb(dbPath, [
      [TS, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 300_000, 10_000, 250_000, 200],
      [TS, "deepseek-harness", "glm-5.3-flash", "glm-5.3-flash", 50_000, 5_000, 0, 200],
      [TS, "Claude Code", "deepseek-flash", "deepseek-v4-1-flash", 600_000, 20_000, 500_000, 200],
    ]);

    // A fresh install has no legacy rows: the parser does the attribution and
    // the repair must stay out of it, or zcode would be credited twice.
    const cursors = { migrations: {}, hourly: { version: 3, buckets: {} } };
    const legacyRowId = Number(cursors.agent2api?.lastRowId) || 0;
    const parsed = await parseAgent2ApiIncremental({ cursors, queuePath, dbPath, env: {} });
    assert.equal(parsed.eventsAggregated, 2, "zcode credit + claude credit; dsh skipped");

    const queueAfterParser = fs.readFileSync(queuePath, "utf8").trim();
    const repair = await repairGatewayClientAttribution({
      cursors, queuePath, dbPath, maxRowId: legacyRowId,
    });
    assert.equal(repair.skipped, true);
    assert.equal(repair.reason, "no-legacy-rows");
    assert.equal(fs.readFileSync(queuePath, "utf8").trim(), queueAfterParser, "queue untouched");

    const rebuild = await rebuildAgent2ApiCardFromUnknown({
      cursors, queuePath, dbPath, queueStatePath: path.join(dir, "queue.state.json"),
    });
    assert.equal(rebuild.skipped, false);
    assert.equal(rebuild.removed, 0, "the parser left no gateway rows to replace");
    assert.equal(rebuild.unknownRows, 0, "every row in this fixture is attributable");
    assert.equal(
      fs.readFileSync(queuePath, "utf8").trim(),
      queueAfterParser,
      "rebuild does not drop rows it did not consume",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the repair only touches rows at or below the legacy ceiling", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-gw-ceiling-"));
  try {
    const dbPath = path.join(dir, "agent2api.db");
    const queuePath = path.join(dir, "queue.jsonl");
    // Rows 1-2 were consumed under the old rule; row 3 arrives after the upgrade.
    writeDb(dbPath, [
      [TS, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 300_000, 10_000, 250_000, 200],
      [TS, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 200_000, 5_000, 150_000, 200],
      [TS + 60_000, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 100_000, 1_000, 90_000, 200],
    ]);
    const cursors = {
      migrations: {},
      agent2api: { version: 1, lastRowId: 2 },
      hourly: {
        version: 3,
        buckets: {
          [`agent2api|glm-5.3-flash|${HOUR}`]: {
            totals: totals({ input: 600_000, cached: 400_000, output: 20_000, conv: 3 }),
          },
        },
      },
    };

    const repair = await repairGatewayClientAttribution({ cursors, queuePath, dbPath, maxRowId: 2 });
    assert.equal(repair.skipped, false);
    const queued = fs.readFileSync(queuePath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const zcode = queued.find((row) => row.source === "zcode");
    // Rows 1-2 only: fresh input 50k+50k, cache 250k+150k. Row 3 belongs to the
    // parser, which credits it itself, so it must not appear here.
    assert.equal(zcode.input_tokens, 100_000);
    assert.equal(zcode.cached_input_tokens, 400_000);
    assert.equal(zcode.output_tokens, 0);
    assert.equal(zcode.total_tokens, 500_000);
    const gateway = queued.find((row) => row.source === "agent2api");
    assert.equal(gateway.input_tokens, 500_000, "600k - 100k of legacy rows");
    assert.equal(gateway.cached_input_tokens, 0, "400k - 400k");
    assert.equal(gateway.output_tokens, 5_000, "20k - 15k");
    assert.equal(gateway.conversation_count, 1, "3 - 2 legacy requests");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("agent2api card rebuild keeps exactly the unattributed rows and drops dead models", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-gw-rebuild-"));
  try {
    const dbPath = path.join(dir, "agent2api.db");
    const queuePath = path.join(dir, "queue.jsonl");
    const queueStatePath = path.join(dir, "queue.state.json");
    writeDb(dbPath, [
      // Unattributed (empty client) → stays on the card.
      [TS, "", "glm-5.3-flash", "glm-5.3-flash", 10_000, 500, 4_000, 200],
      [TS, "other", "spark-x2.6", "spark-x2.6", 2_000, 100, 0, 200],
      // Known clients → must not appear on the card.
      [TS, "ZCode", "glm-5.3-flash", "glm-5.3-flash", 300_000, 10_000, 250_000, 200],
      [TS, "deepseek-harness", "sn-sensenova-6-8-flash", "sn-sensenova-6-8-flash", 100_000, 5_000, 0, 200],
      [TS, "Claude Code", "deepseek-flash", "deepseek-v4-1-flash", 600_000, 20_000, 500_000, 200],
    ]);
    const oldRows = [
      { source: "agent2api", model: "glm-5.3-flash", hour_start: HOUR, total_tokens: 9_999, conversation_count: 9 },
      { source: "agent2api", model: "sn-sensenova-6-8-flash", hour_start: HOUR, total_tokens: 5_555, conversation_count: 5 },
      { source: "zcode", model: "glm-5.3-flash", hour_start: HOUR, total_tokens: 777, conversation_count: 1 },
      { source: "claude", model: "deepseek-v4.1-flash", hour_start: HOUR, total_tokens: 888, conversation_count: 1 },
    ];
    fs.writeFileSync(queuePath, oldRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    fs.writeFileSync(queueStatePath, JSON.stringify({ offset: 1234 }));

    const cursors = {
      migrations: { [GATEWAY_ATTRIBUTION_REPAIR_KEY]: "done" },
      agent2api: { version: 1, lastRowId: 5 },
      hourly: {
        version: 3,
        buckets: {
          [`agent2api|glm-5.3-flash|${HOUR}`]: { totals: totals({ input: 9, output: 1, conv: 9 }) },
          [`agent2api|sn-sensenova-6-8-flash|${HOUR}`]: { totals: totals({ input: 5, output: 1, conv: 5 }) },
          [`zcode|glm-5.3-flash|${HOUR}`]: { totals: totals({ input: 7, output: 1, conv: 1 }) },
        },
      },
    };

    const result = await rebuildAgent2ApiCardFromUnknown({ cursors, queuePath, queueStatePath, dbPath });
    assert.equal(result.skipped, false);
    assert.equal(result.removed, 2, "every historical agent2api row is replaced");
    assert.equal(result.rebuilt, 2, "two unattributed buckets");
    assert.equal(result.models, 2);

    const rows = fs.readFileSync(queuePath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const gateway = rows.filter((row) => row.source === "agent2api");
    assert.equal(gateway.length, 2);
    const glm = gateway.find((row) => row.model === "glm-5.3-flash");
    assert.equal(glm.input_tokens, 6_000);
    assert.equal(glm.cached_input_tokens, 4_000);
    assert.equal(glm.output_tokens, 500);
    assert.equal(glm.total_tokens, 10_500);
    assert.ok(gateway.some((row) => row.model === "spark-x2.6"), "unattributed small model survives");
    assert.ok(!gateway.some((row) => row.model === "sn-sensenova-6-8-flash"), "known-client model is gone");
    assert.ok(rows.some((row) => row.source === "zcode"), "other sources untouched");
    assert.ok(rows.some((row) => row.source === "claude"), "other sources untouched");

    const agent2apiBuckets = Object.keys(cursors.hourly.buckets).filter((key) => key.startsWith("agent2api|"));
    assert.deepEqual(agent2apiBuckets.sort(), [
      `agent2api|glm-5.3-flash|${HOUR}`,
      `agent2api|spark-x2.6|${HOUR}`,
    ].sort());
    assert.equal(JSON.parse(fs.readFileSync(queueStatePath, "utf8")).offset, 0, "byte offset reset after rewrite");

    const again = await rebuildAgent2ApiCardFromUnknown({ cursors, queuePath, queueStatePath, dbPath });
    assert.equal(again.skipped, true);
    assert.equal(again.reason, "already-applied");
    assert.ok(cursors.migrations[AGENT2API_CARD_REBUILD_KEY]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
