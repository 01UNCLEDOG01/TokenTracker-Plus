'use strict';

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { workbuddySourceForPath, resolveWorkbuddyProjectFiles } = require("../src/lib/rollout");

test("workbuddySourceForPath attributes a file to the edition that owns its data dir", () => {
  assert.equal(
    workbuddySourceForPath(path.join(os.homedir(), ".workbuddy", "projects", "p", "s1.jsonl")),
    "workbuddy"
  );
  assert.equal(
    workbuddySourceForPath(path.join(os.homedir(), ".workbuddy-ai", "projects", "p", "s1.jsonl")),
    "workbuddy-ai"
  );
  assert.equal(
    workbuddySourceForPath(path.join(os.homedir(), ".workbuddy-ai", "traces", "111", "trace_a.json")),
    "workbuddy-ai"
  );
  // POSIX spelling must behave the same (WSL / macOS roots reach this too)
  assert.equal(workbuddySourceForPath("/home/dev/.workbuddy-ai/projects/p/s1.jsonl"), "workbuddy-ai");
  assert.equal(workbuddySourceForPath("/home/dev/.workbuddy/projects/p/s1.jsonl"), "workbuddy");
});

test("a project directory that merely mentions the other edition does not switch source", () => {
  const tricky = path.join(
    os.homedir(), ".workbuddy", "projects", "my-.workbuddy-ai-app", "s1.jsonl"
  );
  assert.equal(workbuddySourceForPath(tricky), "workbuddy");
  const reverse = path.join(
    os.homedir(), ".workbuddy-ai", "projects", "legacy-.workbuddy", "s1.jsonl"
  );
  assert.equal(workbuddySourceForPath(reverse), "workbuddy-ai");
});

test("empty or unknown paths stay on the domestic source", () => {
  assert.equal(workbuddySourceForPath(""), "workbuddy");
  assert.equal(workbuddySourceForPath(null), "workbuddy");
  assert.equal(workbuddySourceForPath(undefined), "workbuddy");
  assert.equal(workbuddySourceForPath("C:/somewhere/else/s1.jsonl"), "workbuddy");
});

test("every discovered file maps to exactly one edition", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-editions-"));
  try {
    for (const [dir, names] of [
      [".workbuddy", ["a.jsonl"]],
      [".workbuddy-ai", ["b.jsonl"]]
    ]) {
      const projects = path.join(home, dir, "projects", "p");
      fs.mkdirSync(projects, { recursive: true });
      for (const n of names) fs.writeFileSync(path.join(projects, n), "{}\n");
    }
    const files = resolveWorkbuddyProjectFiles({ HOME: home });
    const sources = new Map();
    for (const f of files) {
      const p = typeof f === "string" ? f : f.path;
      sources.set(p, workbuddySourceForPath(p));
    }
    const values = [...sources.values()];
    assert.ok(values.includes("workbuddy"), "domestic file attributed");
    assert.ok(values.includes("workbuddy-ai"), "international file attributed");
    assert.equal(new Set(values).size, 2, "each file lands in exactly one bucket");
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
