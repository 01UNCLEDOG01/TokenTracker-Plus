-- TRAE fold evidence reaches the cloud (2026-11-15; owner report: the account
-- hero billed ~¥68.7k while 本机数据 said ~¥39k for the same account).
--
-- Root cause chain, measured on the J2900 instance:
--   1. TRAE rows uploaded to tokentracker_hourly carry almost no reported
--      cache (cache_observed_input_tokens was dropped by the ingest wire and
--      never stored), so the account edge functions priced the whole input
--      side at the list-price ceiling. trae-cn alone came out at $6,003 of the
--      $10,292 account total — e.g. Kimi-K2.7-Code $3,559.76 where the local
--      dashboard (foldTraeRowCost, measured ~84% hit rate) prices ¥5,768.76.
--   2. The device card excluded trae-cn as "account-level" while the summary
--      included it, so the hero (853.4亿) and the device rows (752.3亿)
--      disagreed by exactly the trae-cn volume (101.1亿).
--
-- This migration:
--   a. stores the coverage signal the CLI queue already emits
--      (tokentracker_hourly.cache_observed_input_tokens, carried by the ingest),
--   b. stores the per-edition fold evidence the client computes locally
--      (tokentracker_account_trae_evidence; uploaded through the ingest),
--   c. carries both through account_usage_grouped and the three compact/wire
--      pairs (trailing dim slot; the wire packer trims trailing zeros, so a
--      0-observed dim arrives slotless and the decoders default it to 0 =
--      unmeasured — the fold's real gate is the evidence pool, which only
--      exists once this migration ran),
--   d. attaches cursor to the oldest active device that has cursor rows and
--      lets trae-cn ride its real device_id, so every account-wide total is
--      the sum of the device rows (owner ruling 2026-11-15: trae and cursor
--      are used on the PC — show them there).
--
-- The fold itself stays read-side in the edge TypeScript (lockstep with
-- src/lib/pricing + local-api foldTraeRowCost). SQL never prices: the price
-- table lives in the function bundle only.

ALTER TABLE public.tokentracker_hourly
  ADD COLUMN IF NOT EXISTS cache_observed_input_tokens bigint;

CREATE TABLE IF NOT EXISTS public.tokentracker_account_trae_evidence (
  user_id uuid NOT NULL,
  edition text NOT NULL,
  model text NOT NULL,
  hits bigint NOT NULL,
  volume bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, edition, model)
);
ALTER TABLE public.tokentracker_account_trae_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_account_trae_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tokentracker_account_trae_evidence TO project_admin;

-- Upsert the client's fold pools. "Keep the largest measured pool" makes
-- retries idempotent and stops a second device's smaller (or empty) pool from
-- shrinking the evidence the account view folds with; rates change slowly, so
-- a stale-but-larger pool is the harmless side.
CREATE OR REPLACE FUNCTION public.tokentracker_upsert_trae_evidence(
  p_user_id uuid,
  p_rows jsonb
) RETURNS void
LANGUAGE plpgsql
SET search_path TO public, pg_temp
AS $fn$
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN; END IF;
  -- DISTINCT ON mirrors the ingest's bucket dedupe: two rows with the same
  -- (edition, model) in one batch would otherwise make ON CONFLICT affect a
  -- row twice and reject the whole statement.
  INSERT INTO public.tokentracker_account_trae_evidence AS e (user_id, edition, model, hits, volume, updated_at)
  SELECT p_user_id, x.edition, x.model, x.hits, x.volume, clock_timestamp()
  FROM (
    SELECT DISTINCT ON (lower(trim(r.edition)), lower(trim(r.model)))
      trim(r.edition) AS edition, trim(r.model) AS model, r.hits, r.volume
    FROM jsonb_to_recordset(p_rows) AS r(edition text, model text, hits bigint, volume bigint)
    WHERE r.edition IN ('trae-cn', 'trae')
      AND length(trim(r.model)) BETWEEN 1 AND 200
      AND r.volume > 0
      AND r.hits >= 0
      AND r.hits <= r.volume
    ORDER BY lower(trim(r.edition)), lower(trim(r.model)), r.volume DESC
  ) x
  ON CONFLICT (user_id, edition, model) DO UPDATE
    SET hits = excluded.hits,
        volume = excluded.volume,
        updated_at = excluded.updated_at
    WHERE e.volume < excluded.volume;
