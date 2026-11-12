const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const writer = read("scripts/self-host/local-backend.cjs");
const manifest = read("scripts/self-host/manifest.cjs");
const deviceRowMigrationName = "20261112120000_self-host-leaderboard-device-rows.sql";
const deviceRowMigration = read(`migrations/${deviceRowMigrationName}`);
const migrationName = "20261112150000_self-host-leaderboard-provider-columns.sql";
const migration = read(`migrations/${migrationName}`);
const profileEdge = read("dashboard/edge-patches/tokentracker-leaderboard-profile.ts");
const refreshEdge = read("dashboard/edge-patches/tokentracker-leaderboard-refresh.ts");

// The provider columns the snapshot table stores. The dashboard renders one
// column per key (LEADERBOARD_TOKEN_COLUMNS), so the two lists must not drift.
const PROVIDER_COLUMNS = [
  "gpt_tokens", "claude_tokens", "gemini_tokens", "cursor_tokens", "opencode_tokens",
  "openclaw_tokens", "hermes_tokens", "kiro_tokens", "copilot_tokens", "kimi_tokens",
  "zcode_tokens", "dsh_tokens", "trae_cn_tokens", "workbuddy_tokens",
  "workbuddy_ai_tokens", "antigravity_tokens", "qoder_tokens", "qoder_cn_tokens",
  "codearts_tokens", "agent2api_tokens", "other_tokens",
];

