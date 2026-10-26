const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  computeLocalAchievements,
  LOCAL_BADGE_THRESHOLDS,
  CLOUD_PARITY_BADGE_THRESHOLDS,
} = require("../src/lib/local-api");
const { entryFor } = require("../src/lib/pricing/debut-catalog");

const TZ_SHANGHAI = { timeZone: "Asia/Shanghai", offsetMinutes: 480 };

function projectRow(projectKey, hourStart, tokens) {
  return { project_key: projectKey, source: "claude", hour_start: hourStart, total_tokens: tokens };
}

function queueRow(hourStart, tokens) {
  return { source: "claude", model: "m", hour_start: hourStart, total_tokens: tokens };
}

function byId(result, id) {
  return result.find((badge) => badge.id === id);
}

// The fixture dates hang off the real catalog so a corrected vendor date moves
// the test with it instead of breaking it.
function debutOf(model) {
  const found = entryFor(model);
  assert.ok(found, `${model} must be catalogued for this fixture`);
  return found.debut;
}

function shiftDays(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

test("empty inputs yield the full locked catalog", () => {
  const result = computeLocalAchievements([], [], { timeZoneContext: TZ_SHANGHAI });
  // Local badges plus the cloud-parity set, now including local
  // trendsetter/podium proxies and the four wave-4 model badges.
  assert.equal(result.length, Object.keys(LOCAL_BADGE_THRESHOLDS).length + Object.keys(CLOUD_PARITY_BADGE_THRESHOLDS).length);
  assert.equal(result.length, 65);
  for (const id of ["trendsetter", "podium"]) {
    const badge = result.find((entry) => entry.id === id);
    assert.ok(badge, `${id} must exist in the local catalog`);
    assert.equal(badge.tier, 0);
    assert.equal(badge.metric_value, 0);
  }
  for (const badge of result) {
    assert.equal(badge.tier, 0);
    assert.equal(badge.metric_value, 0);
    assert.equal(badge.next_threshold, badge.thresholds[0]);
    assert.deepEqual(Object.values(badge.achieved), [null, null, null, null]);
  }
});

test("cloud-parity badges replay from the local queue with the SQL semantics", () => {
  const rows = [
    { source: "claude", model: "a", hour_start: "2026-07-01T10:00:00Z", total_tokens: 40, output_tokens: 7 },
    { source: "codex", model: "b", hour_start: "2026-07-01T11:00:00Z", total_tokens: 60, output_tokens: 3 },
    { source: "claude", model: "a", hour_start: "2026-07-02T10:00:00Z", total_tokens: 5, output_tokens: 1 },
    // 2026-07-04 is a Saturday (UTC) — one weekend active day.
    { source: "claude", model: "a", hour_start: "2026-07-04T10:00:00Z", total_tokens: 5, output_tokens: 1 },
  ];
  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(result, "token_titan").metric_value, 110);
  assert.equal(byId(result, "big_day").metric_value, 100);
  assert.equal(byId(result, "wordsmith").metric_value, 12);
  assert.equal(byId(result, "marathoner").metric_value, 3);
  assert.equal(byId(result, "polyglot").metric_value, 2);
  assert.equal(byId(result, "multitool").metric_value, 2);
  // 07-02 continues the run; 07-04 starts a new one.
  assert.equal(byId(result, "streak").metric_value, 2);
  assert.equal(byId(result, "weekend_warrior").metric_value, 1);
  // veteran counts calendar days since the first recorded day, not active days.
  assert.equal(byId(result, "veteran").metric_value, 3);
});

