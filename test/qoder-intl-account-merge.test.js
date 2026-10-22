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


// The signed-in dashboard rewrites every usage path to tokentracker-account-*
// before the request leaves the browser (api.ts USAGE_TO_ACCOUNT_SLUG), and
// local-api derives usageSlug from the path it actually received. Matching only
// the usage- form made this merge a no-op on the cross-device view, which is
// where the card the user actually looks at comes from.
// The international edition records credits and no tokens, so the token
// figures are derived from the money at the qwen3.8-flash input rate
// (0.15 USD/MTok). With no local rows to learn a split from, everything lands
// in input_tokens, so credits -> tokens is `usd / 0.15 * 1e6` rounded.
const derivedTokens = (credits) => Math.round((credits * 0.01) / 0.15 * 1e6);

test("the account-slug form merges too - it is the one the signed-in dashboard sends", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 100)]);
  try {
    const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 5000, total_cost_usd: "50.000000" } };
    const out = merge("tokentracker-account-summary", payload, fixture);
    assert.equal(out.totals.total_cost_usd, "51.000000");
    assert.equal(out.totals.total_tokens, 5000 + derivedTokens(100), "the derived tokens land on the cloud total");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("the account-slug form creates the source card in the cloud breakdown", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 40)]);
  try {
    const payload = { sources: [] };
    const out = merge("tokentracker-account-model-breakdown", payload, fixture);
    const entry = out.sources.find((s) => s.source === "qoder");
    assert.ok(entry, "the qoder source must exist, otherwise buildFleetData drops the card");
    assert.equal(entry.totals.total_cost_usd, "0.400000");
    assert.equal(entry.totals.total_tokens, derivedTokens(40), "the card is no longer money-only");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("the usage-slug form still merges - the fix is additive, not a replacement", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 100)]);
  try {
    const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 5000, total_cost_usd: "50.000000" } };
    const out = merge("tokentracker-usage-summary", payload, fixture);
    assert.equal(out.totals.total_cost_usd, "51.000000");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("an unrelated slug is still ignored rather than guessed at", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 100)]);
  try {
    const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 5000, total_cost_usd: "50.000000" } };
    const out = merge("tokentracker-usage-heatmap", payload, fixture);
    assert.equal(out.totals.total_cost_usd, "50.000000", "heatmap carries no cost, so nothing is credited");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
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

