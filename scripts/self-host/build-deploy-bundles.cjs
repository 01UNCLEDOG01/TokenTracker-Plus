#!/usr/bin/env node
// Deploy builder for a packaged (bundled-only) self-host target such as the
// j2900 router — runbook step ①, validated 2026-11-14 and 2026-11-15: raw
// bundles → esbuild cjs runtime bundles → .source-stamp, computed exactly the
// way local-backend loadHandlers computes them, so the target adopts the
// directory verbatim instead of attempting an on-device build.
// Usage: node scripts/self-host/build-deploy-bundles.cjs <outDir>
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const Module = require("node:module");
const { privateFunctions } = require("./manifest.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const out = path.resolve(process.argv[2] || "/tmp/tt-deploy-bundles");

async function computeSourceStamp() {
  const hash = createHash("sha256");
  const sources = [
    path.join(__dirname, "manifest.cjs"),
    path.join(__dirname, "build-functions.cjs"),
    ...privateFunctions.map((slug) => path.join(ROOT, "dashboard/edge-patches", slug + ".ts")),
  ];
  for (const file of sources) {
    hash.update(file);
    hash.update(await fs.readFile(file));
  }
  return hash.digest("hex");
}

(async () => {
  const { buildFunctions } = require("./build-functions.cjs");
  const esbuild = require("esbuild");
  await buildFunctions(out);
  const stamp = await computeSourceStamp();
  await fs.writeFile(path.join(out, ".source-stamp"), stamp, "utf8");
  const sdkPath = path.dirname(require.resolve("@insforge/sdk", { paths: [path.join(ROOT, "dashboard")] })) + "/index.mjs";
  for (const slug of privateFunctions) {
    const filename = path.join(out, slug + ".js");
    const output = await esbuild.build({
      entryPoints: [filename], bundle: true, write: false, format: "cjs",
      platform: "node", target: "node20", logLevel: "silent",
      alias: { "npm:@insforge/sdk": sdkPath, "npm:@insforge/sdk@1.4.5": sdkPath },
      plugins: [{
        name: "locked-imports",
        setup(builder) {
          builder.onResolve({ filter: /^npm:/ }, (args) => {
            const match = args.path.match(/^npm:((?:@[^/]+\/)?[^@/]+)@([^/]+)(\/.*)?$/);
            if (!match) throw new Error("Unpinned self-host dependency: " + args.path);
            if (match[1] === "@insforge/sdk") return { path: sdkPath };
            return { path: require.resolve(match[1] + (match[3] || ""), { paths: [path.join(ROOT, "node_modules/urllib"), ROOT] }) };
          });
        },
      }],
    });
    await fs.writeFile(path.join(out, slug + ".runtime.cjs"), output.outputFiles[0].text, "utf8");
  }
  // Smoke: every runtime bundle loads as a handler module (same compile as
  // loadHandlers) and exposes the default export.
  let ok = 0;
  for (const slug of privateFunctions) {
    const code = await fs.readFile(path.join(out, slug + ".runtime.cjs"), "utf8");
    const compiled = new Module(path.join(out, slug + ".js"), null);
    compiled.filename = path.join(out, slug + ".js");
    compiled.paths = Module._nodeModulePaths(out);
    compiled._compile(code, compiled.filename);
    const handler = compiled.exports.default || compiled.exports;
    if (typeof handler !== "function") throw new Error(slug + " has no default handler export");
    ok += 1;
  }
  console.log(`stamp ${stamp.slice(0, 12)}…; ${ok}/${privateFunctions.length} runtime bundles load OK; out=${out}`);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
