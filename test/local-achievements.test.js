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
  // ten cloud-parity badges the fork also replays locally (trendsetter and
  // podium stay cloud-only — they need cross-user facts).
  assert.equal(result.length, Object.keys(LOCAL_BADGE_THRESHOLDS).length + Object.keys(CLOUD_PARITY_BADGE_THRESHOLDS).length);
  assert.equal(result.length, 20);
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