END;
$fn$;
REVOKE ALL ON FUNCTION public.tokentracker_upsert_trae_evidence(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tokentracker_upsert_trae_evidence(uuid, jsonb) TO project_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- account_usage_grouped: carry cache_observed_input_tokens through all arms,
-- and attach cursor to its owning device. Re-applies the 2026-11-13 restore
-- semantics (trae-cn rides the machine arm) on top of the 11-13 cost column.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_usage_grouped(
  p_user_id uuid,
  p_device_ids uuid[],
  p_from timestamptz,
  p_to timestamptz,
  p_trunc text,
  p_tz text,
  p_offset_min integer
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO public, pg_temp
SET statement_timeout TO '8s'
AS $func$
  WITH tzr AS (
    SELECT CASE
      WHEN p_tz IS NOT NULL AND p_tz <> ''
       AND EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_tz)
      THEN p_tz ELSE NULL
    END AS tz
  ), cursor_owner AS (
    -- Account-level cursor data exists once per account, but every device
    -- that syncs it stores an identical copy. Attach the deduped set to the
    -- oldest active device that actually has cursor rows (owner ruling
    -- 2026-11-15: cursor is used on the PC), so per-device views stay
    -- disjoint and account-wide totals equal their sum. Only the non-empty
    -- p_device_ids branch consults this; the explicit account-arm call
    -- (cardinality = 0, the leaderboard profile's all-devices-revoked
    -- fallback) keeps the pre-2026-11-15 semantics in the arm itself. NULL
    -- (no active device with cursor rows) keeps the arm empty — nothing
    -- fabricates a device attribution.
    SELECT hc.device_id AS id
    FROM public.tokentracker_hourly hc
    JOIN public.tokentracker_devices d ON d.id = hc.device_id
    WHERE hc.user_id = p_user_id
      AND hc.source = 'cursor'
      AND d.revoked_at IS NULL
    ORDER BY d.created_at ASC, d.id ASC
    LIMIT 1
  ), base AS MATERIALIZED (
    SELECT
      h.device_id, h.hour_start, h.source, h.model,
      h.total_tokens::bigint AS total_tokens,
      h.input_tokens::bigint AS input_tokens,
      h.output_tokens::bigint AS output_tokens,
      h.cached_input_tokens::bigint AS cached_input_tokens,
      h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
      h.reasoning_output_tokens::bigint AS reasoning_output_tokens,
      h.conversations::bigint AS conversations,
      COALESCE(h.cache_observed_input_tokens, 0)::bigint AS cache_observed_input_tokens,
      COALESCE(h.total_cost_usd, 0)::numeric AS total_cost_usd,
      h.updated_at
    FROM public.tokentracker_hourly h
    WHERE h.user_id = p_user_id
      AND h.hour_start >= p_from AND h.hour_start < p_to
      AND (
        h.source = 'cursor'
        OR (
          h.source NOT IN ('cursor')
          AND h.device_id = ANY(p_device_ids)
        )
      )
  ), hourly AS (
    SELECT mac.hour_start, mac.source, mac.model,
      mac.total_tokens, mac.input_tokens, mac.output_tokens,
      mac.cached_input_tokens, mac.cache_creation_input_tokens,
      mac.reasoning_output_tokens, mac.conversations,
      mac.cache_observed_input_tokens, mac.total_cost_usd
    FROM (
      SELECT DISTINCT ON (
        COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model
      )
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations,
        h.cache_observed_input_tokens, h.total_cost_usd
      FROM base h
      LEFT JOIN public.tokentracker_device_machine dm ON dm.device_id = h.device_id
      WHERE h.source NOT IN ('cursor')
        AND h.device_id = ANY(p_device_ids)
      ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) mac

    UNION ALL

    SELECT d.hour_start, d.source, d.model,
      d.total_tokens, d.input_tokens, d.output_tokens,
      d.cached_input_tokens, d.cache_creation_input_tokens,
      d.reasoning_output_tokens, d.conversations,
      d.cache_observed_input_tokens, d.total_cost_usd
    FROM (
      SELECT DISTINCT ON (h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations,
        h.cache_observed_input_tokens, h.total_cost_usd
      FROM base h
      WHERE h.source = 'cursor'
        AND (
          -- Explicit account-arm call (p_device_ids empty): keep the
          -- pre-2026-11-15 semantics — dedupe across every device's copy,
          -- largest total wins. This is the leaderboard profile's
          -- all-devices-revoked fallback, which exists to surface
          -- account-level history when no active device can own it.
          cardinality(p_device_ids) = 0
          OR (
            (SELECT id FROM cursor_owner) IS NOT NULL
            AND (SELECT id FROM cursor_owner) = ANY(p_device_ids)
            AND h.device_id = (SELECT id FROM cursor_owner)
          )
        )
      ORDER BY h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) d

  ), located AS (
    SELECT
      CASE p_trunc
        WHEN 'hour' THEN to_char(date_trunc('hour', local_ts), 'YYYY-MM-DD"T"HH24:00:00')
        WHEN 'day' THEN to_char(date_trunc('day', local_ts), 'YYYY-MM-DD')
        WHEN 'month' THEN to_char(date_trunc('month', local_ts), 'YYYY-MM')
        ELSE ''
      END AS bucket,
      source, model,
      CASE
        WHEN lower(model) LIKE '%deepseek-v4-flash%'
          OR lower(model) LIKE '%deepseek-v4.1-flash%'
          OR lower(model) LIKE '%deepseek-flash%'
          OR lower(model) LIKE '%deepseek-v4-pro%'
        THEN CASE
          WHEN hour_start >= timestamptz '2026-08-22T16:00:00Z'
            AND extract(dow FROM ((hour_start AT TIME ZONE 'UTC') + interval '8 hours')) IN (0, 6)
          THEN 'off_peak'
          WHEN (
            extract(hour FROM hour_start AT TIME ZONE 'UTC') >= 1
            AND extract(hour FROM hour_start AT TIME ZONE 'UTC') < 4
          ) OR (
            extract(hour FROM hour_start AT TIME ZONE 'UTC') >= 6
            AND extract(hour FROM hour_start AT TIME ZONE 'UTC') < 10
          ) THEN 'peak' ELSE 'off_peak'
        END
        ELSE 'peak'
      END AS pricing_tier,
      total_tokens, input_tokens, output_tokens, cached_input_tokens,
      cache_creation_input_tokens, reasoning_output_tokens, conversations,
      cache_observed_input_tokens, total_cost_usd
    FROM hourly CROSS JOIN tzr
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN tzr.tz IS NOT NULL THEN hour_start AT TIME ZONE tzr.tz
        WHEN p_offset_min IS NOT NULL
          THEN (hour_start AT TIME ZONE 'UTC') + make_interval(mins => p_offset_min)
        ELSE hour_start AT TIME ZONE 'UTC'
      END AS local_ts
    ) local_time
  ), grouped AS (
    SELECT bucket, source, model, pricing_tier,
      SUM(total_tokens)::bigint AS total_tokens,
      SUM(input_tokens)::bigint AS input_tokens,
      SUM(output_tokens)::bigint AS output_tokens,
      SUM(cached_input_tokens)::bigint AS cached_input_tokens,
      SUM(cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
      SUM(reasoning_output_tokens)::bigint AS reasoning_output_tokens,
      SUM(conversations)::bigint AS conversations,
      SUM(cache_observed_input_tokens)::bigint AS cache_observed_input_tokens,
      SUM(total_cost_usd)::numeric AS total_cost_usd
    FROM located
    GROUP BY bucket, source, model, pricing_tier
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(grouped.*) ORDER BY bucket, source, model, pricing_tier),
    '[]'::jsonb
  ) FROM grouped
$func$;

REVOKE ALL ON FUNCTION public.account_usage_grouped(uuid, uuid[], timestamptz, timestamptz, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_usage_grouped(uuid, uuid[], timestamptz, timestamptz, text, text, integer) TO project_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- account_summary_compact: cost_dims gain a trailing 9th slot (observed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_summary_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, 'day', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>'bucket' AS bucket,
      e->>'source' AS source,
      e->>'model' AS model,
      e->>'pricing_tier' AS pricing_tier,
      COALESCE((e->>'total_tokens')::bigint, 0) AS total_tokens,
      COALESCE((e->>'input_tokens')::bigint, 0) AS input_tokens,
      COALESCE((e->>'output_tokens')::bigint, 0) AS output_tokens,
      COALESCE((e->>'cached_input_tokens')::bigint, 0) AS cached_input_tokens,
      COALESCE((e->>'cache_creation_input_tokens')::bigint, 0) AS cache_creation_input_tokens,
      COALESCE((e->>'reasoning_output_tokens')::bigint, 0) AS reasoning_output_tokens,
      COALESCE((e->>'cache_observed_input_tokens')::bigint, 0) AS cache_observed_input_tokens,
      COALESCE((e->>'conversations')::bigint, 0) AS conversations
    FROM raw, jsonb_array_elements(raw.j) e
  ), in_range AS (
    SELECT * FROM g WHERE bucket >= p_range_from AND bucket <= p_range_to
  ), dims AS (
    SELECT source, model, pricing_tier,
      SUM(input_tokens) AS i,
      SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr,
      SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs,
      SUM(cache_observed_input_tokens) AS ob
    FROM in_range
    GROUP BY source, model, pricing_tier
  ), days AS (
    SELECT bucket, SUM(total_tokens) AS t, SUM(conversations) AS c
    FROM g GROUP BY bucket
  )
  SELECT jsonb_build_object(
    'cost_dims', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(source, model, pricing_tier, i, o, cr, cw, rs, ob)
                        ORDER BY source, model, pricing_tier) FROM dims),
      '[]'::jsonb),
    'day_rollup', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(bucket, t, c) ORDER BY bucket) FROM days),
      '[]'::jsonb),
    'range_totals', (SELECT jsonb_build_object(
        'total_tokens', COALESCE(SUM(total_tokens), 0),
        'input_tokens', COALESCE(SUM(input_tokens), 0),
        'output_tokens', COALESCE(SUM(output_tokens), 0),
        'cached_input_tokens', COALESCE(SUM(cached_input_tokens), 0),
        'cache_creation_input_tokens', COALESCE(SUM(cache_creation_input_tokens), 0),
        'reasoning_output_tokens', COALESCE(SUM(reasoning_output_tokens), 0),
        'conversation_count', COALESCE(SUM(conversations), 0),
        'active_days', COUNT(DISTINCT bucket)
      ) FROM in_range)
  )
