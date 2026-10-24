-- Cloud fix for the DeepSeek V4 peak/off-peak tier split.
--
-- Incident: the tier-split filter only knew deepseek-v4-flash / deepseek-v4-pro,
-- but src/lib/pricing/index.js DEEPSEEK_TIME_PRICED_MODELS (and the edge TS
-- getRowPricing copies, and the 2026-10-13 self-host fix) cover four ids:
-- deepseek-v4-flash, deepseek-v4.1-flash, deepseek-flash, deepseek-v4-pro.
-- deepseek-v4.1-flash and deepseek-flash rows were force-tagged 'peak', so the
-- edge priced their nights and weekends at the peak rate (~2x on night-heavy
-- accounts).
--
-- Why this shape: on 2026-09-04 the cloud's account_usage_grouped was REPLACED
-- by the promoted single-scan implementation
-- (20260904083630_add-single-scan-account-usage-candidate.sql +
--  20260904090000_promote-single-scan-account-usage.sql), which inlines the
-- tier filter instead of delegating to account_usage_deepseek_v4_grouped
-- (now dead on cloud). So this migration patches the two LIVE code paths:
--   1. account_usage_grouped  -- the promoted single-scan body, 4-pattern filter
--      + Beijing-weekend rule (the old cloud SQL, both 20260821 and the
--      single-scan candidate, only checked UTC hour windows, so weekend
--      peak-hour rows were billed at peak; the self-host 20261013 fix and the
--      JS/edge fallbacks already had the 2026-08-23 weekend rule)
--   2. leaderboard_deepseek_v4_grouped / leaderboard_usage_grouped -- replayed
--      with 4-pattern LIKE filters AND 4-pattern NOT LIKE exclusions (a row
--      missing from the exclusions would be counted in BOTH the legacy 'peak'
--      branch and the tier-split branch), plus the same weekend rule.
-- CREATE OR REPLACE keeps each function's OID, so the SQL-language callers
-- (account_usage_grouped_v2, account_usage_grouped_cached) stay bound and the
-- shared cache key needs no version bump. The trailing DELETE purges
-- pre-migration JSON whose rows lack the new tiers.
--
-- Apply to the CLOUD database only (InsForge). The self-host Postgres got its
-- equivalent in 20261013203000_self-host-deepseek-v41-time-priced-patterns.sql;
-- do not apply this file there. scripts/ops/account-usage-grouped-rpc.sql
-- (standalone deployment source) is patched separately in the same change.

-- ============ Part 1: account path (promoted single-scan body) ============
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
      mac.reasoning_output_tokens, mac.conversations
    FROM (
      SELECT DISTINCT ON (
        COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model
      )
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations
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
      d.reasoning_output_tokens, d.conversations
    FROM (
      SELECT DISTINCT ON (h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens, h.input_tokens, h.output_tokens,
        h.cached_input_tokens, h.cache_creation_input_tokens,
        h.reasoning_output_tokens, h.conversations
      FROM base h
      WHERE h.source = 'cursor'
      ORDER BY h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) d

    UNION ALL

    SELECT s.bucket_start, s.source, s.model,
      SUM(s.total_tokens)::bigint, SUM(s.input_tokens)::bigint,
      SUM(s.output_tokens)::bigint, SUM(s.cached_input_tokens)::bigint,
      SUM(s.cache_creation_input_tokens)::bigint,
      SUM(s.reasoning_output_tokens)::bigint, COUNT(*)::bigint
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
      cache_creation_input_tokens, reasoning_output_tokens, conversations
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
      SUM(conversations)::bigint AS conversations
    FROM located
    GROUP BY bucket, source, model, pricing_tier
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(grouped.*) ORDER BY bucket, source, model, pricing_tier),
    '[]'::jsonb
  ) FROM grouped
$func$;

