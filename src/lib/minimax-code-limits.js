const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

// MiniMax Code quota lane (agent.minimax.cn / agent.minimax.io). Ported from
// Token Monitor's provider (Javis603/token-monitor #1284, src/shared/providers/
// minimax/limits.js; MIT) onto our provider shape, minus the multi-key profile
// system and the CLI refresh path (see limitations below).
//
// Unlike the API-key lane in minimax-limits.js, this lane reads the OAuth
// session the MiniMax Code app itself stores on disk — zero configuration,
// the user only needs to be signed in there:
//   <data-dir>/auth/prod/<region>/mcode-public/auth.json
//   <data-dir>/auth/prod/<region>/mcode-public/auth-state.json
// where <data-dir> is MINIMAX_DATA_DIR, MAVIS_DATA_DIR, or ~/.minimax.
//
// Three calls, all with the stored Bearer access token:
//   1. POST {agent-origin}/matrix/api/v1/user/get_user_extra_info  → the
//      personal workspace id (workspace_type === 0).
//   2. POST {agent-origin}/matrix/api/v1/commerce/get_membership_info
//      { workspace_id } → points balance (op_credit_summary), op_group_id,
//      has_token_plan, plan name/tier.
//   3. GET {platform-origin}/backend/account/token_plan/remains_percent with
//      the X-Group-Id header → plan quota rows in USED-percent semantics
//      (status === 3 means unlimited — the opposite of the API-key lane's
//      placeholder meaning; the two parsers must never be merged).
//
// Known limitations, deliberate:
//   - No CLI refresh. TM refreshes an expired lease by running
//     `mcode provider list --json` and re-reading the file; that binary is not
//     guaranteed to exist and spawning a hidden login flow untested is worse
//     than an honest error, so an expired session reports unauthorized and
//     tells the user to re-login in the MiniMax Code app.
//   - No multi-key profiles: the API-key lane stays single-key.
//   - The recordKey hash the CLI uses to index auth.json did not reproduce
//     from the documented inputs on a real installation, so record selection
//     falls back to "the sole record" then "newest expiresAtMs". This is
//     version-tolerant: the auth-state generation check still filters stale
//     records.

const DEFAULT_TIMEOUT_MS = 12_000;
const WINDOW_5H_SECONDS = 5 * 60 * 60;
const WINDOW_WEEKLY_SECONDS = 7 * 24 * 60 * 60;

const REGION_ENDPOINTS = {
  cn: {
    agent: "https://agent.minimax.cn",
    platform: "https://www.minimaxi.com",
  },
  en: {
    agent: "https://agent.minimax.io",
    platform: "https://platform.minimax.io",
  },
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function expandHome(value, env) {
  if (typeof value !== "string" || !value) return "";
  if (value === "~") return env.HOME || os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(env.HOME || os.homedir(), value.slice(2));
  }
  return value;
}

