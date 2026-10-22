const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  computeLocalAchievements,
  LOCAL_BADGE_THRESHOLDS,
  CLOUD_PARITY_BADGE_THRESHOLDS,
} = require("../src/lib/local-api");

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

test("empty inputs yield the full locked catalog", () => {
  const result = computeLocalAchievements([], [], { timeZoneContext: TZ_SHANGHAI });
  // Ten local badges (three originals plus the seven habit badges) plus the
  // nineteen cloud-parity badges the fork also replays locally. Only
  // trendsetter and podium are absent — global model debut dates and a
  // cross-user leaderboard rank cannot be derived from one machine's queue.
  assert.equal(result.length, Object.keys(LOCAL_BADGE_THRESHOLDS).length + Object.keys(CLOUD_PARITY_BADGE_THRESHOLDS).length);
  assert.equal(result.length, 29);
  assert.equal(result.find((badge) => badge.id === "trendsetter"), undefined);
  assert.equal(result.find((badge) => badge.id === "podium"), undefined);
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
  // grand_slam exists locally now; this modest history has no diamonds.
  const slam = result.find((b) => b.id === "grand_slam");
  assert.equal(slam.tier, 0);
  assert.equal(slam.metric_value, 0);
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
  // 18:00–22:00 UTC = 02:00–06:00 Asia/Shanghai (only <06:00 counts → 4 rows).
  const night = [
    queueRow("2026-07-01T18:00:00Z", 10), // 02:00 local
    queueRow("2026-07-01T19:00:00Z", 10), // 03:00
    queueRow("2026-07-01T20:00:00Z", 10), // 04:00
    queueRow("2026-07-01T21:00:00Z", 10), // 05:00
    queueRow("2026-07-01T22:00:00Z", 10), // 06:00 — NOT night
    queueRow("2026-07-01T10:00:00Z", 10), // 18:00 — NOT night
  ];
  const badge = byId(
    computeLocalAchievements(night, [], { timeZoneContext: TZ_SHANGHAI }),
    "night_owl",
  );
  assert.equal(badge.metric_value, 4);
  assert.equal(badge.tier, 0); // bronze needs 5

  // One more genuine night hour crosses bronze.
  const crossed = byId(
    computeLocalAchievements(
      [...night, queueRow("2026-07-02T17:00:00Z", 10)], // 01:00 local next day
      [],
      { timeZoneContext: TZ_SHANGHAI },
    ),
    "night_owl",
  );
  assert.equal(crossed.tier, 1);
  assert.equal(crossed.metric_value, 5);
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

function sessionRow(durationMs, { tokens = 100, hash = "s1", endedAt = "2026-07-05T12:00:00Z" } = {}) {
  return { session_hash: hash, source: "claude", total_tokens: tokens, duration_ms: durationMs, ended_at: endedAt };
}

test("early_bird buckets hours in the caller's timezone, not UTC", () => {
  // 20:00Z–01:00Z = 04:00–09:00 Asia/Shanghai (6 morning rows); 18:00Z (02:00
  // local) and 02:00Z (10:00 local) fall outside the 04:00–09:59 window.
  const morning = [
    queueRow("2026-07-01T18:00:00Z", 10), // 02:00 local — too early
    queueRow("2026-07-01T20:00:00Z", 10), // 04:00
    queueRow("2026-07-01T21:00:00Z", 10), // 05:00
    queueRow("2026-07-01T22:00:00Z", 10), // 06:00
    queueRow("2026-07-01T23:00:00Z", 10), // 07:00
    queueRow("2026-07-02T00:00:00Z", 10), // 08:00 — crosses bronze (5) here
    queueRow("2026-07-02T01:00:00Z", 10), // 09:00
    queueRow("2026-07-02T02:00:00Z", 10), // 10:00 — too late
  ];
  const badge = byId(
    computeLocalAchievements(morning, [], { timeZoneContext: TZ_SHANGHAI }),
    "early_bird",
  );
  assert.equal(badge.metric_value, 6);
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

test("sprinter peaks at the single strongest hour bucket", () => {
  const rows = [
    queueRow("2026-07-01T08:00:00Z", 1_000),
    queueRow("2026-07-01T09:00:00Z", 5_000_000),
    queueRow("2026-07-01T10:00:00Z", 3_000_000),
  ];
  const badge = byId(
    computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI }),
    "sprinter",
  );
  assert.equal(badge.metric_value, 5_000_000);
  assert.equal(badge.tier, 1); // bronze 1M
  assert.equal(badge.meta.hour_start, "2026-07-01T09:00:00Z");
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
