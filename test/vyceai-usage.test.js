const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { persistVyceaiUsageRows, defaultStatePath } = require("../src/lib/vyceai-usage");

const ME = (glmIn, glmOut, lunaIn, lunaOut) => ({
  name: "gengxutang",
  balance: 60,
  totalSpent: 2.161502,
  totalRequests: 4,
  modelUsage: {
    "glm-5.3-flash": { inputTokens: glmIn, outputTokens: glmOut, cost: 0 },
    "gpt-6-luna": { inputTokens: lunaIn, outputTokens: lunaOut, cost: 2.16 },
  },
});

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vyce-usage-"));
}

function writeCredentials(home, apiKey) {
  const trackerDir = path.join(home, ".tokentracker");
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, "vyceai-credentials.json"), JSON.stringify({ api_key: apiKey }));
}

async function run(home, payload, nowMs = 1793600000000) {
  const queuePath = path.join(home, ".tokentracker", "tracker", "queue.jsonl");
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  return persistVyceaiUsageRows({
    queuePath,
    home,
    env: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => payload }),
    nowMs,
  });
}

function readRows(home) {
  const queuePath = path.join(home, ".tokentracker", "tracker", "queue.jsonl");
  if (!fs.existsSync(queuePath)) return [];
  return fs.readFileSync(queuePath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

test("first run adopts the current cumulative as real usage rows", async () => {
  const home = tempHome();
  writeCredentials(home, "sk-test");
  const res = await run(home, ME(324161, 292, 1079309, 1442));
  assert.equal(res.appended, 2);
  const rows = readRows(home);
  assert.equal(rows.length, 2);
  const glm = rows.find((r) => r.model === "glm-5.3-flash");
  assert.equal(glm.source, "vyceai");
  assert.equal(glm.input_tokens, 324161);
  assert.equal(glm.total_tokens, 324161 + 292);
  assert.equal(glm.billable_total_tokens, glm.total_tokens);
  // Falls in the current UTC hour bucket (no server-side timestamps exist).
  assert.match(glm.hour_start, /^2026-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
  // State advanced to the cumulative, so an identical next cycle is a no-op.
  const again = await run(home, ME(324161, 292, 1079309, 1442));
  assert.equal(again.appended, 0);
  assert.equal(readRows(home).length, 2);
});

test("later deltas append only the growth", async () => {
  const home = tempHome();
  writeCredentials(home, "sk-test");
  await run(home, ME(1000, 100, 0, 0));
  await run(home, ME(3000, 150, 500, 20));
  const rows = readRows(home);
  const glm = rows.filter((r) => r.model === "glm-5.3-flash");
  const luna = rows.filter((r) => r.model === "gpt-6-luna");
  assert.equal(glm.length, 2);
  assert.equal(glm[1].input_tokens, 2000);
  assert.equal(glm[1].output_tokens, 50);
  assert.equal(luna.length, 1);
  assert.equal(luna[0].input_tokens, 500);
});

test("a counter reset books the whole current cumulative", async () => {
  const home = tempHome();
  writeCredentials(home, "sk-test");
  await run(home, ME(10000, 500, 0, 0));
  // Site counter drops below the previous watermark → treat as a reset.
  await run(home, ME(400, 20, 0, 0));
  const rows = readRows(home).filter((r) => r.model === "glm-5.3-flash");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].input_tokens, 400);
  assert.equal(rows[1].output_tokens, 20);
});

test("no credentials and fetch failures are silent no-ops", async () => {
  const home = tempHome();
  const noCreds = await persistVyceaiUsageRows({
    queuePath: path.join(home, "q.jsonl"),
    home,
    env: {},
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ME(1, 1, 1, 1) }),
  });
  assert.deepEqual(noCreds, { appended: 0, reason: "no-credentials" });
  writeCredentials(home, "sk-test");
  const failed = await persistVyceaiUsageRows({
    queuePath: path.join(home, "q.jsonl"),
    home,
    env: {},
    fetchImpl: async () => { throw new Error("down"); },
  });
  assert.deepEqual(failed, { appended: 0, reason: "fetch-failed" });
});

test("state file lands in the tracker dir by default", () => {
  const home = tempHome();
  assert.equal(
    defaultStatePath(home),
    path.join(home, ".tokentracker", "tracker", "vyceai-usage-state.json"),
  );
});
