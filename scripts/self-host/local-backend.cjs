#!/usr/bin/env node
"use strict";

// Local TokenTracker backend.
//
// Runs the self-host package - the Postgres schema (scripts/self-host/*.sql via
// install.cjs) plus the fourteen private handlers (build-functions.cjs) - on
// this machine, so the account view has an owner the user controls instead of
// the hosted service. PGlite supplies PostgreSQL in-process (WASM), so there is
// no Docker and no external account.
//
// It is deliberately a thin re-implementation of the InsForge platform surface
// the client actually calls:
//   POST/GET /functions/<slug>      -> the bundled private handler
//   POST     /api/database/rpc/<fn> -> a Postgres function (the SDK's rpc path)
//   GET/POST/PATCH /rest/v1/<table> -> minimal PostgREST the SDK emits
//   GET      /healthz               -> liveness + what is installed
//
// Everything runs under the project_admin role with RLS bypassed, matching the
// self-host fixture the backend is tested against (test/self-host-backend.test.js).
// This is a single-user personal instance: there is no signup, no billing and no
// public data. Authentication is a device token minted from a local secret; see
// docs/self-host-local-backend.md.

const fs = require("node:fs/promises");
const fssync = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const Module = require("node:module");
const { randomUUID, createHmac, createHash } = require("node:crypto");
const { PGlite } = require("@electric-sql/pglite");
const { install } = require("./install.cjs");
const { privateFunctions } = require("./manifest.cjs");
const { ensureAuthSchema, handleAuthRequest, signToken, hashPassword, REFRESH_TTL_SECONDS } = require("./local-auth.cjs");

const ROOT = path.resolve(__dirname, "..", "..");

function dataDir() {
  return process.env.TOKENTRACKER_LOCAL_BACKEND_DIR
    || path.join(os.homedir(), ".tokentracker", "local-backend");
}

function argValue(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const identifier = (value) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(value).trim())) {
    throw new Error("Unsupported SQL identifier: " + value);
  }
  return '"' + String(value).trim() + '"';
};

