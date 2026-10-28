"use strict";

// persistQoderEstimateRows: the watermark-guarded bridge that lands the
// read-time qoder estimate fold into the upload queue. Guards three
// behaviors the cloud parity depends on: first run lands the full history,
// re-runs are no-ops (the watermark), and once the rows are in the queue the
// read-time folds retire themselves so no day is ever counted twice.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { persistQoderEstimateRows, readAllQueueRows } = require("../src/lib/qoder-estimate-upload");
const { qoderCnLimitsCacheFile, qoderCnEstimateMirrorFile, qoderCnEstimatedRows } = require("../src/lib/qoder-cn-estimate");
const { qoderIntlCreditMirrorFile, QODER_INTL_MIRROR_VERSION } = require("../src/lib/qoder-intl-credits");

// A queue row with REAL tokens (no 估算 suffix) for the given Beijing day.
function realRow(hourStart, totalTokens) {
  return {
    source: "qoder-cn",
    model: "qoder-cn-model",
    hour_start: hourStart,
    input_tokens: totalTokens,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    conversation_count: 1,
  };
}

const HEALTHY_SPEND = {
  cached_at: "2026-10-16T01:00:00Z",
  qoder: {
    spend: {
      est_anchor: { tokens: 17235393, messages: 467, from: "2026-07-20", to: "2026-07-22" },
      daily: [
        { date: "2026-10-01", messages: 120 },
        { date: "2026-10-02", messages: 80, by_model: { "Qwen3.8-Flash": 60, "Auto": 20 } },
      ],
    },
  },
};