// Data directories the MiniMax Code family keeps its OAuth session in.
function resolveMinimaxCodeDataDirs(env = process.env) {
  const candidates = [
    clean(env.TOKENTRACKER_MINIMAX_DATA_DIR),
    clean(env.MINIMAX_DATA_DIR),
    clean(env.MAVIS_DATA_DIR),
  ]
    .map((dir) => expandHome(dir, env))
    .filter(Boolean);
  const home = env.HOME || os.homedir();
  candidates.push(path.join(home, ".minimax"));
  const seen = new Set();
  const out = [];
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Pick the OAuth record for a region dir. Record selection is deliberately
// tolerant: the CLI's own recordKey formula did not reproduce from the
// documented inputs on a real install, so a single-record map wins outright
// and multiple records fall back to the newest lease.
function pickAuthRecord(authDoc, stateDoc) {
  if (!authDoc || authDoc.schemaVersion !== 1 || !authDoc.records || typeof authDoc.records !== "object") {
    return null;
  }
  const records = Object.values(authDoc.records).filter(
    (record) => record && typeof record === "object" && clean(record.accessToken),
  );
  if (!records.length) return null;
  // A stale record from a previous login carries an older generation than the
  // auth-state; skip those before anything else.
  const stateGeneration = Number(stateDoc?.generation);
  const generationMatched = Number.isFinite(stateGeneration)
    ? records.filter((record) => Number(record.generation) === stateGeneration)
    : records;
  const pool = generationMatched.length ? generationMatched : records;
  if (pool.length === 1) return pool[0];
  return pool.reduce((best, record) =>
    (Number(record.expiresAtMs) || 0) > (Number(best.expiresAtMs) || 0) ? record : best,
  );
}

// Find the newest readable auth session across data dirs and regions. Region
// preference follows the caller; a cn session is tried before en by default
// because that is where a mainland install signs in.
function readMinimaxCodeSession(env = process.env, { preferRegion = "cn" } = {}) {
  const regions = preferRegion === "en" ? ["en", "cn"] : ["cn", "en"];
  let best = null;
  for (const dataDir of resolveMinimaxCodeDataDirs(env)) {
    for (const region of regions) {
      const dir = path.join(dataDir, "auth", "prod", region, "mcode-public");
      const authPath = path.join(dir, "auth.json");
      const statePath = path.join(dir, "auth-state.json");
      if (!fs.existsSync(authPath)) continue;
      const authDoc = readJson(authPath);
      const stateDoc = readJson(statePath);
      const record = pickAuthRecord(authDoc, stateDoc);
      if (!record) continue;
      const session = {
        accessToken: clean(record.accessToken),
        expiresAtMs: Number(record.expiresAtMs) || 0,
        generation: Number(record.generation) || 0,
        region,
        authPath,
        statePath,
        stateStatus: clean(stateDoc?.status),
        stateScopes: Array.isArray(stateDoc?.scopes) ? stateDoc.scopes.map(clean) : [],
        stateBuildEnv: clean(stateDoc?.buildEnv),
      };
      if (!session.accessToken) continue;
      if (!best || session.expiresAtMs > best.expiresAtMs) best = session;
    }
  }
  return best;
}

function sessionIsLocallyExpired(session, nowMs) {
  return Number.isFinite(session.expiresAtMs) && session.expiresAtMs > 0 && session.expiresAtMs <= nowMs;
}

function intOrNull(value) {
  if (typeof value === "string" && /^\d+(\.\d+)?%?$/u.test(value.trim())) {
    value = value.trim().replace(/%$/u, "");
  }
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function percent(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/%$/u, "").trim();
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.max(0, Math.min(100, n)) : null;
}

function resetAtMs(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}T/u.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// The matrix endpoints answer under either the top level or a `data` wrapper;
// business errors ride base_resp.status_code (1004 = unauthorized, 2062 = no
// plan). Anything unreadable returns null so the caller degrades honestly.
function envelope(doc) {
  if (!doc || typeof doc !== "object") return null;
  const data = doc.data && typeof doc.data === "object" ? doc.data : doc;
  const baseResp = doc.base_resp && typeof doc.base_resp === "object"
    ? doc.base_resp
    : (data.base_resp && typeof data.base_resp === "object" ? data.base_resp : null);
  return { data, baseResp };
}

function businessCode(doc) {
  const env = envelope(doc);
  const code = Number(env?.baseResp?.status_code);
  return Number.isFinite(code) ? code : null;
}

function businessMessage(doc) {
  return clean(envelope(doc)?.baseResp?.status_msg);
}

// Plan quota rows: used-percent semantics. status === 3 = unlimited (a meter
// would lie); video rows carry counts instead of percentages.
function parseMinimaxCodePlan(doc) {
  const env = envelope(doc);
  if (!env) return { rows: [], unlimited: false };
  const rows = Array.isArray(env.data.model_remains)
    ? env.data.model_remains
    : Array.isArray(doc.model_remains)
      ? doc.model_remains
      : Array.isArray(env.data)
        ? env.data
        : [];
  let unlimited = false;
  const out = { general: null, video: null, unlimited: false };
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const name = clean(row.model_name).toLowerCase();
    if (name === "general") {
      const status = Number(row.current_interval_status);
      const intervalPct = percent(row.current_interval_used_percent);
      const weeklyPct = percent(row.current_weekly_used_percent);
      const totalPct = percent(row.current_interval_total_percent);
      if (status === 3) {
        unlimited = true;
        out.general = {
          unlimited: true,
          reset_at: resetAtMs(row.end_time) ?? null,
          weekly_reset_at: resetAtMs(row.weekly_end_time) ?? null,
        };
      } else {
        out.general = {
          used_percent: intervalPct,
          total_percent: totalPct,
          weekly_used_percent: weeklyPct,
          reset_at: resetAtMs(row.end_time) ?? null,
          weekly_reset_at: resetAtMs(row.weekly_end_time) ?? null,
        };
      }
      continue;
    }
    if (name.includes("video")) {
      const used = intOrNull(row.current_interval_used_count);
      const limit = intOrNull(row.current_interval_total_count);
      if (used !== null && limit !== null && limit > 0) {
        out.video = {
          used,
          limit,
          remaining: Math.max(0, limit - used),
          used_percent: Math.max(0, Math.min(100, (used / limit) * 100)),
          reset_at: resetAtMs(row.end_time) ?? null,
        };
      }
    }
  }
  out.unlimited = unlimited;
  return out;
}

