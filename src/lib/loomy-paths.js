"use strict";

// Loomy (the desktop AI assistant) embeds its own OpenCode runtime and keeps
// every conversation in a single SQLite database under its per-install data
// directory:
//
//   <Public>/Loomy/<installId>/share/opencode/opencode.db
//
// The schema is OpenCode's own (session / message / part), so the existing
// OpenCode database reader parses it unchanged. Loomy is registered under its
// own source key ("loomy") so its tokens never fold into a standalone OpenCode
// install — the two are different products and must keep separate buckets.
//
// Windows is the only platform Loomy ships on today, but the resolver stays
// platform-agnostic: the shared `Public` profile root is derived as the sibling
// of the user home, never from the ambient PUBLIC variable, so a sandboxed or
// test home scans its own tree instead of the machine's real installs. An
// explicit LOOMY_HOME always wins, letting a portable or CI layout point
// straight at the install dir, its `share/opencode` folder, or the DB file.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DB_FILE = "opencode.db";
const REL_DB = path.join("share", "opencode", DB_FILE);

function isDbFile(target) {
  return path.basename(String(target || "")).toLowerCase() === DB_FILE;
}

// Expand an explicit LOOMY_HOME into the concrete DB path it names. Accepts the
// install root, the `share/opencode` directory, or the database file itself.
function dbPathFromRoot(root) {
  if (!root) return null;
  if (isDbFile(root)) return root;
  const base = path.basename(String(root)).toLowerCase();
  if (base === "opencode") return path.join(root, DB_FILE);
  return path.join(root, REL_DB);
}

function resolveLoomyDbPaths({ env = process.env, home = os.homedir(), deps = {} } = {}) {
  const existsSync = deps.existsSync || fs.existsSync;
  const readdirSync = deps.readdirSync || fs.readdirSync;

  const seen = new Set();
  const out = [];
  const push = (candidate) => {
    if (typeof candidate !== "string" || !candidate) return;
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) return;
    seen.add(resolved);
    if (existsSync(resolved)) out.push(resolved);
  };

  const explicit = typeof env.LOOMY_HOME === "string" && env.LOOMY_HOME.trim()
    ? env.LOOMY_HOME.trim()
    : "";
  if (explicit) push(dbPathFromRoot(path.resolve(explicit)));

  const publicDir = path.join(path.dirname(path.resolve(home)), "Public");
  const loomyRoot = path.join(publicDir, "Loomy");

  let installs = [];
  try {
    installs = readdirSync(loomyRoot, { withFileTypes: true })
      .filter((entry) => entry && typeof entry.isDirectory === "function" && entry.isDirectory())
      .map((entry) => path.join(loomyRoot, entry.name));
  } catch (_error) {
    installs = [];
  }
  for (const install of installs) push(path.join(install, REL_DB));

  return out;
}

module.exports = { resolveLoomyDbPaths, LOOMY_DB_RELATIVE_PATH: REL_DB };