test("wave-2 cloud-parity badges replay with SQL semantics", () => {
  const rows = [
    { source: "claude", model: "a", hour_start: "2026-07-01T10:00:00Z", total_tokens: 40 },
    { source: "codex", model: "b", hour_start: "2026-07-01T11:00:00Z", total_tokens: 60 },
    { source: "claude", model: "a", hour_start: "2026-07-02T10:00:00Z", total_tokens: 5 },
    { source: "claude", model: "a", hour_start: "2026-07-04T10:00:00Z", total_tokens: 5 },
    // 11-day gap (07-04 → 07-15), a fresh ISO week, and still July.
    { source: "codex", model: "c", hour_start: "2026-07-15T10:00:00Z", total_tokens: 5 },
  ];
  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });
  // phoenix: the longest return gap spans both endpoints (Fri → Mon gaps 3).
  const phoenix = byId(result, "phoenix");
  assert.equal(phoenix.metric_value, 11);
  assert.equal(phoenix.meta.gap_start, "2026-07-04");
  assert.equal(phoenix.meta.return_day, "2026-07-15");
  // iron_month counts active UTC days per calendar month.
  const iron = byId(result, "iron_month");
  assert.equal(iron.metric_value, 4);
  assert.equal(iron.meta.month, "2026-07");
  // full_blast: heaviest ISO week (the 06-29 week holds 110, 07-13 week 5).
  const blast = byId(result, "full_blast");
  assert.equal(blast.metric_value, 110);
  assert.equal(blast.meta.week, "2026-06-29");
  // multitool_day: 2026-07-01 saw two distinct sources; no day beats it.
  const swarm = byId(result, "multitool_day");
  assert.equal(swarm.metric_value, 2);
  assert.equal(swarm.meta.day, "2026-07-01");
  assert.deepEqual(swarm.meta.tools.slice().sort(), ["claude", "codex"]);
  // grand_slam counts local diamonds; podium is rank 1 locally, so this
  // modest history has exactly one diamond and stays below grand_slam bronze.
  const slam = result.find((b) => b.id === "grand_slam");
  const diamonds = result.filter((b) => b.id !== "grand_slam" && b.tier === 4).length;
  assert.equal(slam.metric_value, diamonds);
  assert.equal(slam.tier, 0);
});

test("trendsetter gives no verdict to models with no cited debut; podium is local rank 1", () => {
  const rows = [
    { source: "claude", model: "a", hour_start: "2026-07-01T10:00:00Z", total_tokens: 10 },
    { source: "claude", model: "b", hour_start: "2026-07-03T10:00:00Z", total_tokens: 10 },
    // A model adopted later still debuted locally the day it first appeared.
    { source: "claude", model: "c", hour_start: "2026-07-10T10:00:00Z", total_tokens: 10 },
  ];
  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });
  const trend = byId(result, "trendsetter");
  assert.equal(trend.metric_value, 3);
  assert.equal(trend.tier, 1);
  assert.equal(trend.meta.first_day, "2026-07-01");
  const podium = byId(result, "podium");
  assert.equal(podium.metric_value, 1);
  assert.equal(podium.tier, 4);
  assert.equal(podium.lower_is_better, true);
  assert.equal(podium.next_threshold, null);
});

test("trendsetter credits a debut-week model once, however many routers name it", () => {
  const flash = debutOf("GLM-5.3-Flash");
  const rows = [
    // Three ledger strings, one model: OpenRouter stealth ID, the vendor name,
    // and the Qoder slug all fold onto GLM-5.3-Flash.
    { source: "openrouter", model: "stealth/ox-alpha", hour_start: `${shiftDays(flash, 3)}T10:00:00Z`, total_tokens: 10 },
    { source: "trae", model: "GLM-5.3-Flash", hour_start: `${shiftDays(flash, 4)}T10:00:00Z`, total_tokens: 10 },
    { source: "qoder-cn", model: "gfmodel", hour_start: `${shiftDays(flash, 5)}T10:00:00Z`, total_tokens: 10 },
  ];
  const trend = byId(computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }), "trendsetter");
  assert.equal(trend.metric_value, 1, "alias spellings must not buy extra trendsetter slots");
  assert.equal(trend.meta.debut_week, 1);
  assert.equal(trend.meta.late, 0);
});

test("trendsetter reads the earliest day across a model's aliases, not the newest", () => {
  const flash = debutOf("GLM-5.3-Flash");
  // The vendor name only shows up long after the debut, but the stealth alias
  // was used on day 1 — the model was adopted early, so it counts.
  const rows = [
    { source: "trae", model: "GLM-5.3-Flash", hour_start: `${shiftDays(flash, 40)}T10:00:00Z`, total_tokens: 10 },
    { source: "openrouter", model: "stealth/ox-alpha", hour_start: `${shiftDays(flash, 1)}T10:00:00Z`, total_tokens: 10 },
  ];
  const trend = byId(computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }), "trendsetter");
  assert.equal(trend.meta.debut_week, 1);
  assert.equal(trend.meta.late, 0);
  assert.equal(trend.metric_value, 1);
});

