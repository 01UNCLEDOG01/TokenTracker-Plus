"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  applyAccountViewQoderIntlMerge,
  buildCostBuckets,
} = require("../src/lib/qoder-intl-account-merge");

// Payload shapes below were read off the live account=1 responses, not written
// from imagination: summary totals and breakdown totals are 6-decimal strings,
// daily cost is a number, daily models is a model->tokens map.
function sandbox(records) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qintl-merge-"));
  const projectsDir = path.join(home, "projects", "C--work");
  fs.mkdirSync(projectsDir, { recursive: true });
  if (records) {
    fs.writeFileSync(
      path.join(projectsDir, "sess-1.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n",
    );
  }
  return { home, projectsDir };
}

const credit = (timestamp, value) => ({
  type: "assistant",
  timestamp,
  message: { role: "assistant", model: "qfmodel", usage: { input_tokens: 0, output_tokens: 0, credits: value } },
});

function merge(slug, payload, fixture, params = [["from", "2026-10-01"], ["to", "2026-10-31"]]) {
  return applyAccountViewQoderIntlMerge(slug, payload, {
    queueRows: [],
    projectsDir: fixture.projectsDir,
    home: fixture.home,
    // A Map stands in for URLSearchParams so the window can be moved per test.
    searchParams: new Map(params),
  });
}

test("the credit spend joins the cloud hero total without touching tokens", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 100)]);
  try {
    const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 5000, total_cost_usd: "50.000000" } };
    const out = merge("tokentracker-usage-summary", payload, fixture);
    assert.equal(out.totals.total_cost_usd, "51.000000");
    assert.equal(out.totals.total_tokens, 5000, "credits never become invented tokens");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("the credit spend joins an existing cloud day and its model map at zero", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 25)]);
  try {
    const payload = {
      data: [
        { day: "2026-10-08", total_tokens: 10, billable_total_tokens: 10, total_cost_usd: 1.5, models: { "gpt-5": 10 } },
        { day: "2026-10-09", total_tokens: 20, billable_total_tokens: 20, total_cost_usd: 2.5, models: { "gpt-5": 20 } },
      ],
    };
    const out = merge("tokentracker-usage-daily", payload, fixture);
    const day = out.data.find((d) => d.day === "2026-10-09");
    assert.equal(day.total_cost_usd, 2.75, "daily cost stays a number and adds to what the cloud reported");
    assert.equal(day.total_tokens, 20);
    assert.equal(day.models["官方云端（积分）"], 0, "the model map is token-valued, so this edition joins at zero");
    assert.equal(out.data[0].total_cost_usd, 1.5, "another day is not credited twice");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("a missing cloud day is inserted in day order with money and no tokens", () => {
  const fixture = sandbox([credit("2026-10-05T06:00:00.000Z", 10), credit("2026-10-11T06:00:00.000Z", 20)]);
  try {
    const payload = { data: [{ day: "2026-10-09", total_tokens: 5, billable_total_tokens: 5, total_cost_usd: 1, models: {} }] };
    const out = merge("tokentracker-usage-daily", payload, fixture);
    assert.deepEqual(out.data.map((d) => d.day), ["2026-10-05", "2026-10-09", "2026-10-11"]);
    assert.equal(out.data[0].total_cost_usd, 0.1);
    assert.equal(out.data[0].total_tokens, 0);
    assert.equal(out.data[2].total_cost_usd, 0.2);
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("the credit spend becomes its own source card in the cloud breakdown", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 40)]);
  try {
    const payload = {
      sources: [
        {
          source: "claude",
          source_scope: "cloud",
          totals: { total_tokens: 100, total_cost_usd: "9.000000" },
          models: [{ model: "sonnet", model_id: "sonnet", cost_source: "model_pricing", totals: { total_tokens: 100, total_cost_usd: "9.000000" } }],
        },
      ],
    };
    const out = merge("tokentracker-usage-model-breakdown", payload, fixture);
    const qoder = out.sources.find((s) => s.source === "qoder");
    assert.ok(qoder, "the card must exist in the cross-device view too");
    assert.equal(qoder.totals.total_cost_usd, "0.400000");
    assert.equal(qoder.totals.total_tokens, 0);
    assert.equal(qoder.models.length, 1);
    assert.equal(qoder.models[0].model, "官方云端（积分）");
    assert.equal(qoder.models[0].cost_source, "provider_reported");
    assert.equal(qoder.models[0].pricing.status, "unpriced", "no model price is claimed for a credit bill");
    assert.equal(out.sources[0].totals.total_cost_usd, "9.000000", "the other card is untouched");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("a cloud source that already lists qoder money is added to, not replaced", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 5)]);
  try {
    const payload = {
      sources: [{
        source: "qoder",
        source_scope: "cloud",
        totals: { total_tokens: 0, total_cost_usd: "1.000000" },
        models: [{ model: "官方云端（积分）", model_id: "官方云端（积分）", cost_source: "provider_reported", totals: { total_tokens: 0, total_cost_usd: "1.000000" } }],
      }],
    };
    const out = merge("tokentracker-usage-model-breakdown", payload, fixture);
    assert.equal(out.sources.length, 1, "one card, not two");
    assert.equal(out.sources[0].totals.total_cost_usd, "1.050000");
    assert.equal(out.sources[0].models.length, 1);
    assert.equal(out.sources[0].models[0].totals.total_cost_usd, "1.050000");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("payloads without a cost field are left alone rather than given one", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 5)]);
  try {
    for (const [slug, payload] of [
      ["tokentracker-usage-monthly", { data: [{ month: "2026-10", total_tokens: 10, models: {} }] }]
      , ["tokentracker-usage-hourly", { day: "2026-10-09", data: [{ hour: "2026-10-09T12:00:00", total_tokens: 3, models: {} }] }]
      , ["tokentracker-usage-heatmap", { weeks: [[{ day: "2026-10-09", total_tokens: 3, level: 2, models: {} }]] }],
    ]) {
      const snapshot = JSON.stringify(payload);
      const out = merge(slug, payload, fixture);
      assert.equal(JSON.stringify(out), snapshot, `${slug} must stay untouched`);
    }
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("only the requested window is credited", () => {
  const fixture = sandbox([credit("2026-09-30T06:00:00.000Z", 100), credit("2026-10-09T06:00:00.000Z", 50)]);
  try {
    const payload = { totals: { total_cost_usd: "0.000000" } };
    const out = merge("tokentracker-usage-summary", payload, fixture, [["from", "2026-10-01"], ["to", "2026-10-31"]]);
    assert.equal(out.totals.total_cost_usd, "0.500000", "September credits stay out of an October window");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("buckets are clipped by the Beijing day, not the UTC one", () => {
  const rows = [
    // 2026-09-30T16:30Z is 2026-10-01 00:30 in Beijing.
    { source: "qoder", model: "官方云端（积分）", hour_start: "2026-09-30T16:30:00.000Z", total_cost_usd: 0.42 },
    // 2026-10-01T15:00Z is still 2026-10-01 in Beijing.
    { source: "qoder", model: "官方云端（积分）", hour_start: "2026-10-01T15:00:00.000Z", total_cost_usd: 0.08 },
  ];
  const buckets = buildCostBuckets(rows, { from: "2026-10-01", to: "2026-10-01", offsetMinutes: 480 });
  assert.equal(buckets.byDay.size, 1);
  assert.equal(buckets.grand, 0.5);
  const outside = buildCostBuckets(rows, { from: "2026-10-02", to: "2026-10-31", offsetMinutes: 480 });
  assert.equal(outside.byDay.size, 0);
});
