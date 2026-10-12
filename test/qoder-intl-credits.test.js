"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  qoderIntlCreditRows,
  qoderIntlCreditMirrorFile,
  QODER_INTL_USD_PER_CREDIT,
} = require("../src/lib/qoder-intl-credits");
const { computeRowCost } = require("../src/lib/pricing");

function sandbox(records) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "qintl-"));
  const projects = path.join(home, ".qoder", "projects", "C--work-proj");
  fs.mkdirSync(projects, { recursive: true });
  if (records) {
    fs.writeFileSync(
      path.join(projects, "sess-1.jsonl"),
      records.map((r) => JSON.stringify(r)).join("\n") + "\n"
    );
  }
  return { home, projects };
}

const usageRecord = (timestamp, credits, model = "gpt-5.6-high") => ({
  type: "assistant",
  timestamp,
  message: { role: "assistant", model, usage: { input_tokens: 0, output_tokens: 0, credits } },
});

test("credits become money without inventing tokens", () => {
  assert.equal(QODER_INTL_USD_PER_CREDIT, 0.01, "the published Pro rate is $20 for 2,000 credits");
  const { home, projects } = sandbox([
    usageRecord("2026-10-09T06:00:00.000Z", 1.5),
    usageRecord("2026-10-09T07:00:00.000Z", 2.25),
    usageRecord("2026-10-10T06:00:00.000Z", 0.25),
  ]);
  try {
    const rows = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.equal(rows.length, 2, "one row per Beijing day");
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    assert.equal(sum("credits"), 4);
    assert.equal(sum("total_tokens"), 0, "no token figure is fabricated");
    assert.equal(sum("billable_total_tokens"), 0, "nor a billable one");
    assert.equal(sum("total_cost_usd"), 0.04, "4 credits at the published rate");
    assert.equal(rows[0].source, "qoder");
    assert.equal(rows[0].model, "gpt-5.6-high");
    assert.equal(rows[0].conversation_count, 0, "requests are not conversations");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a 0-token credit row still carries its money through pricing", () => {
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 3)]);
  try {
    const [row] = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.equal(computeRowCost(row), 0.03, "3 credits at the published rate");
    // A source that does not report authoritative cost must keep being priced
    // from tokens, so a stray total_cost_usd there cannot leak through.
    assert.equal(computeRowCost({ source: "codex", model: "gpt-5-codex", input_tokens: 1e6, total_cost_usd: 99 }), 1.25);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("the mirror is reused until the transcript tree changes", () => {
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 1)]);
  try {
    const first = qoderIntlCreditRows([], { projectsDir: projects, home });
    const mirror = JSON.parse(fs.readFileSync(qoderIntlCreditMirrorFile({ home }), "utf8"));
    assert.equal(mirror.rows.length, first.length);
    assert.ok(mirror.signature.includes("sess-1.jsonl"), "the signature names the files");
    // Same size and mtime, different content would be missed by the signature;
    // the guard is that any change to the tree forces a re-scan.
    fs.appendFileSync(path.join(projects, "sess-1.jsonl"),
      JSON.stringify(usageRecord("2026-10-09T08:00:00.000Z", 5)) + "\n");
    const second = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.equal(second.reduce((a, r) => a + r.credits, 0), 6, "an appended request is picked up");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("an unreadable tree falls back to the mirror, not to zero", () => {
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 7)]);
  try {
    const warm = qoderIntlCreditRows([], { projectsDir: projects, home });
    fs.rmSync(projects, { recursive: true, force: true });
    const cold = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.deepEqual(cold, warm, "the card keeps its numbers when the tree disappears");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("queue rows that already carry Qoder spend suppress the credit scan", () => {
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 9)]);
  try {
    const call = (rows) => qoderIntlCreditRows(rows, { projectsDir: projects, home });
    assert.deepEqual(
      call([{ source: "qoder", total_tokens: 0, total_cost_usd: 1.2 }]),
      [],
      "money already in the queue must not be billed a second time",
    );
    assert.deepEqual(
      call([{ source: "qoder", total_tokens: 5000, total_cost_usd: 0 }]),
      [],
      "tokens already in the queue are equally authoritative",
    );
    // A row recording neither is the exact gap this module fills.
    assert.equal(call([{ source: "qoder", total_tokens: 0, total_cost_usd: 0 }]).length, 1);
    // The CN edition is a different source and never suppresses this card.
    assert.equal(call([{ source: "qoder-cn", total_tokens: 900, total_cost_usd: 4 }]).length, 1);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("transcripts that carry no credits leave no mirror behind", () => {
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 0)]);
  try {
    assert.deepEqual(qoderIntlCreditRows([], { projectsDir: projects, home }), []);
    // An empty scan must not overwrite the mirror: the next cold read would
    // then serve an empty ledger and the card would collapse to zero.
    assert.equal(fs.existsSync(qoderIntlCreditMirrorFile({ home })), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("an opaque router name is labelled as the cloud plan, not as the router", () => {
  const { home, projects } = sandbox([
    usageRecord("2026-10-09T06:00:00.000Z", 1.5, "qfmodel"),
    usageRecord("2026-10-09T07:00:00.000Z", 2.5, "QFModel"),
  ]);
  try {
    const rows = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.deepEqual(rows.map((r) => r.model), ["官方云端（积分）"], "case-folded and collapsed to one line");
    assert.equal(rows[0].credits, 4);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a mirror from an older derivation is rebuilt, not replayed", () => {
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 4, "qfmodel")]);
  try {
    const first = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.deepEqual(first.map((r) => r.model), ["官方云端（积分）"]);
    const file = qoderIntlCreditMirrorFile({ home });
    const mirror = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(mirror.version, 2, "the current derivation version is recorded");

    // Replay the pre-mapping mirror this code shipped before the fix: same
    // signature, stale row shape. The tree never changed, so only the version
    // can tell the two apart.
    mirror.version = 1;
    mirror.rows = [{ ...first[0], model: "qfmodel" }];
    fs.writeFileSync(file, JSON.stringify(mirror));
    const second = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.deepEqual(second.map((r) => r.model), ["官方云端（积分）"], "the stale label must not come back");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2, "the mirror is upgraded in place");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("no transcripts and no mirror yields nothing", () => {
  const { home, projects } = sandbox(null);
  try {
    assert.deepEqual(qoderIntlCreditRows([], { projectsDir: projects, home }), []);
    assert.equal(fs.existsSync(qoderIntlCreditMirrorFile({ home })), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