test("a catalogued model adopted after its debut week is the only thing dropped", () => {
  const flash = debutOf("GLM-5.3-Flash");
  const rows = [
    // late: verified release, adopted outside the window
    { source: "trae", model: "GLM-5.3-Flash", hour_start: `${shiftDays(flash, 40)}T10:00:00Z`, total_tokens: 10 },
    // codename: vendor never claimed the slug, so first local use is the debut
    { source: "trae", model: "codely-air", hour_start: "2026-10-06T10:00:00Z", total_tokens: 10 },
    // unjudged: publicly named but no cited date yet — no verdict either way
    { source: "trae", model: "spark-x", hour_start: "2026-10-12T10:00:00Z", total_tokens: 10 },
    // not a model at all: a router placeholder must never open a slot
    { source: "trae", model: "auto", hour_start: "2026-09-01T10:00:00Z", total_tokens: 10 },
    { source: "openrouter", model: "openrouter/free", hour_start: "2026-10-12T11:00:00Z", total_tokens: 10 },
  ];
  const trend = byId(computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }), "trendsetter");
  assert.deepEqual(
    { early: trend.meta.debut_week, codename: trend.meta.codename, unjudged: trend.meta.unjudged, late: trend.meta.late },
    { early: 0, codename: 1, unjudged: 1, late: 1 },
  );
  assert.equal(trend.metric_value, 2, "metric = early + codename + unjudged, never the late model");
});

test("a beta hit before the announcement counts, and is reported as beta", () => {
  const spark = entryFor("spark-x2.6").entry;
  assert.ok(spark.beta_observed, "the fixture reads the beta date recorded in the catalog");
  const rows = [
    { source: "trae", model: "spark-x2.6", hour_start: `${spark.beta_observed}T10:00:00Z`, total_tokens: 10 },
  ];
  const trend = byId(computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }), "trendsetter");
  assert.equal(trend.meta.debut_week, 1);
  assert.equal(trend.meta.beta, 1, "the pre-announcement half of the window is called out separately");
  assert.equal(trend.meta.late, 0);
  assert.equal(trend.metric_value, 1);
});

test("grand_slam counts locally earned diamond badges and excludes itself", () => {
  const rows = [{
    source: "claude",
    model: "claude-opus",
    hour_start: "2026-07-01T10:00:00Z",
    total_tokens: 100_000_000_000,
    output_tokens: 300_000_000,
    cached_input_tokens: 50_000_000_000,
    reasoning_output_tokens: 60_000_000,
  }];
  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });
  const slam = byId(result, "grand_slam");
  const diamonds = result.filter((badge) => badge.id !== "grand_slam" && badge.tier === 4).length;
  assert.ok(diamonds >= 3, `expected at least three diamonds, got ${diamonds}`);
  assert.equal(slam.metric_value, diamonds);
  assert.ok(slam.tier >= 1);
});

test("heart_model needs five models and tracks the favorite's share", () => {
  const guarded = byId(
    computeLocalAchievements(
      ["a", "b", "c", "d"].map((model, i) => ({
        source: "claude", model, hour_start: `2026-07-0${i + 1}T10:00:00Z`, total_tokens: 100,
      })),
      [],
      { timeZoneContext: TZ_SHANGHAI },
    ),
    "heart_model",
  );
  assert.equal(guarded.metric_value, 0); // one model short of the guard — no share at all

  const rows = [
    ...["a", "b", "c", "d"].map((model, i) => ({
      source: "claude", model, hour_start: `2026-07-0${i + 1}T10:00:00Z`, total_tokens: 100,
    })),
    { source: "claude", model: "e", hour_start: "2026-07-05T10:00:00Z", total_tokens: 600 },
  ];
  const heart = byId(computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }), "heart_model");
  assert.equal(heart.metric_value, 60); // 600 of 1000 lifetime tokens
  assert.equal(heart.tier, 1); // bronze 50%
  assert.equal(heart.meta.model, "e");
});

test("deep_diver counts models past the billion-token floor", () => {
  const rows = [
    { source: "claude", model: "a", hour_start: "2026-07-01T10:00:00Z", total_tokens: 1_200_000_000 },
    { source: "claude", model: "b", hour_start: "2026-07-02T10:00:00Z", total_tokens: 900_000_000 },
    { source: "claude", model: "b", hour_start: "2026-07-03T10:00:00Z", total_tokens: 150_000_000 },
    { source: "claude", model: "c", hour_start: "2026-07-04T10:00:00Z", total_tokens: 50 },
  ];
  const diver = byId(computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }), "deep_diver");
  assert.equal(diver.metric_value, 2); // a crossed on arrival, b on the 07-03 row
  assert.equal(diver.tier, 2); // silver 2
  assert.deepEqual(diver.meta.models, ["a", "b"]);
});