// The platform contract the installer requires: auth.users, auth.uid(), and the
// three roles. PGlite starts empty, so we build exactly that - the same block the
// verified self-host fixture uses.
async function createPlatform(db) {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE project_admin BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    GRANT USAGE ON SCHEMA auth TO project_admin;
    GRANT SELECT(id) ON auth.users TO project_admin;
  `);
}

async function platformIsReady(db) {
  try {
    const result = await db.query("SELECT to_regclass('auth.users') AS t");
    return Boolean(result.rows?.[0]?.t);
  } catch (_error) {
    return false;
  }
}

async function loadSecret(dir) {
  const file = path.join(dir, "jwt-secret");
  try {
    const existing = (await fs.readFile(file, "utf8")).trim();
    if (existing) return existing;
  } catch (_error) { /* first run */ }
  const secret = "local-backend-" + randomUUID();
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

// Bundling the fourteen handlers takes ~25s on a desktop and minutes on a
// low-power host (a J1900 soft-router, say). Stamp the sources so a restart with
// nothing changed reuses the previous bundles instead of rebuilding them.
async function computeSourceStamp() {
  // A packaged deployment (the container image) ships only the prebuilt
  // bundles, not dashboard/edge-patches. There is nothing to fingerprint there,
  // so return null and let the prebuilt stamp stand as the authority - otherwise
  // the stamp can never match and the server tries to build without esbuild.
  if (!fssync.existsSync(path.join(ROOT, "dashboard", "edge-patches"))) return null;
  const hash = createHash("sha256");
  const sources = [
    path.join(__dirname, "manifest.cjs"),
    path.join(__dirname, "build-functions.cjs"),
    ...privateFunctions.map((slug) => path.join(ROOT, "dashboard", "edge-patches", slug + ".ts")),
  ];
  for (const file of sources) {
    hash.update(file + "\0");
    try {
      hash.update(await fs.readFile(file, "utf8"));
    } catch (_error) {
      hash.update("missing");
    }
  }
  // package-lock is large and only matters when the pinned SDK versions move.
  try {
    const stat = await fs.stat(path.join(ROOT, "package-lock.json"));
    hash.update(String(stat.size) + ":" + String(Math.round(stat.mtimeMs)));
  } catch (_error) {
    hash.update("no-lock");
  }
  return hash.digest("hex");
}

// esbuild and the bundler are only needed to (re)build handler bundles. A
// deployment that ships prebuilt bundles - the container image does - never
// loads them, which keeps the runtime image small (esbuild is a large native
// binary and is deliberately not installed there).
let esbuildModule = null;
function getEsbuild() {
  if (!esbuildModule) esbuildModule = require("esbuild");
  return esbuildModule;
}
let bundlerModule = null;
function getBundler() {
  if (!bundlerModule) bundlerModule = require("./build-functions.cjs");
  return bundlerModule;
}

// A low-power host (a J1900 soft-router, say) should never run esbuild. When a
// prebuilt bundle directory is supplied and matches the current sources, adopt
// it verbatim instead of building. The stamp is the same fingerprint the build
// writes, so a stale prebuild is detected rather than silently trusted.
async function adoptPrebuiltBundles(directory, stamp) {
  const source = process.env.TOKENTRACKER_LOCAL_BACKEND_BUNDLES;
  if (!source) return false;
  const present = (dir) => privateFunctions.every((slug) => fssync.existsSync(path.join(dir, slug + ".runtime.cjs")));
  if (present(directory)) return false;
  const sourceStampFile = path.join(source, ".source-stamp");
  if (!fssync.existsSync(sourceStampFile) || !present(source)) {
    process.stdout.write("[local-backend] prebuilt bundle directory is incomplete: " + source + "\n");
    return false;
  }
  // Only re-derive staleness when the build sources exist. In a packaged
  // deployment stamp is null and the shipped bundles are used as-is.
  if (stamp) {
    let sourceStampOk = false;
    try {
      sourceStampOk = (await fs.readFile(sourceStampFile, "utf8")).trim() === stamp;
    } catch (_error) { sourceStampOk = false; }
    if (!sourceStampOk) {
      process.stdout.write("[local-backend] prebuilt bundles are stale for these sources; rebuilding\n");
      return false;
    }
  }
  await fs.mkdir(directory, { recursive: true });
  for (const slug of privateFunctions) {
    await fs.copyFile(path.join(source, slug + ".runtime.cjs"), path.join(directory, slug + ".runtime.cjs"));
  }
  await fs.copyFile(sourceStampFile, path.join(directory, ".source-stamp"));
  process.stdout.write("[local-backend] adopted prebuilt handler bundles from " + source + "\n");
  return true;
}

async function loadHandlers(directory) {
  const stampFile = path.join(directory, ".source-stamp");
  const stamp = await computeSourceStamp();
  let cached = false;
  if (stamp) {
    try {
      cached = (await fs.readFile(stampFile, "utf8")).trim() === stamp;
    } catch (_error) { cached = false; }
  }
  if (!cached) cached = await adoptPrebuiltBundles(directory, stamp);
  if (!cached && !stamp) {
    throw new Error(
      "handler bundles are missing and this deployment has no build sources "
      + "(dashboard/edge-patches). Ship a complete prebuilt/ directory or point "
      + "TOKENTRACKER_LOCAL_BACKEND_BUNDLES at one.",
    );
  }
  // Two caches: the raw bundles buildFunctions writes, and the Node-ready
  // bundles esbuild produces from them (the npm: alias rewrite). Reusing both
  // skips every esbuild call, which is what a slow host actually waits on.
  const runtimeFile = (slug) => path.join(directory, slug + ".runtime.cjs");
  const missingRuntime = privateFunctions.filter((slug) => !fssync.existsSync(runtimeFile(slug)));
  const needRuntime = !cached || missingRuntime.length > 0;
  if (needRuntime) {
    // The raw bundles are only an input to producing the runtime bundles.
    const missingRaw = privateFunctions.some((slug) => !fssync.existsSync(path.join(directory, slug + ".js")));
    if (missingRaw) await getBundler().buildFunctions(directory);
    await fs.writeFile(stampFile, stamp, { encoding: "utf8" });
  } else {
    process.stdout.write("[local-backend] reusing cached handler bundles\n");
  }
  // Resolved lazily: a packaged deployment ships only the prebuilt runtime
  // bundles, so the SDK sources (dashboard/node_modules) are absent and must not
  // be required unless a rebuild is actually needed.
  let sdkPath = null;
  const resolveSdk = () => {
    if (!sdkPath) {
      sdkPath = path.join(
        path.dirname(require.resolve("@insforge/sdk", { paths: [path.join(ROOT, "dashboard")] })),
        "index.mjs",
      );
    }
    return sdkPath;
  };
  const handlers = {};
  for (const slug of privateFunctions) {
    const filename = path.join(directory, slug + ".js");
    let code;
    if (!needRuntime && fssync.existsSync(runtimeFile(slug))) {
      code = await fs.readFile(runtimeFile(slug), "utf8");
    } else {
      const output = await getEsbuild().build({
        entryPoints: [filename], bundle: true, write: false, format: "cjs",
        platform: "node", target: "node20", logLevel: "silent",
        alias: {
          "npm:@insforge/sdk": resolveSdk(),
          "npm:@insforge/sdk@1.4.5": resolveSdk(),
          "npm:(removed)pancake-ts@0.25.0": require.resolve("(removed)pancake-ts"),
          "npm:(removed)@4.14.0": require.resolve("(removed)"),
        },
        plugins: [{
          name: "local-backend-locked-imports",
          setup(builder) {
            builder.onResolve({ filter: /^npm:/ }, (args) => {
              const match = args.path.match(/^npm:((?:@[^/]+\/)?[^@/]+)@([^/]+)(\/.*)?$/);
              if (!match) throw new Error("Unpinned self-host dependency: " + args.path);
              if (match[1] === "@insforge/sdk") return { path: resolveSdk() };
              return { path: require.resolve(match[1] + (match[3] || ""), { paths: [path.join(ROOT, "node_modules/urllib"), ROOT] }) };
            });
          },
        }],
      });
      code = output.outputFiles[0].text;
      await fs.writeFile(runtimeFile(slug), code, { encoding: "utf8" });
    }
    const compiled = new Module(filename, module);
    compiled.filename = filename;
    compiled.paths = Module._nodeModulePaths(path.dirname(filename));
    compiled._compile(code, filename);
    handlers[slug] = compiled.exports.default || compiled.exports;
  }
  return handlers;
}

function createTokenMinter(secret) {
  return (sub, role = "authenticated", ttlSeconds = 3600) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({
      sub, role, exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    })).toString("base64url");
    return `${header}.${body}.${createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url")}`;
  };
}