$fn$;
REVOKE ALL ON FUNCTION public.account_summary_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_summary_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- account_daily_compact: cost_dims gain a trailing 10th slot (observed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_daily_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, 'day', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>'bucket' AS bucket,
      e->>'source' AS source,
      e->>'model' AS model,
      e->>'pricing_tier' AS pricing_tier,
      COALESCE(NULLIF(e->>'model', ''), 'unknown') AS model_key,
      COALESCE((e->>'total_tokens')::bigint, 0) AS total_tokens,
      COALESCE((e->>'input_tokens')::bigint, 0) AS input_tokens,
      COALESCE((e->>'output_tokens')::bigint, 0) AS output_tokens,
      COALESCE((e->>'cached_input_tokens')::bigint, 0) AS cached_input_tokens,
      COALESCE((e->>'cache_creation_input_tokens')::bigint, 0) AS cache_creation_input_tokens,
      COALESCE((e->>'reasoning_output_tokens')::bigint, 0) AS reasoning_output_tokens,
      COALESCE((e->>'cache_observed_input_tokens')::bigint, 0) AS cache_observed_input_tokens,
      COALESCE((e->>'conversations')::bigint, 0) AS conversations
    FROM raw, jsonb_array_elements(raw.j) e
    WHERE e->>'bucket' >= p_range_from AND e->>'bucket' <= p_range_to
  ), per_day_model AS (
    SELECT bucket, model_key, SUM(total_tokens) AS mt
    FROM g GROUP BY bucket, model_key
  ), models AS (
    SELECT bucket, jsonb_object_agg(model_key, mt) AS mm
    FROM per_day_model GROUP BY bucket
  ), days AS (
    SELECT bucket,
      SUM(total_tokens) AS tt, SUM(input_tokens) AS i, SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr, SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs, SUM(conversations) AS cv
    FROM g GROUP BY bucket
  ), cost AS (
    SELECT bucket, source, model, pricing_tier,
      SUM(input_tokens) AS i, SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr, SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs,
      SUM(cache_observed_input_tokens) AS ob
    FROM g GROUP BY bucket, source, model, pricing_tier
  )
  SELECT jsonb_build_object(
    'days', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(d.bucket, d.tt, d.i, d.o, d.cr, d.cw, d.rs, d.cv, m.mm)
                        ORDER BY d.bucket)
       FROM days d JOIN models m ON m.bucket = d.bucket),
      '[]'::jsonb),
    'cost_dims', COALESCE(
      (SELECT jsonb_agg(jsonb_build_array(bucket, source, model, pricing_tier, i, o, cr, cw, rs, ob)
                        ORDER BY bucket, source, model, pricing_tier) FROM cost),
      '[]'::jsonb)
  )
