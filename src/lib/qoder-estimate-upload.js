"use strict";

// Persist the Qoder estimate rows into the upload queue so the cloud
// account aggregate carries the same spend the local dashboard folds in at
// read time. Until 2026-10-16 the estimate only existed as a read-time fold
// (local-api's scopedQueueRows), so the cloud never held a qoder-cn/qoder row
// and the signed-in account view showed ~0.9B fewer tokens than the local
// view over 30 days (user decision: the cloud should know the same numbers).
//
// Persistence is watermark-guarded: rows are appended once per local day, the
// queue's own (source, model, hour_start) last-wins dedupe makes a re-append
// idempotent, and both folds retire themselves once the queue carries the
// rows — qoderCnEstimatedRows only fills the per-day shortfall and
// qoderIntlCreditRows stands down the moment the queue reports real spend.
// A changed anchor therefore heals itself on the next newer day instead of
// rewriting history.

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { qoderCnEstimatedRows } = require("./qoder-cn-estimate");
const { qoderIntlCreditRows } = require("./qoder-intl-credits");

function dayKeyOf(row) {
  const hourStart = typeof row?.hour_start === "string" ? row.hour_start : "";
  return hourStart.length >= 10 ? hourStart.slice(0, 10) : "";
}

async function readAllQueueRows(queuePath) {
  let raw = "";
  try {
    raw = await fs.readFile(queuePath, "utf8");
  } catch {
    return [];
  }
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) rows.push(parsed);
    } catch {
      // Incomplete/control tail lines are skipped — the upload path does the same.
    }
  }
  return rows;
}

async function readWatermark(statePath) {
  // Always return the cn_day/intl_day keys (empty string when unset) so the
  // comparisons below never see undefined — "day" > undefined is false and
  // would silently freeze the watermark forever.
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    return {
      cn_day: typeof state?.cn_day === "string" ? state.cn_day : "",
      intl_day: typeof state?.intl_day === "string" ? state.intl_day : "",
    };
  } catch {
    return { cn_day: "", intl_day: "" };
  }
}

function isNewDay(rows, watermark) {
  let newest = "";
  for (const row of rows) {
    const day = dayKeyOf(row);
    if (day && day > newest) newest = day;
  }
  return { newest, hasNew: Boolean(newest && newest > watermark) };
}

function rowsAfter(rows, watermark) {
  return rows.filter((row) => {
    const day = dayKeyOf(row);
    return day && day > watermark;
  });
}

/**
 * Append the qoder estimate rows that are newer than the watermark to the
 * upload queue. Returns the counts so the caller can log the outcome.
 */
async function persistQoderEstimateRows({
  queuePath,
  statePath,
  localRows = null,
  projectsDir,
  home = os.homedir(),
}) {
  const rows = Array.isArray(localRows) ? localRows : await readAllQueueRows(queuePath);
  // NOTE: an empty queue must NOT short-circuit here — the estimate is driven
  // by the qoder limits cache (official daily spend), not by local rows, and
  // a fresh install is exactly when the estimate needs to land first.

  const watermark = await readWatermark(statePath);
  const cnRows = rowsAfter(qoderCnEstimatedRows(rows, { home }), watermark.cn_day);
  const intlRows = rowsAfter(
    qoderIntlCreditRows(rows, { projectsDir, home }),
    watermark.intl_day,
  );
  const pending = [...cnRows, ...intlRows];
  if (pending.length === 0) {
    return { appended: 0, cnAppended: 0, intlAppended: 0 };
  }

  await fs.appendFile(queuePath, pending.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");

  const nextWatermark = { ...watermark };
  for (const row of pending) {
    const day = dayKeyOf(row);
    if (!day) continue;
    if (row.source === "qoder-cn" && day > nextWatermark.cn_day) nextWatermark.cn_day = day;
    if (row.source === "qoder" && day > nextWatermark.intl_day) nextWatermark.intl_day = day;
  }
  await fs.writeFile(statePath, JSON.stringify(nextWatermark, null, 2) + "\n", "utf8");

  return {
    appended: pending.length,
    cnAppended: cnRows.length,
    intlAppended: intlRows.length,
  };
}

module.exports = { persistQoderEstimateRows, dayKeyOf, readAllQueueRows };
module.exports.default = module.exports;
