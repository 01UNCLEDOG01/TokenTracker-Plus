#!/usr/bin/env node
"use strict";

// Assemble the Docker build context for the local backend: the runtime scripts,
// the prebuilt handler bundles, and a minimal package.json.
//
// esbuild runs HERE, on the machine doing the packaging, and never inside the
// image - so the target host (an iStoreOS / OpenWrt soft-router, say) only has
// to start Node, not compile fourteen handlers.
//
//   node scripts/self-host/package-image.cjs
//   cd dist/local-backend-image
//   docker build -t tokentracker-local-backend .
//
// Copy dist/local-backend-image to the router (or build there directly) and run
// it as shown in scripts/self-host/Dockerfile.

const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const HERE = __dirname;

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

// Recursive copy via readdir/copyFile rather than fs.cp, so it works under
// filesystem shims that do not implement fs.cp.
async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(source, target);
    else await fs.copyFile(source, target);
  }
}

(async () => {
  const out = path.resolve(argValue("--out", path.join(ROOT, "dist", "local-backend-image")));
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(path.join(out, "scripts", "self-host"), { recursive: true });

  // The runtime scripts. install.cjs reads the .sql files beside it, so copy
  // those too. The directory is small.
  for (const name of await fs.readdir(HERE)) {
    if (name.endsWith(".cjs") || name.endsWith(".sql")) {
      await fs.copyFile(path.join(HERE, name), path.join(out, "scripts", "self-host", name));
    }
  }
  await fs.copyFile(path.join(HERE, "Dockerfile"), path.join(out, "Dockerfile"));

  // manifest.cjs resolves the repo root as two levels above scripts/self-host
  // and reads the migration SQL from there, so the image needs the same layout:
  // /app/migrations next to /app/scripts. Missing this is what made the first
  // container crash-loop with ENOENT on a migration file.
  await copyDir(path.join(ROOT, "migrations"), path.join(out, "migrations"));

  const prebuilt = path.join(out, "prebuilt");
  await fs.mkdir(prebuilt, { recursive: true });
  execFileSync(process.execPath, [path.join(HERE, "local-backend.cjs"), "--prebuild", prebuilt], {
    stdio: "inherit",
  });

  // Minimal runtime manifest: PGlite is the only dependency the server needs.
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  const pglite = (pkg.dependencies && pkg.dependencies["@electric-sql/pglite"])
    || (pkg.devDependencies && pkg.devDependencies["@electric-sql/pglite"])
    || "^0.5.8";
  await fs.writeFile(
    path.join(out, "package.json"),
    JSON.stringify({
      name: "tokentracker-local-backend",
      private: true,
      type: "commonjs",
      dependencies: { "@electric-sql/pglite": pglite },
    }, null, 2) + "\n",
  );

  const bundles = (await fs.readdir(prebuilt)).filter((name) => name.endsWith(".runtime.cjs"));
  process.stdout.write([
    "",
    "build context ready: " + out,
    "  prebuilt bundles : " + bundles.length,
    "",
    "  cd " + out,
    "  docker build -t tokentracker-local-backend .",
    "  docker run -d --name tt-backend -p 17681:17681 -v tt-backend-data:/data tokentracker-local-backend",
    "",
  ].join("\n"));
})().catch((error) => {
  console.error("[package-image] failed:", error?.stack || error);
  process.exit(1);
});
