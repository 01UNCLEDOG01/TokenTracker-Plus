"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  GAP_WINDOW_DAYS,
  MIN_BASELINE_DAYS,
  computeSourceUsageGaps,
  computeSourceUsageGapsFromSets,
  collectDaySets,
  scanQueueUsageDays,
  dayKeyFromTs,
  daysBetweenKeys,
  shortDay,
} = require("../src/lib/source-usage-gap");

// 一律用固定 nowMs + 显式 offsetMinutes，测试不随运行时刻/运行机器时区漂移。
// offset +480 = UTC+8：本地日 = UTC 日（UTC 16:00 起才翻日）。
const TZ = { offsetMinutes: 480 };
const NOW = Date.parse("2026-11-22T04:00:00Z"); // 北京 11-22 12:00 → 本地今天 11-22

function iso(day, time = "08:00:00Z") {
  return `${day}T${time}`;
}

// 窗口含今天：从今天往回数 n 个本地日（back 0..n-1）。
function lastNDays(nowMs, n) {
  const out = [];
  for (let back = 0; out.length < n; back += 1) {
    out.push(dayKeyFromTs(nowMs - back * 86_400_000, TZ));
  }
  return out;
}

function activeSessions(source, days) {
  return days.map((day) => ({ source, ended_at: iso(day, "10:00:00Z") }));
}

test("window/baseline constants match the settled criterion (N=3, 14d)", () => {
  assert.equal(GAP_WINDOW_DAYS, 3);
  assert.equal(MIN_BASELINE_DAYS, 14);
});

test("dayKeyFromTs: offset bucketing turns UTC evening into next local day", () => {
  // UTC 11-21T20:00Z 在 UTC+8 是 11-22 04:00 → 本地日 11-22
  assert.equal(dayKeyFromTs(Date.parse("2026-11-21T20:00:00Z"), TZ), "2026-11-22");
  // UTC 11-21T15:00Z 在 UTC+8 是 11-21 23:00 → 本地日 11-21
  assert.equal(dayKeyFromTs(Date.parse("2026-11-21T15:00:00Z"), TZ), "2026-11-21");
  // IANA 时区路径与偏移路径一致
  assert.equal(
    dayKeyFromTs(Date.parse("2026-11-21T20:00:00Z"), { timeZone: "Asia/Shanghai" }),
    "2026-11-22",
  );
  // 无时区无偏移 → 进程本地日（只验证形态，不验证具体值）
  assert.match(dayKeyFromTs(Date.parse("2026-11-21T00:00:00Z"), {}), /^\d{4}-\d{2}-\d{2}$/);
});

test("daysBetweenKeys is calendar-based and sign-correct", () => {
  assert.equal(daysBetweenKeys("2026-11-20", "2026-11-22"), 2);
  assert.equal(daysBetweenKeys("2026-11-22", "2026-11-20"), -2);
});

test("collectDaySets skips rows without source or parseable timestamp", () => {
  const sets = collectDaySets(
    [
      { source: "a", ended_at: iso("2026-11-20") },
      { source: "", ended_at: iso("2026-11-20") },
      { source: "a", ended_at: "not-a-date" },
      { source: "a", ended_at: null }, // Number(null)===0 台账坑：不得落成 1970
      { source: "a", ended_at: "" }, // Number("")===0 同坑
      { source: "a", ended_at: 1750000000000 },
      { noSource: true },
    ],
    "ended_at",
    TZ,
  );
  assert.equal(sets.size, 1);
  assert.equal(sets.get("a").size, 2); // 11-20 + epoch ms 数值型那条
});