function sandbox(files = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-qoder-est-"));
  const trackerDir = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(trackerDir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return home;
}

function intlMirror(rows) {
  return { version: QODER_INTL_MIRROR_VERSION, synced_at: "2026-10-16T00:00:00Z", signature: ["mirror"], rows };
}

const INTL_ROWS = [
  {
    source: "qoder", model: "GLM-5.3-Flash", day: "2026-10-05",
    hour_start: "2026-10-05T04:00:00.000Z",
    input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: 64000, billable_total_tokens: 64000,
    total_cost_usd: 1.2, conversation_count: 3,
  },
  {
    source: "qoder", model: "DeepSeek-V4.1-Flash", day: "2026-10-06",
    hour_start: "2026-10-06T04:00:00.000Z",
    input_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    output_tokens: 0, reasoning_output_tokens: 0,
    total_tokens: 12000, billable_total_tokens: 12000,
    total_cost_usd: 0.4, conversation_count: 1,
  },
];

test("first run lands the full estimate history into the queue", async () => {
  const home = sandbox({ "qoder-cn-usage-limits-cache.json": HEALTHY_SPEND, "qoder-intl-credit-rows.json": intlMirror(INTL_ROWS) });
  const queuePath = path.join(home, "queue.jsonl");
  // A pre-existing placeholder qoder-cn row (tokens recorded as zero) and an
  // unrelated row — neither may suppress the estimate.
  fs.writeFileSync(queuePath, [
    JSON.stringify({ source: "qoder-cn", model: "dfmodel", hour_start: "2026-09-01T04:00:00.000Z", total_tokens: 0, conversation_count: 5 }),
    JSON.stringify({ source: "codex", model: "gpt-6", hour_start: "2026-10-01T00:30:00.000Z", total_tokens: 1000 }),
  ].join("\n") + "\n");
  const statePath = path.join(home, "qoder-estimate.upload.json");

  try {
    const first = await persistQoderEstimateRows({ queuePath, statePath, projectsDir: path.join(home, "absent-projects"), home });
    assert.ok(first.cnAppended > 0, "cn estimate rows landed");
    assert.equal(first.intlAppended, 2, "intl mirror rows landed");
    assert.equal(first.appended, first.cnAppended + first.intlAppended);

    const queueRows = await readAllQueueRows(queuePath);
    const cnDays = new Set(queueRows.filter((r) => r.source === "qoder-cn").map((r) => r.hour_start.slice(0, 10)));
    assert.ok(cnDays.has("2026-10-01") && cnDays.has("2026-10-02"), "both estimate days landed");
    const intlRows = queueRows.filter((r) => r.source === "qoder");
    assert.equal(intlRows.length, 2, "intl rows landed once each");
    assert.ok(intlRows.every((r) => Number(r.total_cost_usd) > 0), "intl rows carry the money");

    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.cn_day, "2026-10-02");
    assert.equal(state.intl_day, "2026-10-06");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("second run is a no-op and the folds retire so nothing double-counts", async () => {
  const home = sandbox({ "qoder-cn-usage-limits-cache.json": HEALTHY_SPEND, "qoder-intl-credit-rows.json": intlMirror(INTL_ROWS) });
  const queuePath = path.join(home, "queue.jsonl");
  const statePath = path.join(home, "qoder-estimate.upload.json");
  try {
    await persistQoderEstimateRows({ queuePath, statePath, projectsDir: path.join(home, "absent-projects"), home });
    const sizeAfterFirst = fs.statSync(queuePath).size;

    // Watermark: nothing new, nothing appended.
    const second = await persistQoderEstimateRows({ queuePath, statePath, projectsDir: path.join(home, "absent-projects"), home });
    assert.equal(second.appended, 0);
    assert.equal(fs.statSync(queuePath).size, sizeAfterFirst, "the queue must not grow");

    // The read-time fold reads the queue again (now carrying the landed rows)
    // and must retire: the local per-day totals cover the estimate exactly.
    const landed = await readAllQueueRows(queuePath);
    const { qoderCnEstimatedRows } = require("../src/lib/qoder-cn-estimate");
    const { qoderIntlCreditRows } = require("../src/lib/qoder-intl-credits");
    assert.equal(qoderCnEstimatedRows(landed, { home }).length, 0, "cn fold retires on shortfall 0");
    assert.equal(qoderIntlCreditRows(landed, { projectsDir: path.join(home, "absent-projects"), home }).length, 0, "intl fold retires on reported spend");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a newer estimate day appends incrementally past the watermark", async () => {
  const home = sandbox({ "qoder-cn-usage-limits-cache.json": HEALTHY_SPEND, "qoder-intl-credit-rows.json": intlMirror(INTL_ROWS) });
  const queuePath = path.join(home, "queue.jsonl");
  const statePath = path.join(home, "qoder-estimate.upload.json");
  try {
    await persistQoderEstimateRows({ queuePath, statePath, projectsDir: path.join(home, "absent-projects"), home });
    const queueRowsAfterFirst = await readAllQueueRows(queuePath);
    const cnCountAfterFirst = (day) => queueRowsAfterFirst.filter((r) => r.source === "qoder-cn" && r.hour_start.startsWith(day)).length;

    const newer = JSON.parse(JSON.stringify(HEALTHY_SPEND));
    newer.qoder.spend.daily.push({ date: "2026-10-03", messages: 50 });
    fs.writeFileSync(qoderCnLimitsCacheFile({ home }), JSON.stringify(newer));

    const third = await persistQoderEstimateRows({ queuePath, statePath, projectsDir: path.join(home, "absent-projects"), home });
    assert.equal(third.cnAppended, 1, "only the new day landed");
    assert.equal(third.intlAppended, 0, "intl watermark holds");
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    assert.equal(state.cn_day, "2026-10-03");

    const queueRows = await readAllQueueRows(queuePath);
    for (const day of ["2026-10-01", "2026-10-02"]) {
      const now = queueRows.filter((r) => r.source === "qoder-cn" && r.hour_start.startsWith(day)).length;
      assert.equal(now, cnCountAfterFirst(day), `older day ${day} was not rewritten`);
    }
    assert.ok(queueRows.filter((r) => r.source === "qoder-cn" && r.hour_start.startsWith("2026-10-03")).length >= 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a local anchor only silences its own measurement days, not the gaps between them", () => {
  const home = sandbox({});
  try {
    // Daily feed: two days carry real local tokens (they form the anchor),
    // one day inside the anchor span has nothing locally (a gap), one day is
    // outside the span.
    const spend = {
      cached_at: "2026-10-16T01:00:00Z",
      qoder: {
        spend: {
          daily: [
            { date: "2026-10-01", messages: 100 },
            { date: "2026-10-02", messages: 50 },
            { date: "2026-10-03", messages: 40 },
            { date: "2026-10-05", messages: 30 },
          ],
        },
      },
    };
    fs.writeFileSync(qoderCnLimitsCacheFile({ home }), JSON.stringify(spend));
    const rows = [
      realRow("2026-10-01T04:00:00.000Z", 1000),
      realRow("2026-10-05T04:00:00.000Z", 2000),
    ];
    const estimated = qoderCnEstimatedRows(rows, { home });
    const days = estimated.map((row) => String(row.hour_start).slice(0, 10));
    // The two anchor days are ground truth; the gap day inside the span and the
    // day outside it are still estimated.
    assert.ok(!days.includes("2026-10-01"), "an anchor day is never estimated");
    assert.ok(!days.includes("2026-10-05"), "an anchor day is never estimated");
    assert.ok(days.includes("2026-10-02"), "a gap inside the anchor span is still estimated");
    assert.ok(days.includes("2026-10-03"), "a gap inside the anchor span is still estimated");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("anchor-window days and cold caches produce no rows", async () => {
  // Days inside the anchor window are ground truth locally — never estimated.
  const anchored = JSON.parse(JSON.stringify(HEALTHY_SPEND));
  anchored.qoder.spend.daily = [{ date: "2026-07-21", messages: 100 }];
  const homeA = sandbox({ "qoder-cn-usage-limits-cache.json": anchored });
  const stateA = path.join(homeA, "qoder-estimate.upload.json");
  try {
    const resultA = await persistQoderEstimateRows({ queuePath: path.join(homeA, "queue.jsonl"), statePath: stateA, projectsDir: path.join(homeA, "absent"), home: homeA });
    assert.equal(resultA.cnAppended, 0, "anchor-window days are never estimated");
  } finally {
    fs.rmSync(homeA, { recursive: true, force: true });
  }

  // Cold cache with no mirror: nothing to land, and no state written.
  const homeB = sandbox({});
  const stateB = path.join(homeB, "qoder-estimate.upload.json");
  try {
    const resultB = await persistQoderEstimateRows({ queuePath: path.join(homeB, "queue.jsonl"), statePath: stateB, projectsDir: path.join(homeB, "absent"), home: homeB });
    assert.equal(resultB.appended, 0);
    assert.ok(!fs.existsSync(stateB), "no watermark is written without rows");
  } finally {
    fs.rmSync(homeB, { recursive: true, force: true });
  }
});