$fn$;
REVOKE ALL ON FUNCTION public.account_daily_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_daily_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- account_model_breakdown_compact: dims gain a trailing 10th slot (observed).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_model_breakdown_compact(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql
VOLATILE
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $fn$
  WITH raw AS (
    SELECT public.account_usage_grouped_cached(
      p_user_id, p_device_id, p_from, p_to, 'day', p_tz, p_offset_min
    ) AS j
  ), g AS (
    SELECT
      e->>'bucket' AS bucket,
      e->>'source' AS source,
      e->>'model' AS model,
      e->>'pricing_tier' AS pricing_tier,
      COALESCE((e->>'total_tokens')::bigint, 0) AS total_tokens,
      COALESCE((e->>'input_tokens')::bigint, 0) AS input_tokens,
      COALESCE((e->>'output_tokens')::bigint, 0) AS output_tokens,
      COALESCE((e->>'cached_input_tokens')::bigint, 0) AS cached_input_tokens,
      COALESCE((e->>'cache_creation_input_tokens')::bigint, 0) AS cache_creation_input_tokens,
      COALESCE((e->>'reasoning_output_tokens')::bigint, 0) AS reasoning_output_tokens,
      COALESCE((e->>'cache_observed_input_tokens')::bigint, 0) AS cache_observed_input_tokens
    FROM raw, jsonb_array_elements(raw.j) e
  ), dims AS (
    SELECT source, model, pricing_tier,
      SUM(total_tokens) AS tt,
      SUM(input_tokens) AS i,
      SUM(output_tokens) AS o,
      SUM(cached_input_tokens) AS cr,
      SUM(cache_creation_input_tokens) AS cw,
      SUM(reasoning_output_tokens) AS rs,
      SUM(cache_observed_input_tokens) AS ob
    FROM g
    WHERE bucket >= p_range_from AND bucket <= p_range_to
    GROUP BY source, model, pricing_tier
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(jsonb_build_array(source, model, pricing_tier, tt, i, o, cr, cw, rs, ob)
                      ORDER BY source, model, pricing_tier) FROM dims),
    '[]'::jsonb)
