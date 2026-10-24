"use strict";

// Parity: every SQL migration that (re)defines a DeepSeek V4 tier-split
// filter must (a) cover the full DEEPSEEK_TIME_PRICED_MODELS list from
// src/lib/pricing/index.js, and (b) carry the Beijing-weekend off-peak rule
// (official since 2026-08-23 00:00 Beijing: whole weekends off-peak).
//
// Real incidents:
//  1. the 2026-08 cloud migration (20260821173500_deepseek-v4-time-pricing.sql)
//     only knew deepseek-v4-flash / deepseek-v4-pro, so deepseek-v4.1-flash
//     and deepseek-flash rows were force-tagged 'peak' in the cloud account
//     view and leaderboard (~2x overstatement for night/weekend usage);
//  2. the cloud tier-split SQL (20260821 and the 20260904 single-scan
//     promotion) only checked UTC hour windows and never the weekend rule,
//     so weekend peak-hour rows of ALL four ids were billed at peak on cloud
//     (local JS and edge fallbacks had the rule; the SQL path ignored it).
// Fixed for cloud by 20261024093000_cloud-deepseek-v41-time-priced-patterns.sql
// and for self-host by 20261013203000_self-host-deepseek-v41-time-priced-patterns.sql.
//
// A migration that ships a partial pattern list is only acceptable when a
// later migration redefines the same function (superseded).

const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const assert = require("node:assert");

const { DEEPSEEK_TIME_PRICED_MODELS } = require("../src/lib/pricing/index.js");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
// Standalone deployment sources that are applied directly to a database
// outside the migrations chain (kept in sync by convention + this test).
const STANDALONE_TIER_SPLIT_FILES = [
  "scripts/ops/account-usage-grouped-rpc.sql",
];

function likePatterns(sql) {
  const out = new Set();
  const re = /LIKE\s+'%([^%']+)%'/gi;
  let m;
  while ((m = re.exec(sql))) out.add(m[1].toLowerCase());
  return out;
}

function definedFunctions(sql) {
  // Only functions whose OWN body tier-splits DeepSeek V4 rows count: a file
  // can also define pure delegating wrappers (e.g. account_usage_grouped_v2)
  // that carry no LIKE filter of their own. Returns Map<fn, {patterns, body}>.
  const out = new Map();
  const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(.*?AS\s+\$func\$(.*?)\$func\$;/gis;
  let m;
  while ((m = re.exec(sql))) {
    const body = m[2];
    const patterns = likePatterns(body);
    if (!patterns.has("deepseek-v4-flash")) continue;
    out.set(m[1].toLowerCase(), { patterns, body });
  }
  return out;
}

function computesTierInline(body) {
  // A body that assigns pricing_tier from the UTC hour windows computes the
  // tier itself; delegating wrappers (e.g. leaderboard_usage_grouped calling
  // leaderboard_deepseek_v4_grouped) do not and are exempt from the
  // weekend-rule assertion below.
  return /pricing_tier/i.test(body) && /extract\s*\(\s*hour/i.test(body);
}

function hasWeekendRule(body) {
  // Beijing-weekend off-peak rule, effective 2026-08-23 00:00 Beijing time
  // (official: weekends fully off-peak). Convention shared with the
  // self-host fix: cutoff instant + Beijing weekday check.
  return /2026-08-22.?16:00:00/i.test(body);
}

function coversAll(patterns) {
  return DEEPSEEK_TIME_PRICED_MODELS.every((model) =>
    [...patterns].some((p) => p.includes(model)),
  );
}

test("deepseek time-priced models: latest SQL tier-split per function covers the full list", () => {
  assert.ok(
    Array.isArray(DEEPSEEK_TIME_PRICED_MODELS) && DEEPSEEK_TIME_PRICED_MODELS.length > 0,
    "DEEPSEEK_TIME_PRICED_MODELS must be exported from src/lib/pricing/index.js",
  );
  // fn -> { file, patterns } — the latest definition of each tier-splitting
  // function, using that function body's OWN LIKE patterns.
  //
  // Rename semantics: `ALTER FUNCTION public.old(...) RENAME TO new` retires
  // the old name (the 2026-09-04 promotion renamed
  // account_usage_grouped_single_scan_candidate to account_usage_grouped).
  // A retired name is only effective again if a LATER file redefines it.
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const renamedAwayAt = new Map(); // fn -> last file that renamed it away
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    const reRename = /ALTER\s+FUNCTION\s+public\.(\w+)\s*\(.*?\)\s*RENAME\s+TO\s+(\w+)/gis;
    let rm;
    while ((rm = reRename.exec(sql))) renamedAwayAt.set(rm[1].toLowerCase(), f);
  }
  // fn -> { file, patterns } — the latest EFFECTIVE definition of each
  // tier-splitting function, using that function body's OWN LIKE patterns.
  const latestByFunction = new Map();
  const seenIn = new Map(); // fn -> files with effective definitions (superseded check)
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    for (const [fn, { patterns, body }] of definedFunctions(sql)) {
      const retiredAt = renamedAwayAt.get(fn);
      if (retiredAt && f <= retiredAt) continue; // dead name at this point
      latestByFunction.set(fn, { file: f, patterns, body });
      if (!seenIn.has(fn)) seenIn.set(fn, []);
      seenIn.get(fn).push(f);
    }
  }
  assert.ok(latestByFunction.size > 0, "expected at least one migration with a deepseek-v4-flash LIKE filter");

  for (const [fn, { file, patterns, body }] of latestByFunction) {
    const missing = DEEPSEEK_TIME_PRICED_MODELS.filter(
      (model) => ![...patterns].some((p) => p.includes(model)),
    );
    assert.deepStrictEqual(
      missing,
      [],
      `${file}: function ${fn} is the latest tier-split definition but its LIKE patterns miss: ${missing.join(", ")}`,
    );
    // Beijing-weekend off-peak rule (official since 2026-08-23): the old
    // cloud SQL only checked UTC hour windows, so weekend peak-hour rows
    // were billed at peak. Every inline tier computation must carry it.
    if (computesTierInline(body)) {
      assert.ok(
        hasWeekendRule(body),
        `${file}: function ${fn} computes pricing_tier inline but lacks the Beijing-weekend off-peak rule (2026-08-22T16:00:00Z cutoff)`,
      );
    }
  }

  // Every older (superseded) tier-split definition must actually be
  // superseded: the same function is redefined by a later file.
  for (const [fn, definers] of seenIn) {
    const latest = latestByFunction.get(fn).file;
    for (const f of definers) {
      if (f === latest) continue;
      assert.ok(
        definers.indexOf(f) < definers.indexOf(latest),
        `${f}: defines tier-split function ${fn} but no later migration redefines it; partial pattern lists must not be left effective`,
      );
    }
  }

  // Standalone deployment sources are always effective (never superseded),
  // so they must cover the full list outright.
  for (const rel of STANDALONE_TIER_SPLIT_FILES) {
    const sql = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const patterns = likePatterns(sql);
    if (!patterns.has("deepseek-v4-flash")) continue;
    const missing = DEEPSEEK_TIME_PRICED_MODELS.filter(
      (model) => ![...patterns].some((p) => p.includes(model)),
    );
    assert.deepStrictEqual(
      missing,
      [],
      `${rel}: standalone tier-split source misses: ${missing.join(", ")}`,
    );
    if (computesTierInline(sql)) {
      assert.ok(
        hasWeekendRule(sql),
        `${rel}: computes pricing_tier inline but lacks the Beijing-weekend off-peak rule (2026-08-22T16:00:00Z cutoff)`,
      );
    }
  }
});
