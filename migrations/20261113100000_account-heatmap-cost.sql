-- Heatmap per-day cost (owner report 2026-11-13: 账户汇总 heatmap tooltip showed
-- 「当日花费 ¥0.00」 on a 12.8 亿-token day).
--
-- tokentracker_hourly already stores the per-row total_cost_usd written by the
-- client's pricing engine, but account_usage_grouped dropped the column and
-- account_heatmap_compact only shipped [day, tokens, models]. Carry the cost
-- through both layers so the day cells can render it.
--
-- 1) account_usage_grouped: SUM(total_cost_usd) in the grouped emit, with the
--    column carried through all three source branches. The trae-cn branch reads
--    tokentracker_account_session_states, which has no cost column by design
--    (TRAE CN is priced for display elsewhere as 牌价推算), so that branch
--    contributes 0 — the same body that had no cost before, made explicit.
-- 2) account_heatmap_compact: fourth positional element per day = cost.
--
-- account_usage_grouped_cached (30 s TTL) caches the JSONB verbatim, so the
-- extra key needs no change there; the edge expands the 4-tuple and both the
-- dense and compact responses become cost-complete.

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
      COALESCE(h.total_cost_usd, 0)::numeric AS total_cost_usd,
      h.updated_at
    FROM public.tokentracker_hourly h
    WHERE h.user_id = p_user_id
      AND h.hour_start >= p_from AND h.hour_start < p_to
      AND (
        h.source = 'cursor'
        OR (
          h.source NOT IN ('cursor', 'trae-cn')
          AND h.device_id = ANY(p_device_ids)
        )
      )
  ), hourly AS (
    SELECT mac.hour_start, mac.source, mac.model,
      mac.total_tokens, mac.input_tokens, mac.output_tokens,
      mac.cached_input_tokens, mac.cache_creation_input_tokens,
      mac.reasoning_output_tokens, mac.conversations, mac.total_cost_usd
    FROM (
      SELECT DISTINCT ON (
        COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model
      )
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations, h.total_cost_usd
      FROM base h
      LEFT JOIN public.tokentracker_device_machine dm ON dm.device_id = h.device_id
      WHERE h.source NOT IN ('cursor', 'trae-cn')
        AND h.device_id = ANY(p_device_ids)
      ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) mac

    UNION ALL

    SELECT d.hour_start, d.source, d.model,
      d.total_tokens, d.input_tokens, d.output_tokens,
      d.cached_input_tokens, d.cache_creation_input_tokens,
      d.reasoning_output_tokens, d.conversations, d.total_cost_usd
    FROM (
      SELECT DISTINCT ON (h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations, h.total_cost_usd
      FROM base h
      WHERE h.source = 'cursor'
      ORDER BY h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) d

    UNION ALL

    SELECT s.bucket_start, s.source, s.model,
      SUM(s.total_tokens)::bigint, SUM(s.input_tokens)::bigint,
      SUM(s.output_tokens)::bigint, SUM(s.cached_input_tokens)::bigint,
      SUM(s.cache_creation_input_tokens)::bigint,
      SUM(s.reasoning_output_tokens)::bigint, COUNT(*)::bigint,
      0::numeric
    FROM public.tokentracker_account_session_states s
    WHERE s.user_id = p_user_id
      AND s.bucket_start >= p_from AND s.bucket_start < p_to
      AND s.source = 'trae-cn'
    GROUP BY s.bucket_start, s.source, s.model
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
      total_cost_usd
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
      SUM(total_cost_usd)::numeric AS total_cost_usd
    FROM located
    GROUP BY bucket, source, model, pricing_tier
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(grouped.*) ORDER BY bucket, source, model, pricing_tier),
    '[]'::jsonb
  ) FROM grouped
$func$;

CREATE OR REPLACE FUNCTION public.account_heatmap_compact(
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
      COALESCE(NULLIF(e->>'model', ''), 'unknown') AS model,
      COALESCE((e->>'total_tokens')::bigint, 0) AS tt,
      COALESCE((e->>'total_cost_usd')::numeric, 0) AS tc
    FROM raw, jsonb_array_elements(raw.j) e
    WHERE e->>'bucket' >= p_range_from AND e->>'bucket' <= p_range_to
  ), per_model AS (
    SELECT bucket, model, SUM(tt) AS mt, SUM(tc) AS mc FROM g GROUP BY bucket, model
  ), per_day AS (
    SELECT
      bucket,
      SUM(mt) AS t,
      SUM(mc) AS cost,
      jsonb_object_agg(model, mt) AS models
    FROM per_model
    GROUP BY bucket
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(jsonb_build_array(bucket, t, models, cost) ORDER BY bucket) FROM per_day),
    '[]'::jsonb)
$fn$;

REVOKE ALL ON FUNCTION public.account_usage_grouped(uuid, uuid[], timestamptz, timestamptz, text, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_heatmap_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_usage_grouped(uuid, uuid[], timestamptz, timestamptz, text, text, integer) TO project_admin;
GRANT EXECUTE ON FUNCTION public.account_heatmap_compact(uuid, uuid, timestamptz, timestamptz, text, integer, text, text) TO project_admin;