test("State A fires: 3 window days (incl today) active with zero usage", () => {
  // 复刻 Qoder CN 真实形态：11-01 之前天天有用量，之后会话照常、用量断供。
  const activityDays = [...lastNDays(NOW, 30), ...Array.from({ length: 20 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-01T00:00:00Z") - i * 86_400_000, TZ))];
  const usageDays = Array.from({ length: 20 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-01T00:00:00Z") - i * 86_400_000, TZ));
  const sessions = activeSessions("qoder-cn", activityDays);
  const queueRows = usageDays.map((day) => ({ source: "qoder-cn", hour_start: iso(day, "02:00:00Z") }));
  const gaps = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].source, "qoder-cn");
  assert.equal(gaps[0].last_usage_day, "2026-11-01");
  assert.equal(gaps[0].window_days, 3);
  assert.equal(gaps[0].window_activity_day_count, 3);
  assert.ok(gaps[0].baseline_day_count >= MIN_BASELINE_DAYS);
});

test("Qoder CN real shape: UTC-evening sessions land on local tomorrow and fire today", () => {
  // 实测复现：CN 会话记录时间戳 2026-11-21T17:10Z = 本地 11-22 凌晨；历史用量
  // 停在本地 11-02。窗口含今天 → 今天就亮，横幅日期=11-02。
  const history = Array.from({ length: 40 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-01T00:00:00Z") - i * 86_400_000, TZ));
  const sessions = [
    ...history.map((day) => ({ source: "qoder-cn", ended_at: iso(day, "06:00:00Z") })),
    { source: "qoder-cn", ended_at: "2026-11-21T17:10:07Z" }, // 本地 11-22 01:10
    { source: "qoder-cn", ended_at: "2026-11-21T16:35:57Z" }, // 本地 11-22 00:35
  ];
  const queueRows = history.map((day) => ({ source: "qoder-cn", hour_start: iso(day, "02:00:00Z") }));
  const gaps = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].source, "qoder-cn");
  assert.equal(gaps[0].last_usage_day, "2026-11-01");
  assert.equal(gaps[0].last_activity_day, "2026-11-22");
});

test("State C: no activity in window → silent (intl shape: used 11-19, idle since)", () => {
  const activityDays = lastNDays(NOW, 20).slice(3); // 最近 3 天（含今天）无活动
  const sessions = activeSessions("qoder", activityDays);
  const queueRows = activityDays.map((day) => ({ source: "qoder", hour_start: iso(day, "02:00:00Z") }));
  const gaps = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 0);
});

test("no fire when window still has usage rows (lag < window days is not a break)", () => {
  // 会话与用量都活跃到今天之前一天、今天两者皆无：窗口最旧日有用量 → 不亮。
  const recent = lastNDays(NOW, 3);
  const older = Array.from({ length: 20 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-19T00:00:00Z") - i * 86_400_000, TZ));
  const sessions = activeSessions("x", [...recent, ...older]);
  const queueRows = [...recent, ...older].map((day) => ({ source: "x", hour_start: iso(day, "02:00:00Z") }));
  const gaps = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 0);
});

test("no fire below the 14-day baseline (low-frequency source)", () => {
  const recent = lastNDays(NOW, 3);
  const older = Array.from({ length: 6 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-18T00:00:00Z") - i * 86_400_000, TZ));
  const sessions = activeSessions("x", [...recent, ...older]);
  const queueRows = older.map((day) => ({ source: "x", hour_start: iso(day, "02:00:00Z") }));
  const gaps = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 0);
});

test("no fire for a source that never reported usage (form, not failure)", () => {
  const days = lastNDays(NOW, 30);
  const sessions = activeSessions("x", days);
  const gaps = computeSourceUsageGaps({ sessions, queueRows: [], nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 0);
});

test("usage anywhere in the window blocks the gap (not just per-day contiguity)", () => {
  // 窗口 3 天里只有最旧的一天有用量 → 不亮（有用量=没有断供证据）。
  const activityDays = lastNDays(NOW, 30);
  const older = Array.from({ length: 20 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-19T00:00:00Z") - i * 86_400_000, TZ));
  const sessions = activeSessions("x", [...activityDays, ...older]);
  const queueRows = [...older, { source: "x", hour_start: iso(activityDays[2], "02:00:00Z") }]; // activityDays[2] = 窗口最旧日
  const gaps = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  assert.equal(gaps.length, 0);
});

test("multiple gaps sort by last_usage_day ascending, then source", () => {
  const build = (source, lastUsageDay) => {
    const older = Array.from({ length: 20 }, (_, i) => dayKeyFromTs(Date.parse(`${lastUsageDay}T00:00:00Z`) - i * 86_400_000, TZ));
    const sessions = activeSessions(source, [...lastNDays(NOW, 3), ...older]);
    const queueRows = older.map((day) => ({ source, hour_start: iso(day, "02:00:00Z") }));
    return { sessions: sessions, queueRows };
  };
  const a = build("aaa", "2026-11-05");
  const b = build("bbb", "2026-11-10");
  const gaps = computeSourceUsageGaps({
    sessions: [...a.sessions, ...b.sessions],
    queueRows: [...a.queueRows, ...b.queueRows],
    nowMs: NOW,
    ...TZ,
  });
  assert.deepEqual(gaps.map((g) => g.source), ["aaa", "bbb"]);
});

test("scanQueueUsageDays: streaming byte-extract over a fixture queue", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-usage-gap-queue-"));
  const queuePath = path.join(dir, "queue.jsonl");
  const lines = [
    JSON.stringify({ source: "qoder-cn", hour_start: "2026-11-01T10:00:00.000Z", total_tokens: 0 }),
    JSON.stringify({ source: "qoder-cn", hour_start: "2026-11-02T06:30:00.000Z", total_tokens: 5 }),
    '{"source":"qoder","model":"dfmodel"}', // 缺 hour_start → 跳过
    "not json at all", // 脏行 → 跳过
    JSON.stringify({ source: "zcode", hour_start: "2026-11-10T10:00:00.000Z", total_tokens: 9 }),
  ];
  fs.writeFileSync(queuePath, lines.join("\n") + "\n", "utf8");
  const usageBySource = await scanQueueUsageDays(queuePath, TZ);
  assert.deepEqual([...usageBySource.get("qoder-cn")].sort(), ["2026-11-01", "2026-11-02"]);
  assert.equal(usageBySource.get("qoder-cn").size, 2);
  assert.deepEqual([...usageBySource.get("zcode")], ["2026-11-10"]);
  assert.equal(usageBySource.get("qoder"), undefined);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("scanQueueUsageDays: missing file yields empty map (optional source, not an error)", async () => {
  const map = await scanQueueUsageDays(path.join(os.tmpdir(), "tt-usage-gap-missing", "queue.jsonl"), TZ);
  assert.equal(map.size, 0);
});

test("shortDay: YYYY-MM-DD → MM-DD; anything else passes through", () => {
  assert.equal(shortDay("2026-11-02"), "11-02");
  assert.equal(shortDay("2026-11-02T00:00:00Z"), "2026-11-02T00:00:00Z");
  assert.equal(shortDay(null), "");
  assert.equal(shortDay(undefined), "");
});

test("sets entrypoint matches rows entrypoint on identical inputs", () => {
  const days = lastNDays(NOW, 3);
  const older = Array.from({ length: 20 }, (_, i) => dayKeyFromTs(Date.parse("2026-11-01T00:00:00Z") - i * 86_400_000, TZ));
  const sessions = activeSessions("qoder-cn", [...days, ...older]);
  const queueRows = older.map((day) => ({ source: "qoder-cn", hour_start: iso(day, "02:00:00Z") }));
  const viaRows = computeSourceUsageGaps({ sessions, queueRows, nowMs: NOW, ...TZ });
  const viaSets = computeSourceUsageGapsFromSets({
    activityBySource: collectDaySets(sessions, "ended_at", TZ),
    usageBySource: collectDaySets(queueRows, "hour_start", TZ),
    nowMs: NOW,
    dayCtx: TZ,
  });
  assert.deepEqual(viaRows, viaSets);
});
