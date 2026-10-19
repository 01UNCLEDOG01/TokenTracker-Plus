/**
 * Project attribution tests for the three remaining cwd-sourced providers.
 *
 * Each parser mirrors the same contract: usage deltas that carry a workspace
 * location (kimi wire loop events / codearts session directory) also feed the
 * project queue, and rows without a location stay hourly-only. The Agent2API
 * speed endpoint is covered separately through its aggregation invariants.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const { parseKimiIncremental, parseCodeartsIncremental } = require("../src/lib/rollout");

const T0 = Date.UTC(2026, 9, 19, 10);

async function makeGitProject(dir, name, remoteHost) {
  const project = path.join(dir, name);
  fs.mkdirSync(path.join(project, ".git"), { recursive: true });
  fs.writeFileSync(
    path.join(project, ".git", "config"),
    `[remote "origin"]\n\turl = https://${remoteHost}/example/${name}.git\n`,
  );
  return project;
}

function projectRows(file, source) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((row) => row.source === source);
}

// ── Kimi desktop ──

test("kimi wire loop events attribute usage to the workspace project", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-kimi-project-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await makeGitProject(dir, "kimi-proj", "github.com");
  const workspaceDir = path.join(dir, ".kimi-desktop-home", "sessions", "wd_workspace_x", "conv-1", "agents", "main");
  fs.mkdirSync(workspaceDir, { recursive: true });
  const wire = path.join(workspaceDir, "wire.jsonl");
  const lines = [
    JSON.stringify({ event: { display: { cwd: project } } }),
    JSON.stringify({
      timestamp: T0 / 1000,
      message: {
        type: "StatusUpdate",
        payload: {
          message_id: "m-1",
          token_usage: { input_other: 100, output: 50, input_cache_read: 0, input_cache_creation: 0 },
        },
      },
    }),
    "",
  ];
  fs.writeFileSync(wire, lines.join("\n"));
  const cursors = {};
  const queuePath = path.join(dir, "queue.jsonl");
  const projectQueuePath = path.join(dir, "project.queue.jsonl");

  const res = await parseKimiIncremental({
    wireFiles: [wire],
    cursors,
    queuePath,
    projectQueuePath,
    publicRepoResolver: async ({ projectRef }) => ({
      status: "public_verified",
      projectKey: "example/kimi-proj",
      projectRef,
    }),
  });
  assert.equal(res.eventsAggregated, 1);
  const hourly = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse)
    .filter((r) => r.source === "kimi");
  assert.equal(hourly.length, 1);
  const projects = projectRows(projectQueuePath, "kimi");
  assert.equal(projects.length, 1);
  assert.equal(projects[0].project_key, "example/kimi-proj");
  assert.equal(projects[0].total_tokens, 150);

  // Re-run on the unchanged file: the offsets gate keeps both queues flat.
  const res2 = await parseKimiIncremental({
    wireFiles: [wire],
    cursors,
    queuePath,
    projectQueuePath,
    publicRepoResolver: async ({ projectRef }) => ({
      status: "public_verified",
      projectKey: "example/kimi-proj",
      projectRef,
    }),
  });
  assert.equal(res2.eventsAggregated, 0);
  assert.equal(projectRows(projectQueuePath, "kimi").length, 1);
});

// ── CodeArts Agent ──

test("codearts session directory attributes usage to the workspace project", async (t) => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "tt-codearts-project-"));
  t.after(() => fs.promises.rm(dir, { recursive: true, force: true }));
  const project = await makeGitProject(dir, "codearts-proj", "github.com");
  const dbPath = path.join(dir, "opencode.db");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT)");
  db.exec("CREATE TABLE message (session_id TEXT, data TEXT)");
  db.prepare("INSERT INTO session (id, directory) VALUES (?, ?)").run("sess-1", project);
  const data = JSON.stringify({
    role: "assistant",
    finish: "stop",
    modelID: "deepseek-v4.1-flash",
    time: { created: T0 },
    tokens: { input: 200, output: 80, reasoning: 0, cache: { read: 0, write: 0 } },
  });
  db.prepare("INSERT INTO message (session_id, data) VALUES (?, ?)").run("sess-1", data);
  db.close();

  const cursors = {};
  const queuePath = path.join(dir, "queue.jsonl");
  const projectQueuePath = path.join(dir, "project.queue.jsonl");
  const res = await parseCodeartsIncremental({
    dbPath,
    cursors,
    queuePath,
    projectQueuePath,
    publicRepoResolver: async ({ projectRef }) => ({
      status: "public_verified",
      projectKey: "example/codearts-proj",
      projectRef,
    }),
  });
  assert.equal(res.eventsAggregated, 1);
  const hourly = fs.readFileSync(queuePath, "utf8").trim().split("\n").map(JSON.parse)
    .filter((r) => r.source === "codearts");
  assert.equal(hourly.length, 1);
  const projects = projectRows(projectQueuePath, "codearts");
  assert.equal(projects.length, 1);
  assert.equal(projects[0].project_key, "example/codearts-proj");
  assert.equal(projects[0].total_tokens, 280);
});