test("claude_survivor and wishing_well accrue per model-name family", () => {
  const rows = [
    { source: "claude", model: "claude-opus-4-6", hour_start: "2026-07-01T10:00:00Z", total_tokens: 30_000_000 },
    { source: "codex", model: "claude-sonnet-4-6", hour_start: "2026-07-02T10:00:00Z", total_tokens: 20_000_000 },
    { source: "codex", model: "deepseek-v4-1-flash", hour_start: "2026-07-03T10:00:00Z", total_tokens: 10_000_000 },
    { source: "codex", model: "gpt-x", hour_start: "2026-07-04T10:00:00Z", total_tokens: 999_999_999 },
  ];
  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });
  const survivor = byId(result, "claude_survivor");
  assert.equal(survivor.metric_value, 50_000_000); // claude-* regardless of source
  assert.equal(survivor.tier, 2); // recalibrated lines 1M/10M/100M/1B — 50M is silver
  const well = byId(result, "wishing_well");
  assert.equal(well.metric_value, 10_000_000);
  assert.equal(well.tier, 1); // wishing lines are 10M/100M/1B/10B — 10M is bronze
});

test("project_hopper tiers on distinct projects with boundary exactness", () => {
  const [bronze] = [LOCAL_BADGE_THRESHOLDS.project_hopper[0]];
  const below = Array.from({ length: bronze - 1 }, (_, i) =>
    projectRow(`p${i}`, `2026-07-0${i + 1}T10:00:00Z`, 100),
  );
  const under = byId(
    computeLocalAchievements([], below, { timeZoneContext: TZ_SHANGHAI }),
    "project_hopper",
  );
  assert.equal(under.tier, 0);

  const exact = [...below, projectRow(`p${bronze}`, "2026-07-09T10:00:00Z", 100)];
  const at = byId(
    computeLocalAchievements([], exact, { timeZoneContext: TZ_SHANGHAI }),
    "project_hopper",
  );
  assert.equal(at.tier, 1);
  // achieved timestamp = hour the crossing row landed
  assert.equal(at.achieved.bronze, "2026-07-09T10:00:00Z");
  assert.equal(at.metric_value, bronze);
});

test("project_devotion tracks the max single-project running total", () => {
  const rows = [
    projectRow("small", "2026-07-01T01:00:00Z", 400_000),
    projectRow("big", "2026-07-02T01:00:00Z", 600_000),
    projectRow("big", "2026-07-03T01:00:00Z", 500_000), // big crosses 1M here
  ];
  const badge = byId(
    computeLocalAchievements([], rows, { timeZoneContext: TZ_SHANGHAI }),
    "project_devotion",
  );
  assert.equal(badge.tier, 1);
  assert.equal(badge.metric_value, 1_100_000);
  assert.equal(badge.achieved.bronze, "2026-07-03T01:00:00Z");
  assert.equal(badge.meta.project_key, "big");
});

test("night_owl buckets hours in the caller's timezone, not UTC", () => {
  // 16:00–19:00 UTC = 00:00–03:00 Asia/Shanghai (all before 04:00 → 4 rows).
  const night = [
    queueRow("2026-07-01T15:00:00Z", 10), // 23:00 local — before midnight, not counted
    queueRow("2026-07-01T16:00:00Z", 10), // 00:00
    queueRow("2026-07-01T17:00:00Z", 10), // 01:00
    queueRow("2026-07-01T18:00:00Z", 10), // 02:00
    queueRow("2026-07-01T19:00:00Z", 10), // 03:00 — crosses bronze (4) here
    queueRow("2026-07-01T20:00:00Z", 10), // 04:00 — NOT night
    queueRow("2026-07-01T22:00:00Z", 10), // 06:00 — NOT night
    queueRow("2026-07-01T10:00:00Z", 10), // 18:00 — NOT night
  ];
  const badge = byId(
    computeLocalAchievements(night, [], { timeZoneContext: TZ_SHANGHAI }),
    "night_owl",
  );
  assert.equal(badge.metric_value, 4);
  assert.equal(badge.tier, 1);
  assert.equal(badge.achieved.bronze, "2026-07-01T19:00:00Z");

  // A window-only row (04:00 local) must not add a point.
  const noExtra = byId(
    computeLocalAchievements(
      [...night, queueRow("2026-07-02T20:00:00Z", 10)], // 04:00 local next day
      [],
      { timeZoneContext: TZ_SHANGHAI },
    ),
    "night_owl",
  );
  assert.equal(noExtra.metric_value, 4);
});