// Minimal PostgREST surface: the subset of query shapes the InsForge SDK emits
// for these tables. Anything outside it fails loudly rather than silently
// returning wrong rows.
function buildFilter(url, args) {
  const filters = [];
  for (const [key, value] of url.searchParams) {
    if (["select", "order", "limit", "offset", "columns"].includes(key)) continue;
    const column = identifier(key);
    if (value === "is.null") filters.push(column + " IS NULL");
    else if (value === "not.is.null") filters.push(column + " IS NOT NULL");
    else if (value.startsWith("in.(")) {
      args.push(value.slice(4, -1).split(","));
      filters.push(column + "::text=ANY($" + args.length + "::text[])");
    } else {
      const at = value.indexOf(".");
      const op = { eq: "=", neq: "<>", gte: ">=", gt: ">", lte: "<=", lt: "<" }[value.slice(0, at)];
      if (!op) throw new Error("Unsupported SQL filter: " + key);
      args.push(value.slice(at + 1));
      filters.push(column + op + "$" + args.length);
    }
  }
  return filters.length ? " WHERE " + filters.join(" AND ") : "";
}

async function handleDatabase(tx, url, method, raw, send, acceptsObject) {
  await tx.exec("SET LOCAL ROLE project_admin");

  if (url.pathname.startsWith("/api/database/rpc/")) {
    const args = JSON.parse(raw || "{}");
    const names = Object.keys(args);
    const values = names.map((name) =>
      args[name] && typeof args[name] === "object" && !Array.isArray(args[name])
        ? JSON.stringify(args[name]) : args[name]);
    const result = await tx.query(
      `SELECT ${identifier(url.pathname.split("/").pop())}(${names.map((name, i) => identifier(name) + " => $" + (i + 1)).join(",")}) AS r`,
      values,
    );
    send(200, result.rows[0].r);
    return;
  }

  const table = identifier(url.pathname.split("/").pop());
  const args = [];
  const where = buildFilter(url, args);
  const selection = url.searchParams.get("select") || "*";
  const selected = selection === "*" ? "*" : selection.split(",").map(identifier).join(",");

  let result;
  if (method === "POST") {
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || !rows.length) throw new Error("Expected SDK array insert");
    const names = Object.keys(rows[0]);
    const values = rows.flatMap((row) => names.map((name) => row[name]));
    result = await tx.query(
      `INSERT INTO ${table} (${names.map(identifier).join(",")}) VALUES ${rows
        .map((_, r) => "(" + names.map((__, c) => "$" + (r * names.length + c + 1)).join(",") + ")")
        .join(",")} RETURNING *`,
      values,
    );
  } else if (method === "PATCH") {
    const values = JSON.parse(raw);
    const names = Object.keys(values);
    const initial = args.length;
    args.push(...names.map((name) => values[name]));
    result = await tx.query(
      `UPDATE ${table} SET ${names.map((name, i) => identifier(name) + "=$" + (initial + i + 1)).join(",")}${where} RETURNING ${selected}`,
      args,
    );
  } else {
    let sql = `SELECT ${selected} FROM ${table}${where}`;
    if (url.searchParams.has("order")) {
      sql += " ORDER BY " + url.searchParams.get("order").split(",").map((part) => {
        const [name, direction] = part.split(".");
        return identifier(name) + (direction === "desc" ? " DESC" : " ASC");
      }).join(",");
    }
    sql += " LIMIT " + Math.min(100, Number(url.searchParams.get("limit")) || 100)
      + " OFFSET " + (Number(url.searchParams.get("offset")) || 0);
    result = await tx.query(sql, args);
  }

  if (acceptsObject && result.rows.length !== 1) {
    send(406, { code: "PGRST116", message: "No single object", details: `The result contains ${result.rows.length} rows` });
    return;
  }
  send(200, acceptsObject ? result.rows[0] : result.rows);
}

