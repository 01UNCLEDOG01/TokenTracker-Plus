"use strict";

// 挣到值捕获（成就并集的「锦上添花」，站主 2026-11-14 拍板）：每台设备在
// 第一次观察到某枚徽章的某个等级时，把当时的实时 metric_value 记进
// <tracker>/badge-earned-values.json 并随 badge-sync 上传。并集读取端按
// 「解锁时间戳最早者胜」取对应设备的挣到值，弹窗就能显示「另一台设备挣到
// 钻石那天实际跑到多少」而不是只剩门槛值（KI-084）。
//
// 两条铁律：
// 1. 只捕「新鲜解锁」——等级的 achieved 时间戳距现在 ≤36h 才记（派生日期
//    本身可以滞后到当日零点）。存量成就（部署前早就解锁的档位）的真实挣到
//    读数已不可知，绝不拿今天的累计读数冒充「挣到时数值」——那比门槛值更
//    假（对抗审查 F2）。没捕到的档位弹窗回落到门槛值。
// 2. 记过就永久——读数回落（份额/连胜类徽章的固有波动）不抹除，重新涨过
//    已记录的等级才补记更高档。文件损坏按空表起步（无损，重记一遍）。
//    已知限制（P3 接受）：两个进程同写一个 tracker 目录时读改写有竞态，
//    可能丢一条首捕值——现役只有安装副本一个服务进程会写。

const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomicSync } = require("./atomic-json");

const BADGE_TIER_KEYS = ["bronze", "silver", "gold", "diamond"];
const FILE_NAME = "badge-earned-values.json";
const VERSION = 1;
// 上限只防脏数据撑爆文件：合法读数（token 数/美元/天数/百分数）远小于此。
const MAX_VALUE = 1e15;
// 派生解锁日期可能滞后到当日零点（每日徽章），36h 覆盖「零点滞后 + 应用
// 半天没开」；更老的解锁视为存量，不回填。
const CAPTURE_FRESH_MS = 36 * 60 * 60 * 1000;

/** Readings must be real numbers: Number(null/"")===0 leniency is a lie (F6). */
function sanitizeValue(value) {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) && value >= 0 && value < MAX_VALUE ? value : null;
}

/**
 * Tolerant read. A file from a NEWER version is surfaced with its own version
 * so the caller refuses to overwrite it (a rolled-back binary must never
 * downgrade the record, F7); its badges are not parseable here and stay empty.
 */
function readBadgeEarnedValues(trackerDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(trackerDir, FILE_NAME), "utf8"));
    if (parsed && typeof parsed.version === "number" && parsed.badges && typeof parsed.badges === "object"
      && !Array.isArray(parsed.badges)) {
      if (parsed.version > VERSION) {
        return { version: parsed.version, badges: {}, readOnly: true };
      }
      return { version: parsed.version, badges: parsed.badges };
    }
  } catch {
    // missing or corrupt file: start from an empty table
  }
  return { version: VERSION, badges: {} };
}

/**
 * Record the live reading for every FRESH tier not yet recorded (see rule 1),
 * and return the earned-values table ({ [badgeId]: { [tierKey]: number } })
 * for the badge-sync upload. The file only rewrites when something new was
 * learned.
 */
function captureBadgeEarnedValues(trackerDir, achievements, { nowMs = Date.now() } = {}) {
  const data = readBadgeEarnedValues(trackerDir);
  if (data.readOnly) return data.badges;
  let changed = false;
  for (const badge of Array.isArray(achievements) ? achievements : []) {
    const tier = Number(badge?.tier);
    if (!badge?.id || !Number.isInteger(tier) || tier < 1) continue;
    const value = sanitizeValue(badge.metric_value);
    if (value === null) continue;
    // Decide first, materialize later: an entry whose tiers are all stale
    // (stock unlocks) must not leave an empty per-badge object behind.
    const freshKeys = [];
    for (let index = 0; index < Math.min(tier, BADGE_TIER_KEYS.length); index += 1) {
      const key = BADGE_TIER_KEYS[index];
      const recorded = data.badges[badge.id]?.[key];
      if (recorded !== undefined) continue;
      const achievedAt = Date.parse(badge.achieved?.[key] || "");
      if (!Number.isFinite(achievedAt) || nowMs - achievedAt > CAPTURE_FRESH_MS) continue;
      freshKeys.push(key);
    }
    if (freshKeys.length === 0) continue;
    const perTier = (data.badges[badge.id] ??= {});
    for (const key of freshKeys) {
      perTier[key] = value;
    }
    changed = true;
  }
  if (changed) writeJsonAtomicSync(path.join(trackerDir, FILE_NAME), data);
  return data.badges;
}

module.exports = { CAPTURE_FRESH_MS, BADGE_TIER_KEYS, captureBadgeEarnedValues, readBadgeEarnedValues, sanitizeValue };
