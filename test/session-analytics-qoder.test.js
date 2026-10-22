"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildSessionAnalytics, listSessionsForBrowser } = require("../src/lib/session-analytics");

const TZ = { timeZone: "Asia/Shanghai", offsetMinutes: 480 };

function writeQoderTranscript(home, edition, projectDir, sessionId, lines) {
  const projects = path.join(home, edition, "projects", projectDir);
  fs.mkdirSync(projects, { recursive: true });
  const file = path.join(projects, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

test("qoder and qoder-cn transcripts become sessions", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-qoder-sessions-"));
  try {
    writeQoderTranscript(home, ".qoder", "F--work", "11111111-1111-4111-8111-111111111111", [
      { type: "workspace-directories", sessionId: "11111111-1111-4111-8111-111111111111", directories: ["F:\\work"] },
      { type: "user", sessionId: "11111111-1111-4111-8111-111111111111", timestamp: "2026-10-21T01:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "帮我盘点会话层" }] } },
      { type: "assistant", sessionId: "11111111-1111-4111-8111-111111111111", timestamp: "2026-10-21T01:00:05.000Z", message: { role: "assistant", model: "mmodel", usage: { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 20, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 } } } },
      // A zero-counter assistant line must not invent usage events.
      { type: "assistant", sessionId: "11111111-1111-4111-8111-111111111111", timestamp: "2026-10-21T01:00:09.000Z", message: { role: "assistant", model: "mmodel", usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
    ]);
    writeQoderTranscript(home, ".qoder-cn", "D-QoderCN", "22222222-2222-4222-8222-222222222222", [
      { type: "user", sessionId: "22222222-2222-4222-8222-222222222222", timestamp: "2026-10-22T02:00:00.000Z", message: { role: "user", content: "第二条" } },
      { type: "assistant", sessionId: "22222222-2222-4222-8222-222222222222", timestamp: "2026-10-22T02:00:04.000Z", message: { role: "assistant", model: "dfmodel", usage: { input_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 3 } } },
    ]);

    const sessions = await buildSessionAnalytics({
      home,
      force: true,
      cacheTtlMs: 0,
    });
    const bySource = new Map(sessions.map((row) => [row.source, row]));

    const intl = bySource.get("qoder");
    assert.ok(intl, "qoder session must be listed");
    assert.equal(intl.session_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(intl.project_key, "F--work");
    assert.equal(intl.title, "帮我盘点会话层");
    assert.equal(intl.turns, 2);
    assert.equal(intl.usage_events, 1);
    assert.equal(intl.total_tokens, 180);
    assert.equal(intl.usage_precision, "reported");
    assert.equal(intl.model_usage[0].model, "mmodel");
    assert.equal(intl.model_usage[0].usage_events, 1);

    const cn = bySource.get("qoder-cn");
    assert.ok(cn, "qoder-cn session must be listed");
    assert.equal(cn.project_key, "D-QoderCN");
    assert.equal(cn.title, "第二条");
    assert.equal(cn.total_tokens, 10);

    // Qoder bills in credits, so a real conversation whose transcript reports
    // all-zero counters must still reach the browser (unlike token-billed
    // sources, where a zero row is noise). Write one and read the browser view.
    writeQoderTranscript(home, ".qoder-cn", "D-QoderCN", "33333333-3333-4333-8333-333333333333", [
      { type: "user", sessionId: "33333333-3333-4333-8333-333333333333", timestamp: "2026-10-22T03:00:00.000Z", message: { role: "user", content: "零计数会话" } },
      { type: "assistant", sessionId: "33333333-3333-4333-8333-333333333333", timestamp: "2026-10-22T03:00:04.000Z", message: { role: "assistant", model: "dfmodel", usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } },
    ]);
    const refreshed = await buildSessionAnalytics({ home, force: true, cacheTtlMs: 0 });
    const browserRows = listSessionsForBrowser(refreshed, { ...TZ });
    const zeroRow = browserRows.sessions.find((row) => row.session_id === "33333333-3333-4333-8333-333333333333");
    assert.ok(zeroRow, "credit-billed zero-token session must reach the browser");
    assert.equal(zeroRow.total_tokens, 0);
    // …while a zero-token row from a token-billed source stays hidden.
    assert.equal(browserRows.sessions.some((row) => row.source === "claude" && row.total_tokens === 0), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("an absent Qoder install is not incomplete discovery", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-qoder-absent-"));
  try {
    // No .qoder / .qoder-cn at all — the machine simply has neither edition.
    const sessions = await buildSessionAnalytics({ home, force: true, cacheTtlMs: 0 });
    assert.equal(sessions.filter((row) => row.source === "qoder" || row.source === "qoder-cn").length, 0);
    // The sidecar must still persist, or every other source would lose its cache.
    assert.ok(fs.existsSync(path.join(home, ".tokentracker", "tracker", "session.queue.jsonl")));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
