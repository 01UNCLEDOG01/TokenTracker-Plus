"use strict";

// The forced refresh path (?refresh=1) re-walks and re-stats every session
// file but must reuse the cached row for a file whose stat_key still matches:
// before that, refresh re-parsed the whole local inventory (10k+ files) even
// when nothing had changed. These tests pin both sides of that contract.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildSessionAnalytics } = require("../src/lib/session-analytics");

function writeClaudeSession(home, project, sessionId, model) {
  const projectDir = path.join(home, ".claude", "projects", project);
  fs.mkdirSync(projectDir, { recursive: true });
  const filePath = path.join(projectDir, `${sessionId}.jsonl`);
  const rows = [
    { type: "user", sessionId, cwd: projectDir, timestamp: "2026-07-18T05:00:00Z", message: { content: "build" } },
    { type: "assistant", sessionId, cwd: projectDir, timestamp: "2026-07-18T05:00:01Z", message: { id: `${sessionId}-message`, model, usage: { input_tokens: 10, output_tokens: 2 }, content: [] } },
  ];
  fs.writeFileSync(filePath, `${rows.map(JSON.stringify).join("\n")}\n`);
  return filePath;
}

function sidecarPaths(home) {
  const sidecarPath = path.join(home, ".tokentracker", "tracker", "session.queue.jsonl");
  return { sidecarPath, metaPath: `${sidecarPath}.meta.json` };
}

function stampSentinelTitle(sidecarPath, projectKey) {
  const rows = fs.readFileSync(sidecarPath, "utf8").trim().split("\n").map(JSON.parse);
  rows.find((row) => row.project_key === projectKey).title = "cached-proof";
  fs.writeFileSync(sidecarPath, `${rows.map(JSON.stringify).join("\n")}\n`);
}

test("forced refresh reuses the cached row of an unchanged session file", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-session-force-reuse-"));
  writeClaudeSession(home, "project-a", "session-a", "claude-a");

  await buildSessionAnalytics({ home, force: true });
  const { sidecarPath } = sidecarPaths(home);
  stampSentinelTitle(sidecarPath, "project-a");

  const refreshed = await buildSessionAnalytics({ home, force: true });
  assert.equal(refreshed.find((row) => row.project_key === "project-a").title, "cached-proof");
});

test("forced refresh rescans a session file whose stat changed", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-session-force-change-"));
  const changedFile = writeClaudeSession(home, "project-b", "session-b", "claude-b");

  await buildSessionAnalytics({ home, force: true });
  fs.appendFileSync(changedFile, `${JSON.stringify({
    type: "user",
    sessionId: "session-b",
    cwd: path.dirname(changedFile),
    timestamp: "2026-07-18T05:00:02Z",
    message: { content: "changed" },
  })}\n`);

  const refreshed = await buildSessionAnalytics({ home, force: true });
  assert.equal(refreshed.find((row) => row.project_key === "project-b").turns, 2);
});

test("forced refresh picks up a session file added between builds", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-session-force-new-"));
  writeClaudeSession(home, "project-a", "session-a", "claude-a");
  await buildSessionAnalytics({ home, force: true });

  writeClaudeSession(home, "project-b", "session-b", "claude-b");
  const refreshed = await buildSessionAnalytics({ home, force: true });
  const mine = refreshed.filter((row) => ["project-a", "project-b"].includes(row.project_key));
  assert.equal(mine.length, 2);
});

test("a sidecar version mismatch still rebuilds on a forced refresh", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tt-session-force-version-"));
  writeClaudeSession(home, "project-a", "session-a", "claude-a");

  await buildSessionAnalytics({ home, force: true });
  const { sidecarPath, metaPath } = sidecarPaths(home);
  stampSentinelTitle(sidecarPath, "project-a");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.version = meta.version + 1;
  fs.writeFileSync(metaPath, `${JSON.stringify(meta)}\n`);

  const rebuilt = await buildSessionAnalytics({ home, force: true });
  assert.notEqual(rebuilt.find((row) => row.project_key === "project-a").title, "cached-proof");
});
