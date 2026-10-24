#!/usr/bin/env node
// Catch a half-built or half-mirrored dashboard: every /assets/* file that
// index.html references must exist next to it, and the entry bundle must be a
// hashed main-*.js. Run after the build and against each deployed copy.
const fs = require("node:fs");
const path = require("node:path");

const dist = path.resolve(process.argv[2] || "dashboard/dist");
const indexPath = path.join(dist, "index.html");
if (!fs.existsSync(indexPath)) {
  console.error(`dist gate: missing ${indexPath}`);
  process.exit(1);
}

const html = fs.readFileSync(indexPath, "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
if (!refs.length) {
  console.error(`dist gate: ${indexPath} references no /assets/ files`);
  process.exit(1);
}
if (!refs.some((ref) => /\/assets\/main-[^/]+\.js$/.test(ref))) {
  console.error("dist gate: index.html does not reference a hashed main-*.js");
  process.exit(1);
}

const missing = refs.filter((ref) => !fs.existsSync(path.join(dist, ref.replace(/^\//, ""))));
if (missing.length) {
  console.error(`dist gate: ${missing.length} referenced asset(s) missing in ${dist}`);
  for (const ref of missing) console.error(`  - ${ref}`);
  process.exit(1);
}

console.log(`dist assets ok (${refs.length} referenced, ${path.basename(dist)} ${path.basename(path.dirname(dist))})`);
