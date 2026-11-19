/**
 * InsForge Edge：接收本地 CLI 上传的用量数据，写入 tokentracker_hourly。
 * 用 device token（SHA-256 hash）验证身份，用 service role key 写 DB。
 */
import { createClient } from "npm:@insforge/sdk";
import { cloudRpc, cloudFailure } from "./cloud/access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, apikey, x-tokentracker-device-token-hash",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isLeaderboardBlockedUser(userId: string): boolean {
  return (Deno.env.get("LEADERBOARD_BLOCKED_USER_IDS") ?? "")
    .split(",")
    .some((candidate) => candidate.trim() === userId);
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export default async function (req: Request): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  const deviceToken = authHeader?.replace(/^Bearer\s+/i, "");
  if (!deviceToken) return json({ error: "Missing bearer token" }, 401);

  // Bound bytes before parsing; clients retain their queue offset on rejection.
  if (Number(req.headers.get("Content-Length") || 0) > 1_048_576) return json({ error: "Upload too large" }, 413);
  const rawBody = await req.text();
  if (new TextEncoder().encode(rawBody).byteLength > 1_048_576) return json({ error: "Upload too large" }, 413);
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(rawBody); } catch { /* malformed request */ }
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL")!;
  const serviceRoleKey = Deno.env.get("INSFORGE_SERVICE_ROLE_KEY");
  const incomingApiKey =
    req.headers.get("apikey") ?? req.headers.get("Apikey") ?? req.headers.get("x-api-key") ?? undefined;
  const anonKey =
    Deno.env.get("INSFORGE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? incomingApiKey ?? undefined;
  if (!serviceRoleKey) return json({ error: "server misconfigured" }, 500);

  const client = createClient({
    baseUrl,
    edgeFunctionToken: serviceRoleKey,
    anonKey,
    ...(anonKey ? { headers: { apikey: anonKey } } : {}),
  });

  const tokenHash = await sha256Hex(deviceToken);

  const { data: tokenRow, error: tokenErr } = await client.database
    .from("tokentracker_device_tokens")
    .select("user_id, device_id")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .maybeSingle();

  if (tokenErr) return json({ error: tokenErr.message }, 500);
  if (!tokenRow) return json({ error: "Unauthorized" }, 401);

  const userId = (tokenRow as { user_id: string }).user_id;
  const deviceId = (tokenRow as { device_id: string }).device_id;

  // Revoking known tokens is not sufficient when another issuance request is
  // already in flight. The blocklist is the final write-path authorization.
  // Only an explicit ban stops the write path. An `auto_excluded` anomaly flag
  // deliberately does not: the detector is heuristic, and
  // tokentracker-leaderboard-refresh already excludes flagged accounts from the
  // public snapshot on its own. Blocking ingest as well meant a false positive
  // could not upload the corrected numbers that would clear it -- the account
  // was stuck until someone opened an issue (#639).
  if (isLeaderboardBlockedUser(userId)) {
    return json({ error: "Account blocked" }, 403);
  }

  const buckets = Array.isArray(body.buckets)
    ? body.buckets
    : Array.isArray(body.hourly)
      ? body.hourly
      : [];

  // Account session states (kind: "account_session_state" queue records)
  // are canonical observations of one provider-side session (trae-cn):
  // identity is (user, source, session_id) - device_id is NOT identity, so
  // every device of the account converges onto the same row via the LWW
  // upsert rpc. Downward / model / bucket corrections are one whole-row
  // replace; absence never deletes (contract NOT PROVEN). A states-only
  // batch is a meaningful upload and must not fall into the no-buckets
  // reject.
  const rawStates = Array.isArray(body.account_session_states) ? body.account_session_states : [];
  if (rawStates.length > 500) {
    return json({ error: "Too many account session states (max 500)" }, 400);
  }
  const TOKEN_KEYS = [
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "reasoning_output_tokens",
    "total_tokens",
  ] as const;
  const states: Record<string, unknown>[] = [];
  for (const r of rawStates) {
    const source = typeof r?.source === "string" ? r.source.trim().toLowerCase() : "";
    const sessionId = typeof r?.session_id === "string" ? r.session_id.trim() : "";
    const model = typeof r?.model === "string" ? r.model.trim() : "";
    const bucketStart = Date.parse(String(r?.bucket_start ?? ""));
    const verifiedAt = Date.parse(String(r?.snapshot_verified_at ?? ""));
    const tokens: Record<string, number> = {};
    let tokensOk = true;
    for (const k of TOKEN_KEYS) {
      const v = Number(r?.[k]);
      if (!Number.isSafeInteger(v) || v < 0) tokensOk = false;
      else tokens[k] = v;
    }
    // Fail closed on a malformed state record: a bogus canonical session row
    // would corrupt the account's cross-device truth. The parser guarantees
    // total = input + cached + cacheCreation + output; enforce it here too.
    if (
      source !== "trae-cn" ||
      !sessionId ||
      sessionId.length > 256 ||
      !model ||
      model.length > 200 ||
      !Number.isFinite(bucketStart) ||
      !Number.isFinite(verifiedAt) ||
      !tokensOk ||
      tokens.total_tokens !==
        tokens.input_tokens + tokens.cached_input_tokens + tokens.cache_creation_input_tokens + tokens.output_tokens
    ) {
      return json({ error: "Invalid account session state" }, 400);
    }
    states.push({
      source,
      session_id: sessionId,
      model,
      bucket_start: new Date(bucketStart).toISOString(),
      snapshot_verified_at: new Date(verifiedAt).toISOString(),
      ...tokens,
    });
  }
  // Same-session collisions inside one batch would make the LWW upsert's
  // ON CONFLICT affect a row twice (Postgres error). Keep the LAST record:
  // the append-only CLI queue writes later records with newer stamps.
  const stateMap = new Map<string, Record<string, unknown>>();
  for (const r of states) stateMap.set(r.source + "|" + r.session_id, r);
  const stateRows = Array.from(stateMap.values());

  // TRAE cache-fold evidence (src/lib/trae-fold-evidence.js): the client's
  // per-edition, per-model measured pools. The SQL upsert keeps the largest
  // measured volume per pool, so retries are idempotent and a device with no
  // TRAE history (empty pools → no rows here) never clobbers a real one.
  const rawEvidence = Array.isArray(body.trae_evidence) ? body.trae_evidence : [];
  if (rawEvidence.length > 200) {
    return json({ error: "Too many TRAE evidence rows (max 200)" }, 400);
  }
  const EVIDENCE_EDITIONS = new Set(["trae-cn", "trae"]);
  const evidenceRows: Record<string, unknown>[] = [];
  for (const r of rawEvidence) {
    const edition = typeof r?.edition === "string" ? r.edition.trim().toLowerCase() : "";
    const model = typeof r?.model === "string" ? r.model.trim() : "";
    const hits = Number(r?.hits);
    const volume = Number(r?.volume);
    // Fail closed on a malformed pool: a bogus rate would silently reprice
    // every TRAE row of the account.
    if (
      !EVIDENCE_EDITIONS.has(edition) ||
      !model ||
      model.length > 200 ||
      !Number.isSafeInteger(hits) || hits < 0 ||
      !Number.isSafeInteger(volume) || volume <= 0 ||
      hits > volume
    ) {
      return json({ error: "Invalid TRAE evidence row" }, 400);
    }
    evidenceRows.push({ edition, model, hits, volume });
  }

  if ((!Array.isArray(buckets) || buckets.length === 0) && stateRows.length === 0) {
    return json({ error: "No usage buckets provided" }, 400);
  }
  if (buckets.length > 500) {
    return json({ error: "Too many buckets (max 500)" }, 400);
  }

  // Fail closed on a malformed coverage signal before any mapping: garbage
  // would silently reprice every TRAE row of the account.
  for (const b of buckets) {
    if (b?.cache_observed_input_tokens == null) continue;
    const v = Number(b.cache_observed_input_tokens);
    if (!Number.isSafeInteger(v) || v < 0) {
      return json({ error: "Invalid cache_observed_input_tokens" }, 400);
    }
  }
  const mappedRows = buckets.map((b: Record<string, unknown>) => ({
    user_id: userId,
    device_id: deviceId,
    hour_start: b.hour_start,
    source: b.source || "unknown",
    model: b.model || "unknown",
    input_tokens: b.input_tokens || 0,
    cached_input_tokens: b.cached_input_tokens || 0,
    cache_creation_input_tokens: b.cache_creation_input_tokens || 0,
    output_tokens: b.output_tokens || 0,
    reasoning_output_tokens: b.reasoning_output_tokens || 0,
    total_tokens: b.total_tokens || 0,
    billable_total_tokens: b.billable_total_tokens || 0,
    total_cost_usd: Number(b.total_cost_usd) || 0,
    // The CLI queue rows name this field `conversation_count`; older upload
    // paths sent `conversations`. Reading only `conversations` zeroed the
    // column for every CLI upload since 2026-04-18 — accept both.
    conversations: b.conversation_count ?? b.conversations ?? 0,
    // Coverage signal for the TRAE cache fold (owner report 2026-11-15): the
    // CLI queue emits it on every TRAE-family row, but this wire used to drop
    // it — so the account view priced unreported TRAE cache at the list-price
    // ceiling (trae-cn $6,003 of the $10,292 account total). Absent → NULL →
    // the SQL COALESCEs to 0 → the fold treats the row as unmeasured, the same
    // semantics the local fold applies to pre-signal rows. Pre-validated below
    // (fail closed, like the token columns): garbage would silently reprice
    // every TRAE row of the account.
    cache_observed_input_tokens: b.cache_observed_input_tokens == null
      ? null
      : Number(b.cache_observed_input_tokens),
  }));

  // Dedupe within the batch by (hour_start, source, model), keeping the row
  // with the largest total_tokens. The CLI's queue.jsonl is append-only and
  // re-emits the same logical bucket multiple times as a session fills out
  // (each emission carries the cumulative running total, so MAX wins). Two
  // rows sharing the conflict key in one upsert make Postgres throw
  // "ON CONFLICT DO UPDATE command cannot affect row a second time" and
  // reject the entire batch — which stalled all clients until this dedupe.
  const dedupedMap = new Map<string, typeof mappedRows[number]>();
  for (const r of mappedRows) {
    const key = `${r.hour_start}|${r.source}|${r.model}`;
    const prev = dedupedMap.get(key);
    if (!prev || (Number(r.total_tokens) || 0) > (Number(prev.total_tokens) || 0)) {
      dedupedMap.set(key, r);
    }
  }
  // TRAE 双计守卫（站主裁定 2026-11-20，方案 B）：同一台机器上旧版 Trae
  // （Work CN）本地库与 Trae CN 官方 API/本地库覆盖同一段会话，`trae` 与
  // `trae-cn` 行会把同一份用量各计一次（J2900 实测 973 行/≈44.9 亿 tokens
  // 重复）。同一批内与 trae-cn 行 (hour_start, model, total_tokens) 逐位
  // 相同的 trae 行视为同一份用量，跳过不入库；不精确相等的切期差额保留。
  // 跨批次的重复由聚合侧同名守卫兜底（scripts/self-host/aggregation.sql）。
  const traeCnKeys = new Set<string>();
  for (const r of dedupedMap.values()) {
    if (r.source !== "trae-cn" || (Number(r.total_tokens) || 0) <= 0) continue;
    traeCnKeys.add(`${r.hour_start}|${r.model}|${Number(r.total_tokens)}`);
  }
  const rows = traeCnKeys.size
    ? Array.from(dedupedMap.values()).filter((r) => (
        r.source !== "trae" ||
        (Number(r.total_tokens) || 0) <= 0 ||
        !traeCnKeys.has(`${r.hour_start}|${r.model}|${Number(r.total_tokens)}`)
      ))
    : Array.from(dedupedMap.values());

  try {
    const result = await cloudRpc(client, "cloud_ingest_usage", {
      p_token_hash: tokenHash, p_rows: rows, p_states: stateRows,
      p_upload_id: typeof body.upload_id === "string" && /^[0-9a-f-]{36}$/i.test(body.upload_id)
        ? body.upload_id : null,
      p_evidence: evidenceRows,
    });
    if (!result.ok) return cloudFailure(result, corsHeaders);
    return json(result);
  } catch (error) {
    console.error("cloud ingest transaction failed", (error as Error).message);
    return json({ error: "Cloud access unavailable", code: "cloud_access_unavailable" }, 503);
  }
}
