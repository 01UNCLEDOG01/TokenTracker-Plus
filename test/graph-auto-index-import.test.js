const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const { importScip, buildSql } = require("../scripts/graph/lib/importer.cjs");

test("importScip writes sqlite with documents, symbols, and occurrences", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-import-"));
  const dbPath = path.join(tmpDir, "graph.sqlite");
  const deps = {
    parseScipFile: () => ({
      documents: [
        {
          relative_path: "src/a.ts",
          occurrences: [
            {
              symbol: "test foo",
              symbol_roles: 1,
              range: [0, 0, 0],
            },
            {
              symbol: "test foo",
              symbol_roles: 8,
              range: [1, 2, 1, 4],
            },
          ],
        },
      ],
    }),
  };

  importScip({ rootDir: tmpDir, scipPath: "/repo/index.src.scip", dbPath, deps });

  const db = new DatabaseSync(dbPath);
  try {
    const scalar = (sql) => db.prepare(sql).get().n;
    const docsCount = Number(scalar("select count(*) as n from documents"));
    const symbolsCount = Number(scalar("select count(*) as n from symbols"));
    const occurrencesCount = Number(scalar("select count(*) as n from occurrences"));
    const defsCount = Number(
      scalar("select count(*) as n from occurrences where role='definition'"),
    );

    assert.equal(docsCount, 1);
    assert.equal(symbolsCount, 1);
    assert.equal(occurrencesCount, 2);
    assert.equal(defsCount, 1);
  } finally {
    db.close();
  }
});

test("importScip deletes existing occurrences for documents before insert", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-import-"));
  const sqls = [];
  const deps = {
    DatabaseSync: class {
      exec(sql) {
        sqls.push(sql);
      }
      close() {}
    },
    parseScipFile: () => ({
      documents: [
        {
          relative_path: "src/a.ts",
          occurrences: [
            {
              symbol: "test foo",
              symbol_roles: 1,
              range: [0, 0, 0],
            },
          ],
        },
      ],
    }),
  };

  importScip({ rootDir: tmpDir, scipPath: "/repo/index.src.scip", deps });

  const sql = sqls.join("\n");
  const docsInsert = sql.indexOf("INSERT OR IGNORE INTO documents");
  const deleteOccurrences = sql.indexOf("DELETE FROM occurrences");
  assert.ok(docsInsert !== -1);
  assert.ok(deleteOccurrences !== -1);
  assert.ok(deleteOccurrences > docsInsert);
});

test("buildSql escapes single quotes in identifiers", () => {
  const sql = buildSql({
    documents: [
      {
        relative_path: "src/it's.ts",
        occurrences: [{ symbol: "sym'i", symbol_roles: 1, range: [0, 0, 0] }],
      },
    ],
  });
  assert.ok(sql.includes("'src/it''s.ts'"));
  assert.ok(sql.includes("'sym''i'"));
});

test("importScip throws helpful error when node:sqlite is unavailable", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-import-"));
  const deps = {
    DatabaseSync: null,
    parseScipFile: () => ({
      documents: [{ relative_path: "src/a.ts", occurrences: [] }],
    }),
  };

  assert.throws(
    () => importScip({ rootDir: tmpDir, scipPath: "/repo/index.src.scip", deps }),
    /node:sqlite.*22\.5/i,
  );
});
