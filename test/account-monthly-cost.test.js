"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const monthlySource = fs.readFileSync(
  path.join(__dirname, "..", "dashboard", "edge-patches", "tokentracker-account-monthly.ts"),
  "utf8"
);

test("tokentracker-account-monthly defines total_cost_usd in byMonth and GroupedRow", () => {
  assert.ok(
    monthlySource.includes("total_cost_usd: number;"),
    "byMonth map item type must define total_cost_usd: number"
  );
  assert.ok(
    monthlySource.includes("total_cost_usd?: number | null;"),
    "GroupedRow interface must declare total_cost_usd"
  );
  assert.ok(
    monthlySource.includes("a.total_cost_usd += foldTraeRowCost("),
    "monthly aggregation loop must accumulate total_cost_usd via foldTraeRowCost"
  );
});

test("tokentracker-account-monthly initializes total_cost_usd to 0 for each month bucket", () => {
  const match = monthlySource.match(/total_cost_usd:\s*0,/);
  assert.ok(match, "each new month bucket must initialize total_cost_usd to 0");
});
