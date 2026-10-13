"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  qoderIntlCreditRows,
  qoderIntlCreditMirrorFile,
  qoderIntlBlendedRateUsdPerMtok,
  QODER_INTL_USD_PER_CREDIT,
  QODER_INTL_REFERENCE_MODEL,
  QODER_INTL_MIRROR_VERSION,
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

// One CN queue row whose token columns carry the mix qoderCnTokenShape measures.
// The estimate only reads the ratios, so a single row is enough. Returns the row
// and the shares the code will actually measure back off it - rounding the shares
// onto a 1,000,000 base would otherwise make the test's own blend differ from
// the one under test in the last few tokens.
const SHAPE_FIELDS = ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens"];
function cnRowsFor(shares) {
  const row = { source: "qoder-cn", total_tokens: 1_000_000 };
  for (const f of SHAPE_FIELDS) row[f] = Math.round((shares[f] || 0) * 1_000_000);
  const measured = {};
  for (const f of SHAPE_FIELDS) measured[f] = row[f] / row.total_tokens;
  return { row, measured };
}

test("credits convert to derived tokens at the flat input rate when no shape is measured", () => {
  assert.equal(QODER_INTL_USD_PER_CREDIT, 0.01, "the published Pro rate is $20 for 2,000 credits");
  assert.equal(QODER_INTL_REFERENCE_MODEL, "qwen3.8-flash");
  // Nothing measured to weight, so the reference model's input rate stands. This
  // sandbox has no CN rows, so qoderCnTokenShape returns null.
  assert.equal(qoderIntlBlendedRateUsdPerMtok(null), 0.15, "the published qwen3.8-flash input rate, USD per MTok");
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
    // 4 credits = $0.04, divided by $0.15 per MTok, so the equivalence is
    // ~266,667 tokens. Derived, never read off the wire, and flagged as such.
    assert.equal(sum("total_cost_usd"), 0.04, "4 credits at the published rate");
    assert.equal(sum("total_tokens"), 266_667, "credits convert into derived tokens");
    assert.equal(sum("billable_total_tokens"), 266_667, "the billable figure matches");
    assert.ok(rows.every((r) => r.tokens_derived === true), "every row is marked as derived");
    assert.equal(rows[0].source, "qoder");
    assert.equal(rows[0].model, "gpt-5.6-high");
    assert.equal(rows[0].conversation_count, 0, "requests are not conversations");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a measured CN token mix prices the derivation at the blended rate", () => {
  // The machine's real CN mix: 85.8% of its tokens are cache reads at $0.016,
  // about a ninth of the $0.15 input rate. Billing the input rate alone used to
  // credit the same money with roughly a quarter of the tokens it bought.
  const shape = {
    input_tokens: 116_642_671,
    cached_input_tokens: 734_261_193,
    cache_creation_input_tokens: 0,
    output_tokens: 4_960_724,
    reasoning_output_tokens: 0,
    total_tokens: 855_864_588,
  };
  const shares = {};
  for (const f of ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens"]) {
    shares[f] = shape[f] / shape.total_tokens;
  }
  const blended = qoderIntlBlendedRateUsdPerMtok(shares);
  const expected = 0.136286 * 0.15 + 0.005796 * 0.47 + 0.857917 * 0.016;
  assert.ok(Math.abs(blended - expected) < 1e-6, `blended ${blended} is the shape-weighted mix, not the input rate`);
  assert.ok(blended < 0.05, "the mix is far cheaper per token than the input rate alone");
  // $3.566868 of credits buys 96,679,263 tokens at that mix, not 23,779,120 at
  // the input rate. Measured from the exact shares above, not from rounded ones.
  assert.equal(Math.round((3.566868 / blended) * 1e6), 96_679_263);

  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 4, "qfmodel")]);
  try {
    const { row: cnRow, measured } = cnRowsFor(shares);
    const rateUsed = qoderIntlBlendedRateUsdPerMtok(measured);
    const [row] = qoderIntlCreditRows([cnRow], { projectsDir: projects, home });
    assert.equal(row.total_cost_usd, 0.04, "the money is still the provider's own charge");
    assert.equal(row.total_tokens, Math.round((0.04 / rateUsed) * 1e6), "the tokens come from the blended rate");
    // The split must describe the same usage the total was solved for, so the
    // components still sum to the total.
    const components = SHAPE_FIELDS.reduce((a, f) => a + (Number(row[f]) || 0), 0);
    assert.equal(components, row.total_tokens, "the derived split sums to the derived total");
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
    assert.equal(mirror.version, QODER_INTL_MIRROR_VERSION, "the current derivation version is recorded");

    // Replay the pre-mapping mirror this code shipped before the fix: same
    // signature, stale row shape. The tree never changed, so only the version
    // can tell the two apart.
    mirror.version = 1;
    mirror.rows = [{ ...first[0], model: "qfmodel" }];
    fs.writeFileSync(file, JSON.stringify(mirror));
    const second = qoderIntlCreditRows([], { projectsDir: projects, home });
    assert.deepEqual(second.map((r) => r.model), ["官方云端（积分）"], "the stale label must not come back");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, QODER_INTL_MIRROR_VERSION, "the mirror is upgraded in place");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("a v3 mirror priced at the flat input rate is rebuilt, not replayed", () => {
  const shape = {
    input_tokens: 116_642_671,
    cached_input_tokens: 734_261_193,
    cache_creation_input_tokens: 0,
    output_tokens: 4_960_724,
    reasoning_output_tokens: 0,
    total_tokens: 855_864_588,
  };
  const shares = {};
  for (const f of ["input_tokens", "cached_input_tokens", "cache_creation_input_tokens", "output_tokens", "reasoning_output_tokens"]) {
    shares[f] = shape[f] / shape.total_tokens;
  }
  const blended = qoderIntlBlendedRateUsdPerMtok(shares);
  const { home, projects } = sandbox([usageRecord("2026-10-09T06:00:00.000Z", 4, "qfmodel")]);
  try {
    // Warm the tree so the mirror carries a real signature, then downgrade it to
    // the version whose rows were derived at the flat input rate. The transcript
    // tree never changes, so the signature cannot tell the two derivations apart
    // - only the version can. Without the bump, this stale ledger would keep
    // serving the old total forever.
    const cn = cnRowsFor(shares);
    const rateUsed = qoderIntlBlendedRateUsdPerMtok(cn.measured);
    qoderIntlCreditRows([cn.row], { projectsDir: projects, home });
    const file = qoderIntlCreditMirrorFile({ home });
    const mirror = JSON.parse(fs.readFileSync(file, "utf8"));
    mirror.version = 3;
    mirror.rows = [{ ...mirror.rows[0], total_tokens: 266_667, billable_total_tokens: 266_667 }];
    fs.writeFileSync(file, JSON.stringify(mirror));

    const [row] = qoderIntlCreditRows([cn.row], { projectsDir: projects, home });
    assert.equal(row.total_tokens, Math.round((0.04 / rateUsed) * 1e6), "the v3 flat-rate figure is gone");
    assert.notEqual(row.total_tokens, 266_667, "the stale total must not come back");
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, QODER_INTL_MIRROR_VERSION);
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
