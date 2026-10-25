"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  dedupeQoderCnDaily,
  computeQoderCnValueSummary,
  enrichQoderCnSpend,
  QODER_CN_TOKENS_PER_MSG_ANCHOR,
} = require("../src/lib/qoder-cn-estimate");

// KI-030 standard 5: the official feed returned byte-identical rows for 10-21
// and 10-22 (984 phantom messages). Only whole-object-equal rows may be dropped.
test("dedupeQoderCnDaily drops whole-object duplicates and keeps distinct days", () => {
  const day = (date, extra = {}) => ({ date, credits: 57.076, cost: 1.29, messages: 164, by_model: { Auto: 164 }, ...extra });
  const daily = [day("2026-10-21"), day("2026-10-21"), day("2026-10-22", { credits: 2.079, cost: 0.05, messages: 10, by_model: { Auto: 10 } })];
  const deduped = dedupeQoderCnDaily(daily);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].date, "2026-10-21");
  // A day that repeats with different numbers is real data, not a duplicate.
  const changed = dedupeQoderCnDaily([day("2026-10-21"), day("2026-10-21", { messages: 200 })]);
  assert.equal(changed.length, 2);
  assert.deepEqual(dedupeQoderCnDaily(null), []);
});

function liveSpendFixture() {
  return {
    credits_total: 2743.333,
    cost_total: 118.62,
    messages_total: 29474,
    daily: [
      { date: "2026-10-21", credits: 5, cost: 0.2, messages: 40, by_model: { Auto: 40 } },
      { date: "2026-10-21", credits: 5, cost: 0.2, messages: 40, by_model: { Auto: 40 } },
    ],
    model_messages: {
      Auto: { credits: 215.217, messages: 4899 },
      "Qwen3.8-Flash": { credits: 0, messages: 21588 },
      "DeepSeek-Flash": { credits: 156.818, messages: 2530 },
      "GLM-5.3-Flash": { credits: 78.134, messages: 21 },
    },
  };
}

// KI-030 standard 3: cash paid / official pricing / freeloading side by side,
// never merged. Standard 1: free is judged per SKU, so the 0.1x tier is NOT
// free and must stay out of the freeloading message count.
test("computeQoderCnValueSummary keeps the three values apart and only counts 0x SKUs as free", () => {
  const summary = computeQoderCnValueSummary(liveSpendFixture());
  assert.equal(summary.cash_paid_cny, 80.93); // 2743.333 credits x ¥0.0295
  assert.equal(summary.official_cost_cny, 118.62);
  assert.equal(summary.daily_deduped.removed, 1);
  // 21,588 + 2,530 messages on the two 0x SKUs; GLM-5.3-Flash (0.1x) excluded.
  assert.equal(summary.freeloading.messages, 24118);
  assert.equal(summary.freeloading.tokens_est, 24118 * QODER_CN_TOKENS_PER_MSG_ANCHOR);
  assert.ok(summary.freeloading.cny_low < summary.freeloading.cny_high);
  assert.equal(summary.freeloading.estimate_kind, "interval");
  // The band width is the two-source rate spread (6.1%), nothing wider.
  const spread = (summary.freeloading.cny_high - summary.freeloading.cny_low) / summary.freeloading.cny_low;
  assert.ok(spread > 0.05 && spread < 0.07, `unexpected spread ${spread}`);
});

test("enrichQoderCnSpend attaches a deduped daily list and is idempotent", () => {
  const limits = { configured: true, plan_label: "Pro", spend: liveSpendFixture() };
  const enriched = enrichQoderCnSpend(limits);
  assert.equal(enriched.spend.daily.length, 1);
  assert.ok(enriched.spend.value_summary.freeloading.messages === 24118);
  // The original object is not mutated (the on-disk cache stays untouched).
  assert.equal(limits.spend.daily.length, 2);
  assert.equal(limits.spend.value_summary, undefined);
  // Running it twice must not double-wrap.
  const twice = enrichQoderCnSpend(enriched);
  assert.equal(twice, enriched);
  assert.equal(enrichQoderCnSpend({ configured: true, spend: null }).spend, null);
});
