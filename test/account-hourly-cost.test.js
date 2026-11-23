"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const hourlySource = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "edge-patches", "tokentracker-account-hourly.ts"),
  "utf8"
);

test("tokentracker-account-hourly carries the per-bucket cost dimension", () => {
  assert.ok(
    hourlySource.includes("total_cost_usd: number;"),
    "byHour map item type must define total_cost_usd: number"
  );
  assert.ok(
    hourlySource.includes("total_cost_usd?: number | null;"),
    "GroupedRow interface must declare total_cost_usd"
  );
  assert.ok(
    hourlySource.includes("bucket.total_cost_usd += foldTraeRowCost("),
    "hourly aggregation loop must accumulate total_cost_usd via foldTraeRowCost"
  );
  assert.ok(
    hourlySource.includes("const evidence = await fetchTraeEvidence(client, userId);"),
    "handler must load the Trae cache-fold evidence before the bucket loop"
  );
});

test("tokentracker-account-hourly initializes total_cost_usd to 0 for each hour bucket", () => {
  const match = hourlySource.match(/total_cost_usd:\s*0,/);
  assert.ok(match, "each new hour bucket must initialize total_cost_usd to 0");
});

test("tokentracker-account-monthly defines the COMPACT_STALE_IF_ERROR_MS it uses", () => {
  // 2026-11-23: the monthly patch referenced the constant without defining it
  // (esbuild does not typecheck), so the evidence stale-fallback path would
  // have thrown a ReferenceError at runtime.
  const monthlySource = fs.readFileSync(
    path.join(__dirname, "..", "dashboard", "edge-patches", "tokentracker-account-monthly.ts"),
    "utf8"
  );
  assert.ok(
    monthlySource.includes("const COMPACT_STALE_IF_ERROR_MS = 5 * 60_000;"),
    "monthly must define COMPACT_STALE_IF_ERROR_MS before fetchTraeEvidence uses it"
  );
});
