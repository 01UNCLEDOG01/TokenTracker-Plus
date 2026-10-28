"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  TERMINAL_SOURCES,
  NON_TERMINAL_SOURCES,
  CANDIDATE_SOURCES,
  isTerminalSource,
  classifySource,
  listUnresolvedSources,
} = require("../src/lib/terminal-sources");
const { computeLocalAchievements } = require("../src/lib/local-api");

const TZ_SHANGHAI = { timeZone: "Asia/Shanghai", offsetMinutes: 480 };

function dayRows(source, days) {
  const rows = [];
  for (let i = 0; i < days; i += 1) {
    rows.push({
      source,
      model: "m",
      hour_start: new Date(Date.UTC(2026, 9, 1 + i, 10)).toISOString(),
      total_tokens: 1000,
    });
  }
  return rows;
}

function badge(rows) {
  return computeLocalAchievements(rows, [], { timeZoneContext: TZ_SHANGHAI })
    .find((entry) => entry.id === "terminal_purist");
}

test("the two tables never overlap and every entry carries evidence", () => {
  for (const key of TERMINAL_SOURCES.keys()) {
    assert.equal(NON_TERMINAL_SOURCES.has(key), false, `${key} must not be in both tables`);
  }
  for (const [key, evidence] of [...TERMINAL_SOURCES, ...NON_TERMINAL_SOURCES]) {
    assert.equal(typeof evidence, "string", `${key} needs an evidence line`);
    assert.ok(evidence.trim().length > 10, `${key} evidence is too thin to audit: ${evidence}`);
  }
});

test("every CLI/TUI product seen in this machine's queue is classified terminal", () => {
  // 2026-10-29 实测：这十个源的 home 目录形态证明记录是终端程序写的
  // （projects/plugins/bin/config.yaml 形态，或路径里就写着 cli）。
  for (const key of ["claude", "codex", "opencode", "zcode", "kimi", "kimi-code",
    "dsh", "tuanjie-cowork", "codebuddy", "minimax-code"]) {
    assert.equal(isTerminalSource(key), true, `${key} must count as terminal`);
    assert.match(classifySource(key).evidence, /CLI|TUI/);
  }
});

test("desktop apps and IDEs never count, even with CLI lineage", () => {
  // autoclaw/cola/loomy 内嵌 OpenCode 运行时，但外壳是桌面应用 —— 用户点的是窗口。
  for (const key of ["autoclaw", "cola", "loomy", "reasonix", "raccoon", "mimo",
    "workbuddy", "workbuddy-ai", "cursor", "trae", "trae-cn", "qoder", "qoder-cn",
    "codearts", "antigravity", "copilot", "kilo-code", "agent2api"]) {
    assert.equal(isTerminalSource(key), false, `${key} must not count as terminal`);
  }
});

test("an id that spells cli counts without a table entry", () => {
  for (const key of ["gemini-cli", "devin-cli", "kilo-cli", "kiro-cli"]) {
    assert.equal(isTerminalSource(key), true, `${key} names itself a CLI`);
  }
});

// 每个能被采集器产出的 key 都必须落在三层之一 —— 静默未知是这套表唯一的真故障模式
// （未知 = 不计入 = 悄悄少算）。这份清单从 src/lib 的 source 常量与队列实测汇总而来。
const KNOWN_SOURCE_KEYS = [
  "claude", "codex", "opencode", "zcode", "kimi", "kimi-code", "dsh", "tuanjie-cowork",
  "codebuddy", "minimax-code", "autoclaw", "cola", "loomy", "reasonix", "raccoon",
  "workbuddy", "workbuddy-ai", "antigravity", "cursor", "trae", "trae-cn", "qoder",
  "qoder-cn", "codearts", "copilot", "agent2api", "gemini-cli", "devin-cli", "kilo-cli",
  "kiro-cli", "command-code", "joycode", "dumate", "grok", "omp", "omo", "pi",
  "prime-agent", "openclaw", "every-code", "craft-agents", "hermes-agent", "kilo",
  "kilo-code", "mimo", "droid", "goose", "zed", "cline", "roo", "acode", "anythingllm",
  "lmstudio", "unsloth", "claudescience", "dots", "muse", "qwen-code",
];

test("every collector-emitted source key is classified into one of the three layers", () => {
  const unknown = KNOWN_SOURCE_KEYS.filter((key) => classifySource(key).layer === "unknown");
  assert.deepEqual(unknown, [], `these keys would be silently under-counted: ${unknown.join(", ")}`);
});

test("a candidate is not counted, does not warn, and shows up in the audit list", () => {
  assert.equal(classifySource("grok").layer, "candidate");
  assert.equal(isTerminalSource("grok"), false, "candidates must not be counted before they are verified");
  assert.ok(listUnresolvedSources().includes("grok"));
  // 三层互斥
  for (const key of CANDIDATE_SOURCES.keys()) {
    assert.equal(TERMINAL_SOURCES.has(key) || NON_TERMINAL_SOURCES.has(key), false, `${key} sits in two layers`);
  }
});

test("an unclassified source is treated as non-terminal, not guessed in", () => {
  assert.equal(isTerminalSource("brand-new-tool", { quiet: true }), false);
  assert.match(classifySource("brand-new-tool").evidence, /未分类/);
});

test("terminal_purist counts a CLI day and ignores a desktop-app day", () => {
  // 同样 7 天、同样 token 量，只有来源不同：终端源进指标，桌面应用不进。
  assert.equal(badge(dayRows("dsh", 7)).tier, 1, "7 terminal days reach bronze");
  assert.equal(badge(dayRows("dsh", 7)).metric_value, 7);
  assert.equal(badge(dayRows("reasonix", 7)).tier, 0, "desktop-app days must not count");
  assert.equal(badge(dayRows("reasonix", 7)).metric_value, 0);
});

test("a day needs 90% terminal tokens, and a mixed day can still qualify", () => {
  // 90% 终端 + 10% 桌面 → 达标；反过来不达标。
  const mixed = [
    ...dayRows("zcode", 1).map((row) => ({ ...row, total_tokens: 900 })),
    ...dayRows("cursor", 1).map((row) => ({ ...row, total_tokens: 100 })),
  ];
  assert.equal(badge(mixed).metric_value, 1);

  const guiHeavy = [
    ...dayRows("zcode", 1).map((row) => ({ ...row, total_tokens: 100 })),
    ...dayRows("cursor", 1).map((row) => ({ ...row, total_tokens: 900 })),
  ];
  assert.equal(badge(guiHeavy).metric_value, 0);
});