test("zero-token rows never count anywhere", () => {
  const result = computeLocalAchievements(
    [queueRow("2026-07-01T18:00:00Z", 0)],
    [projectRow("p1", "2026-07-01T10:00:00Z", 0)],
    { timeZoneContext: TZ_SHANGHAI },
  );
  for (const badge of result) {
    assert.equal(badge.tier, 0);
    assert.equal(badge.metric_value, 0);
  }
});

test("tier timestamps replay in hour order even when rows arrive shuffled", () => {
  const thresholds = LOCAL_BADGE_THRESHOLDS.project_hopper;
  const rows = [];
  for (let i = 0; i < thresholds[1]; i += 1) {
    rows.push(projectRow(`p${i}`, `2026-06-${String(i + 1).padStart(2, "0")}T08:00:00Z`, 50));
  }
  const shuffled = [rows[4], rows[0], rows[3], rows[1], rows[2]];
  const badge = byId(
    computeLocalAchievements([], shuffled, { timeZoneContext: TZ_SHANGHAI }),
    "project_hopper",
  );
  assert.equal(badge.tier, 2);
  // bronze crossed on the 3rd distinct project chronologically, silver on the 5th.
  assert.equal(badge.achieved.bronze, "2026-06-03T08:00:00Z");
  assert.equal(badge.achieved.silver, "2026-06-05T08:00:00Z");
});

function costRow(hourStart, tokens, costUsd) {
  // grok is a SOURCES_WITH_AUTHORITATIVE_COST source: computeRowCost prefers
  // the reported cost, so the test doesn't depend on the pricing tables.
  return { source: "grok", model: "m", hour_start: hourStart, total_tokens: tokens, total_cost_usd: costUsd };
}

function sessionRow(durationMs, { tokens = 100, hash = "s1", endedAt = "2026-07-05T12:00:00Z", performance = null } = {}) {
  return { session_hash: hash, source: "claude", total_tokens: tokens, duration_ms: durationMs, ended_at: endedAt, performance };
}

test("early_bird buckets hours in the caller's timezone, not UTC", () => {
  // 21:00Z–00:00Z = 05:00–08:00 Asia/Shanghai (4 morning rows). 20:00Z (04:00)
  // and 01:00Z (09:00) sit outside the 05:00–08:59 window.
  const morning = [
    queueRow("2026-07-01T18:00:00Z", 10), // 02:00 local — too early
    queueRow("2026-07-01T20:00:00Z", 10), // 04:00 — too early
    queueRow("2026-07-01T21:00:00Z", 10), // 05:00
    queueRow("2026-07-01T22:00:00Z", 10), // 06:00
    queueRow("2026-07-01T23:00:00Z", 10), // 07:00
    queueRow("2026-07-02T00:00:00Z", 10), // 08:00 — crosses bronze (4) here
    queueRow("2026-07-02T01:00:00Z", 10), // 09:00 — too late
    queueRow("2026-07-02T02:00:00Z", 10), // 10:00 — too late
  ];
  const badge = byId(
    computeLocalAchievements(morning, [], { timeZoneContext: TZ_SHANGHAI }),
    "early_bird",
  );
  assert.equal(badge.metric_value, 4);
  assert.equal(badge.tier, 1);
  assert.equal(badge.achieved.bronze, "2026-07-02T00:00:00Z");
});

test("around_the_clock dedupes by local hour-of-day across days", () => {
  // 10:00Z on two different days is 18:00 local both times — one footprint.
  const rows = [
    queueRow("2026-07-01T02:00:00Z", 10), // 10:00 local
    queueRow("2026-07-01T03:00:00Z", 10), // 11:00
    queueRow("2026-07-01T04:00:00Z", 10), // 12:00
    queueRow("2026-07-01T05:00:00Z", 10), // 13:00
    queueRow("2026-07-01T10:00:00Z", 10), // 18:00
    queueRow("2026-07-02T10:00:00Z", 10), // 18:00 again — no new footprint
    queueRow("2026-07-01T18:00:00Z", 10), // 02:00 — sixth distinct hour
  ];
  const badge = byId(
    computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }),
    "around_the_clock",
  );
  assert.equal(badge.metric_value, 6);
  assert.equal(badge.tier, 1); // bronze 6
  assert.equal(badge.achieved.bronze, "2026-07-01T18:00:00Z");
});

