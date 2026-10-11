'use strict';

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  resolveWorkbuddyHome,
  resolveWorkbuddyHomes,
  resolveWorkbuddyProjectFiles,
} = require("../src/lib/rollout");

function tempHome(withIntl = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "wb-homes-"));
  const seed = (dir, names, traces) => {
    if (!dir && !withIntl) return;
    const projects = path.join(home, dir, "projects", "proj");
    fs.mkdirSync(projects, { recursive: true });
    for (const name of names) fs.writeFileSync(path.join(projects, name), "{}\n");
    const traceDir = path.join(home, dir, "traces", "111");
    fs.mkdirSync(traceDir, { recursive: true });
    for (const name of traces) fs.writeFileSync(path.join(traceDir, name), "{}");
  };
  seed(".workbuddy", ["main-a.jsonl", "agent-1.jsonl"], ["trace_a.json"]);
  if (withIntl) seed(".workbuddy-ai", ["intl-a.jsonl"], ["trace_b.json", "trace_c.json"]);
  return home;
}

test("resolveWorkbuddyHomes", async (t) => {
  await t.test("pairs the international data dir with the domestic one", () => {
    const home = tempHome();
    try {
      const env = { HOME: home };
      const homes = resolveWorkbuddyHomes(env);
      assert.deepEqual(
        homes.map((h) => path.basename(h)).sort(),
        [".workbuddy", ".workbuddy-ai"].sort()
      );
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("collects both homes' files without duplicating paths", () => {
    const home = tempHome();
    try {
      const files = resolveWorkbuddyProjectFiles({ HOME: home });
      const keys = files.map((f) => (typeof f === "string" ? f : f.path));
      assert.equal(new Set(keys).size, keys.length);
      const jsonl = keys.filter((k) => k.endsWith(".jsonl"));
      assert.equal(jsonl.length, 3);
      assert.ok(jsonl.some((k) => k.includes(".workbuddy-ai")), "international jsonl discovered");
      assert.equal(keys.filter((k) => k.includes("trace_")).length, 3);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("an explicit WORKBUDDY_HOME still means exactly one home", () => {
    const home = tempHome();
    try {
      const only = path.join(home, ".workbuddy-ai");
      const env = { HOME: home, WORKBUDDY_HOME: only };
      assert.deepEqual(resolveWorkbuddyHomes(env), [only]);
      const files = resolveWorkbuddyProjectFiles(env);
      assert.equal(files.length, 3);
      assert.ok(files.every((f) => String(typeof f === "string" ? f : f.path).includes(".workbuddy-ai")));
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("a machine without the international edition keeps working", () => {
    const home = tempHome(false);
    try {
      assert.deepEqual(resolveWorkbuddyHomes({ HOME: home }), [path.join(home, ".workbuddy")]);
      assert.equal(resolveWorkbuddyProjectFiles({ HOME: home }).length, 3);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("a non-native primary does not pick up the native sibling", () => {
    // Under a wsl-only pass the primary is a \\wsl.localhost path; adding the
    // native sibling there would make the "both" merge read it twice.
    const wslPath = "\\\\wsl.localhost\\Ubuntu\\home\\dev\\.workbuddy";
    const homes = resolveWorkbuddyHomes({ HOME: process.env.HOME || os.homedir(), WORKBUDDY_HOME: wslPath });
    assert.deepEqual(homes, [wslPath]);
  });

  await t.test("jsonl is ordered before lossy trace summaries", () => {
    const home = tempHome();
    try {
      const files = resolveWorkbuddyProjectFiles({ HOME: home });
      const firstTrace = files.findIndex((f) => typeof f !== "string");
      const lastJsonl = files.map((f) => typeof f).lastIndexOf("string");
      assert.ok(firstTrace === -1 || lastJsonl < firstTrace);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  await t.test("resolveWorkbuddyHome still honours WORKBUDDY_HOME alone", () => {
    assert.equal(resolveWorkbuddyHome({ WORKBUDDY_HOME: "/tmp/explicit" }), "/tmp/explicit");
  });
});