$fn$;
REVOKE ALL ON FUNCTION public.account_model_breakdown_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_model_breakdown_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- The positional wires: pack the new trailing slot. The packers trim trailing
-- zeros, and the TypeScript decoders default missing trailing slots to 0, so
-- old edges/new SQL and new edges/old SQL both degrade to "no fold".
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_summary_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_summary_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  dims AS (
    SELECT value AS row, ordinality AS ord
    FROM raw, jsonb_array_elements(raw.j->'cost_dims') WITH ORDINALITY
  ), sources AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->0 AS name FROM dims) names
  ), models AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->1 AS name FROM dims) names
  ), tiers AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->2 AS name FROM dims) names
  ), indexed AS (
    SELECT ord, jsonb_build_array(s.idx, m.idx, t.idx, row->3, row->4, row->5, row->6, row->7, row->8) AS row
    FROM dims
    JOIN sources s ON s.name = row->0
    JOIN models m ON m.name = row->1
    JOIN tiers t ON t.name = row->2
  ), packed_dims AS (
    SELECT ord, (
      SELECT jsonb_agg(value ORDER BY token_ord)
      FROM jsonb_array_elements(row) WITH ORDINALITY AS tokens(value, token_ord)
      WHERE token_ord <= GREATEST(3, COALESCE((
        SELECT MAX(last_ord)
        FROM jsonb_array_elements(row) WITH ORDINALITY AS last_value(value, last_ord)
        WHERE last_value.value <> '0'::jsonb
      ), 3))
    ) AS row FROM indexed
  ), days AS (
    SELECT value AS row, ordinality AS ord
    FROM raw, jsonb_array_elements(raw.j->'day_rollup') WITH ORDINALITY
  ), day_start AS (
    SELECT MIN(row->>0) AS day FROM days
  ), packed_days AS (
    SELECT ord, jsonb_build_array((row->>0)::date - day::date, row->1, row->2) AS row
    FROM days CROSS JOIN day_start
  ), candidate AS (
    SELECT jsonb_build_object(
      'source_names', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM sources), '[]'::jsonb),
      'model_names', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM models), '[]'::jsonb),
      'pricing_tiers', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM tiers), '[]'::jsonb),
      'cost_dims', COALESCE((SELECT jsonb_agg(row ORDER BY ord) FROM packed_dims), '[]'::jsonb),
      'day_start', (SELECT day FROM day_start),
      'day_rollup', COALESCE((SELECT jsonb_agg(row ORDER BY ord) FROM packed_days), '[]'::jsonb),
      'range_totals', jsonb_build_array(raw.j->'range_totals'->'total_tokens', raw.j->'range_totals'->'input_tokens', raw.j->'range_totals'->'output_tokens', raw.j->'range_totals'->'cached_input_tokens', raw.j->'range_totals'->'cache_creation_input_tokens', raw.j->'range_totals'->'reasoning_output_tokens', raw.j->'range_totals'->'conversation_count', raw.j->'range_totals'->'active_days')
    ) AS wire FROM raw
  )
  SELECT CASE WHEN octet_length(wire::text) < octet_length(raw.j::text)
    THEN wire ELSE raw.j END
  FROM candidate CROSS JOIN raw
$fn$;
REVOKE EXECUTE ON FUNCTION public.account_summary_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_summary_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;

