/**
 * Tokentracker badge sync — account-level achievement union (成就跨设备并集).
 *
 * Achievements are computed per device from that device's own queue: session
 * marathons, project counts, JoyCode / raccoon ledgers only exist locally, so
 * the computation cannot move server-side without losing badges. Instead each
 * device keeps its local computation and syncs the RESULT here; a read returns
 * the union across devices, so every device shows the same achievement wall.
 *
 * Endpoints (Bearer required — badges are account data, not public):
 *   POST { badges: [{ id, achieved: {bronze?,silver?,gold?,diamond?} }], device_id? }
 *        → merges per (user, badge): each tier keeps the EARLIEST timestamp
 *          across devices, tier = highest non-null tier. Idempotent: re-posting
 *          the same set never moves a timestamp forward.
 *   GET  → { badges: [{ id, tier, achieved, device_id, updated_at }] }
 *
 * Validation: badge ids match the local catalog's slug shape; timestamps must
 * parse as dates (ISO). Unknown ids are accepted and stored (a newer client
 * may know badges this deployment's catalog doesn't) — the reader filters.
 *
 * The table has RLS enabled with no policy: only this function's service-role
 * key can read/write it (direct PostgREST access is denied), matching
 * tokentracker_profile_likes.
 */
import { createClient } from "npm:@insforge/sdk";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
};

const TABLE = "tokentracker_account_badges";
const TIER_KEYS = ["bronze", "silver", "gold", "diamond"] as const;
const MAX_BADGES = 120;
const BADGE_ID_RE = /^[a-z0-9_]{1,64}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (b64.length % 4)) % 4;
  const raw = atob(b64 + "=".repeat(pad));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Verify a HS256/RS256 JWT locally and return its `sub`. InsForge does NOT
 * validate JWTs at the gateway, so this edge function must do it — otherwise
 * any caller could forge `{"sub":"<victim>"}` and read or overwrite someone's
 * achievement wall. Returns null on any failure; the caller 401s (badges are
 * account data, there is no anonymous fallback).
 * Mirrors tokentracker-profile-likes.ts.
 */
async function verifiedUserIdFromJwt(token: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as Record<string, unknown>;
    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const sig = b64urlToBytes(parts[2]);
    let ok = false;
    if (header.alg === "HS256") {
      const secret = Deno.env.get("JWT_SECRET");
      if (!secret) return null;
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify("HMAC", key, sig, data);
    } else if (header.alg === "RS256") {
      const publicKeyPem = Deno.env.get("JWT_PUBLIC_KEY");
      if (!publicKeyPem) return null;
      const publicKeyDer = Uint8Array.from(atob(publicKeyPem.replace(/-----[^-]+-----|\s/g, "")), (char) => char.charCodeAt(0));
      const key = await crypto.subtle.importKey("spki", publicKeyDer, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
    } else return null;
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as Record<string, unknown>;
    if (typeof payload.exp === "number" && Date.now() / 1000 > payload.exp) return null;
    const sub = payload.sub;
    if (typeof sub === "string" && sub.length > 0) return sub;
    const uid = payload.user_id;
    if (typeof uid === "string" && uid.length > 0) return uid;
  } catch {
    /* ignore */
  }
  return null;
}

function bearerToken(req: Request): string | null {
  const raw = req.headers.get("authorization") ?? "";
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : null;
}

function getClient(incomingApiKey?: string) {
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  return createClient({
    baseUrl: Deno.env.get("INSFORGE_BASE_URL")!,
    edgeFunctionToken: serviceRoleKey,
    anonKey: anonKey ?? undefined,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
    isServerMode: true,
  });
}

type AchievedMap = Partial<Record<(typeof TIER_KEYS)[number], string | null>>;

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normalizeAchieved(raw: unknown): AchievedMap | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: AchievedMap = {};
  const source = raw as Record<string, unknown>;
  for (const tier of TIER_KEYS) {
    const value = source[tier];
    if (value == null) {
      out[tier] = null;
    } else if (isTimestamp(value)) {
      out[tier] = value;
    } else {
      return null;
    }
  }
  return out;
}

