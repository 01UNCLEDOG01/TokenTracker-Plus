-- TRAE span guard in the account aggregation (2026-11-20; regression repair).
--
-- Incident: the 2026-11-20 TRAE/trae-cn dedup round applied the canonical
-- scripts/self-host/aggregation.sql (kept byte-identical to step 04's frozen
-- pre-10-20 body on purpose — see 681be413) directly over the deployed
-- account_usage_grouped with CREATE OR REPLACE. That silently reverted TWO
-- deployed fixes on the J2900 volume at once:
--   * 20261020120000 (step 14) / 20261113230000 (step 20): trae-cn rides the
--     machine-level hourly arm with its real device_id. The canonical body's
--     third arm reads tokentracker_account_session_states instead, which only
--     ever held the retired SOLO CN cloud-bill sessions (21.5亿 of the real
--     104亿 CN-API hourly volume) — the account hero under-counted trae-cn
--     while the machine arm excluded the hourly rows it used to carry.
--   * 20261115120000 (step 20b): cursor_owner attribution. Without it every
--     per-device call re-includes the full cursor arm, so the device card's
--     sum disagreed with the hero again.
-- Net effect measured on J2900 (2026-11-20): device rows each carried the
-- account-level trae-cn states arm, and the hero/leaderboard path lost 82亿
-- of real trae-cn hourly volume.
--
-- This step re-applies the step-20b definition with one addition — the TRAE
-- span guard proven by the 2026-11-20 dedup rounds: a `trae` hourly row whose
-- hour span [H, H+1h) holds a same-model (case-insensitive) `trae-cn` row is
-- a re-upload of the same usage (the old Trae local DB and the Trae CN
-- official API cover the same sessions; the CN API is the canonical ledger)
-- and is excluded at read time. The ingest upsert re-grows those rows on every
-- device sync, so the guard has to live in the read path, not just in the
-- one-off cleanup. Span + case-insensitive matching mirrors the local reader
-- (scopedQueueRows) and the ingest same-batch guard.
--
-- Everything else is the step-20b body verbatim: trae-cn rides the hourly
-- machine arm, cursor attaches to its owning device, cache_observed /
-- total_cost_usd ride every arm, and the compact/wire wrappers are untouched
-- (their shapes did not change, so the usage cache needs no truncation).

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
          -- TRAE span guard (2026-11-20): the old Trae (Work CN) local DB and
          -- the Trae CN official API/DB cover the same sessions, so a `trae`
          -- row overlapped by a same-model `trae-cn` row within its hour span
          -- is a duplicate of usage the CN rows already count. Case-
          -- insensitive because the two readers disagree on casing; span
          -- because the two readers disagree on the hour mark (half-hour
          -- offsets measured on J2900). The CN API is the canonical ledger.
          AND (
            h.source <> 'trae'
            OR NOT EXISTS (
              SELECT 1 FROM public.tokentracker_hourly tc
              WHERE tc.user_id = h.user_id
                AND tc.source = 'trae-cn'
                AND lower(tc.model) = lower(h.model)
                AND tc.hour_start >= h.hour_start
                AND tc.hour_start < h.hour_start + interval '1 hour'
            )
          )
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
