/**
 * End-to-end test for `tracker status --json` / `--light` / `--diagnostics`.
 *
 * Boots the real CLI in a child process, but against an ISOLATED
 * TOKENTRACKER_HOME fixture — never the real ~/.tokentracker. Two reasons:
 * (1) the real tracker dir holds multi-MB caches / a concurrently-written
 * cursors.json, so a full status scan could exceed any fixed timeout under a
 * loaded suite (these four used to sit in flaky-red.txt for exactly that);
 * (2) real-machine state (device token, installed providers) makes the
 * assertions depend on whatever the workstation happens to have. The fixture
 * keeps the E2E property (real CLI child process, real output shape) while
 * making both the data and the runtime deterministic (~0.1s per run).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const TRACKER = path.resolve(__dirname, "..", "bin", "tracker.js");

function runStatus(args) {
  const res = spawnSync(process.execPath, [TRACKER, "status", ...args], {
    encoding: "utf-8",
    // 全量 npm test 高负载下真实 CLI 子进程也可能超时，余量放宽。fixture 家目录
    // 让单次 status 只有 ~0.1s，这个 90s 只是防挂死护栏，不是常态耗时。
    timeout: 90_000,
    env: { ...process.env, TOKENTRACKER_HOME: STATUS_FIXTURE_HOME },
  });
  return res;
}

// 空的家目录夹具：queue 为空（0 bytes pending）、未设置 device token、未安装
// 任何 provider —— 恰好让「结构断言」在最小确定状态下验证。注意
// TOKENTRACKER_HOME 本身就是根（getTrackerRootDir 直接返回它），所以 tracker
// 目录是 <fixture>/tracker，不是 <fixture>/.tokentracker/tracker。
const STATUS_FIXTURE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tt-status-fixture-"));
fs.mkdirSync(path.join(STATUS_FIXTURE_HOME, "tracker"), { recursive: true });
test.after(() => fs.rmSync(STATUS_FIXTURE_HOME, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test("status --json emits a JSON object with required summary fields", () => {
  const res = runStatus(["--json"]);
  assert.equal(res.status, 0, `exit code: ${res.status} stderr=${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  assert.ok("version" in parsed, "missing top-level key: version");
  for (const key of [
    "generated_at",
    "base_url",
    "device_token_set",
    "queue",
    "hooks",
    "providers",
    "copilot",
    "subscriptions",
  ]) {
    assert.ok(key in parsed, `missing top-level key: ${key}`);
  }
  assert.ok("pending_bytes" in parsed.queue);
  assert.ok("claude" in parsed.hooks);
  assert.ok("openclaw_session_plugin_conversation_access" in parsed.hooks);
  assert.ok(parsed.providers.cline, "missing Cline provider summary");
  assert.equal(typeof parsed.providers.cline.installed, "boolean");
  if (parsed.providers.cline.installed) assert.equal(typeof parsed.providers.cline.files, "number");
  assert.ok("app_db_has_file" in parsed.copilot);
  assert.ok("app_db_path" in parsed.copilot);
  assert.equal(typeof parsed.device_token_set, "boolean");
});

test("status --light renders an ASCII table with key columns", () => {
  const res = runStatus(["--light"]);
  assert.equal(res.status, 0, `exit code: ${res.status} stderr=${res.stderr}`);
  // table separators show up at top, between header/body, and at bottom
  const sepCount = (res.stdout.match(/^\+-+\+-+\+$/gm) || []).length;
  assert.ok(sepCount >= 3, `expected ≥3 separator lines, got ${sepCount}`);
  // No ANSI / emoji / spinner artifacts
  assert.ok(!/ \[/.test(res.stdout), "ANSI escapes leaked");
  assert.match(res.stdout, /^\| Version/m);
  assert.match(res.stdout, /^\| Key /m);
  assert.match(res.stdout, /^\| Queue pending/m);
  assert.match(res.stdout, /^\| Hook · claude/m);
});

test("status --diagnostics still emits raw diagnostics JSON (back-compat)", () => {
  const res = runStatus(["--diagnostics"]);
  assert.equal(res.status, 0, `exit code: ${res.status} stderr=${res.stderr}`);
  const parsed = JSON.parse(res.stdout);
  // diagnostics has a different shape: `ok`, `version`, `env`, `paths`
  assert.ok("env" in parsed && "paths" in parsed, "diagnostics shape changed");
  assert.ok(!("hooks" in parsed), "summary keys must not leak into diagnostics");
});

test("status default (no flag) still prints the human-readable list", () => {
  const res = runStatus([]);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /^TokenTracker v/);
  assert.match(res.stdout, /Status:/);
  assert.match(res.stdout, /^- Queue: \d+ bytes pending/m);
});

test("status --bogus rejects unknown flag", () => {
  const res = runStatus(["--bogus"]);
  assert.notEqual(res.status, 0, "unknown flag must be rejected");
  assert.match(res.stderr + res.stdout, /Unknown option: --bogus/);
});

test("status --json --no-spinner is accepted (no-spinner is a no-op for status)", () => {
  const res = runStatus(["--json", "--no-spinner"]);
  assert.equal(res.status, 0);
  const parsed = JSON.parse(res.stdout);
  assert.ok("queue" in parsed);
});
