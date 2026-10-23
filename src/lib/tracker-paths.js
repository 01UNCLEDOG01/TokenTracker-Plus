const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function getTrackerRootDir({ home = os.homedir() } = {}) {
  if (process.env.TOKENTRACKER_HOME) return process.env.TOKENTRACKER_HOME;
  const plusDir = path.join(home, ".tokentracker-plus");
  if (fs.existsSync(plusDir)) return plusDir;
  return path.join(home, ".tokentracker");
}

function resolveTrackerPathsSync({ home = os.homedir() } = {}) {
  const rootDir = getTrackerRootDir({ home });
  return {
    rootDir,
    trackerDir: path.join(rootDir, "tracker"),
    binDir: path.join(rootDir, "bin"),
    cacheDir: path.join(rootDir, "cache"),
    petsDir: path.join(rootDir, "pets"),
    skillsDir: path.join(rootDir, "skills"),
  };
}

async function resolveTrackerPaths(opts) {
  return resolveTrackerPathsSync(opts);
}

module.exports = {
  getTrackerRootDir,
  resolveTrackerPathsSync,
  resolveTrackerPaths,
};