test("migrations add every provider column, plus device_id and its unique key", () => {
  for (const column of PROVIDER_COLUMNS) {
    assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}\\b`), column);
  }
  assert.match(deviceRowMigration, /ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT ''/);
  assert.match(deviceRowMigration, /tokentracker_leaderboard_snapshots_device_key/);
  // The account-level unique key must go, or an account's second device row is
  // rejected. Dropped by lookup, not by a guessed generated name.
  assert.match(deviceRowMigration, /contype = 'u'/);
  assert.match(deviceRowMigration, /DROP CONSTRAINT %I/);
});

test("the migration is part of the installable self-host manifest", () => {
  for (const name of [deviceRowMigrationName, migrationName]) {
    assert.ok(
      manifest.includes(name),
      `a migration that is not in manifest.steps() never reaches a real instance: ${name}`,
    );
  }
  assert.match(manifest, /17-leaderboard-device-rows/);
  assert.match(manifest, /18-leaderboard-provider-columns/);
});

test("snapshot writer fills the provider columns from one column list", () => {
  for (const column of PROVIDER_COLUMNS) {
    assert.ok(writer.includes(`"${column}"`), `writer must name ${column}`);
  }
  // The INSERT (columns, placeholders, DO UPDATE clause) is generated from
  // PROVIDER_COLUMNS, so a new provider column cannot desync the placeholder
  // count — the failure mode that kept snapshots empty for weeks.
  assert.match(writer, /const insertColumns = \[/);
  assert.match(writer, /const insertPlaceholders = insertColumns\.map/);
  assert.match(writer, /const insertUpdates = insertColumns/);
  assert.ok(writer.includes('+ " (" + insertColumns.join(", ") + ", generated_at)"'));
  assert.ok(writer.includes("...row.slice(14, 14 + PROVIDER_COLUMNS.length)"));
});

test("provider columns are derived from the same deduped scan as the totals", () => {
  // One scan grouped to (device, source, model); both rows are folded in JS.
  assert.ok(writer.includes("GROUP BY dev_id, source, model"));
  assert.match(writer, /const column = SOURCE_COLUMN\[grain\.source\] \|\| "other_tokens"/);
  assert.match(writer, /bucket\[column\] \+= tokens/);
});

test("hosted refresh writes the same fork provider columns as the self-host writer", () => {
  // Two writers fill one table. If only one learns a new source the other
  // leaves that column null, and the leaderboard renders "-" for whoever the
  // other writer covered.
  const forkSources = {
    zcode: "zcode_tokens",
    dsh: "dsh_tokens",
    "trae-cn": "trae_cn_tokens",
    workbuddy: "workbuddy_tokens",
    "workbuddy-ai": "workbuddy_ai_tokens",
    antigravity: "antigravity_tokens",
    qoder: "qoder_tokens",
    "qoder-cn": "qoder_cn_tokens",
    codearts: "codearts_tokens",
    agent2api: "agent2api_tokens",
  };
  for (const [source, column] of Object.entries(forkSources)) {
    // Keys are written bare where the identifier allows it ("agent2api" does
    // not contain a dash but does contain a digit — both forms are legal).
    const matches = (text) => text.includes(`${source}: "${column}"`) || text.includes(`"${source}": "${column}"`);
    assert.ok(matches(writer), `self-host writer must map ${source} → ${column}`);
    assert.ok(matches(refreshEdge), `hosted refresh must map ${source} → ${column}`);
    assert.ok(refreshEdge.includes(`${column}: agg.${column}`), `hosted refresh must write ${column}`);
  }
  // Both writers key on device_id now that the unique index includes it.
  assert.ok(refreshEdge.includes('onConflict: "user_id,period,from_day,to_day,device_id"'));
  assert.ok(refreshEdge.includes('device_id: ""'));
});

test("provider column list is declared where the row writer can see it", () => {
  // The INSERT block runs after the per-user loop (ranking spans every user),
  // so the column list must not live inside that loop — the first deploy did,
  // and every refresh died with "PROVIDER_COLUMNS is not defined".
  const providerAt = writer.indexOf("const PROVIDER_COLUMNS = [");
  const collectedAt = writer.indexOf("const collected = [];");
  const insertAt = writer.indexOf("const insertColumns = [");
  assert.ok(providerAt > 0 && collectedAt > 0 && insertAt > 0);
  assert.ok(providerAt < collectedAt, "PROVIDER_COLUMNS must precede the collected-rows buffer");
  assert.ok(providerAt < insertAt, "PROVIDER_COLUMNS must precede the INSERT builder");
});

test("per-device rows are priced per device, not with the account total", () => {
  // Cost comes from the account-summary bundle (raw hourly rows carry zeros);
  // without the device filter every device row showed the same account cost.
  assert.match(writer, /const summaryCost = async \(fromDay, toDay, deviceId\)/);
  assert.match(writer, /"&device_id=" \+ encodeURIComponent\(deviceId\)/);
  // A machine cluster can hold several device_ids; each is priced and summed,
  // otherwise a clustered machine silently falls back to a zero stored cost.
  assert.match(writer, /const clusterDeviceIds = \(await db\.query\(/);
  assert.match(writer, /const cost = await summaryCost\(fromDay, toDay, clusterDevice\.id\)/);
  assert.match(writer, /deviceCost = \(deviceCost \?\? 0\) \+ cost/);
  assert.ok(!writer.includes("costByPeriod"), "the account-wide cost map must not price device rows");
});

test("rank order sorts on total_tokens, not on the avatar URL", () => {
  assert.match(writer, /rows\.sort\(\(a, b\) => Number\(b\[7\]\) - Number\(a\[7\]\)\)/);
});

test("leaderboard-profile accepts a device scope and pins the RPC to it", () => {
  assert.match(profileEdge, /const UUID_RE =/);
  assert.match(profileEdge, /url\.searchParams\.get\("device_id"\)/);
  assert.match(profileEdge, /p_device_id: deviceId && UUID_RE\.test\(deviceId\) \? deviceId : null/);
  // The snapshot row behind rank/name must follow the same scope.
  assert.match(profileEdge, /\.eq\("device_id", deviceId\)/);
  // And the modal title falls back to the snapshot name so device rows differ.
  assert.match(profileEdge, /device_id: deviceId,/);
});

test("dashboard provider columns match the writer's column set", () => {
  const columnsSource = read("dashboard/src/lib/leaderboard-columns.js");
  const keys = [...columnsSource.matchAll(/\{ key: "([a-z0-9_]*_tokens)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), [...PROVIDER_COLUMNS].sort());
});