test("sprinter reads the fastest output rate inside one task, not an hour bucket", () => {
  const perf = (output, ms) => ({
    estimated_output_tokens: output,
    estimated_duration_ms: ms,
    estimated_tokens_per_second: output / (ms / 1000),
  });
  const sessions = [
    sessionRow(60_000, { hash: "steady", performance: perf(3_000, 60_000) }), // 50 tok/s = bronze line
    sessionRow(8_000, { hash: "burst", endedAt: "2026-07-06T09:00:00Z", performance: perf(2_400, 8_000) }), // 300 = gold
    // A 0.4s blip divides out to 500 tok/s; sub-five-second rows are noise.
    sessionRow(400, { hash: "blip", performance: perf(200, 400) }),
  ];
  const badge = byId(
    computeLocalAchievements([], [], { timeZoneContext: TZ_SHANGHAI, sessions }),
    "sprinter",
  );
  assert.equal(badge.metric_value, 300);
  assert.equal(badge.tier, 3); // 50 / 120 / 250 / 500
  assert.equal(badge.meta.session_hash, "burst");
  assert.equal(badge.achieved.gold, "2026-07-06T09:00:00Z");
  // The old grain must not move it any more — that is token_titan's job.
  const fromQueue = byId(
    computeLocalAchievements([queueRow("2026-07-01T09:00:00Z", 5_000_000)], [], { timeZoneContext: TZ_SHANGHAI }),
    "sprinter",
  );
  assert.equal(fromQueue?.tier || 0, 0);
});

test("cache_alchemist, deep_thinker and real_money accrue across rows", () => {
  const rows = [
    costRow("2026-07-01T08:00:00Z", 1_000, 4.5),
    costRow("2026-07-02T08:00:00Z", 1_000, 45.5),
  ];
  rows[0].cached_input_tokens = 30_000_000;
  rows[0].cache_creation_input_tokens = 10_000_000;
  rows[0].reasoning_output_tokens = 500_000;
  rows[1].cached_input_tokens = 20_000_000;
  rows[1].reasoning_output_tokens = 600_000;
  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });
  const cache = byId(result, "cache_alchemist");
  assert.equal(cache.metric_value, 60_000_000); // 40M then 60M — bronze (50M) on row 2
  assert.equal(cache.achieved.bronze, "2026-07-02T08:00:00Z");
  const thinker = byId(result, "deep_thinker");
  assert.equal(thinker.metric_value, 1_100_000);
  assert.equal(thinker.tier, 1);
  const money = byId(result, "real_money");
  assert.equal(money.metric_value, 50);
  assert.equal(money.tier, 2); // bronze $5 on row 1, silver $50 on row 2
  assert.equal(money.achieved.silver, "2026-07-02T08:00:00Z");
});

test("session_marathon takes the longest token-spending session", () => {
  const sessions = [
    sessionRow(3 * 3_600_000, { hash: "short" }),
    sessionRow(0, { tokens: 0, hash: "empty" }), // never spent tokens → ignored
    sessionRow(5 * 3_600_000, { hash: "long", endedAt: "2026-07-06T20:00:00Z" }),
  ];
  const badge = byId(
    computeLocalAchievements([], [], { timeZoneContext: TZ_SHANGHAI, sessions }),
    "session_marathon",
  );
  assert.equal(badge.metric_value, 5 * 3_600_000);
  assert.equal(badge.tier, 2); // bronze 1h, silver 4h
  assert.equal(badge.meta.session_hash, "long");
  assert.equal(badge.achieved.silver, "2026-07-06T20:00:00Z");
});

test("wave-3 local badges replay with expected semantics", () => {
  const rows = [
    // OpenAI model -> closed_source_loyalist
    { source: "codex", model: "gpt-5-turbo", hour_start: "2026-07-01T10:00:00Z", total_tokens: 15000000, output_tokens: 200000, input_tokens: 50000, cached_input_tokens: 450000 },
    // Free cost row -> frugal_architect
    { source: "lmstudio", model: "qwen-coder", hour_start: "2026-07-01T10:15:00Z", total_tokens: 60000000, output_tokens: 500000, input_tokens: 100000 },
    // Free model name with catalog price -> frugal_architect
    { source: "openrouter", model: "deepseek-v4-flash-free", hour_start: "2026-07-01T10:20:00Z", total_tokens: 500000000, output_tokens: 10000000, input_tokens: 40000000 },
    // Local source row -> offgrid_sovereign
    { source: "ollama", model: "llama3:local", hour_start: "2026-07-01T23:55:00Z", total_tokens: 2000000, output_tokens: 100000 },
    // Day 2 (weekday)
    { source: "claude", model: "claude-4", hour_start: "2026-07-02T10:00:00Z", total_tokens: 1000, output_tokens: 100 },
  ];
  const projects = [
    { project_key: "my-repo", source: "claude", hour_start: "2026-07-01T10:00:00Z", total_tokens: 1000 },
    { project_key: "my-repo", source: "claude", hour_start: "2026-07-08T10:00:00Z", total_tokens: 1000 },
  ];

  const result = computeLocalAchievements(rows, projects, { timeZoneContext: TZ_SHANGHAI });
  assert.ok(byId(result, "closed_source_loyalist").metric_value >= 15000000);
  assert.equal(byId(result, "closed_source_loyalist").tier, 1);
  assert.ok(byId(result, "frugal_architect").metric_value >= 560000000);
  assert.equal(byId(result, "frugal_architect").tier, 2);
  assert.ok(byId(result, "offgrid_sovereign").metric_value >= 2000000);
  assert.equal(byId(result, "offgrid_sovereign").tier, 3);
  assert.ok(byId(result, "megacontext_voyager").metric_value >= 500000);
  assert.ok(byId(result, "cache_miser").metric_value >= 1);
  assert.ok(byId(result, "code_cannon").metric_value >= 500000);
  assert.ok(byId(result, "buzzer_beater").metric_value >= 1);
  assert.ok(byId(result, "refactor_titan").metric_value >= 2);
  assert.ok(byId(result, "zen_balancer").metric_value >= 1);
});