CREATE OR REPLACE FUNCTION public.account_daily_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_daily_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  days AS (
    SELECT value AS row, ordinality AS day_ord
    FROM raw, jsonb_array_elements(raw.j->'days') WITH ORDINALITY
  ), cost AS (
    SELECT value AS row, ordinality AS cost_ord
    FROM raw, jsonb_array_elements(raw.j->'cost_dims') WITH ORDINALITY
  ), model_names AS (
    SELECT to_jsonb(key) AS name
    FROM days, jsonb_each(COALESCE(NULLIF(row->8, 'null'::jsonb), '{}'::jsonb))
    UNION SELECT row->2 FROM cost
  ), models AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx FROM model_names
  ), sources AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->1 AS name FROM cost) names
  ), tiers AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->3 AS name FROM cost) names
  ), packed_days AS (
    SELECT day_ord, jsonb_build_array(
      row->0, row->1, row->2, row->3, row->4, row->5, row->6, row->7,
      CASE WHEN row->8 = 'null'::jsonb THEN 'null'::jsonb ELSE COALESCE((
        SELECT jsonb_agg(v ORDER BY model_ord, part)
        FROM jsonb_each(row->8) WITH ORDINALITY AS m(name, tokens, model_ord)
        JOIN models d ON d.name = to_jsonb(m.name)
        CROSS JOIN LATERAL (VALUES (0, to_jsonb(d.idx)), (1, m.tokens)) AS pairs(part, v)
      ), '[]'::jsonb) END
    ) AS row FROM days
  ), packed_cost AS (
    SELECT cost_ord, jsonb_build_array(
      row->0, s.idx, m.idx, t.idx, row->4, row->5, row->6, row->7, row->8, row->9
    ) AS row FROM cost
    JOIN sources s ON s.name = row->1
    JOIN models m ON m.name = row->2
    JOIN tiers t ON t.name = row->3
  )
  SELECT jsonb_build_object(
    'model_names', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM models), '[]'::jsonb),
    'days', COALESCE((SELECT jsonb_agg(row ORDER BY day_ord) FROM packed_days), '[]'::jsonb),
    'cost_dims', COALESCE((SELECT jsonb_agg(row ORDER BY cost_ord) FROM packed_cost), '[]'::jsonb)
  )
$fn$;
REVOKE EXECUTE ON FUNCTION public.account_daily_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_daily_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;

CREATE OR REPLACE FUNCTION public.account_model_breakdown_wire(
  p_user_id uuid,
  p_device_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_tz text,
  p_offset_min integer,
  p_range_from text,
  p_range_to text
) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
SET statement_timeout TO '8s'
AS $fn$

  WITH raw AS MATERIALIZED (SELECT public.account_model_breakdown_compact(p_user_id, p_device_id, p_from, p_to, p_tz, p_offset_min, p_range_from, p_range_to) AS j),
  dims AS (
    SELECT value AS row, ordinality AS ord
    FROM raw, jsonb_array_elements(raw.j) WITH ORDINALITY
  ), sources AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->0 AS name FROM dims) names
  ), models AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->1 AS name FROM dims) names
  ), tiers AS (
    SELECT name, row_number() OVER (ORDER BY name) - 1 AS idx
    FROM (SELECT DISTINCT row->2 AS name FROM dims) names
  ), indexed AS (
    SELECT ord, jsonb_build_array(s.idx, m.idx, t.idx, row->3, row->4, row->5, row->6, row->7, row->8, row->9) AS row
    FROM dims
    JOIN sources s ON s.name = row->0
    JOIN models m ON m.name = row->1
    JOIN tiers t ON t.name = row->2
  ), packed_dims AS (
    SELECT ord, (
      SELECT jsonb_agg(value ORDER BY token_ord)
      FROM jsonb_array_elements(row) WITH ORDINALITY AS tokens(value, token_ord)
      WHERE token_ord <= GREATEST(3, COALESCE((
        SELECT MAX(last_ord)
        FROM jsonb_array_elements(row) WITH ORDINALITY AS last_value(value, last_ord)
        WHERE last_value.value <> '0'::jsonb
      ), 3))
    ) AS row FROM indexed
  ), candidate AS (
    SELECT jsonb_build_object(
      'source_names', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM sources), '[]'::jsonb),
      'model_names', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM models), '[]'::jsonb),
      'pricing_tiers', COALESCE((SELECT jsonb_agg(name ORDER BY idx) FROM tiers), '[]'::jsonb),
      'dims', COALESCE((SELECT jsonb_agg(row ORDER BY ord) FROM packed_dims), '[]'::jsonb)
    ) AS wire FROM raw
  )
  SELECT CASE WHEN octet_length(wire::text) < octet_length(raw.j::text)
    THEN wire ELSE raw.j END
  FROM candidate CROSS JOIN raw
