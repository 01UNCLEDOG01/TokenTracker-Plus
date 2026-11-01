// Guard: every `npm run <script>` referenced by a GitHub Actions workflow must
// exist in package.json. The Linux CI job spent every push red because ci.yml
// still called `validate:bot-frames` after scripts/gen-bot-frames.cjs was
// deleted together with the macOS/Linux clients (2026-10-28). npm exits 1 on an
// unknown script, so the job failed at the last validation while every local
// gate stayed green (ci:local never mentioned that script).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");
const scripts = require(path.join(ROOT, "package.json")).scripts || {};
const NPM_RUN = /\bnpm run ([\w:.-]+)/g;

function workflowFiles() {
  if (!fs.existsSync(WORKFLOW_DIR)) return [];
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => path.join(WORKFLOW_DIR, name));
}

test("workflows only invoke npm scripts that exist in package.json", () => {
  const missing = [];
  for (const file of workflowFiles()) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      // Full-line YAML comments mention scripts without running them.
      if (line.trimStart().startsWith("#")) return;
      for (const match of line.matchAll(NPM_RUN)) {
        if (!scripts[match[1]]) {
          missing.push(`${path.relative(ROOT, file)}:${index + 1} -> npm run ${match[1]}`);
        }
      }
    });
  }
  assert.deepEqual(
    missing,
    [],
    `workflows reference npm scripts that package.json does not define:\n${missing.join("\n")}`,
  );
});
