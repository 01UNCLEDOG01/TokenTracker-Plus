#!/usr/bin/env node
// Every byte change under dashboard/public/achievements must come with a bumped
// `?v=` in the catalog/registry that references it. Without this gate a rebuilt
// PNG keeps its old URL and the WebView happily serves the cached copy.
//
// Usage:
//   node scripts/ops/validate-art-versions.cjs            # working tree vs HEAD
//   node scripts/ops/validate-art-versions.cjs --staged   # pre-commit
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ART_DIR = "dashboard/public/achievements";
const REFERENCES = [
  "dashboard/src/ui/achievements/badge-catalog.js",
  "dashboard/src/ui/achievements/title-registry.js",
];

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
}

function changedArt(staged) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=AM"]
    : ["diff", "--name-only", "--diff-filter=AM", "HEAD"];
  return git(args)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith(`${ART_DIR}/`) && line.endsWith(".png"));
}

function versionsIn(text, filename) {
  const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`/achievements/${escaped}\\?v=(\\d+)`, "g");
  const out = [];
  let match;
  while ((match = re.exec(text)) !== null) out.push(Number(match[1]));
  return out;
}

function headText(file) {
  try {
    return git(["show", `HEAD:${file}`]);
  } catch {
    return "";
  }
}

const failures = [];
for (const file of changedArt(process.argv.includes("--staged"))) {
  const base = path.basename(file);
  let referenced = false;
  let bumped = false;
  for (const ref of REFERENCES) {
    const now = fs.existsSync(path.join(ROOT, ref))
      ? fs.readFileSync(path.join(ROOT, ref), "utf8")
      : "";
    const before = headText(ref);
    const nowVersions = versionsIn(now, base);
    const beforeVersions = versionsIn(before, base);
    if (!nowVersions.length) continue;
    referenced = true;
    if (!beforeVersions.length) {
      bumped = true; // brand-new reference counts as a fresh URL
      continue;
    }
    const maxBefore = Math.max(...beforeVersions);
    if (Math.max(...nowVersions) > maxBefore) bumped = true;
  }
  if (!referenced) {
    console.warn(`art gate: ${base} is not referenced by catalog/registry; skipped`);
    continue;
  }
  if (!bumped) failures.push(base);
}

if (failures.length) {
  console.error("art gate: changed artwork kept its old ?v= URL:");
  for (const name of failures) console.error(`  - ${name}`);
  console.error("Bump the ?v= for each file in badge-catalog.js / title-registry.js.");
  process.exit(1);
}

// Title member icons reuse the badge artwork URL. A badge art bump must reach
// every title that lists that badge, or the title keeps rendering the old PNG.
const catalogText = fs.readFileSync(path.join(ROOT, REFERENCES[0]), "utf8");
const catalogArt = new Map();
for (const match of catalogText.matchAll(/\{ id: "([^"]+)"[^\n]*?art: "([^"]+)"/g)) {
  catalogArt.set(match[1], match[2]);
}
const titleText = fs.readFileSync(path.join(ROOT, REFERENCES[1]), "utf8");
const staleTitleArt = [];
for (const match of titleText.matchAll(/\{ id: "([^"]+)", name: "([^"]+)", tier: \d+, art: "([^"]+)" \}/g)) {
  const [, id, name, art] = match;
  const expected = catalogArt.get(id);
  if (expected && expected !== art) staleTitleArt.push(`${id} (${name}): ${art} -> ${expected}`);
}
if (staleTitleArt.length) {
  console.error("art gate: title member art is stale against badge-catalog.js:");
  for (const line of staleTitleArt) console.error(`  - ${line}`);
  process.exit(1);
}

console.log("art versions ok");
