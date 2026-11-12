#!/usr/bin/env node
"use strict";

// Local TokenTracker backend.
//
// Runs the self-host package - the Postgres schema (scripts/self-host/*.sql via
// install.cjs) plus the twenty private handlers (build-functions.cjs) - on
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
const { ensureAuthSchema, handleAuthRequest, signToken, verifyAccessToken, hashPassword, REFRESH_TTL_SECONDS } = require("./local-auth.cjs");

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

// Bundling the twenty handlers takes ~25s on a desktop and minutes on a
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
  if (present(directory)) {
    // With build sources present the fingerprint path in loadHandlers judges
    // staleness; adopt must not second-guess it with the shipped copy.
    if (stamp) return false;
    // Packaged deployment: the adopted copy in the data directory carries the
    // fingerprint of the sources its image was built from. When the shipped
    // prebuilt/ stamp differs the image is newer than the volume and must
    // win — an image upgrade is how handler code ships, and the volume holds
    // data plus the last adoption, not truth.
    const dirStampFile = path.join(directory, ".source-stamp");
    try {
      const shipped = (await fs.readFile(path.join(source, ".source-stamp"), "utf8")).trim();
      const adopted = (await fs.readFile(dirStampFile, "utf8")).trim();
      if (shipped && shipped === adopted) return false;
    } catch (_error) { /* a stamp is missing or unreadable: refresh */ }
  }
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
  const haveRuntime = () => privateFunctions.every(
    (slug) => fssync.existsSync(path.join(directory, slug + ".runtime.cjs")),
  );
  let cached = false;
  if (stamp) {
    try {
      cached = (await fs.readFile(stampFile, "utf8")).trim() === stamp;
    } catch (_error) { cached = false; }
    if (!cached) cached = await adoptPrebuiltBundles(directory, stamp);
  } else {
    // Packaged deployment: there is no fingerprint to re-derive. Adopt first
    // so an upgraded image refreshes the bundles a previous boot copied into
    // the data directory; then "do we have the bundles" is the whole question.
    // Without the adopt a fresh volume would wrongly report them missing, and
    // a volume older than the image would wrongly keep the stale bundles.
    await adoptPrebuiltBundles(directory, stamp);
    cached = haveRuntime();
  }
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

// A fixed expiry for the public anon key. Time-relative exp meant every
// container restart minted a different key, and a client whose stored copy
// came from an earlier boot then looked misconfigured to the dashboard
// (hidden login, "incomplete configuration" banner) until the key was
// re-copied. 2100-01-01 keeps the shape of a normal JWT while making the
// token deterministic.
const ANON_KEY_FIXED_EXP = 4102444800;