function codeWindow({ usedPercent, resetAt, kind, limitSeconds }) {
  if (usedPercent === null && !resetAt) return null;
  return {
    kind,
    used: null,
    limit: null,
    remaining: null,
    used_percent: usedPercent,
    reset_at: resetAt,
    limit_window_seconds: limitSeconds,
  };
}

async function postJson(fetchImpl, url, token, body, timeoutMs) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    const error = new Error(`MiniMax Code HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

async function getJson(fetchImpl, url, token, extraHeaders, timeoutMs) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "error",
  });
  if (!response.ok) {
    const error = new Error(`MiniMax Code HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return response.json();
}

async function fetchMinimaxCodeLimits({
  home,
  fetchImpl = fetch,
  nowMs = Date.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  env = { ...process.env, HOME: home || process.env.HOME },
} = {}) {
  const session = readMinimaxCodeSession(env);
  if (!session) {
    return { configured: false, error: null };
  }
  if (session.stateStatus && session.stateStatus !== "authenticated") {
    return { configured: true, error: "MiniMax Code is not signed in — sign in to the MiniMax Code app and retry" };
  }
  if (sessionIsLocallyExpired(session, nowMs)) {
    return { configured: true, error: "MiniMax Code session expired — re-login in the MiniMax Code app (this lane does not auto-refresh)" };
  }

  const endpoints = REGION_ENDPOINTS[session.region] || REGION_ENDPOINTS.cn;
  const unauthorized = () => ({
    configured: true,
    error: "MiniMax Code session expired or unauthorized — re-login in the MiniMax Code app",
  });

  let extraInfo;
  try {
    extraInfo = await postJson(
      fetchImpl,
      `${endpoints.agent}/matrix/api/v1/user/get_user_extra_info`,
      session.accessToken,
      {},
      timeoutMs,
    );
  } catch (error) {
    const status = Number(error?.statusCode);
    if (status === 401 || status === 403) return unauthorized();
    if (status === 429) return { configured: true, error: "MiniMax Code rate limited" };
    return { configured: true, error: error?.message || "MiniMax Code user info fetch failed" };
  }
  if (businessCode(extraInfo) === 1004) return unauthorized();

  const userInfo = envelope(extraInfo);
  const workspaces = Array.isArray(userInfo?.data?.workspaces) ? userInfo.data.workspaces : [];
  const personal = workspaces.filter((workspace) => Number(workspace?.workspace_type) === 0);
  // A personal workspace id can legitimately be the NUMBER 0 — routing it
  // through the string cleaner would drop it and misreport a missing
  // workspace. The commerce endpoints reject stringified ids (HTTP 400), so
  // the numeric value is preserved for the request body.
  const rawWorkspaceId = personal[0]?.workspace_id ?? personal[0]?.workspaceId;
  const workspaceIdNum = Number(rawWorkspaceId);
  const hasWorkspaceId =
    rawWorkspaceId !== undefined && rawWorkspaceId !== null && rawWorkspaceId !== ""
    && Number.isFinite(workspaceIdNum);
  if (!hasWorkspaceId) {
    return { configured: true, error: "MiniMax Code account has no personal workspace" };
  }

  let membership = null;
  try {
    membership = await postJson(
      fetchImpl,
      `${endpoints.agent}/matrix/api/v1/commerce/get_membership_info`,
      session.accessToken,
      { workspace_id: workspaceIdNum },
      timeoutMs,
    );
    if (businessCode(membership) === 1004) return unauthorized();
  } catch (error) {
    const status = Number(error?.statusCode);
    if (status === 401 || status === 403) return unauthorized();
    // Points are best-effort: a failed membership call must not hide plan
    // windows the remains endpoint can still render.
  }

  const membershipData = envelope(membership)?.data || {};
  const points = intOrNull(membershipData.op_credit_summary?.total_remaining_amount);
  const opGroupId = clean(membershipData.op_group_id);
  const hasTokenPlan = membershipData.has_token_plan === true;
  const planName = clean(membershipData.plan_name);
  const tier = membershipData.token_plan_tier;
  const tierLabel = typeof tier === "string" ? clean(tier) : null;

  let planDoc = null;
  if (opGroupId) {
    try {
      planDoc = await getJson(
        fetchImpl,
        `${endpoints.platform}/backend/account/token_plan/remains_percent`,
        session.accessToken,
        { "X-Group-Id": opGroupId },
        timeoutMs,
      );
      const code = businessCode(planDoc);
      if (code === 1004) return unauthorized();
      if (code === 2062) planDoc = null; // no token plan on this account
    } catch (error) {
      const status = Number(error?.statusCode);
      if (status === 401 || status === 403) return unauthorized();
      planDoc = null;
    }
  }

  const parsedPlan = planDoc ? parseMinimaxCodePlan(planDoc) : { general: null, video: null, unlimited: false };
  const general = parsedPlan.general;
  const primary = general && !general.unlimited
    ? codeWindow({ usedPercent: general.used_percent, resetAt: general.reset_at, kind: "primary", limitSeconds: WINDOW_5H_SECONDS })
    : null;
  const secondary = general && !general.unlimited && (general.weekly_used_percent !== null || general.weekly_reset_at)
    ? codeWindow({ usedPercent: general.weekly_used_percent, resetAt: general.weekly_reset_at, kind: "secondary", limitSeconds: WINDOW_WEEKLY_SECONDS })
    : null;
  const video = parsedPlan.video
    ? {
      kind: "secondary",
      used: parsedPlan.video.used,
      limit: parsedPlan.video.limit,
      remaining: parsedPlan.video.remaining,
      used_percent: parsedPlan.video.used_percent,
      reset_at: parsedPlan.video.reset_at,
      limit_window_seconds: WINDOW_WEEKLY_SECONDS,
    }
    : null;

  if (!general && points === null && !hasTokenPlan) {
    return { configured: true, error: "MiniMax Code quota response is malformed or lacks plan data" };
  }

  return {
    configured: true,
    plan_name: planName || tierLabel || (hasTokenPlan ? "Token Plan" : "Free"),
    primary_window: primary,
    secondary_window: secondary,
    minimax_code_video_window: video,
    minimax_code_points: points,
    minimax_code_unlimited: Boolean(general?.unlimited),
    minimax_code_region: session.region,
    source: "mcode-auth",
    captured_at: new Date(nowMs).toISOString(),
  };
}

module.exports = {
  REGION_ENDPOINTS,
  resolveMinimaxCodeDataDirs,
  readMinimaxCodeSession,
  pickAuthRecord,
  parseMinimaxCodePlan,
  fetchMinimaxCodeLimits,
};
