const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  applyWallClockSpeed,
  applyQoderSessionUsageEstimates,
} = require("../src/lib/session-analytics");

test("wall-clock speed fills sources without per-request timing", () => {
  const record = {
    source: "workbuddy",
    output_tokens: 100000,
    active_ms: 1000000,
    turns: 10,
    performance: {},
  };
  applyWallClockSpeed(record);
  assert.equal(record.performance.estimated_tokens_per_second, 100);
  assert.equal(record.performance_source, "wall-clock");

  const precise = {
    source: "workbuddy",
    output_tokens: 100000,
    active_ms: 1000000,
    performance: {
      estimated_output_tokens: 50000,
      estimated_duration_ms: 1000,
      estimated_request_count: 1,
      estimated_tokens_per_second: 50000,
    },
  };
  applyWallClockSpeed(precise);
  assert.equal(precise.performance.estimated_tokens_per_second, 50000);
});

test("Qoder credit estimates are allocated across zero-usage sessions by turns", () => {
  const sessions = [
    { source: "qoder-cn", turns: 1, active_ms: 60000, total_tokens: 0, performance: {} },
    { source: "qoder-cn", turns: 3, active_ms: 120000, total_tokens: 0, performance: {} },
    { source: "qoder-cn", turns: 2, active_ms: 60000, total_tokens: 100, performance: {} },
    { source: "qoder", turns: 2, active_ms: 60000, total_tokens: 0, performance: {} },
  ];
  applyQoderSessionUsageEstimates(sessions, [
    { source: "qoder-cn", total_tokens: 500, input_tokens: 400, cached_input_tokens: 50, output_tokens: 50 },
    { source: "qoder", total_tokens: 100, input_tokens: 90, output_tokens: 10 },
  ]);

  const cn = sessions.filter((session) => session.source === "qoder-cn");
  assert.equal(cn.reduce((sum, session) => sum + session.total_tokens, 0), 500);
  assert.equal(cn[0].total_tokens, 100); // 1 of 4 allocated turns
  assert.equal(cn[1].total_tokens, 300);
  assert.equal(cn[2].total_tokens, 100); // pre-existing real value, untouched
  assert.equal(cn[0].usage_precision, "estimated");
  assert.equal(cn[0].usage_source, "qoder-credit-estimate");
  assert.equal(cn[0].model_usage.length, 1);
  assert.ok(cn[0].performance.estimated_tokens_per_second > 0);

  const intl = sessions.find((session) => session.source === "qoder");
  assert.equal(intl.total_tokens, 100);
  assert.equal(intl.output_tokens, 10);
  assert.equal(intl.usage_precision, "estimated");
});
