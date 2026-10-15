"use strict";

// First tests for this module. Until now it had none at all, which is how a
// no-op merge survived: nothing asserted that it ever did anything.
//
// The bug these pin: with cloud sync on, the dashboard rewrites every usage
// path to tokentracker-account-* before the request leaves the browser, and
// local-api derives usageSlug from the path it actually received. The switch in
// this module only matched the tokentracker-usage-* form, so on the
// cross-device view - the one the user actually looks at - it fell through to
// `default: break` and merged nothing. That is why QODER-CN sat at its bare
// local value no matter how much the estimate had improved.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { applyAccountViewQoderMerge, normalizeUsageSlug } = require("../src/lib/qoder-cn-account-merge");

// The estimate rows come from a mirror file, so a sandbox home is all it takes.
function sandbox(rows) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qcn-merge-"));
  const dir = path.join(home, ".tokentracker", "tracker");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "qoder-cn-estimate-rows.json"),
    JSON.stringify({ version: 1, synced_at: "2026-10-12T09:05:35.208Z", rows }),
  );
  return home;
}

// One day of the official breakdown, shaped like the rows rollout.js writes:
// hour_start is an on-the-hour ISO instant, 04:00Z is midday in Beijing.
const ESTIMATE_ROWS = [
  {
    source: "qoder-cn",
    model: "官方云端（估算）",
    hour_start: "2026-10-09T04:00:00.000Z",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 3_000_000,
    billable_total_tokens: 3_000_000,
    total_cost_usd: 0,
    conversation_count: 0,
  },
];

function merge(slug, payload, home, params = [["from", "2026-10-01"], ["to", "2026-10-31"]]) {
  return applyAccountViewQoderMerge(slug, payload, {
    queueRows: [],
    searchParams: new Map(params),
    offsetMinutes: 480,
    // buildBuckets -> qoderCnEstimatedRows reads the mirror from `home`; the
    // merge API does not forward it, so the process HOME stands in for it.
    home,
  });
}

test("normalizeUsageSlug maps the account form back onto the usage form", () => {
  assert.equal(normalizeUsageSlug("tokentracker-account-model-breakdown"), "tokentracker-usage-model-breakdown");
  assert.equal(normalizeUsageSlug("tokentracker-usage-summary"), "tokentracker-usage-summary");
  assert.equal(normalizeUsageSlug("tokentracker-account-heatmap"), "tokentracker-usage-heatmap");
  assert.equal(normalizeUsageSlug(undefined), "");
});

test("the account-slug summary carries the estimate - the cross-device hero total", (t) => {
  const home = sandbox(ESTIMATE_ROWS);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const original = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  });

  const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 34_000_000_000, total_cost_usd: 1170 } };
  const out = merge("tokentracker-account-summary", payload, home);
  assert.equal(out.totals.total_tokens, 34_003_000_000, "3,000,000 estimated tokens must land on the cloud total");
  assert.equal(out.totals.total_cost_usd, 1170, "no component tokens to price - the estimate adds tokens, never invented money");
});

test("the account-slug breakdown creates the qoder-cn source with its tokens", (t) => {
  const home = sandbox(ESTIMATE_ROWS);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const original = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  });

  const out = merge("tokentracker-account-model-breakdown", { sources: [] }, home);
  const entry = out.sources.find((s) => s.source === "qoder-cn");
  assert.ok(entry, "qoder-cn must exist as its own source");
  assert.equal(entry.totals.total_tokens, 3_000_000);
  assert.equal(entry.models.length, 1);
  assert.equal(entry.models[0].model, "官方云端（估算）");
  assert.equal(entry.models[0].totals.total_cost_usd, "0");
});

test("the usage-slug form still merges - the fix is additive", (t) => {
  const home = sandbox(ESTIMATE_ROWS);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const original = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  });

  const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 100, total_cost_usd: 1 } };
  const out = merge("tokentracker-usage-summary", payload, home);
  assert.equal(out.totals.total_tokens, 3_000_100);
});

test("the estimate's cost follows the same read-time pricing as the local view", (t) => {
  const priced = {
    source: "qoder-cn",
    model: "Qwen3.8-Flash（估算）",
    hour_start: "2026-10-09T04:00:00.000Z",
    input_tokens: 1_000_000,
    cached_input_tokens: 4_000_000,
    cache_creation_input_tokens: 0,
    output_tokens: 200_000,
    reasoning_output_tokens: 0,
    total_tokens: 5_200_000,
    billable_total_tokens: 5_200_000,
    total_cost_usd: 0,
    conversation_count: 0,
  };
  const home = sandbox([priced]);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const original = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  });

  const { computeRowCost } = require("../src/lib/pricing");
  const expected = computeRowCost(priced);
  const expect6 = (Math.round(expected * 1e6) / 1e6).toFixed(6);
  assert.ok(expected > 0, "fixture model must be priceable");

  // Summary totals are fixed-precision strings.
  const payload = { from: "2026-10-01", to: "2026-10-31", totals: { total_tokens: 100, total_cost_usd: "1.000000" } };
  const out = merge("tokentracker-account-summary", payload, home);
  assert.equal(out.totals.total_cost_usd, (1 + expected).toFixed(6));

  // Daily rows are numbers.
  const daily = merge("tokentracker-account-daily", { from: "2026-10-01", to: "2026-10-31", data: [] }, home,
    [["from", "2026-10-09"], ["to", "2026-10-09"]]);
  const day = daily.data.find((d) => String(d.day) === "2026-10-09");
  assert.ok(day, "daily row created");
  assert.ok(Math.abs(day.total_cost_usd - expected) < 1e-9, "daily cost must equal the read-time price");

  // Breakdown entries and their model rows carry 6-decimal strings.
  const bd = merge("tokentracker-account-model-breakdown", { sources: [] }, home,
    [["from", "2026-10-09"], ["to", "2026-10-09"]]);
  const entry = bd.sources.find((s) => s.source === "qoder-cn");
  assert.ok(entry, "qoder-cn source exists");
  assert.equal(entry.totals.total_cost_usd, expect6);
  const modelRow = entry.models.find((m) => (m.model_id || m.model) === "Qwen3.8-Flash（估算）");
  assert.ok(modelRow, "model row exists");
  assert.equal(modelRow.totals.total_cost_usd, expect6);
});

test("the estimate only lands on days inside the requested window", (t) => {
  const home = sandbox(ESTIMATE_ROWS);
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const original = process.env.HOME;
  const originalProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  t.after(() => {
    if (original === undefined) delete process.env.HOME; else process.env.HOME = original;
    if (originalProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = originalProfile;
  });

  const payload = { from: "2026-10-01", to: "2026-10-05", totals: { total_tokens: 100, total_cost_usd: 1 } };
  const out = merge("tokentracker-account-summary", payload, home, [["from", "2026-10-01"], ["to", "2026-10-05"]]);
  assert.equal(out.totals.total_tokens, 100, "2026-10-09 is outside the window");
});