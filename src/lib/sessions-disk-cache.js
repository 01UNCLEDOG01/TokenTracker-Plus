const fs = require("node:fs/promises");
const { setImmediate: yieldToRequests } = require("node:timers/promises");

const SCHEMA_VERSION = 1;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function isUsableSessionsCache(value, now = Date.now()) {
  const savedAt = typeof value?.savedAt === "string" ? Date.parse(value.savedAt) : NaN;
  return value?.schemaVersion === SCHEMA_VERSION && Array.isArray(value.sessions)
    && Number.isFinite(savedAt) && savedAt <= now && now - savedAt <= MAX_AGE_MS;
}

function createSessionsDiskCache(target, { fileSystem = fs } = {}) {
  let loaded;
  let current = null;
  let writes = Promise.resolve();
  return {
    async load() {
      loaded ||= fileSystem.readFile(target, "utf8").then((text) => {
        const value = JSON.parse(text);
        if (!current && isUsableSessionsCache(value)) current = value;
      }).catch(() => {});
      await loaded;
      return isUsableSessionsCache(current) ? current : null;
    },
    save(sessions) {
      const snapshot = { schemaVersion: SCHEMA_VERSION, savedAt: new Date().toISOString(), sessions };
      current = snapshot;
      // Serialize after the HTTP response gets a chance to leave; serialize
      // writes so an older scan cannot rename over a newer snapshot.
      writes = writes.catch(() => {}).then(async () => {
        await yieldToRequests();
        await fileSystem.writeFile(`${target}.tmp`, JSON.stringify(snapshot));
        await fileSystem.rename(`${target}.tmp`, target);
      });
      return writes;
    },
  };
}

module.exports = { createSessionsDiskCache, isUsableSessionsCache, SCHEMA_VERSION, MAX_AGE_MS };