test("wave-4 local badges replay with expected semantics", () => {
  const rows = [
    // Zhipu: glm-5.3-flash
    { source: "codex", model: "glm-5.3-flash", hour_start: "2026-07-01T10:00:00Z", total_tokens: 15000000, output_tokens: 200000, input_tokens: 50000 },
    // Moonshot: kimi-k3
    { source: "codex", model: "kimi-k3-preview", hour_start: "2026-07-01T10:15:00Z", total_tokens: 12000000, output_tokens: 200000, input_tokens: 50000 },
    // MiniMax: minimax-m3.1-flash
    { source: "codex", model: "minimax-m3.1-flash", hour_start: "2026-07-01T10:30:00Z", total_tokens: 18000000, output_tokens: 200000, input_tokens: 50000 },
    // Google: gemini-4-pro
    { source: "google", model: "gemini-4-flash", hour_start: "2026-07-01T11:00:00Z", total_tokens: 15000000, output_tokens: 200000, input_tokens: 50000 },
    // Grok: grok-3-beta
    { source: "xai", model: "grok-3-mini", hour_start: "2026-07-01T11:15:00Z", total_tokens: 15000000, output_tokens: 200000, input_tokens: 50000 },
    // Qwen: qwen-3.8-flash
    { source: "qoder", model: "qwen-3.8-flash", hour_start: "2026-07-01T11:30:00Z", total_tokens: 15000000, output_tokens: 200000, input_tokens: 50000 },
    // Flash models accumulator (glm-5.3-flash + gemini-4-flash + minimax-m3.1-flash + qwen-3.8-flash = 63M tokens)
    // Seedance / ByteDance: seedance-v1
    { source: "volcengine", model: "seedance-video-pro", hour_start: "2026-07-01T12:00:00Z", total_tokens: 15000000, output_tokens: 200000, input_tokens: 50000 },
    // Arbitrage platforms: openrouter, apigoto, trae, qoder, cloudflare (5 platforms)
    { source: "openrouter", model: "deepseek-chat", hour_start: "2026-07-01T13:00:00Z", total_tokens: 1000 },
    { source: "apigoto", model: "gpt-4o", hour_start: "2026-07-01T13:05:00Z", total_tokens: 1000 },
    { source: "trae", model: "claude-3-5-sonnet", hour_start: "2026-07-01T13:10:00Z", total_tokens: 1000 },
    { source: "cloudflare", model: "llama-3", hour_start: "2026-07-01T13:20:00Z", total_tokens: 1000 },
  ];

  const result = computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI });

  // 9 new badges should have tiered up to at least Tier 1
  assert.equal(byId(result, "zhipu_sage").tier, 1);
  assert.equal(byId(result, "moonshot_voyager").tier, 1);
  assert.equal(byId(result, "minimax_abyss").tier, 1);
  assert.equal(byId(result, "gemini_gemma").tier, 1);
  assert.equal(byId(result, "hyperspeed_grok").tier, 1);
  assert.equal(byId(result, "qwen_dynasty").tier, 1);
  assert.equal(byId(result, "flash_immortal").tier, 1);
  assert.equal(byId(result, "seedance_master").tier, 1);
  assert.equal(byId(result, "token_arbitrageur").tier, 1); // 5 platforms out of [5, 10, 18, 26]
});