REVOKE ALL ON FUNCTION public.account_usage_grouped(
  uuid, uuid[], timestamptz, timestamptz, text, text, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_usage_grouped(
  uuid, uuid[], timestamptz, timestamptz, text, text, integer
) TO project_admin;

-- ============ Part 2: leaderboard path ============
CREATE OR REPLACE FUNCTION public.leaderboard_deepseek_v4_grouped(
  p_from timestamptz, p_to timestamptz
) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path TO public, pg_temp
SET statement_timeout TO '25s'
AS $func$
  WITH hourly AS (
    SELECT mac.user_id, mac.source, mac.model, mac.hour_start,
      SUM(mac.total_tokens)::bigint AS total_tokens,
      SUM(mac.input_tokens)::bigint AS input_tokens,
      SUM(mac.output_tokens)::bigint AS output_tokens,
      SUM(mac.cached_input_tokens)::bigint AS cached_input_tokens,
      SUM(mac.cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
      SUM(mac.reasoning_output_tokens)::bigint AS reasoning_output_tokens
    FROM (
      SELECT DISTINCT ON (h.user_id, COALESCE(dm.machine_cluster_id, h.device_id::text), h.source, h.model, h.hour_start)
        h.user_id, h.source, h.model, h.hour_start,
        h.total_tokens, h.input_tokens, h.output_tokens, h.cached_input_tokens,
        h.cache_creation_input_tokens, h.reasoning_output_tokens
      FROM public.tokentracker_hourly h
      JOIN public.tokentracker_devices d ON d.id = h.device_id AND d.revoked_at IS NULL
      LEFT JOIN public.tokentracker_device_machine dm ON dm.device_id = h.device_id
      WHERE h.hour_start >= p_from AND h.hour_start < p_to
        AND h.source NOT IN ('cursor', 'trae-cn')
        AND (lower(h.model) LIKE '%deepseek-v4-flash%' OR lower(h.model) LIKE '%deepseek-v4-pro%'
 OR lower(h.model) LIKE '%deepseek-v4.1-flash%'
 OR lower(h.model) LIKE '%deepseek-flash%')
      ORDER BY h.user_id, COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.source, h.model, h.hour_start, h.total_tokens DESC, h.updated_at DESC
    ) mac
    GROUP BY mac.user_id, mac.source, mac.model, mac.hour_start

    UNION ALL

    SELECT acct.user_id, acct.source, acct.model, acct.hour_start,
      acct.total_tokens, acct.input_tokens, acct.output_tokens,
      acct.cached_input_tokens, acct.cache_creation_input_tokens, acct.reasoning_output_tokens
    FROM (
      SELECT DISTINCT ON (h.user_id, h.source, h.model, h.hour_start)
        h.user_id, h.source, h.model, h.hour_start, h.total_tokens,
        h.input_tokens, h.output_tokens, h.cached_input_tokens,
        h.cache_creation_input_tokens, h.reasoning_output_tokens
      FROM public.tokentracker_hourly h
      WHERE h.hour_start >= p_from AND h.hour_start < p_to
        AND h.source = 'cursor'
        AND (lower(h.model) LIKE '%deepseek-v4-flash%' OR lower(h.model) LIKE '%deepseek-v4-pro%'
 OR lower(h.model) LIKE '%deepseek-v4.1-flash%'
 OR lower(h.model) LIKE '%deepseek-flash%')
      ORDER BY h.user_id, h.source, h.model, h.hour_start, h.total_tokens DESC, h.updated_at DESC
    ) acct

    UNION ALL

    SELECT s.user_id, s.source, s.model, s.bucket_start,
      SUM(s.total_tokens)::bigint, SUM(s.input_tokens)::bigint, SUM(s.output_tokens)::bigint,
      SUM(s.cached_input_tokens)::bigint, SUM(s.cache_creation_input_tokens)::bigint,
      SUM(s.reasoning_output_tokens)::bigint
    FROM public.tokentracker_account_session_states s
    WHERE s.bucket_start >= p_from AND s.bucket_start < p_to
      AND s.source = 'trae-cn'
      AND (lower(s.model) LIKE '%deepseek-v4-flash%' OR lower(s.model) LIKE '%deepseek-v4-pro%'
 OR lower(s.model) LIKE '%deepseek-v4.1-flash%'
 OR lower(s.model) LIKE '%deepseek-flash%')
    GROUP BY s.user_id, s.source, s.model, s.bucket_start
  ), grouped AS (
    SELECT user_id, source, model,
      CASE WHEN hour_start >= timestamptz '2026-08-22T16:00:00Z'
                AND extract(dow FROM ((hour_start AT TIME ZONE 'UTC') + interval '8 hours')) IN (0, 6)
        THEN 'off_peak'
        WHEN (extract(hour FROM hour_start AT TIME ZONE 'UTC') >= 1
                      AND extract(hour FROM hour_start AT TIME ZONE 'UTC') < 4)
                  OR (extract(hour FROM hour_start AT TIME ZONE 'UTC') >= 6
                      AND extract(hour FROM hour_start AT TIME ZONE 'UTC') < 10)
        THEN 'peak' ELSE 'off_peak' END AS pricing_tier,
      SUM(total_tokens)::bigint AS total_tokens, SUM(input_tokens)::bigint AS input_tokens,
      SUM(output_tokens)::bigint AS output_tokens,
      SUM(cached_input_tokens)::bigint AS cached_input_tokens,
      SUM(cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
      SUM(reasoning_output_tokens)::bigint AS reasoning_output_tokens
    FROM hourly
    GROUP BY user_id, source, model, pricing_tier
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(grouped.*) ORDER BY user_id, source, model, pricing_tier),
    '[]'::jsonb
  ) FROM grouped
$func$;

CREATE OR REPLACE FUNCTION public.leaderboard_usage_grouped(
  p_from timestamptz, p_to timestamptz
) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path TO public, pg_temp
SET work_mem TO '96MB'
SET hash_mem_multiplier TO '4'
SET statement_timeout TO '25s'
AS $func$
DECLARE
  v_through timestamptz;
  v_cut timestamptz;
  v_base jsonb;
  v_deepseek jsonb;
BEGIN
  SELECT m.through INTO v_through
  FROM public.tokentracker_leaderboard_rollup_meta_v2 m WHERE m.id = 1;
  v_cut := date_trunc('day', LEAST(v_through, p_to) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';

  IF v_through IS NOT NULL
     AND p_from = date_trunc('day', p_from AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
     AND v_cut > p_from THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(per_usm.*) ORDER BY user_id, source, model), '[]'::jsonb)
    INTO v_base
    FROM (
      SELECT u.user_id, u.source, u.model, 'peak'::text AS pricing_tier,
        SUM(u.total_tokens)::bigint AS total_tokens, SUM(u.input_tokens)::bigint AS input_tokens,
        SUM(u.output_tokens)::bigint AS output_tokens,
        SUM(u.cached_input_tokens)::bigint AS cached_input_tokens,
        SUM(u.cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
        SUM(u.reasoning_output_tokens)::bigint AS reasoning_output_tokens
      FROM (
        SELECT r.user_id, r.source, r.model, r.total_tokens, r.input_tokens, r.output_tokens,
          r.cached_input_tokens, r.cache_creation_input_tokens, r.reasoning_output_tokens
        FROM public.tokentracker_leaderboard_rollup_daily_v2 r
        WHERE r.day >= (p_from AT TIME ZONE 'UTC')::date
          AND r.day < (v_cut AT TIME ZONE 'UTC')::date
          AND lower(r.model) NOT LIKE '%deepseek-v4-flash%'
          AND lower(r.model) NOT LIKE '%deepseek-v4.1-flash%'
          AND lower(r.model) NOT LIKE '%deepseek-flash%'
          AND lower(r.model) NOT LIKE '%deepseek-v4-pro%'
        UNION ALL
        SELECT t.user_id, t.source, t.model, t.total_tokens, t.input_tokens, t.output_tokens,
          t.cached_input_tokens, t.cache_creation_input_tokens, t.reasoning_output_tokens
        FROM public.leaderboard_hourly_dedup_v2(v_cut, p_to) t
        WHERE lower(t.model) NOT LIKE '%deepseek-v4-flash%'
          AND lower(t.model) NOT LIKE '%deepseek-v4.1-flash%'
          AND lower(t.model) NOT LIKE '%deepseek-flash%'
          AND lower(t.model) NOT LIKE '%deepseek-v4-pro%'
      ) u GROUP BY u.user_id, u.source, u.model
    ) per_usm;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(per_usm.*) ORDER BY user_id, source, model), '[]'::jsonb)
    INTO v_base
    FROM (
      SELECT d.user_id, d.source, d.model, 'peak'::text AS pricing_tier,
        SUM(d.total_tokens)::bigint AS total_tokens, SUM(d.input_tokens)::bigint AS input_tokens,
        SUM(d.output_tokens)::bigint AS output_tokens,
        SUM(d.cached_input_tokens)::bigint AS cached_input_tokens,
        SUM(d.cache_creation_input_tokens)::bigint AS cache_creation_input_tokens,
        SUM(d.reasoning_output_tokens)::bigint AS reasoning_output_tokens
      FROM public.leaderboard_hourly_dedup_v2(p_from, p_to) d
      WHERE lower(d.model) NOT LIKE '%deepseek-v4-flash%'
        AND lower(d.model) NOT LIKE '%deepseek-v4.1-flash%'
        AND lower(d.model) NOT LIKE '%deepseek-flash%'
        AND lower(d.model) NOT LIKE '%deepseek-v4-pro%'
      GROUP BY d.user_id, d.source, d.model
    ) per_usm;
  END IF;

  v_deepseek := public.leaderboard_deepseek_v4_grouped(p_from, p_to);
  RETURN COALESCE(v_base, '[]'::jsonb) || COALESCE(v_deepseek, '[]'::jsonb);
END
$func$;

REVOKE ALL ON FUNCTION public.leaderboard_deepseek_v4_grouped(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.leaderboard_usage_grouped(timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leaderboard_usage_grouped(timestamptz, timestamptz)
  TO project_admin;

-- Rebuild the DeepSeek partial indexes with the 4-pattern predicate so the
-- new ids stay index-assisted.
DROP INDEX IF EXISTS public.tokentracker_hourly_deepseek_v4_hour_idx;
CREATE INDEX IF NOT EXISTS tokentracker_hourly_deepseek_v4_hour_idx
  ON public.tokentracker_hourly (hour_start, user_id, device_id, source, model)
  WHERE lower(model) LIKE '%deepseek-v4-flash%'
     OR lower(model) LIKE '%deepseek-v4.1-flash%'
     OR lower(model) LIKE '%deepseek-flash%'
     OR lower(model) LIKE '%deepseek-v4-pro%';

DROP INDEX IF EXISTS public.tokentracker_session_states_deepseek_v4_hour_idx;
CREATE INDEX IF NOT EXISTS tokentracker_session_states_deepseek_v4_hour_idx
  ON public.tokentracker_account_session_states (bucket_start, user_id, source, model)
  WHERE lower(model) LIKE '%deepseek-v4-flash%'
     OR lower(model) LIKE '%deepseek-v4.1-flash%'
     OR lower(model) LIKE '%deepseek-flash%'
     OR lower(model) LIKE '%deepseek-v4-pro%';

-- ============ Appendix: orphaned helper, kept pattern-consistent ============
-- account_usage_deepseek_v4_grouped is no longer called on cloud since the
-- 2026-09-04 single-scan promotion (its only caller was dropped), but it is
-- replayed here with the same 4-pattern filter so ad-hoc queries or a future
-- rollback cannot silently bill v4.1-flash / deepseek-flash at peak.
CREATE OR REPLACE FUNCTION public.account_usage_deepseek_v4_grouped(
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
  ), hourly AS (
    SELECT mac.hour_start, mac.source, mac.model,
      mac.total_tokens, mac.input_tokens, mac.output_tokens,
      mac.cached_input_tokens, mac.cache_creation_input_tokens,
      mac.reasoning_output_tokens, mac.conversations
    FROM (
      SELECT DISTINCT ON (
        COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model
      )
        h.hour_start, h.source, h.model,
        h.total_tokens::bigint AS total_tokens,
        h.input_tokens::bigint AS input_tokens,
        h.output_tokens::bigint AS output_tokens,
        h.cached_input_tokens::bigint AS cached_input_tokens,
        h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
        h.reasoning_output_tokens::bigint AS reasoning_output_tokens,
        h.conversations::bigint AS conversations
      FROM public.tokentracker_hourly h
      LEFT JOIN public.tokentracker_device_machine dm ON dm.device_id = h.device_id
      WHERE h.user_id = p_user_id
        AND h.hour_start >= p_from AND h.hour_start < p_to
        AND h.source NOT IN ('cursor', 'trae-cn')
        AND h.device_id = ANY(p_device_ids)
        AND (lower(h.model) LIKE '%deepseek-v4-flash%'
          OR lower(h.model) LIKE '%deepseek-v4-pro%'
          OR lower(h.model) LIKE '%deepseek-v4.1-flash%'
          OR lower(h.model) LIKE '%deepseek-flash%')
      ORDER BY COALESCE(dm.machine_cluster_id, h.device_id::text),
        h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) mac

    UNION ALL

    SELECT d.hour_start, d.source, d.model,
      d.total_tokens, d.input_tokens, d.output_tokens,
      d.cached_input_tokens, d.cache_creation_input_tokens,
      d.reasoning_output_tokens, d.conversations
    FROM (
      SELECT DISTINCT ON (h.hour_start, h.source, h.model)
        h.hour_start, h.source, h.model,
        h.total_tokens::bigint AS total_tokens,
        h.input_tokens::bigint AS input_tokens,
        h.output_tokens::bigint AS output_tokens,
        h.cached_input_tokens::bigint AS cached_input_tokens,
        h.cache_creation_input_tokens::bigint AS cache_creation_input_tokens,
        h.reasoning_output_tokens::bigint AS reasoning_output_tokens,
        h.conversations::bigint AS conversations
      FROM public.tokentracker_hourly h
      WHERE h.user_id = p_user_id
        AND h.hour_start >= p_from AND h.hour_start < p_to
        AND h.source = 'cursor'
        AND (lower(h.model) LIKE '%deepseek-v4-flash%'
          OR lower(h.model) LIKE '%deepseek-v4-pro%'
          OR lower(h.model) LIKE '%deepseek-v4.1-flash%'
          OR lower(h.model) LIKE '%deepseek-flash%')
      ORDER BY h.hour_start, h.source, h.model, h.total_tokens DESC, h.updated_at DESC
    ) d

    UNION ALL

    SELECT s.bucket_start, s.source, s.model,
      SUM(s.total_tokens)::bigint, SUM(s.input_tokens)::bigint,
      SUM(s.output_tokens)::bigint, SUM(s.cached_input_tokens)::bigint,
      SUM(s.cache_creation_input_tokens)::bigint,
      SUM(s.reasoning_output_tokens)::bigint, COUNT(*)::bigint
    FROM public.tokentracker_account_session_states s
    WHERE s.user_id = p_user_id
      AND s.bucket_start >= p_from AND s.bucket_start < p_to
      AND s.source = 'trae-cn'
      AND (lower(s.model) LIKE '%deepseek-v4-flash%'
        OR lower(s.model) LIKE '%deepseek-v4-pro%'
        OR lower(s.model) LIKE '%deepseek-v4.1-flash%'
        OR lower(s.model) LIKE '%deepseek-flash%')
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
      CASE WHEN hour_start >= timestamptz '2026-08-22T16:00:00Z'
                AND extract(dow FROM ((hour_start AT TIME ZONE 'UTC') + interval '8 hours')) IN (0, 6)
        THEN 'off_peak'
        WHEN (extract(hour FROM hour_start AT TIME ZONE 'UTC') >= 1
                      AND extract(hour FROM hour_start AT TIME ZONE 'UTC') < 4)
                  OR (extract(hour FROM hour_start AT TIME ZONE 'UTC') >= 6
                      AND extract(hour FROM hour_start AT TIME ZONE 'UTC') < 10)
        THEN 'peak' ELSE 'off_peak' END AS pricing_tier,
      total_tokens, input_tokens, output_tokens, cached_input_tokens,
      cache_creation_input_tokens, reasoning_output_tokens, conversations
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
      SUM(conversations)::bigint AS conversations
    FROM located
    GROUP BY bucket, source, model, pricing_tier
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(grouped.*) ORDER BY bucket, source, model, pricing_tier),
    '[]'::jsonb
  ) FROM grouped
$func$;

-- Cached JSON created before this migration does not contain the new tiers.
DELETE FROM public.tokentracker_account_usage_cache;