function createTokenMinter(secret) {
  return (sub, role = "authenticated", ttlSeconds = 3600) => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({
      sub, role,
      exp: role === "anon" ? ANON_KEY_FIXED_EXP : Math.floor(Date.now() / 1000) + ttlSeconds,
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
    if (["select", "order", "limit", "offset", "columns", "on_conflict"].includes(key)) continue;
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
    const rawRows = JSON.parse(raw);
    // PostgREST accepts both shapes: array (bulk) and single object. The SDK
    // emits a single object for .upsert({...}) / .insert({...}).
    const rows = Array.isArray(rawRows) ? rawRows : [rawRows];
    if (!rows.length) throw new Error("Expected SDK insert rows");
    const names = Object.keys(rows[0]);
    const values = rows.flatMap((row) => names.map((name) => row[name]));
    // PostgREST upsert: POST with on_conflict=<cols> means INSERT ... ON CONFLICT
    // DO UPDATE. The public-visibility function saves github_url via upsert,
    // so this must be supported (it used to 500 with "Unsupported SQL filter").
    const onConflict = url.searchParams.get("on_conflict");
    if (onConflict) {
      // 比较用原始列名：identifier() 返回带引号形式，直接 includes 永远
      // 不等，冲突列会被留进 DO UPDATE 自赋值（合法但脏）。
      const conflictNames = onConflict.split(",").map((col) => col.trim());
      const conflictCols = conflictNames.map(identifier);
      const updateCols = names.filter((name) => !conflictNames.includes(name));
      const doUpdate = updateCols.length
        ? " DO UPDATE SET " + updateCols.map((name) => identifier(name) + "=EXCLUDED." + identifier(name)).join(",")
        : " DO NOTHING";
      result = await tx.query(
        `INSERT INTO ${table} (${names.map(identifier).join(",")}) VALUES ${rows
          .map((_, r) => "(" + names.map((__, c) => "$" + (r * names.length + c + 1)).join(",") + ")")
          .join(",")} ON CONFLICT (${conflictCols.join(",")})${doUpdate} RETURNING *`,
        values,
      );
    } else {
      result = await tx.query(
        `INSERT INTO ${table} (${names.map(identifier).join(",")}) VALUES ${rows
          .map((_, r) => "(" + names.map((__, c) => "$" + (r * names.length + c + 1)).join(",") + ")")
          .join(",")} RETURNING *`,
        values,
      );
    }
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
  // Report the anonymous key clients put in config.anonKey: the client only
  // checks that the JWT decodes with role "anon", so a stable value is fine.
  if (process.argv.includes("--print-anon-key")) {
    process.stdout.write(mintToken("anon", "anon", 10 * 365 * 24 * 3600) + "\n");
    await db.close();
    return;
  }

  if (process.argv.includes("--create-user")) {
    const email = argValue("--create-user", null);
    if (!email) {
      process.stderr.write("[local-backend] --create-user needs an email\n");
      process.exit(2);
    }
    const existing = await db.query("SELECT count(*)::int AS n FROM auth.users WHERE email IS NOT NULL");
    if (Number(existing.rows?.[0]?.n || 0) > 0 && process.env.TOKENTRACKER_LOCAL_BACKEND_MULTI_USER !== "1") {
      process.stderr.write("[local-backend] an account already exists; this instance is single-user (set TOKENTRACKER_LOCAL_BACKEND_MULTI_USER=1 to allow more accounts)\n");
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
  const anonKeyForHandlers = mintToken("anon", "anon", 10 * 365 * 24 * 3600);
  // Mirrored onto the process env: local-auth serves it from
  // /api/auth/public-config so new machines can bootstrap with join-machine.cjs.
  process.env.ANON_KEY = process.env.ANON_KEY || anonKeyForHandlers;
  const env = {
    // The handlers build their own InsForge client for database/RPC calls and
    // read its base URL from here. Without it they fail before reaching this
    // server, which surfaces as "cloud_access_unavailable".
    INSFORGE_BASE_URL: selfUrl,
    INSFORGE_INTERNAL_URL: selfUrl,
    INSFORGE_SERVICE_ROLE_KEY: mintToken(randomUUID(), "project_admin", 10 * 365 * 24 * 3600),
    // Deterministic subject: the client validates the anon key by decoding the
    // JWT and checking role === "anon", so any stable value works, and being
    // stable means --print-anon-key can report the same key the server uses.
    ANON_KEY: anonKeyForHandlers,

    JWT_SECRET: secret,
    TOKENTRACKER_CLOUD_ENVIRONMENT: "live",
    TOKENTRACKER_DASHBOARD_URL: selfUrl,
  };
  const serverCredential = env.INSFORGE_SERVICE_ROLE_KEY;

  // The handlers read configuration through Deno.env.get. They run here under
  // Node, so supply the same shape the self-host fixture does. Only
  // Deno.env.get is used anywhere in the private function set.
  const previousDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (key) => env[key] } };

  // Keep the counters for the server lifetime, rather than resetting them on
  // every request. Bound memory and reclaim expired buckets before admitting
  // a new address; at capacity, fail closed instead of evicting active limits.
  const AUTH_RATE_LIMIT = { windowMs: 5 * 60 * 1000, max: 60, maxBuckets: 1024 };
  const authRateBuckets = new Map();
  let authRateSweepAt = 0;
  const authRateLimited = (ip) => {
    const nowMs = Date.now();
    if (nowMs >= authRateSweepAt) {
      for (const [key, value] of authRateBuckets) {
        if (value.resetAt <= nowMs) authRateBuckets.delete(key);
      }
      authRateSweepAt = nowMs + AUTH_RATE_LIMIT.windowMs;
    }
    const bucket = authRateBuckets.get(ip);
    if (!bucket || bucket.resetAt <= nowMs) {
      if (!bucket && authRateBuckets.size >= AUTH_RATE_LIMIT.maxBuckets) return true;
      authRateBuckets.set(ip, { count: 1, resetAt: nowMs + AUTH_RATE_LIMIT.windowMs });
      return false;
    }
    if (bucket.count >= AUTH_RATE_LIMIT.max) return true;
    bucket.count += 1;
    return false;
  };

  const server = http.createServer(async (req, res) => {
    let acceptsObject = false;
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const url = new URL(req.url, "http://127.0.0.1:" + port);
    // 实例 CA 公开下载（站主 2026-11-12）：新设备接入不再手动传证书——
    // 信任根证书是公开信息，任何能连到本实例的客户端都该能取。路径优先
    // 环境变量 TOKENTRACKER_LOCAL_BACKEND_CA，默认 <数据目录>/../tls/ca.crt。
    if (url.pathname === "/ca.crt") {
      if (String(req.method || "GET").toUpperCase() !== "GET" && String(req.method || "GET").toUpperCase() !== "HEAD") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "method_not_allowed" }));
        return;
      }
      const caPath = process.env.TOKENTRACKER_LOCAL_BACKEND_CA
        || require("node:path").join(require("node:path").dirname(path.resolve(process.env.TOKENTRACKER_LOCAL_BACKEND_DIR || ".")), "tls", "ca.crt");
      let pem;
      try {
        pem = fssync.readFileSync(caPath, "utf8");
      } catch {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ca_not_configured", hint: "set TOKENTRACKER_LOCAL_BACKEND_CA to the CA certificate path" }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/x-x509-ca-cert",
        "Content-Disposition": 'attachment; filename="tt-local-backend-ca.crt"',
        "Cache-Control": "public, max-age=300",
      });
      res.end(String(req.method || "GET").toUpperCase() === "HEAD" ? undefined : pem);
      return;
    }
    if (url.pathname.startsWith("/api/auth/") && authRateLimited(req.socket?.remoteAddress || "unknown")) {
      req.resume?.();
      send(429, { error: "rate_limited", message: "too many requests" });
      return;
    }
    // Bound both declared and chunked bodies. Keep the socket alive on an
    // early return so the 413 response can flush, then drain without buffering.
    const maxBodyBytes = url.pathname.startsWith("/api/auth/") ? 64 * 1024 : 6 * 1024 * 1024;
    const chunks = [];
    let bodyBytes = 0;
    let raw;
    try {
      const stream = typeof req.iterator === "function" ? req.iterator({ destroyOnReturn: false }) : req;
      for await (const chunk of stream) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bodyBytes += bytes.length;
        if (bodyBytes > maxBodyBytes) {
          req.resume?.();
          send(413, { error: "payload_too_large" });
          return;
        }
        chunks.push(bytes);
      }
      raw = Buffer.concat(chunks).toString("utf8");
    } catch {
      if (!res.headersSent) send(400, { error: "invalid_request" });
      return;
    }
    if (process.env.TOKENTRACKER_LOCAL_BACKEND_DEBUG) {
      console.error(`[req] ${req.method} ${url.pathname}${url.search} auth=${req.headers.authorization ? "yes" : "no"}`);
    }
    try {
      if (url.pathname === "/healthz") {
        send(200, { ok: true, functions: privateFunctions.length, dir });
        return;
      }
      // Personal-data endpoints on a private instance: require a signed-in
      // caller. The hosted platform used to validate the Authorization
      // header before user code; the self-host dispatch reproduces that for
      // the leaderboard surfaces only. Ingest authenticates by device token
      // (not a JWT) inside its own handler and must stay outside this gate.
      const AUTH_REQUIRED_FUNCTIONS = new Set([
        "tokentracker-leaderboard",
        "tokentracker-leaderboard-profile",
        "tokentracker-embed-svg",
      ]);
      // Auth routes may attach Set-Cookie headers (browser refresh-cookie
      // session flow); the shared send() only writes JSON, so auth gets its
      // own sender with a mutable extra-headers slot (2026-10-16).
      const authHeaders = {};
      const authSend = (status, value) => {
        res.writeHead(status, { "Content-Type": "application/json", ...authHeaders });
        res.end(JSON.stringify(value));
      };
      if (await handleAuthRequest({ req, url, raw, db, secret, send: authSend, extraHeaders: authHeaders })) return;
      if (url.pathname.startsWith("/functions/")) {
        const slug = url.pathname.split("/").pop();
        const handler = handlers[slug];
        if (!handler) { send(404, { error: "Function not installed" }); return; }
        // OPTIONS is the CORS preflight, which never carries credentials —
        // let it through to the handler (it answers 204 with the allow
        // headers); gating it 401s the preflight and the browser then
        // blocks the real request entirely.
        if (AUTH_REQUIRED_FUNCTIONS.has(slug) && req.method !== "OPTIONS") {
          const header = String(req.headers.authorization || "");
          const payload = header.startsWith("Bearer ") ? verifyAccessToken(header.slice(7), secret) : null;
          if (!payload) {
            send(401, { error: "unauthorized", message: "sign in to view this data" });
            return;
          }
          const user = await db.query("SELECT id FROM auth.users WHERE id = $1 LIMIT 1", [payload.sub]);
          if (!user.rows?.[0]) {
            send(401, { error: "unauthorized", message: "account no longer exists" });
            return;
          }
        }
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
  // ── Self-host leaderboard snapshots ──
  // See the comment above refreshSelfHostLeaderboard. Refreshed at boot and
  // every 10 minutes; a failure logs and retries on the next tick rather
  // than ever blocking the API server.
  const refreshSelfHostLeaderboard = async () => {
    try {
      // Multi-user instances (TOKENTRACKER_LOCAL_BACKEND_MULTI_USER=1) snapshot
      // every account and rank them per period; single-user keeps the original
      // one-account flow. Rows are collected first so rank reflects the whole
      // board instead of whatever was written first.
      const allUsers = (await db.query(
        "SELECT id, email FROM auth.users ORDER BY created_at",
      )).rows;
      if (!allUsers.length) return;
      const snapshotUsers = process.env.TOKENTRACKER_LOCAL_BACKEND_MULTI_USER === "1"
        ? allUsers
        : [allUsers[0]];
      const collected = [];
      let topUser = null;
      let topTotal = null;
      // The settings UI writes the chosen identity into user_settings /
      // user_profiles; the hostname is only the last-resort fallback.
      for (const user of snapshotUsers) {
      const profileRow = (await db.query(
        "SELECT COALESCE(us.display_name, up.display_name) AS display_name, up.avatar_url AS avatar_url"
        + " FROM tokentracker_user_settings us"
        + " LEFT JOIN tokentracker_user_profiles up ON up.user_id = us.user_id"
        + " WHERE us.user_id = $1 LIMIT 1",
        [user.id],
      )).rows[0] || {};
      const fallbackName = profileRow.display_name
        || String(user.email || "").split("@")[0] || "local";
      const chosenAvatar = profileRow.avatar_url || null;
      await db.query(
        "INSERT INTO tokentracker_user_profiles (user_id, display_name, avatar_url) VALUES ($1, $2, $3) "
        + "ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name,"
        + " avatar_url = COALESCE(EXCLUDED.avatar_url, tokentracker_user_profiles.avatar_url)",
        [user.id, fallbackName, chosenAvatar],
      );
      await db.query(
        "INSERT INTO tokentracker_user_settings (user_id) VALUES ($1) "
        + "ON CONFLICT (user_id) DO NOTHING",
        [user.id],
      );
      const now = new Date();
      const dayOf = (d) => d.toISOString().slice(0, 10);
      const weekFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      weekFrom.setUTCDate(weekFrom.getUTCDate() - ((weekFrom.getUTCDay() + 6) % 7));
      // ISO 8601 Monday-start week, matching tokentracker-leaderboard.ts.
      // "total" starts at the account's earliest ingested day (the snapshot
      // row needs a concrete from_day, and the reader orders by it).
      const earliest = (await db.query(
        "SELECT COALESCE(MIN(hour_start)::date::text, to_char(now(), 'YYYY-MM-DD')) AS d"
        + " FROM tokentracker_hourly WHERE user_id = $1",
        [user.id],
      )).rows[0].d;
      // The reader matches the FULL window the refresh pipeline writes:
      // Monday→Sunday for weeks, the whole UTC month for months.
      const weekTo = new Date(weekFrom);
      weekTo.setUTCDate(weekTo.getUTCDate() + 6);
      const monthTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
      const periods = [
        ["week", dayOf(weekFrom), dayOf(weekTo)],
        ["month", dayOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), dayOf(monthTo)],
        ["total", earliest, dayOf(now)],
      ];
      // Real costs live in the account-summary handler (its bundle embeds the
      // pricing tables; the raw hourly rows store zeros). Best effort: a
      // failed call leaves the period cost at the stored sum.
      const mintForCost = createTokenMinter(secret);
      const costByPeriod = {};
      for (const [period, fromDay, toDay] of periods) {
        try {
          const costReq = new Request(
            "http://local/functions/tokentracker-account-summary?from=" + fromDay + "&to=" + toDay,
            { headers: { authorization: "Bearer " + mintForCost(user.id, "authenticated", 3600) } },
          );
          const costRes = await handlers["tokentracker-account-summary"](costReq);
          if (costRes.status === 200) {
            const payload = await costRes.json();
            const cost = Number(payload?.totals?.total_cost_usd);
            if (Number.isFinite(cost)) costByPeriod[period] = cost;
          }
        } catch (_e) { /* best effort */ }
      }

      // 按设备拆行（站主 2026-11-12）：一个账号有 ≥2 台设备且有产出时，
      // 排行榜按设备各出一行（各自排名）；单设备账号保持账号级一行。
      const deviceRowsRaw = (await db.query(
        "SELECT COALESCE(dm.machine_cluster_id, h.device_id::text) AS dev_id,"
        + " MAX(d.device_name) AS device_name, SUM(h.total_tokens)::bigint AS tokens"
        + " FROM tokentracker_hourly h"
        + " LEFT JOIN tokentracker_device_machine dm ON dm.device_id = h.device_id"
        + " LEFT JOIN tokentracker_devices d ON d.id = h.device_id"
        + " WHERE h.user_id = $1"
        + " GROUP BY COALESCE(dm.machine_cluster_id, h.device_id::text)"
        + " HAVING SUM(h.total_tokens) > 0"
        + " ORDER BY tokens DESC",
        [user.id],
      )).rows;
      let totalAgg = null;
      const periodRows = [];
      for (const [period, fromDay, toDay] of periods) {
        const fromIso = period === "total"
          ? "1970-01-01T00:00:00Z"
          : new Date(fromDay + "T00:00:00Z").toISOString();
        const toIso = new Date(toDay + "T23:59:59.999Z").toISOString();
        const agg = (await db.query(
          "WITH hourly AS ("
          + " SELECT DISTINCT ON (COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model)"
          + "   h.hour_start, h.source, h.model, h.total_tokens, h.input_tokens, h.output_tokens,"
          + "   h.cached_input_tokens, h.conversations, h.total_cost_usd"
          + " FROM tokentracker_hourly h"
          + " LEFT JOIN tokentracker_device_machine dm ON dm.device_id = h.device_id"
          + " WHERE h.user_id = $1 AND h.hour_start >= $2 AND h.hour_start <= $3"
          + " ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC"
          + " )"
          + " SELECT COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,"
          + " COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,"
          + " COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,"
          + " COALESCE(SUM(cached_input_tokens),0)::bigint AS cached_input_tokens,"
          + " COALESCE(SUM(conversations),0)::bigint AS conversations,"
          + " COALESCE(SUM(total_cost_usd),0)::numeric AS estimated_cost_usd,"
          + " COALESCE(jsonb_object_agg(model, total_tokens) FILTER (WHERE model IS NOT NULL), '{}'::jsonb) AS models"
          + " FROM hourly",
          [user.id, fromIso, toIso],
        )).rows[0];
        if (period === "total") totalAgg = agg;
        // 零用量账号不写快照（避免空账号占榜，device2 事故）。
        if (period === "total" && Number(agg.total_tokens) === 0) { periodRows.length = 0; break; }
        const accountName = profileRow.display_name || fallbackName;
        if (deviceRowsRaw.length >= 2) {
          for (const device of deviceRowsRaw) {
            const devAgg = (await db.query(
              "WITH hourly AS ("
              + " SELECT DISTINCT ON (COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model)"
              + "   h.total_tokens, h.input_tokens, h.output_tokens, h.cached_input_tokens, h.conversations, h.total_cost_usd, h.model"
              + " FROM tokentracker_hourly h"
              + " LEFT JOIN tokentracker_device_machine dm ON dm.device_id = h.device_id"
              + " WHERE h.user_id = $1 AND h.hour_start >= $2 AND h.hour_start <= $3"
              + "   AND COALESCE(dm.machine_cluster_id, h.device_id::text) = $4"
              + " ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC"
              + " )"
              + " SELECT COALESCE(SUM(total_tokens),0)::bigint AS total_tokens,"
              + " COALESCE(SUM(input_tokens),0)::bigint AS input_tokens,"
              + " COALESCE(SUM(output_tokens),0)::bigint AS output_tokens,"
              + " COALESCE(SUM(cached_input_tokens),0)::bigint AS cached_input_tokens,"
              + " COALESCE(SUM(conversations),0)::bigint AS conversations,"
              + " COALESCE(SUM(total_cost_usd),0)::numeric AS estimated_cost_usd,"
              + " COALESCE(jsonb_object_agg(model, total_tokens) FILTER (WHERE model IS NOT NULL), '{}'::jsonb) AS models"
              + " FROM hourly",
              [user.id, fromIso, toIso, device.dev_id],
            )).rows[0];
            if (Number(devAgg.total_tokens) === 0) continue;
            // 逐设备真实花费（站主 2026-11-12 追问「两台设备花费为什么一样」）：
            // hourly.total_cost_usd 恒为 0（价格表只活在函数包里），而
            // costByPeriod 是**账号级**金额——之前每台设备都拿它填充，于是同账号
            // 两台设备显示同一个预估值。改为一台设备一次 account-summary
            // （带 device_id，价格口径与账号总账同一份），汇总成该设备花费；
            // 调用失败才退回 hourly 的求和值。
            let deviceCost = null;
            const clusterDeviceIds = (await db.query(
              "SELECT DISTINCT h.device_id::text AS id"
              + " FROM tokentracker_hourly h"
              + " LEFT JOIN tokentracker_device_machine dm ON dm.device_id = h.device_id"
              + " WHERE h.user_id = $1 AND h.hour_start >= $2 AND h.hour_start <= $3"
              + "   AND COALESCE(dm.machine_cluster_id, h.device_id::text) = $4",
              [user.id, fromIso, toIso, device.dev_id],
            )).rows;
            for (const clusterDevice of clusterDeviceIds) {
              try {
                const deviceCostReq = new Request(
                  "http://local/functions/tokentracker-account-summary?from=" + fromDay + "&to=" + toDay
                  + "&device_id=" + encodeURIComponent(clusterDevice.id),
                  { headers: { authorization: "Bearer " + mintForCost(user.id, "authenticated", 3600) } },
                );
                const deviceCostRes = await handlers["tokentracker-account-summary"](deviceCostReq);
                if (deviceCostRes.status === 200) {
                  const deviceCostPayload = await deviceCostRes.json();
                  const cost = Number(deviceCostPayload?.totals?.total_cost_usd);
                  if (Number.isFinite(cost)) deviceCost = (deviceCost ?? 0) + cost;
                }
              } catch (_e) { /* best effort, fall back to the stored sum */ }
            }
            const deviceLabel = device.device_name || String(device.dev_id || "").slice(0, 8);
            periodRows.push([period, fromDay, toDay, user.id, device.dev_id,
              accountName + " · " + deviceLabel,
              chosenAvatar, devAgg.total_tokens,
              deviceCost !== null ? deviceCost : devAgg.estimated_cost_usd,
              devAgg.input_tokens, devAgg.output_tokens, devAgg.cached_input_tokens,
              devAgg.conversations, devAgg.models]);
          }
        } else {
          periodRows.push([period, fromDay, toDay, user.id, "",
            accountName,
            chosenAvatar, agg.total_tokens, costByPeriod[period] !== undefined
              ? costByPeriod[period] : agg.estimated_cost_usd, agg.input_tokens,
            agg.output_tokens, agg.cached_input_tokens, agg.conversations, agg.models]);
        }
      }
      collected.push(...periodRows);
      if (!topUser || Number(totalAgg.total_tokens) > topTotal) {
        topUser = user;
        topTotal = Number(totalAgg.total_tokens);
      }
      // Award every catalog badge from the same deduplicated hourly data the
      // snapshots use. Thresholds come from tokentracker_badge_catalog; the
      // metrics mirror the local replay semantics (CLOUD_PARITY_BADGE_
      // THRESHOLDS in src/lib/local-api.js): UTC day grain, machine-cluster
      // dedup, ISO weeks for momentum. trendsetter and podium have no local
      // metric (cross-user facts), so they keep their dedicated awards.
      // grand_slam's diamond line ("every other badge") lives in the catalog;
      // its metric is the diamond count from the monotonic badge table, so a
      // newly crossed diamond lands one refresh tick later.
      try {
        const metrics = (await db.query(
          "WITH hourly AS ("
          + " SELECT DISTINCT ON (COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model)"
          + "   h.hour_start, h.source, h.model, h.total_tokens, h.output_tokens"
          + " FROM tokentracker_hourly h"
          + " LEFT JOIN tokentracker_device_machine dm ON dm.device_id = h.device_id"
          + " WHERE h.user_id = $1"
          + " ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text), h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC"
          + "), days AS ("
          + " SELECT (hour_start AT TIME ZONE \'UTC\')::date AS day, SUM(total_tokens)::bigint AS tokens FROM hourly GROUP BY 1"
          + "), weeks AS ("
          + " SELECT date_trunc(\'week\', day) AS wk, SUM(tokens)::bigint AS tokens FROM days GROUP BY 1"
          + ")"
          + " SELECT jsonb_build_object("
          + "   \'total_tokens\', (SELECT COALESCE(SUM(total_tokens),0) FROM hourly),"
          + "   \'output_tokens\', (SELECT COALESCE(SUM(output_tokens),0) FROM hourly),"
          + "   \'best_day\', (SELECT COALESCE(MAX(tokens),0) FROM days),"
          + "   \'active_days\', (SELECT COUNT(*) FROM days),"
          + "   \'first_day\', (SELECT COALESCE(MIN(day)::text,\'\') FROM days),"
          + "   \'models\', (SELECT COUNT(DISTINCT model) FROM hourly),"
          + "   \'sources\', (SELECT COUNT(DISTINCT source) FROM hourly),"
          + "   \'weekend_days\', (SELECT COUNT(*) FROM days WHERE EXTRACT(dow FROM day) IN (0,6)),"
          + "   \'streak\', (SELECT COALESCE(MAX(run),0) FROM (SELECT COUNT(*) AS run FROM (SELECT day, day - (ROW_NUMBER() OVER (ORDER BY day))::int * INTERVAL \'1 day\' AS grp FROM days) g GROUP BY grp) r),"
          + "   \'momentum\', (SELECT COALESCE(MAX(CASE WHEN prev >= 10000000 AND prev > 0 THEN curr::numeric / prev ELSE 0 END),0) FROM (SELECT SUM(tokens)::bigint AS curr, LAG(SUM(tokens)::bigint) OVER (ORDER BY wk) AS prev FROM weeks GROUP BY wk) m),"
          + "   \'phoenix\', (SELECT COALESCE(MAX(day - prev_day), 0) FROM (SELECT day, LAG(day) OVER (ORDER BY day) AS prev_day FROM days) g),"
          + "   \'iron_month\', (SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) AS c FROM days GROUP BY date_trunc(\'month\', day)) x),"
          + "   \'full_blast\', (SELECT COALESCE(MAX(tokens), 0) FROM weeks),"
          + "   \'deep_diver\', (SELECT COUNT(*) FROM (SELECT model FROM hourly GROUP BY model HAVING SUM(total_tokens) >= 1000000000) m),"
          + "   \'multitool_day\', (SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(DISTINCT source) AS c FROM hourly GROUP BY (hour_start AT TIME ZONE \'UTC\')::date) x),"
          + "   \'heart_model\', (SELECT CASE WHEN (SELECT COUNT(DISTINCT model) FROM hourly) >= 5 THEN (m.t::numeric * 100 / NULLIF((SELECT SUM(total_tokens) FROM hourly), 0)) ELSE 0 END FROM (SELECT model, SUM(total_tokens) AS t FROM hourly GROUP BY model) m ORDER BY m.t DESC LIMIT 1),"
          + "   \'claude_survivor\', (SELECT COALESCE(SUM(total_tokens), 0) FROM hourly WHERE model LIKE \'claude%\'),"
          + "   \'wishing_well\', (SELECT COALESCE(SUM(total_tokens), 0) FROM hourly WHERE model LIKE \'deepseek%\')"
          + " ) AS m"
          ,
          [user.id],
        )).rows[0].m;

        // Metric per catalog badge id; veteran is derived, grand_slam reads
        // the monotonic badge table, and the two cross-user badges are
        // handled by the dedicated awards below.
        const diamondCount = Number((await db.query(
          "SELECT COUNT(*)::int AS c FROM tokentracker_user_badges"
          + " WHERE user_id = $1 AND tier = 4 AND badge_id <> \'grand_slam\'",
          [user.id],
        )).rows[0].c);
        const metricFor = (badgeId) => {
          switch (badgeId) {
            case "token_titan": return Number(metrics.total_tokens);
            case "wordsmith": return Number(metrics.output_tokens);
            case "big_day": return Number(metrics.best_day);
            case "marathoner": return Number(metrics.active_days);
            case "streak": return Number(metrics.streak);
            case "weekend_warrior": return Number(metrics.weekend_days);
            case "polyglot": return Number(metrics.models);
            case "multitool": return Number(metrics.sources);
            case "momentum": return Number(metrics.momentum);
            case "phoenix": return Number(metrics.phoenix);
            case "iron_month": return Number(metrics.iron_month);
            case "full_blast": return Number(metrics.full_blast);
            case "deep_diver": return Number(metrics.deep_diver);
            case "multitool_day": return Number(metrics.multitool_day);
            case "heart_model": return Number(metrics.heart_model);
            case "claude_survivor": return Number(metrics.claude_survivor);
            case "wishing_well": return Number(metrics.wishing_well);
            case "grand_slam": return diamondCount;
            case "veteran": {
              if (!metrics.first_day) return 0;
              const first = Date.parse(metrics.first_day + "T00:00:00Z");
              return Number.isFinite(first) ? Math.floor((Date.now() - first) / 86400000) : 0;
            }
            default: return null;
          }
        };
        const catalog = (await db.query(
          "SELECT badge_id, bronze, silver, gold, diamond, lower_is_better FROM tokentracker_badge_catalog",
        )).rows;
        for (const row of catalog) {
          const metric = metricFor(row.badge_id);
          if (metric === null) continue;
          const marks = row.lower_is_better
            ? [row.diamond, row.gold, row.silver, row.bronze]
            : [row.bronze, row.silver, row.gold, row.diamond];
          const meets = (threshold) => threshold === null || threshold === undefined
            || (row.lower_is_better ? metric <= Number(threshold) : metric >= Number(threshold));
          let tier = 0;
          for (let i = 0; i < marks.length; i += 1) { if (meets(marks[i])) tier = i + 1; }
          if (tier < 1) continue;
          const atCol = tier >= 4 ? "diamond_at" : tier === 3 ? "gold_at" : tier === 2 ? "silver_at" : "bronze_at";
          await db.query(
            "INSERT INTO tokentracker_user_badges"
            + " (user_id, badge_id, tier, metric_value, " + atCol + ", meta, updated_at)"
            + " VALUES ($1,$2,$3,$4,now(),\'{}\'::jsonb,now())"
            + " ON CONFLICT (user_id, badge_id) DO UPDATE SET"
            + "   tier = GREATEST(tokentracker_user_badges.tier, EXCLUDED.tier),"
            + "   metric_value = EXCLUDED.metric_value,"
            + "   " + atCol + " = COALESCE(tokentracker_user_badges." + atCol + ", EXCLUDED." + atCol + "),"
            + "   updated_at = now()",
            [user.id, row.badge_id, tier, metric],
          );
        }
      } catch (badgeError) {
        process.stdout.write("[local-backend] badge refresh failed: "
          + (badgeError && badgeError.message ? badgeError.message : String(badgeError)) + "\n");
      }

      // Cross-user badges: this instance\'s rank-1 occupant, and the model
      // breadth proxy for the debut-date badge.
      const totalModels2 = Object.keys((totalAgg && totalAgg.models) || {}).length;
      const trendTier2 = totalModels2 >= 20 ? 4 : totalModels2 >= 10 ? 3 : totalModels2 >= 5 ? 2 : totalModels2 >= 2 ? 1 : 0;
      const nowIso2 = new Date().toISOString();
      const extraRows = [
        [user.id, "trendsetter", trendTier2, totalModels2, nowIso2],
        ...(user === topUser ? [[user.id, "podium", 4, 1, nowIso2]] : []),
      ];
      for (const [badgeUser, badgeId, tier, metric, achievedAt] of extraRows) {
        if (tier < 1) continue;
        const atCol = tier >= 4 ? "diamond_at" : tier === 3 ? "gold_at" : tier === 2 ? "silver_at" : "bronze_at";
        await db.query(
          "INSERT INTO tokentracker_user_badges"
          + " (user_id, badge_id, tier, metric_value, " + atCol + ", meta, updated_at)"
          + " VALUES ($1,$2,$3,$4,$5,\'{}\'::jsonb,now())"
          + " ON CONFLICT (user_id, badge_id) DO UPDATE SET"
          + "   tier = GREATEST(tokentracker_user_badges.tier, EXCLUDED.tier),"
          + "   metric_value = EXCLUDED.metric_value,"
          + "   " + atCol + " = COALESCE(tokentracker_user_badges." + atCol + ", EXCLUDED." + atCol + "),"
          + "   updated_at = now()",
          [badgeUser, badgeId, tier, metric, achievedAt],
        );
      }
      } // per-user snapshot loop

      // Rank per period by total_tokens and write every collected row.
      const byPeriod = new Map();
      for (const row of collected) {
        const list = byPeriod.get(row[0]) || [];
        list.push(row);
        byPeriod.set(row[0], list);
      }
      for (const rows of byPeriod.values()) {
        rows.sort((a, b) => Number(b[6]) - Number(a[6]));
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const rank = index + 1;
          await db.query(
            "INSERT INTO tokentracker_leaderboard_snapshots"
            + " (period, from_day, to_day, user_id, device_id, rank, display_name, avatar_url, total_tokens,"
            + "  estimated_cost_usd, input_tokens, output_tokens, cached_input_tokens,"
            + "  conversation_count, models, generated_at)"
            + " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())"
            + " ON CONFLICT (period, from_day, to_day, user_id, device_id) DO UPDATE SET"
            + "   rank = EXCLUDED.rank, avatar_url = EXCLUDED.avatar_url, total_tokens = EXCLUDED.total_tokens,"
            + "   estimated_cost_usd = EXCLUDED.estimated_cost_usd,"
            + "   input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens,"
            + "   cached_input_tokens = EXCLUDED.cached_input_tokens,"
            + "   conversation_count = EXCLUDED.conversation_count, models = EXCLUDED.models,"
            + "   generated_at = now()",
            [row[0], row[1], row[2], row[3], row[4], rank, row[5], row[6], row[7],
              row[8], row[9], row[10], row[11], row[12], row[13]],
          );
        }
      }
      // 清理陈旧行（站主 2026-11-12 按设备拆行后）：零用量快照不留；已有
      // 设备级行的账号再留一份账号级旧行会让榜单出现重复。
      await db.query("DELETE FROM tokentracker_leaderboard_snapshots WHERE total_tokens = 0");
      await db.query(
        "DELETE FROM tokentracker_leaderboard_snapshots s"
        + " WHERE s.device_id = '' AND EXISTS ("
        + "   SELECT 1 FROM tokentracker_leaderboard_snapshots d"
        + "   WHERE d.user_id = s.user_id AND d.period = s.period AND d.device_id <> ''"
        + " )",
      );
      process.stdout.write("[local-backend] leaderboard snapshots refreshed (" + collected.length + " rows)\n");
    } catch (error) {
      process.stdout.write("[local-backend] leaderboard snapshot refresh failed: "
        + (error && error.message ? error.message : String(error)) + "\n");
    }
  };
  void refreshSelfHostLeaderboard().catch(() => {});
  const leaderboardTimer = setInterval(refreshSelfHostLeaderboard, 10 * 60 * 1000);
  leaderboardTimer.unref?.();

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
