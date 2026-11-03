const test = require("node:test");
const assert = require("node:assert/strict");
const { createSessionsDiskCache, isUsableSessionsCache, SCHEMA_VERSION, MAX_AGE_MS } = require("../src/lib/sessions-disk-cache");

test("legacy, damaged, future and expired snapshots are rejected; empty current snapshots are valid", () => {
  const now = Date.now();
  const value = { schemaVersion: SCHEMA_VERSION, sessions: [], savedAt: new Date(now).toISOString() };
  assert.equal(isUsableSessionsCache(value, now), true);
  assert.equal(isUsableSessionsCache({ ...value, savedAt: new Date(now - MAX_AGE_MS).toISOString() }, now), true);
  for (const invalid of [null, { ...value, schemaVersion: undefined }, { ...value, schemaVersion: 999 },
    { ...value, sessions: {} }, { ...value, savedAt: "invalid" }, { ...value, savedAt: new Date(now + 1).toISOString() },
    { ...value, savedAt: new Date(now - MAX_AGE_MS - 1).toISOString() }]) {
    assert.equal(isUsableSessionsCache(invalid, now), false);
  }
});

test("disk reads coalesce and serialized atomic writes leave the newest snapshot", async () => {
  let reads = 0;
  const files = new Map([["cache", JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), sessions: [1] })]]);
  const fileSystem = {
    async readFile(target) { reads++; return files.get(target); },
    async writeFile(target, text) { files.set(target, text); },
    async rename(from, to) { files.set(to, files.get(from)); },
  };
  const cache = createSessionsDiskCache("cache", { fileSystem });
  const values = await Promise.all([cache.load(), cache.load()]);
  assert.equal(reads, 1);
  assert.deepEqual(values[0].sessions, [1]);
  await Promise.all([cache.save([2]), cache.save([3])]);
  assert.deepEqual(JSON.parse(files.get("cache")).sessions, [3]);
  assert.deepEqual((await cache.load()).sessions, [3]);
});

test("a failed write does not prevent a later snapshot from being persisted", async () => {
  let failures = 1;
  let saved;
  const cache = createSessionsDiskCache("cache", { fileSystem: {
    async readFile() { throw new Error("missing"); },
    async writeFile(_, text) { if (failures--) throw new Error("locked"); saved = text; },
    async rename() {},
  } });
  assert.equal(await cache.load(), null);
  await assert.rejects(cache.save([1]));
  await cache.save([2]);
  assert.deepEqual(JSON.parse(saved).sessions, [2]);
});
