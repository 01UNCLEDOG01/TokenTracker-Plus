'use strict';

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  readWorkbuddyCredits,
  workbuddyDbPath,
  EDITIONS,
} = require("../src/lib/workbuddy-credits");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (_error) {
  DatabaseSync = null;
}

function makeLedger(home, dir, snapshots) {
  const editionDir = path.join(home, dir);
  fs.mkdirSync(editionDir, { recursive: true });
  const dbPath = path.join(editionDir, "workbuddy.db");
  const db = new DatabaseSync(dbPath);
  db.exec(
    "create table session_usage (session_id text, used integer, size integer, updated_at integer, credit_json text)"
  );
  const insert = db.prepare(
    "insert into session_usage (session_id, used, size, updated_at, credit_json) values (?,?,?,?,?)"
  );
  for (const [id, updatedAt, creditJson] of snapshots) {
    insert.run(id, 1000, 200000, updatedAt, creditJson);
  }
  db.close();
  return dbPath;
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "wb-credits-"));
}

// 2026-06-24 08:00 Beijing and 2026-06-25 08:00 Beijing, as epoch ms
const DAY_1 = 1782230400000;
const DAY_2 = 1782316800000;

test("readWorkbuddyCredits", { skip: !DatabaseSync ? "node:sqlite unavailable" : false }, async (t) => {
  await t.test("keeps the largest snapshot per conversation instead of summing", () => {
    const home = tempHome();
    try {
      makeLedger(home, ".workbuddy", [
        ["s1", DAY_1, JSON.stringify({ c1: 4, c2: 1 })],
        // same conversation reported again, now bigger: only the delta counts
        ["s1", DAY_2, JSON.stringify({ c1: 10, c2: 1 })],
      ]);
      const out = readWorkbuddyCredits({ home });
      assert.equal(out.credits_total, 11);
      assert.equal(out.conversations, 2);
      assert.equal(out.editions.length, 1);
      assert.equal(out.editions[0].id, "cn");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("prices each edition at the plan rate that grants its credits", () => {
    const home = tempHome();
    try {
      makeLedger(home, ".workbuddy", [["s1", DAY_1, JSON.stringify({ c1: 1000 })]]);
      makeLedger(home, ".workbuddy-ai", [["s9", DAY_2, JSON.stringify({ c9: 1000 })]]);
      const out = readWorkbuddyCredits({ home });
      const [cn, intl] = out.editions;
      assert.deepEqual(out.editions.map((e) => e.id), ["cn", "intl"]);
      assert.equal(cn.currency, "CNY");
      assert.equal(cn.cost, 50);
      assert.equal(cn.rate, "1000 credits = ¥50");
      assert.equal(intl.currency, "USD");
      assert.equal(intl.cost, 10);
      assert.equal(intl.rate, "1000 credits = $10");
      // money is reported per currency, never merged into one number
      assert.deepEqual(out.cost, { CNY: 50, USD: 10 });
      assert.equal(out.credits_total, 2000);
      assert.equal(out.conversations, 2);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("per_day sums to the edition total and is dated in Beijing days", () => {
    const home = tempHome();
    try {
      makeLedger(home, ".workbuddy", [
        ["s1", DAY_1, JSON.stringify({ c1: 7 })],
        ["s2", DAY_2, JSON.stringify({ c2: 5 })],
      ]);
      const out = readWorkbuddyCredits({ home });
      const edition = out.editions[0];
      assert.deepEqual(edition.per_day.map((d) => d.date), ["2026-06-24", "2026-06-25"]);
      const sum = edition.per_day.reduce((a, d) => a + d.credits, 0);
      assert.equal(Number(sum.toFixed(2)), edition.credits_total);
      assert.equal(edition.since, "2026-06-24");
      assert.equal(edition.until, "2026-06-25");
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("merged per_day has one row per date across editions", () => {
    const home = tempHome();
    try {
      makeLedger(home, ".workbuddy", [["s1", DAY_1, JSON.stringify({ c1: 7 })]]);
      makeLedger(home, ".workbuddy-ai", [["s2", DAY_1, JSON.stringify({ c2: 3 })]]);
      const out = readWorkbuddyCredits({ home });
      assert.equal(out.per_day.length, 1);
      assert.equal(out.per_day[0].credits, 10);
      assert.equal(out.per_day[0].conversations, 2);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("returns null when no edition has a ledger", () => {
    const home = tempHome();
    try {
      assert.equal(readWorkbuddyCredits({ home }), null);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("a corrupt ledger degrades to null rather than throwing", () => {
    const home = tempHome();
    try {
      fs.mkdirSync(path.join(home, ".workbuddy"), { recursive: true });
      fs.writeFileSync(path.join(home, ".workbuddy", "workbuddy.db"), "not a database");
      assert.equal(readWorkbuddyCredits({ home }), null);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("aggregation defects surface instead of masquerading as no ledger", () => {
    // The database access is allowed to fail quietly; a bug in the aggregation
    // must not be swallowed by the same catch, or a broken reader would look
    // like "this machine has no WorkBuddy".
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "workbuddy-credits.js"), "utf8");
    const agg = src.slice(src.indexOf("function aggregateRows"), src.indexOf("function readEdition"));
    assert.ok(agg, "aggregateRows is present");
    assert.ok(!/catch\s*\([^)]*\)\s*\{\s*return null/.test(agg), "aggregation contains no swallow-to-null catch");
  });

  await t.test("workbuddyDbPath follows the edition list", () => {
    const home = tempHome();
    try {
      assert.equal(workbuddyDbPath({ home }, EDITIONS[0]), path.join(home, ".workbuddy", "workbuddy.db"));
      assert.equal(workbuddyDbPath({ home }, EDITIONS[1]), path.join(home, ".workbuddy-ai", "workbuddy.db"));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });
});