function tierFromAchieved(achieved: AchievedMap): number {
  for (let index = TIER_KEYS.length - 1; index >= 0; index -= 1) {
    if (achieved[TIER_KEYS[index]]) return index + 1;
  }
  return 0;
}

/** Earliest non-null timestamp wins: an unlock date never moves forward. */
function mergeAchieved(base: AchievedMap, incoming: AchievedMap): AchievedMap {
  const out: AchievedMap = {};
  for (const tier of TIER_KEYS) {
    const left = base[tier] ?? null;
    const right = incoming[tier] ?? null;
    if (!left) out[tier] = right;
    else if (!right) out[tier] = left;
    else out[tier] = Date.parse(left) <= Date.parse(right) ? left : right;
  }
  return out;
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  if (!Deno.env.get("INSFORGE_SERVICE_ROLE_KEY")) {
    return json({ error: "server misconfigured" }, 500);
  }

  const userId = await verifiedUserIdFromJwt(bearerToken(req) ?? "");
  if (!userId) return json({ error: "unauthorized", message: "sign in to sync achievements" }, 401);

  const client = getClient(incomingApiKey ?? undefined);

  try {
    if (req.method === "GET") {
      const { data, error } = await client.database
        .from(TABLE)
        .select("badge_id, achieved, tier, device_id, updated_at")
        .eq("user_id", userId);
      if (error) throw new Error(error.message);
      const badges = (data as Array<Record<string, unknown>>).map((row) => ({
        id: row.badge_id,
        tier: Number(row.tier) || tierFromAchieved(row.achieved as AchievedMap),
        achieved: row.achieved,
        device_id: row.device_id,
        updated_at: row.updated_at,
      }));
      return json({ badges });
    }

    if (req.method === "POST") {
      let body: { badges?: unknown; device_id?: unknown };
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_request", message: "JSON body required" }, 400);
      }
      const incoming = Array.isArray(body.badges) ? body.badges : null;
      if (!incoming || incoming.length === 0) return json({ error: "invalid_request", message: "badges array required" }, 400);
      if (incoming.length > MAX_BADGES) return json({ error: "invalid_request", message: "too many badges" }, 400);
      const deviceId = typeof body.device_id === "string" ? body.device_id.slice(0, 64) : "";

      const parsed = new Map<string, AchievedMap>();
      for (const raw of incoming) {
        if (!raw || typeof raw !== "object") return json({ error: "invalid_request", message: "badge entries must be objects" }, 400);
        const { id, achieved } = raw as Record<string, unknown>;
        if (typeof id !== "string" || !BADGE_ID_RE.test(id)) {
          return json({ error: "invalid_request", message: "badge id must be a catalog slug" }, 400);
        }
        const achievedMap = normalizeAchieved(achieved);
        if (!achievedMap) {
          return json({ error: "invalid_request", message: `badge ${id}: achieved must map tier keys to ISO timestamps` }, 400);
        }
        parsed.set(id, achievedMap);
      }

      const ids = [...parsed.keys()];
      const { data: existingRows, error: readErr } = await client.database
        .from(TABLE)
        .select("badge_id, achieved")
        .eq("user_id", userId)
        .in("badge_id", ids);
      if (readErr) throw new Error(readErr.message);
      const existing = new Map<string, AchievedMap>();
      for (const row of (existingRows as Array<Record<string, unknown>>) ?? []) {
        existing.set(String(row.badge_id), (row.achieved ?? {}) as AchievedMap);
      }

      // Read-merge-write per badge. Two devices racing converge anyway: each
      // keeps the earliest timestamp it saw, and the next upload from the other
      // side cannot move a timestamp forward.
      let stored = 0;
      for (const [badgeId, incomingMap] of parsed) {
        const merged = mergeAchieved(existing.get(badgeId) ?? {}, incomingMap);
        const tier = tierFromAchieved(merged);
        if (tier === 0) continue;
        const { error } = await client.database.from(TABLE).upsert(
          [{ user_id: userId, badge_id: badgeId, achieved: merged, tier, device_id: deviceId }],
          { onConflict: "user_id,badge_id" },
        );
        if (error) throw new Error(error.message);
        stored += 1;
      }
      return json({ ok: true, stored, received: parsed.size });
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (e) {
    return json({ error: (e as Error).message || "badge sync failed" }, 500);
  }
}
