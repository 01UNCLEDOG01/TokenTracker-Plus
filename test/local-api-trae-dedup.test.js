"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

// TRAE 双计守卫（站主裁定 2026-11-20，方案 B）：旧版 Trae（Work CN）本地库与
// Trae CN 官方 API/本地库覆盖同一段会话，`trae` 与 `trae-cn` 行会把同一份
// 用量各计一次（J2900 实测 1,765 对重叠桶、900 对逐位相同、≈45 亿 tokens
// 重复；旧库不报缓存拆分，kimi-k2.7-code 3.7B tokens 仅 0.07% cached=按 0
// 缓存计价）。回归测试钉死：跨区间+大小写不敏感覆盖判定——trae 行在其小时
// 跨度 [H, H+1h) 内同模型有 trae-cn 记录时视为同一份用量的副本排除（CN
// API=官方账本）；trae 独有的小时保留。
function queueRow(source, model, hour, totalTokens) {
  return {
    source,
    model,
    hour_start: hour,
    input_tokens: Math.max(0, totalTokens - 10),
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 10,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
    billable_total_tokens: totalTokens,
    conversation_count: 1,
  };
}

async function callEndpoint(handler, endpoint) {
  const url = new URL(`http://localhost${endpoint}`);
  const chunks = [];
  const req = { method: "GET", url: url.pathname + url.search, headers: { host: "localhost" } };
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(statusCode) { this.statusCode = statusCode; },
    write(chunk) { chunks.push(chunk); },
    end(body) { if (body) chunks.push(body); },
  };
  assert.equal(await handler(req, res, url), true);
  assert.equal(res.statusCode, 200);
  return JSON.parse(chunks.join(""));
}

test("TRAE 双计守卫：跨区间+大小写不敏感覆盖判定，trae 副本行排除", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-trae-dedup-"));
  const queuePath = path.join(tmp, "queue.jsonl");
  const H = "2026-07-17T02:00:00.000Z";
  const H2 = "2026-07-17T03:00:00.000Z";
  const H3 = "2026-07-17T04:00:00.000Z";
  const H4 = "2026-07-17T05:00:00.000Z";
  const H5 = "2026-07-17T09:00:00.000Z";
  const rows = [
    // 同小时同模型有 trae-cn 行 → trae 行是副本 → 排除。
    queueRow("trae", "kimi-k2.7-code", H, 1000),
    queueRow("trae-cn", "kimi-k2.7-code", H, 1000),
    // 无 trae-cn 副本的 trae 行（旧库独有的真实用量）→ 保留。
    queueRow("trae", "deepseek-v4-flash", H, 500),
    // 同小时有 trae-cn 行（即便 token 数不同=切期差额）→ trae 行排除。
    queueRow("trae", "glm-5.2", H2, 300),
    queueRow("trae-cn", "glm-5.2", H2, 200),
    // 半小时错位：trae 在 H3，trae-cn 在 H3+30min（同小时跨度）→ 副本排除。
    queueRow("trae", "space-bunny-free", H3, 400),
    queueRow("trae-cn", "space-bunny-free", "2026-07-17T04:30:00.000Z", 400),
    // 大小写不敏感：trae 大写、trae-cn 小写 → 同模型 → 副本排除。
    queueRow("trae", "GLM-5.2", H4, 600),
    queueRow("trae-cn", "glm-5.2", H4, 600),
    // H5 无任何 trae-cn 覆盖 → trae 独有 → 保留。
    queueRow("trae", "deepseek-v4-flash", H5, 700),
  ];
  await fs.promises.writeFile(queuePath, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const handler = createLocalApiHandler({ queuePath });

  const daily = await callEndpoint(handler, "/functions/tokentracker-usage-daily?from=2026-07-17&to=2026-07-18&tz=UTC");
  assert.equal(daily.data.length, 1);
  // 1000 (trae-cn) + 500 + 200 + 400 + 600 + 700 — 四个 trae 副本行排除。
  assert.equal(daily.data[0].total_tokens, 3400);
  const models = daily.data[0].models || {};
  assert.equal(models["kimi-k2.7-code"], 1000);
  assert.equal(models["deepseek-v4-flash"], 1200);
  // glm: H2 的 trae-cn 200 + H4 的 trae-cn 600（大写 trae 副本排除）= 800。
  assert.equal(models["glm-5.2"], 800);
  assert.equal(models["space-bunny-free"], 400);

  const summary = await callEndpoint(handler, "/functions/tokentracker-usage-summary?from=2026-07-17&to=2026-07-18&tz=UTC");
  assert.equal(summary.totals.total_tokens, 3400);
});
