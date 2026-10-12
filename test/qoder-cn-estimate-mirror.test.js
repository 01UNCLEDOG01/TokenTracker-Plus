"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  qoderCnEstimatedRows,
  qoderCnLimitsCacheFile,
  qoderCnEstimateMirrorFile,
} = require("../src/lib/qoder-cn-estimate");

function sandbox(cacheBody) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qcn-mirror-"));
  const dir = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(dir, { recursive: true });
  if (cacheBody !== undefined) {
    fs.writeFileSync(qoderCnLimitsCacheFile({ home }), JSON.stringify({ qoder: cacheBody }));
  }
  return home;
}

const healthy = {
  cached_at: "2026-10-12T00:00:00Z",
  spend: {
    est_anchor: { tokens: 17235393, messages: 467, from: "2026-07-20", to: "2026-07-22" },
    daily: [
      { date: "2026-10-01", messages: 120 },
      { date: "2026-10-02", messages: 80, by_model: { "Qwen3.8-Flash": 60, "Auto": 20 } },
    ],
  },
};

test("a warm limits cache writes the mirror", () => {
  const home = sandbox(healthy);
  try {
    const rows = qoderCnEstimatedRows([], { home });
    assert.ok(rows.length > 0, "the estimate produced rows");
    const mirror = JSON.parse(fs.readFileSync(qoderCnEstimateMirrorFile({ home }), "utf8"));
    assert.deepEqual(mirror.rows.map((r) => r.total_tokens).sort(), rows.map((r) => r.total_tokens).sort());
    assert.equal(mirror.version, 2);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a missing limits cache keeps the numbers instead of collapsing", () => {
  const home = sandbox(healthy);
  try {
    const warm = qoderCnEstimatedRows([], { home });
    fs.rmSync(qoderCnLimitsCacheFile({ home }));
    const cold = qoderCnEstimatedRows([], { home });
    assert.deepEqual(cold.map((r) => [r.model, r.hour_start, r.total_tokens]),
      warm.map((r) => [r.model, r.hour_start, r.total_tokens]),
      "the card must not change when the cache goes away");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a failed fetch that empties the cache does not wipe the mirror", () => {
  const home = sandbox(healthy);
  try {
    const warm = qoderCnEstimatedRows([], { home });
    fs.writeFileSync(qoderCnLimitsCacheFile({ home }), JSON.stringify({
      qoder: { cached_at: "2026-10-12T01:00:00Z", spend: { est_anchor: {}, daily: [] } },
    }));
    const after = qoderCnEstimatedRows([], { home });
    assert.equal(after.length, warm.length, "the last good numbers survive a bad response");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("locally recorded tokens still suppress the estimate, warm or cold", () => {
  const home = sandbox(healthy);
  try {
    const local = [{
      source: "qoder-cn", model: "Qwen3.8-Flash", hour_start: "2026-10-01T04:00:00.000Z",
      total_tokens: 999999999999,
    }];
    const warm = qoderCnEstimatedRows(local, { home });
    assert.equal(warm.filter((r) => String(r.hour_start).startsWith("2026-10-01")).length, 0,
      "a day with local ground truth is never estimated on top");
    fs.rmSync(qoderCnLimitsCacheFile({ home }));
    assert.deepEqual(qoderCnEstimatedRows(local, { home }), warm,
      "the same suppression applies on the cold path");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("an empty derivation never erases a good mirror", () => {
  const home = sandbox(healthy);
  try {
    const warm = qoderCnEstimatedRows([], { home });
    assert.ok(warm.length > 0);
    // Same cache, but now the ledger holds ground truth for every estimated day,
    // so the derivation legitimately returns nothing. The mirror must keep the
    // numbers it already had rather than be overwritten with an empty set.
    const local = warm.map((r) => ({
      source: "qoder-cn", model: r.model, hour_start: r.hour_start,
      total_tokens: r.total_tokens + 1,
    }));
    assert.equal(qoderCnEstimatedRows(local, { home }).length, 0, "nothing left to estimate");
    const mirror = JSON.parse(fs.readFileSync(qoderCnEstimateMirrorFile({ home }), "utf8"));
    assert.equal(mirror.rows.length, warm.length, "the mirror survived the empty derivation");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("estimated rows carry the local input/cached/output split, not zeros", () => {
  const home = sandbox(healthy);
  try {
    // The rows Qoder CN froze in 2026-07 still carry a real split; reusing it
    // is what keeps the card's "86% cache hit" line on the same scale as the
    // headline instead of two orders of magnitude below it.
    const local = [
      { source: "qoder-cn", model: "qmodel_preview", hour_start: "2026-07-20T04:00:00.000Z",
        total_tokens: 1000, billable_total_tokens: 1000,
        input_tokens: 136, cached_input_tokens: 858, cache_creation_input_tokens: 0,
        output_tokens: 6, reasoning_output_tokens: 0, total_cost_usd: 0, conversation_count: 0 },
    ];
    const rows = qoderCnEstimatedRows(local, { home });
    assert.ok(rows.length > 0, "the estimate produced rows");
    const sum = (field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
    const total = sum("total_tokens");
    assert.ok(total > 0, "the estimate has a total");
    assert.ok(sum("input_tokens") > 0, "input_tokens must not stay at zero");
    assert.ok(sum("cached_input_tokens") > 0, "cached_input_tokens must not stay at zero");
    assert.equal(
      sum("input_tokens") + sum("cached_input_tokens") + sum("output_tokens"),
      total,
      "the component fields must sum back to the total",
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a cold mirror with no split is upgraded the same way the warm path splits", () => {
  const home = sandbox(healthy);
  try {
    const warm = qoderCnEstimatedRows([], { home });
    assert.ok(warm.length > 0);
    const fieldSums = (rows, field) => rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
    // The warm rows carry no split because no local shape was supplied.
    assert.equal(fieldSums(warm, "input_tokens"), fieldSums(warm, "total_tokens"),
      "without a local shape everything lands in input_tokens");
    fs.rmSync(qoderCnLimitsCacheFile({ home }));
    const cold = qoderCnEstimatedRows([], { home });
    assert.deepEqual(cold.map((r) => [r.model, r.hour_start, r.total_tokens, r.input_tokens]),
      warm.map((r) => [r.model, r.hour_start, r.total_tokens, r.input_tokens]),
      "the cold path must not invent a different split than the warm one");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a cold cache with no mirror yields nothing and does not throw", () => {
  const home = sandbox(undefined);
  try {
    assert.deepEqual(qoderCnEstimatedRows([], { home }), []);
    assert.equal(fs.existsSync(qoderCnEstimateMirrorFile({ home })), false,
      "an empty derivation must not create a mirror");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