async function main() {
  const dir = dataDir();
  const port = Number(argValue("--port", process.env.TOKENTRACKER_LOCAL_BACKEND_PORT || 17681));

  // Build the handler bundles into a directory and exit, so a slow host can be
  // handed the result instead of compiling them itself. Pair with
  // TOKENTRACKER_LOCAL_BACKEND_BUNDLES on the target.
  if (process.argv.includes("--prebuild")) {
    const target = argValue("--prebuild", null);
    if (!target) {
      process.stderr.write("[local-backend] --prebuild needs an output directory\n");
      process.exit(2);
    }
    await fs.mkdir(target, { recursive: true });
    process.stdout.write("[local-backend] prebuilding " + privateFunctions.length + " handlers into " + target + "\n");
    await loadHandlers(target);
    process.stdout.write("[local-backend] prebuild complete\n");
    return;
  }

  await fs.mkdir(dir, { recursive: true });

  const db = new PGlite(dir);
  if (!(await platformIsReady(db))) {
    await createPlatform(db);
  }
  await install(db);
  await ensureAuthSchema(db);

  const secret = await loadSecret(dir);
  const mintToken = createTokenMinter(secret);

  const refreshTokenFor = (row) => signToken(
    { sub: row.id, role: "authenticated", typ: "refresh", exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_SECONDS },
    secret,
  );

  // Bootstrap helpers. Both exit before the (slow) handler build, so they are
  // safe to run on a host where bundling takes minutes.
  if (process.argv.includes("--create-user")) {
    const email = argValue("--create-user", null);
    if (!email) {
      process.stderr.write("[local-backend] --create-user needs an email\n");
      process.exit(2);
    }
    const existing = await db.query("SELECT count(*)::int AS n FROM auth.users WHERE email IS NOT NULL");
    if (Number(existing.rows?.[0]?.n || 0) > 0) {
      process.stderr.write("[local-backend] an account already exists; this instance is single-user\n");
      await db.close();
      process.exit(1);
    }
    const password = process.env.TOKENTRACKER_LOCAL_BACKEND_PASSWORD
      || randomUUID().replace(/-/g, "").slice(0, 16);
    const id = randomUUID();
    await db.query("INSERT INTO auth.users(id, email, password_hash) VALUES($1,$2,$3)", [id, email, hashPassword(password)]);
    process.stdout.write([
      "account created",
      "  email    : " + email,
      "  password : " + password,
      "",
      "refresh token (paste into the client / local server):",
      refreshTokenFor({ id, email }),
      "",
    ].join("\n"));
    await db.close();
    return;
  }

  if (process.argv.includes("--print-refresh-token")) {
    const result = await db.query("SELECT id, email FROM auth.users WHERE email IS NOT NULL LIMIT 2");
    const rows = result.rows || [];
    if (rows.length !== 1) {
      process.stderr.write(`[local-backend] expected exactly one account, found ${rows.length}. Create it with --create-user or the dashboard sign-up.\n`);
      await db.close();
      process.exit(1);
    }
    process.stdout.write(refreshTokenFor(rows[0]) + "\n");
    await db.close();
    return;
  }

  const buildDir = path.join(dir, "functions");
  const handlers = await loadHandlers(buildDir);

  const selfUrl = "http://127.0.0.1:" + port;
  const env = {
    // The handlers build their own InsForge client for database/RPC calls and
    // read its base URL from here. Without it they fail before reaching this
    // server, which surfaces as "cloud_access_unavailable".
    INSFORGE_BASE_URL: selfUrl,
    INSFORGE_INTERNAL_URL: selfUrl,
    INSFORGE_SERVICE_ROLE_KEY: mintToken(randomUUID(), "project_admin", 10 * 365 * 24 * 3600),
    ANON_KEY: mintToken(randomUUID(), "anon", 10 * 365 * 24 * 3600),
    JWT_SECRET: secret,
    TOKENTRACKER_BILLING_ENVIRONMENT: "live",
    TOKENTRACKER_DASHBOARD_URL: selfUrl,
  };
  const serverCredential = env.INSFORGE_SERVICE_ROLE_KEY;

  // The handlers read configuration through Deno.env.get. They run here under
  // Node, so supply the same shape the self-host fixture does. Only
  // Deno.env.get is used anywhere in the private function set.
  const previousDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (key) => env[key] } };

  const server = http.createServer(async (req, res) => {
    let acceptsObject = false;
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const url = new URL(req.url, "http://127.0.0.1:" + port);
    if (process.env.TOKENTRACKER_LOCAL_BACKEND_DEBUG) {
      console.error(`[req] ${req.method} ${url.pathname}${url.search} auth=${req.headers.authorization ? "yes" : "no"}`);
    }
    try {
      if (url.pathname === "/healthz") {
        send(200, { ok: true, functions: privateFunctions.length, dir });
        return;
      }
      // Auth is public by definition - it runs before the server-role gate.
      if (await handleAuthRequest({ req, url, raw, db, secret, send })) return;
      if (url.pathname.startsWith("/functions/")) {
        const handler = handlers[url.pathname.split("/").pop()];
        if (!handler) { send(404, { error: "Function not installed" }); return; }
        const result = await handler(new Request(url, {
          method: req.method, headers: req.headers, ...(raw ? { body: raw } : {}),
        }));
        res.writeHead(result.status, Object.fromEntries(result.headers));
        res.end(await result.text());
        return;
      }
      if (req.headers.authorization !== "Bearer " + serverCredential) {
        send(403, { message: "server role required" });
        return;
      }
      acceptsObject = Boolean(req.headers.accept && req.headers.accept.includes("vnd.pgrst.object"));
      await db.transaction(async (tx) => {
        await handleDatabase(tx, url, req.method, raw, send, acceptsObject);
      });
    } catch (error) {
      if (process.env.TOKENTRACKER_LOCAL_BACKEND_DEBUG) console.error(error);
      send(500, { code: error.code || "LOCAL_BACKEND", message: error.message });
    }
  });

  // Loopback by default. On a router running Docker with host networking the
  // container shares the host's interfaces, so a 0.0.0.0 bind is what lets the
  // LAN (and the tunnel) reach it; set TOKENTRACKER_LOCAL_BACKEND_BIND=0.0.0.0.
  const bindHost = process.env.TOKENTRACKER_LOCAL_BACKEND_BIND || "127.0.0.1";
  await new Promise((resolve) => server.listen(port, bindHost, resolve));
  process.stdout.write([
    "",
    "[local-backend] ready",
    "  base URL : http://" + bindHost + ":" + port,
    "  data dir : " + dir,
    "  handlers : " + privateFunctions.length,
    "",
  ].join("\n"));

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[local-backend] failed:", error?.stack || error);
  process.exit(1);
});
