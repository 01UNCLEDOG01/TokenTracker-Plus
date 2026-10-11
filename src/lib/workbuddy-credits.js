'use strict';

// WorkBuddy keeps a real per-conversation credit ledger in a SQLite file inside
// its own data directory: session_usage.credit_json is a {conversationId:
// credits} map, re-snapshotted as conversations grow.
//
// Two separate products are installed here and they keep separate homes:
//   ~/.workbuddy      WorkBuddy (domestic, workbuddy.cn)
//   ~/.workbuddy-ai   WorkBuddy AI (international, workbuddy.ai)
// Their session ids, jsonl files and traces do not overlap, so reading both is
// additive rather than double counting.
//
// Credits are Buddy AI's billing unit, not tokens, so the money figure is the
// subscription rate of the plan that grants them:
//   domestic    标准版 ¥99/月  ÷ 2,000 基础积分  ≈ ¥50 per 1,000 credits
//               (codebuddy.cn pricing + "Buddy AI 国内个人版订阅升级公告" 2026-06-16)
//   international Pro $10/月 ÷ 1,000 基础积分 = $10 per 1,000 credits
//               (workbuddy.ai pricing docs; its $15/500 top-up pack is dearer)
//
// This is a local read of existing files - nothing is written, uploaded or
// mutated. The apps may hold the databases open, so they are opened read-only
// and access failures degrade to null. Aggregation deliberately stays outside
// that catch: a defect there must throw, not masquerade as "no ledger".

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

const EDITIONS = [
  {
    id: 'cn',
    name: 'WorkBuddy',
    dir: '.workbuddy',
    currency: 'CNY',
    symbol: '¥',
    credits_per_money_unit: 1000,
    money_per_unit: 50,
    rate_note: '标准版 ¥99/月 ÷ 2000 基础积分',
  },
  {
    id: 'intl',
    name: 'WorkBuddy AI',
    dir: '.workbuddy-ai',
    currency: 'USD',
    symbol: '$',
    credits_per_money_unit: 1000,
    money_per_unit: 10,
    rate_note: 'Pro $10/月 ÷ 1000 基础积分',
  },
];

function workbuddyDbPath({ home = os.homedir() } = {}, edition = EDITIONS[0]) {
  return path.join(home, edition.dir, 'workbuddy.db');
}

function round2(n) {
  return Number(Number(n).toFixed(2));
}

function readSnapshotRows(dbPath) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (_error) {
    return null;
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    return db
      .prepare('select updated_at, credit_json from session_usage where credit_json is not null')
      .all();
  } catch (_error) {
    return null;
  } finally {
    if (db) {
      try {
        db.close();
      } catch (_error) { /* already closed */ }
    }
  }
}

// Snapshots grow over time: keep the largest value ever seen per conversation,
// attributed to the day that snapshot was written.
function aggregateRows(rows) {
  const best = new Map();
  for (const row of rows) {
    let parsed = null;
    try {
      parsed = JSON.parse(row.credit_json);
    } catch (_error) {
      continue;
    }
    if (!parsed || typeof parsed !== 'object') continue;
    const day = new Date(Number(row.updated_at) + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
    for (const [conversationId, credits] of Object.entries(parsed)) {
      const value = Number(credits);
      if (!Number.isFinite(value) || value <= 0) continue;
      const seen = best.get(conversationId);
      if (!seen || value > seen.credits) best.set(conversationId, { credits: value, day });
    }
  }
  if (best.size === 0) return null;

  let total = 0;
  let since = null;
  let until = null;
  const perDay = new Map();
  for (const { credits, day } of best.values()) {
    total += credits;
    if (!since || day < since) since = day;
    if (!until || day > until) until = day;
    const entry = perDay.get(day) || { date: day, credits: 0, conversations: 0 };
    entry.credits += credits;
    entry.conversations += 1;
    perDay.set(day, entry);
  }
  return {
    credits_total: round2(total),
    conversations: best.size,
    since,
    until,
    per_day: [...perDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({ date: d.date, credits: round2(d.credits), conversations: d.conversations })),
  };
}

function readEdition(edition, home) {
  const dbPath = workbuddyDbPath({ home }, edition);
  if (!fs.existsSync(dbPath)) return null;
  const rows = readSnapshotRows(dbPath);
  if (!rows || rows.length === 0) return null;
  const agg = aggregateRows(rows);
  if (!agg) return null;
  const moneyPerCredit = edition.money_per_unit / edition.credits_per_money_unit;
  return {
    id: edition.id,
    name: edition.name,
    dir: edition.dir,
    currency: edition.currency,
    symbol: edition.symbol,
    credits_total: agg.credits_total,
    cost: round2(agg.credits_total * moneyPerCredit),
    conversations: agg.conversations,
    since: agg.since,
    until: agg.until,
    per_day: agg.per_day,
    rate: `${edition.credits_per_money_unit} credits = ${edition.symbol}${edition.money_per_unit}`,
    rate_basis: edition.rate_note,
    source: 'local-db',
    db_path: dbPath,
  };
}

function mergeDaily(list) {
  const byDay = new Map();
  for (const edition of list) {
    for (const day of edition.per_day) {
      const entry = byDay.get(day.date) || { date: day.date, credits: 0, conversations: 0 };
      entry.credits += day.credits;
      entry.conversations += day.conversations;
      byDay.set(day.date, entry);
    }
  }
  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, credits: round2(d.credits), conversations: d.conversations }));
}

function readWorkbuddyCredits({ home = os.homedir() } = {}) {
  const editions = EDITIONS
    .map((edition) => readEdition(edition, home))
    .filter(Boolean);
  if (editions.length === 0) return null;

  let credits = 0;
  let conversations = 0;
  let since = null;
  let until = null;
  const cost = {};
  for (const edition of editions) {
    credits += edition.credits_total;
    conversations += edition.conversations;
    cost[edition.currency] = round2((cost[edition.currency] || 0) + edition.cost);
    if (!since || edition.since < since) since = edition.since;
    if (!until || edition.until > until) until = edition.until;
  }
  return {
    unit: 'credits',
    currency: Object.keys(cost).join('/'),
    cost,
    credits_total: round2(credits),
    conversations,
    since,
    until,
    per_day: mergeDaily(editions),
    editions,
    source: 'local-db',
    note: 'WorkBuddy bills in credits, not tokens; priced at the plan rate that grants them',
  };
}

module.exports = { readWorkbuddyCredits, workbuddyDbPath, EDITIONS };