test("the credit spend joins the cloud hero total with its derived tokens", () => {
  const fixture = sandbox([credit("2026-10-09T06:00:00.000Z", 100)]);
  try {
    const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 5000, total_cost_usd: "50.000000" } };
    const out = merge("tokentracker-usage-summary", payload, fixture);
    assert.equal(out.totals.total_cost_usd, "51.000000");
    assert.equal(out.totals.total_tokens, 5000 + derivedTokens(100), "credits convert into derived tokens");
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
    assert.equal(day.total_tokens, 20 + derivedTokens(25));
    assert.equal(day.models["qfmodel"], 0, "the model map is token-valued, so this edition joins at zero");
    assert.equal(out.data[0].total_cost_usd, 1.5, "another day is not credited twice");
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

test("a missing cloud day is inserted in day order with money and its derived tokens", () => {
  const fixture = sandbox([credit("2026-10-05T06:00:00.000Z", 10), credit("2026-10-11T06:00:00.000Z", 20)]);
  try {
    const payload = { data: [{ day: "2026-10-09", total_tokens: 5, billable_total_tokens: 5, total_cost_usd: 1, models: {} }] };
    const out = merge("tokentracker-usage-daily", payload, fixture);
    assert.deepEqual(out.data.map((d) => d.day), ["2026-10-05", "2026-10-09", "2026-10-11"]);
    assert.equal(out.data[0].total_cost_usd, 0.1);
    assert.equal(out.data[0].total_tokens, derivedTokens(10));
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
    assert.equal(qoder.totals.total_tokens, derivedTokens(40));
    assert.equal(qoder.models.length, 1);
    assert.equal(qoder.models[0].model, "Qwen3.8-Flash", "the card shows the model name, not the router id");
    assert.equal(qoder.models[0].model_id, "qfmodel", "the row keeps the router id the transcript used");
    assert.equal(qoder.models[0].cost_source, "provider_reported");
    assert.equal(qoder.models[0].pricing.status, "priced", "a credits row is priced at the reference rate its tokens were derived from");
    assert.equal(qoder.models[0].totals.total_tokens, derivedTokens(40));
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
    assert.equal(out.sources[0].models.length, 2, "the legacy generic row and the specific local row both survive");
    // The legacy row keeps its own money; it only loses the （积分） marker the
    // scanner used to bake into the label, same as the local view renders it.
    const generic = out.sources[0].models.find((m) => m.model === "官方云端");
    const specific = out.sources[0].models.find((m) => m.model_id === "qfmodel");
    assert.ok(generic && specific, "both model labels are present");
    assert.equal(generic.model_id, "官方云端（积分）", "the stored id survives the rename");
    assert.equal(generic.totals.total_cost_usd, "1.000000");
    assert.equal(specific.totals.total_cost_usd, "0.050000");
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

const { applyAccountViewQoderIntlMerge: mergeWithQueue } = require("../src/lib/qoder-intl-account-merge");

// The cloud groups by the stored model key, so one model can come back twice:
// the router id the scanner writes now, and the credits label an older build
// wrote into the row. Both must land on the name this machine shows, and a day
// the queue already carries tokens for must not have them added again.
function cloudQoderRow(model, tokens, cost, priced) {
  return {
    model,
    model_id: model,
    pricing: priced
      ? { status: "priced", input: 0.15, output: 0.47, cache_read: 0.016, cache_write: 0.2 }
      : { status: "unpriced", input: 0, output: 0, cache_read: 0, cache_write: 0 },
    cost_source: "model_pricing",
    totals: {
      total_tokens: tokens, billable_total_tokens: tokens, input_tokens: 0, output_tokens: 0,
      cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
      total_cost_usd: cost,
    },
  };
}

test("cloud rows named by router id fold onto the model name, without re-billing a covered day", () => {
  const fixture = sandbox([
    creditFor("mmodel", "2026-10-22T04:00:00.000Z", 100),
    creditFor("qfmodel", "2026-10-22T04:00:00.000Z", 40),
  ]);
  try {
    // Qoder's client texts are what name its routers, so the fixture ships them.
    const authDir = path.join(fixture.home, ".qoder", ".auth");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(
      path.join(authDir, "dynamic-texts.json"),
      JSON.stringify({ modelSelector: { item: { mmodel: "MiniMax-M3.1-Flash", qfmodel: "Qwen3.8-Flash" } } }),
    );
    const payload = {
      sources: [{
        source: "qoder",
        source_scope: "cloud",
        totals: {
          total_tokens: 2826787, billable_total_tokens: 2826787, input_tokens: 0, output_tokens: 0,
          cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0,
          total_cost_usd: "0.104291",
        },
        models: [
          cloudQoderRow("MiniMax-M3.1-Flash（积分）", 0, "0.000000", true),
          cloudQoderRow("mmodel", 0, "0.000000", false),
          cloudQoderRow("Qwen3.8-Flash（积分）", 2826787, "0.104291", true),
        ],
      }],
    };
    const out = mergeWithQueue("tokentracker-account-model-breakdown", payload, {
      // The scanner's own row for that day: it carries the tokens, so the
      // credits row for the same model must not add them a second time.
      queueRows: [{
        source: "qoder", model: "Qwen3.8-Flash（积分）", hour_start: "2026-10-22T04:00:00.000Z",
        total_tokens: 2826787, billable_total_tokens: 2826787, total_cost_usd: 0,
      }],
      projectsDir: fixture.projectsDir,
      home: fixture.home,
      searchParams: new Map([["from", "2026-10-01"], ["to", "2026-10-31"]]),
    });
    const models = out.sources[0].models;
    assert.deepEqual(
      models.map((m) => m.model),
      ["MiniMax-M3.1-Flash", "Qwen3.8-Flash"],
      "no raw router id and no duplicate row reaches the card",
    );
    assert.deepEqual(models.map((m) => m.model_id), ["MiniMax-M3.1-Flash（积分）", "Qwen3.8-Flash（积分）"],
      "the folded row still records the id the cloud stored it under");
    const mini = models[0];
    assert.equal(mini.totals.total_cost_usd, "1.000000", "the credits money lands on the folded row");
    assert.equal(mini.totals.total_tokens, derivedTokens(100), "both zero-token rows folded into one");
    assert.equal(mini.pricing.status, "priced", "folding must not drop the priced badge");
    const qwen = models[1];
    assert.equal(qwen.totals.total_cost_usd, "0.104291", "the covered day keeps the cloud's own figure");
    assert.equal(qwen.totals.total_tokens, 2826787, "covered tokens are not added again");
    assert.equal(out.sources[0].totals.total_cost_usd, "1.104291", "the card total is cloud money + credits");
    assert.equal(out.sources[0].totals.total_tokens, 2826787 + derivedTokens(100));
  } finally {
    fs.rmSync(fixture.home, { recursive: true, force: true });
  }
});

function creditFor(model, timestamp, value) {
  return {
    type: "assistant",
    timestamp,
    message: { role: "assistant", model, usage: { input_tokens: 0, output_tokens: 0, credits: value } },
  };
}
