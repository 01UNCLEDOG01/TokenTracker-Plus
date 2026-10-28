const fs = require("node:fs");
const path = require("node:path");
const { scip } = require("@sourcegraph/scip-typescript/dist/src/scip");

// node:sqlite ships with Node 22.5+ (CI runs Node 24). Wiring the import
// through it removes the external sqlite3 CLI dependency, which was not
// installable on every dev machine (Windows).
let DatabaseSync = null;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch {
  // Node < 22.5 — the helpful error below fires when importScip is called.
}

function importScip({ rootDir, scipPath, dbPath, deps = {} }) {
  const parseScipFile = deps.parseScipFile || ((p) => parseIndex(p, fs));
  const Open = deps.DatabaseSync !== undefined ? deps.DatabaseSync : DatabaseSync;
  if (!Open) {
    throw new Error(
      "node:sqlite is not available. Please use Node.js >= 22.5 to run graph imports.",
    );
  }
  const targetDb = dbPath || path.join(rootDir, "data", "graph.sqlite");
  fs.mkdirSync(path.dirname(targetDb), { recursive: true });

  const index = parseScipFile(scipPath);
  const sql = buildSql(index);
  const db = new Open(targetDb);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
  return targetDb;
}

function parseIndex(scipPath, fsDep) {
  const buf = fsDep.readFileSync(scipPath);
  const index = scip.Index.deserialize(buf);
  return index.toObject();
}

function buildSql(index) {
  const docs = Array.isArray(index.documents) ? index.documents : [];
  const symbolSet = new Set();
  const occurrences = [];

  for (const doc of docs) {
    const relPath = doc.relative_path || doc.relativePath || "";
    const occs = Array.isArray(doc.occurrences) ? doc.occurrences : [];
    for (const occ of occs) {
      if (!occ.symbol) continue;
      const role = resolveRole(occ.symbol_roles ?? occ.symbolRoles ?? 0);
      if (!role) continue;
      const { startLine, startCharacter, endLine, endCharacter } = parseRange(occ.range || []);
      occurrences.push({
        relativePath: relPath,
        symbol: occ.symbol,
        role,
        startLine,
        startCharacter,
        endLine,
        endCharacter,
      });
      symbolSet.add(occ.symbol);
    }
  }

  const symbols = Array.from(symbolSet);
  const lines = [
    "PRAGMA journal_mode=WAL;",
    "BEGIN;",
    "CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, relative_path TEXT UNIQUE);",
    "CREATE TABLE IF NOT EXISTS symbols (id INTEGER PRIMARY KEY, symbol TEXT UNIQUE);",
    "CREATE TABLE IF NOT EXISTS occurrences (",
    "  id INTEGER PRIMARY KEY,",
    "  document_id INTEGER,",
    "  symbol_id INTEGER,",
    "  role TEXT,",
    "  start_line INTEGER,",
    "  start_character INTEGER,",
    "  end_line INTEGER,",
    "  end_character INTEGER",
    ");",
    "CREATE INDEX IF NOT EXISTS idx_occurrences_symbol ON occurrences(symbol_id);",
    "CREATE INDEX IF NOT EXISTS idx_occurrences_document ON occurrences(document_id);",
  ];

  for (const doc of docs) {
    const relPath = doc.relative_path || doc.relativePath || "";
    if (!relPath) continue;
    lines.push(`INSERT OR IGNORE INTO documents(relative_path) VALUES ('${escapeSql(relPath)}');`);
  }

  for (const doc of docs) {
    const relPath = doc.relative_path || doc.relativePath || "";
    if (!relPath) continue;
    lines.push(
      `DELETE FROM occurrences WHERE document_id=` +
        `(SELECT id FROM documents WHERE relative_path='${escapeSql(relPath)}');`,
    );
  }

  for (const symbol of symbols) {
    lines.push(`INSERT OR IGNORE INTO symbols(symbol) VALUES ('${escapeSql(symbol)}');`);
  }

  for (const occ of occurrences) {
    if (!occ.relativePath) continue;
    lines.push(
      `INSERT INTO occurrences(document_id, symbol_id, role, start_line, start_character, end_line, end_character)` +
        ` VALUES (` +
        `(SELECT id FROM documents WHERE relative_path='${escapeSql(occ.relativePath)}'),` +
        `(SELECT id FROM symbols WHERE symbol='${escapeSql(occ.symbol)}'),` +
        `'${occ.role}',${occ.startLine},${occ.startCharacter},${occ.endLine},${occ.endCharacter}` +
        `);`,
    );
  }

  lines.push("COMMIT;");
  return lines.join("\n");
}

function resolveRole(symbolRoles) {
  if ((symbolRoles & scip.SymbolRole.Definition) === scip.SymbolRole.Definition) {
    return "definition";
  }
  if (
    (symbolRoles & scip.SymbolRole.ReadAccess) === scip.SymbolRole.ReadAccess ||
    (symbolRoles & scip.SymbolRole.WriteAccess) === scip.SymbolRole.WriteAccess ||
    (symbolRoles & scip.SymbolRole.Import) === scip.SymbolRole.Import ||
    (symbolRoles & scip.SymbolRole.ForwardDefinition) === scip.SymbolRole.ForwardDefinition
  ) {
    return "reference";
  }
  return null;
}

function parseRange(range) {
  if (range.length === 3) {
    return {
      startLine: range[0],
      startCharacter: range[1],
      endLine: range[0],
      endCharacter: range[2],
    };
  }
  if (range.length >= 4) {
    return {
      startLine: range[0],
      startCharacter: range[1],
      endLine: range[2],
      endCharacter: range[3],
    };
  }
  return { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 };
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

module.exports = { importScip, buildSql };
