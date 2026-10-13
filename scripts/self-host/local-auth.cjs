"use strict";

// Auth layer for the local backend.
//
// InsForge normally supplies sign-up / sign-in / refresh / profiles out of the
// box. PGlite has no such thing, so this file implements the subset of the
// InsForge auth API the client actually calls, against the self-host schema's
// auth.users table:
//
//   POST /api/auth/users              sign up   (first user only)
//   POST /api/auth/sessions           sign in   (email + password)
//   POST /api/auth/refresh            refresh   (refresh token -> access token)
//   GET  /api/auth/public-config      capability probe
//   GET  /api/auth/profiles/current   who am I
//   POST /api/auth/logout             sign out
//
// Scope note: this is a personal, single-user instance. There is no OAuth, no
// email verification and no password reset. Sign-up succeeds exactly once -
// whoever creates the first account owns the instance; later attempts are
// rejected, so the endpoints stay safe even if the port is reachable.

const { randomUUID, createHmac, scryptSync, timingSafeEqual, randomBytes } = require("node:crypto");

const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 365 * 24 * 60 * 60;

const b64url = (value) => Buffer.from(value).toString("base64url");

function signToken(payload, secret) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyToken(token, secret) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch (_error) {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp * 1000 <= Date.now()) return null;
  return payload;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored || "").split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const derived = scryptSync(String(password), salt, 64).toString("hex");
  const given = Buffer.from(derived);
  const want = Buffer.from(digest);
  return given.length === want.length && timingSafeEqual(given, want);
}

// The platform layer creates auth.users(id). Add the columns a real sign-in
// needs, idempotently, so an existing data dir upgrades in place.
async function ensureAuthSchema(db) {
  await db.exec(`
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS password_hash text;
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
    CREATE UNIQUE INDEX IF NOT EXISTS auth_users_email_key ON auth.users(lower(email)) WHERE email IS NOT NULL;
  `);
}

async function findUserByEmail(db, email) {
  const result = await db.query(
    "SELECT id, email, password_hash FROM auth.users WHERE lower(email) = lower($1) LIMIT 1",
    [String(email || "")],
  );
  return result.rows?.[0] || null;
}

async function countUsers(db) {
  const result = await db.query("SELECT count(*)::int AS n FROM auth.users WHERE email IS NOT NULL");
  return Number(result.rows?.[0]?.n || 0);
}

function publicUser(row) {
  return { id: row.id, email: row.email };
}

function sessionPayload(row, secret) {
  const accessToken = signToken(
    { sub: row.id, role: "authenticated", email: row.email, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS },
    secret,
  );
  const refreshToken = signToken(
    { sub: row.id, role: "authenticated", typ: "refresh", exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_SECONDS },
    secret,
  );
  return { accessToken, refreshToken, user: publicUser(row) };
}

async function readJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch (_error) {
    return {};
  }
}

// Returns true when the request was an auth request this module handled.
async function handleAuthRequest({ req, url, raw, db, secret, send }) {
  if (!url.pathname.startsWith("/api/auth/")) return false;

  const route = url.pathname.slice("/api/auth/".length);

  if (route === "public-config") {
    send(200, {
      providers: [],
      oauth_providers: [],
      email_verification: false,
      password_reset: false,
      signup_enabled: true,
    });
    return true;
  }

  if (route === "users" && req.method === "POST") {
    const body = await readJson(raw);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");
    if (!email || !password) {
      send(400, { error: "invalid_request", message: "email and password are required" });
      return true;
    }
    if ((await countUsers(db)) > 0) {
      send(409, { error: "signup_disabled", message: "this instance already has an account" });
      return true;
    }
    const id = randomUUID();
    await db.query(
      "INSERT INTO auth.users(id, email, password_hash) VALUES($1,$2,$3)",
      [id, email, hashPassword(password)],
    );
    send(200, sessionPayload({ id, email }, secret));
    return true;
  }

  if (route === "sessions" && req.method === "POST") {
    const body = await readJson(raw);
    const row = await findUserByEmail(db, body.email);
    if (!row || !verifyPassword(body.password, row.password_hash)) {
      send(401, { error: "invalid_credentials", message: "invalid email or password" });
      return true;
    }
    send(200, sessionPayload(row, secret));
    return true;
  }

  if (route === "refresh" && req.method === "POST") {
    const body = await readJson(raw);
    const token = body.refresh_token || body.refreshToken || "";
    const payload = verifyToken(token, secret);
    if (!payload || payload.typ !== "refresh") {
      send(401, { error: "invalid_refresh_token", message: "refresh token is invalid or expired" });
      return true;
    }
    const result = await db.query("SELECT id, email FROM auth.users WHERE id = $1 LIMIT 1", [payload.sub]);
    const row = result.rows?.[0];
    if (!row) {
      send(401, { error: "invalid_refresh_token", message: "account no longer exists" });
      return true;
    }
    const accessToken = signToken(
      { sub: row.id, role: "authenticated", email: row.email, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS },
      secret,
    );
    // No rotation: the client keeps its refresh token, and mintAccessToken
    // reports refreshToken:null when nothing rotated.
    send(200, { accessToken, user: publicUser(row) });
    return true;
  }

  // Change the single account's password. The SDK patches profiles/current, so
  // accept it there; this matters once the backend is reachable from the
  // internet - the bootstrap password is not something to keep.
  if (route === "profiles/current" && req.method === "PATCH") {
    const header = String(req.headers.authorization || "");
    const payload = verifyToken(header.replace(/^Bearer\s+/i, ""), secret);
    if (!payload) {
      send(401, { error: "unauthorized", message: "not signed in" });
      return true;
    }
    const body = await readJson(raw);
    const password = String(body.password || "");
    if (password.length < 10) {
      send(400, { error: "invalid_request", message: "password must be at least 10 characters" });
      return true;
    }
    await db.query("UPDATE auth.users SET password_hash = $2 WHERE id = $1", [payload.sub, hashPassword(password)]);
    send(200, { id: payload.sub, email: payload.email || null, password_changed: true });
    return true;
  }

  if (route === "profiles/current" && req.method === "GET") {
    const header = String(req.headers.authorization || "");
    const payload = verifyToken(header.replace(/^Bearer\s+/i, ""), secret);
    if (!payload) {
      send(401, { error: "unauthorized", message: "not signed in" });
      return true;
    }
    const result = await db.query("SELECT id, email FROM auth.users WHERE id = $1 LIMIT 1", [payload.sub]);
    if (!result.rows?.[0]) {
      send(404, { error: "not_found", message: "account no longer exists" });
      return true;
    }
    send(200, publicUser(result.rows[0]));
    return true;
  }

  if (route === "logout") {
    send(200, { ok: true });
    return true;
  }

  send(404, { error: "unsupported_auth_route", message: route });
  return true;
}

module.exports = {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  ensureAuthSchema,
  handleAuthRequest,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
};