$fn$;
REVOKE EXECUTE ON FUNCTION public.account_model_breakdown_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_model_breakdown_wire(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;

-- ─────────────────────────────────────────────────────────────────────────────
-- cloud_ingest_usage: store the coverage signal, accept the evidence rows.
-- The 5-arg signature keeps the 20261004120000 body verbatim. NOTE: the hosted
-- platform patches this body via 20261005120000 (cloud-usage-archive) to add
-- cloud_usage_maintenance_lock — that migration is NOT in the self-host
-- manifest, so the self-hosted body never had the lock and this re-creation
-- must not add it (the fixture proves it: the lock function does not exist
-- here). The 6-arg overload wraps the 5-arg call and upserts the evidence.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cloud_ingest_usage(p_token_hash text,p_environment text,p_rows jsonb,p_states jsonb,p_upload_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_token public.tokentracker_device_tokens%ROWTYPE; v_device public.tokentracker_devices%ROWTYPE;
  v_slot uuid; v_machine public.tokentracker_cloud_machines%ROWTYPE; v_state jsonb; v_limit integer; v_count integer;
  v_now timestamptz:=clock_timestamp(); v_interval integer; v_max_batches integer; v_next timestamptz; v_continuation boolean; v_inserted integer;
BEGIN
  IF p_rows IS NULL OR p_states IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_typeof(p_states)<>'array'
    OR jsonb_array_length(p_rows)>500 OR jsonb_array_length(p_states)>500
    OR jsonb_array_length(p_rows)+jsonb_array_length(p_states)=0
    OR octet_length(p_rows::text)+octet_length(p_states::text)>1048576 THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_upload_size_exceeded','status',413);
  END IF;
  SELECT * INTO v_token FROM public.tokentracker_device_tokens WHERE token_hash=p_token_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','cloud_device_token_rejected','status',401); END IF;
  IF v_token.cloud_environment IS DISTINCT FROM p_environment THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_environment_mismatch','status',401);
  END IF;
  PERFORM public.cloud_reconcile_machines(v_token.user_id,p_environment);
  v_now:=clock_timestamp();
  -- Removal and issuance use the same lock. Re-read after waiting for it.
  SELECT * INTO v_token FROM public.tokentracker_device_tokens WHERE token_hash=p_token_hash AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','cloud_device_token_rejected','status',401); END IF;
  IF v_token.cloud_environment IS DISTINCT FROM p_environment THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_environment_mismatch','status',401);
  END IF;
  SELECT * INTO STRICT v_device FROM public.tokentracker_devices WHERE id=v_token.device_id AND user_id=v_token.user_id;
  IF v_device.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_device_revoked','status',403);
  END IF;
  v_slot:=public.cloud_bind_device_slot(v_token.user_id,p_environment,v_token.device_id);
  SELECT * INTO STRICT v_machine FROM public.tokentracker_cloud_machines WHERE id=v_slot;
  v_state:=public.cloud_membership(v_token.user_id,p_environment);
  IF v_machine.status<>'active' THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_machine_paused','status',403,
      'membership',v_state);
  END IF;
  v_limit:=(v_state->>'machine_limit')::integer;
  SELECT count(*) INTO v_count FROM public.tokentracker_cloud_machines
    WHERE user_id=v_token.user_id AND environment=p_environment AND status='active';
  -- The promised transition deadline survives an early purchase. Afterwards
  -- users choose their five; new slots still pass the admission limit above.
  IF v_limit IS NOT NULL AND v_count>v_limit AND NOT coalesce((v_state->>'transition_ends_at')::timestamptz>clock_timestamp(),false) THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_machine_limit','status',409,
      'membership',v_state,'machine_count',v_count);
  END IF;
  v_interval:=(v_state->>'sync_interval_seconds')::integer;
  v_next:=CASE WHEN (v_state->>'can_upload_cloud')::boolean
    THEN v_machine.last_upload_at+make_interval(secs=>v_interval)
    ELSE date_trunc('day',v_machine.last_upload_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' END;
  v_max_batches:=CASE WHEN (v_state->>'can_upload_cloud')::boolean THEN 100 ELSE 10 END;
  v_continuation:=v_machine.upload_window_until>v_now AND v_machine.upload_batch_count<v_max_batches
    AND v_machine.upload_token_id=v_token.id
    AND v_machine.upload_id IS NOT DISTINCT FROM p_upload_id;
  IF v_state->>'phase'='active' AND v_next>v_now AND NOT coalesce(v_continuation,false) THEN
    RETURN jsonb_build_object('ok',false,'code','cloud_sync_throttled','status',429,
      'next_allowed_at',v_next,'retry_after_seconds',greatest(1,ceil(extract(epoch FROM v_next-v_now))::integer),
      'membership',v_state);
  END IF;
  -- Each batch retains MAX within the batch, then replaces the complete row
  -- across requests. Never use GREATEST against the stored hourly snapshot.
  INSERT INTO public.tokentracker_hourly AS h(user_id,device_id,hour_start,source,model,input_tokens,
    cached_input_tokens,cache_creation_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,
    billable_total_tokens,total_cost_usd,conversations,cache_observed_input_tokens,updated_at)
  SELECT v_token.user_id,v_token.device_id,x.hour_start,x.source,x.model,x.input_tokens,
    x.cached_input_tokens,x.cache_creation_input_tokens,x.output_tokens,x.reasoning_output_tokens,x.total_tokens,
    x.billable_total_tokens,x.total_cost_usd,x.conversations,x.cache_observed_input_tokens,v_now
  FROM (SELECT DISTINCT ON (hour_start,source,model) * FROM jsonb_to_recordset(p_rows) AS r(
    hour_start timestamptz,source text,model text,input_tokens bigint,cached_input_tokens bigint,
    cache_creation_input_tokens bigint,output_tokens bigint,reasoning_output_tokens bigint,total_tokens bigint,
    billable_total_tokens bigint,total_cost_usd numeric,conversations integer,cache_observed_input_tokens bigint)
    ORDER BY hour_start,source,model,total_tokens DESC) x
  ON CONFLICT(user_id,device_id,hour_start,source,model) DO UPDATE SET
    input_tokens=excluded.input_tokens,cached_input_tokens=excluded.cached_input_tokens,
    cache_creation_input_tokens=excluded.cache_creation_input_tokens,output_tokens=excluded.output_tokens,
    reasoning_output_tokens=excluded.reasoning_output_tokens,total_tokens=excluded.total_tokens,
    billable_total_tokens=excluded.billable_total_tokens,total_cost_usd=excluded.total_cost_usd,
    conversations=excluded.conversations,cache_observed_input_tokens=excluded.cache_observed_input_tokens,
    updated_at=excluded.updated_at;
  GET DIAGNOSTICS v_inserted=ROW_COUNT;
  IF jsonb_array_length(p_states)>0 THEN
    PERFORM public.tokentracker_upsert_account_session_states(v_token.user_id,p_states);
  END IF;
  IF NOT coalesce(v_continuation,false) THEN
    UPDATE public.tokentracker_cloud_machines SET last_upload_at=v_now,
      upload_window_until=v_now+interval '2 minutes',upload_token_id=v_token.id,upload_id=p_upload_id,
      upload_batch_count=0 WHERE id=v_slot;
    v_next:=CASE WHEN (v_state->>'can_upload_cloud')::boolean THEN v_now+make_interval(secs=>v_interval)
      ELSE date_trunc('day',v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' END;
  END IF;
  UPDATE public.tokentracker_cloud_machines SET last_seen_at=v_now,
    upload_batch_count=upload_batch_count+1 WHERE id=v_slot;
  RETURN jsonb_build_object('ok',true,'inserted',v_inserted,'skipped',0,'membership',v_state,
    'upload_scope',CASE WHEN (v_state->>'can_upload_cloud')::boolean THEN 'cloud' ELSE 'community' END,
    'next_allowed_at',CASE WHEN v_state->>'phase'='active' THEN v_next ELSE NULL END,
    'sync_interval_seconds',CASE WHEN v_state->>'phase'='active' THEN v_interval ELSE NULL END);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_ingest_usage(
  p_token_hash text, p_environment text, p_rows jsonb, p_states jsonb,
  p_upload_id text, p_evidence jsonb
)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE v_result jsonb; v_user uuid;
BEGIN
  v_result := public.cloud_ingest_usage(p_token_hash, p_environment, p_rows, p_states, p_upload_id);
  IF v_result->>'ok' = 'true'
    AND p_evidence IS NOT NULL AND jsonb_typeof(p_evidence) = 'array'
    AND jsonb_array_length(p_evidence) > 0 THEN
    SELECT user_id INTO v_user FROM public.tokentracker_device_tokens
      WHERE token_hash = p_token_hash AND revoked_at IS NULL;
    IF FOUND THEN
      PERFORM public.tokentracker_upsert_trae_evidence(v_user, p_evidence);
    END IF;
  END IF;
  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_ingest_usage(text,text,jsonb,jsonb,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_ingest_usage(text,text,jsonb,jsonb,text) TO project_admin;
REVOKE ALL ON FUNCTION public.cloud_ingest_usage(text,text,jsonb,jsonb,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_ingest_usage(text,text,jsonb,jsonb,text,jsonb) TO project_admin;

-- The grouped output shape changed: cached payloads (30s TTL) predating this
-- migration lack the observed slot, and a fold against them would silently
-- skip. The archive migration clears this table for the same reason.
TRUNCATE public.tokentracker_account_usage_cache;