test("wave-6 badges count domestic families and the DeepSeek kill line", () => {
  const families = computeLocalAchievements([
    { source: "workbuddy", model: "deepseek-v4.1-flash", hour_start: "2026-07-01T10:00:00Z", total_tokens: 1000000 },
    { source: "workbuddy", model: "hy4-preview", hour_start: "2026-07-01T10:01:00Z", total_tokens: 1000000 },
    { source: "workbuddy", model: "glm-5.3-flash", hour_start: "2026-07-01T10:02:00Z", total_tokens: 1000000 },
    { source: "trae-cn", model: "qwen3.8-flash", hour_start: "2026-07-01T10:03:00Z", total_tokens: 1000000 },
  ], [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(families, "dragon_heir").metric_value, 4);
  assert.equal(byId(families, "dragon_heir").tier, 2); // thresholds [1, 3, 5, 7]

  const share = computeLocalAchievements([
    { source: "workbuddy", model: "DeepSeek-V4-Flash", hour_start: "2026-07-01T11:00:00Z", total_tokens: 30 },
    { source: "sensenova", model: "sn-deepseek-v4-1-flash", hour_start: "2026-07-01T11:01:00Z", total_tokens: 30 },
    { source: "workbuddy", model: "gpt-6-luna", hour_start: "2026-07-01T11:02:00Z", total_tokens: 40 },
  ], [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(share, "kill_line").metric_value, 60);
  assert.equal(byId(share, "kill_line").tier, 2); // 50% bronze, 60% silver

  const aliases = computeLocalAchievements([
    { source: "workbuddy", model: "hy3", hour_start: "2026-07-01T12:00:00Z", total_tokens: 1000000000 },
    { source: "workbuddy-ai", model: "hy4-preview-x", hour_start: "2026-07-01T12:01:00Z", total_tokens: 1000000000 },
    { source: "joycode", model: "joycode-pro", hour_start: "2026-07-01T12:02:00Z", total_tokens: 1000000000 },
  ], [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(aliases, "hunyuan_master").tier, 3); // 2B lifetime -> gold floor 1B
  assert.equal(byId(aliases, "jd_joy_brother").tier, 4); // 1B lifetime -> diamond floor 500M

  const joycode = computeLocalAchievements([
    { source: "joycode", model: "JoyAI-Code-1.5", hour_start: "2026-10-06T10:00:00Z", total_tokens: 682000 },
  ], [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(joycode, "jd_joy_brother").metric_value, 682000);
  assert.equal(byId(joycode, "jd_joy_brother").tier, 1);
});

test("qoder router ids reach their family before family badges read them", () => {
  // The ledger keeps Qoder's router ids; only the client text table knows
  // `kmodel_latest` is Kimi-K3.1-Pro. A family badge that read the raw id
  // silently dropped 233M real tokens on 2026-10-25.
  const qoder = computeLocalAchievements([
    { source: "qoder", model: "kmodel_latest", hour_start: "2026-10-25T06:00:00Z", total_tokens: 120000000 },
    { source: "qoder", model: "mmodel", hour_start: "2026-10-25T07:00:00Z", total_tokens: 100000000 },
    { source: "qoder", model: "qfmodel", hour_start: "2026-10-25T08:00:00Z", total_tokens: 20000000 },
  ], [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(qoder, "moonshot_voyager").metric_value, 120000000);
  assert.equal(byId(qoder, "moonshot_voyager").tier, 2); // 100M silver
  assert.equal(byId(qoder, "minimax_abyss").metric_value, 100000000);
  assert.equal(byId(qoder, "minimax_abyss").tier, 2);
  assert.equal(byId(qoder, "qwen_dynasty").metric_value, 20000000);
  assert.equal(byId(qoder, "qwen_dynasty").tier, 1); // 10M bronze

  // Stealth codenames resolve through the pricing catalog instead.
  const stealth = computeLocalAchievements([
    { source: "opencode", model: "x-preview-f-free", hour_start: "2026-10-25T09:00:00Z", total_tokens: 30000000 },
    { source: "opencode", model: "space-bunny-free", hour_start: "2026-10-25T10:00:00Z", total_tokens: 40000000 },
  ], [], { timeZoneContext: TZ_SHANGHAI });
  assert.equal(byId(stealth, "zhipu_sage").metric_value, 30000000);
  assert.equal(byId(stealth, "zhipu_sage").tier, 1);
  assert.equal(byId(stealth, "minimax_abyss").metric_value, 40000000);
  assert.equal(byId(stealth, "minimax_abyss").tier, 1);
});
