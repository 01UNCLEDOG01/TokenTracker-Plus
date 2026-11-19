-- Ingest-side TRAE cross-batch guard (2026-11-20; owner ruling, option C).
--
-- The 2026-11-20 dedup rounds cleaned the covered `trae` rows off the volume
-- and guarded every READ path (aggregation SQL, local reader, ingest same
-- batch). The rows still came back: the client queue is an append-only ledger
-- that holds the original `trae` rows, and a watermark reset replays the whole
-- queue. The ingest same-batch guard only matches trae/trae-cn pairs that
-- share one batch AND the exact hour/model key — replayed `trae` batches
-- usually carry no trae-cn rows at all, so the replay re-landed ~37亿 tokens
-- of duplicates (views stayed correct via the read guards; the waste was
-- disk + churn).
--
-- This step makes the ingest itself refuse covered `trae` rows, so no future
-- replay or re-upload can re-land them:
--   * cross-batch / replay: the INSERT consults the stored table — a `trae`
--     row whose hour span [H, H+1h) already holds a same-model
--     (case-insensitive) `trae-cn` row is skipped. The CN API is the
--     canonical ledger (owner ruling 2026-11-20, option B).
--   * same-batch span sliver: the same-batch TypeScript guard matches the
--     exact (hour_start, model) key, so a same-batch pair shifted by half an
--     hour (the two readers disagree on the hour mark) or differing in case
--     escapes it. The statement consults its own batch CTE with the full span
--     + case-insensitive match, closing that hole server-side.
-- The span is asymmetric by the established ruling: a trae-cn row BEFORE the
-- trae row's span start does not cover it (same judgment the round-3 cleanup
-- and the read-side guard use — one definition everywhere).
--
-- Deliberately NOT included: auto-deleting already-landed covered rows when a
-- trae-cn row arrives. The ingest stays additive-only; landed strays are read
-- -guarded and harmless (deleting in the hot path risks unique rows on a
-- logic slip).
--
-- Partial index for the per-row probe (self-host volumes; the hosted platform
-- does not receive self-host migrations): (user_id, lower(model), hour_start)
-- on trae-cn rows only, so the guard is an index hit even for large accounts.
--
-- Body = the step-20b (20261115120000) 5-arg function verbatim plus this
-- guard. As there: the hosted platform patches the ingest separately (its
-- 20261005120000 maintenance lock is NOT in the self-host manifest and must
-- not appear here).

CREATE INDEX IF NOT EXISTS tokentracker_hourly_trae_cn_cover_idx
  ON public.tokentracker_hourly (user_id, lower(model), hour_start)
  WHERE source = 'trae-cn';

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
  -- TRAE cross-batch guard (owner ruling 2026-11-20, option C): a `trae` row
  -- whose hour span [H, H+1h) holds a same-model (case-insensitive) `trae-cn`
  -- row is a re-upload of usage the CN ledger already counts — skipped
  -- against BOTH the stored table (watermark replays, cross-batch uploads)
  -- and this statement's own batch (the TypeScript same-batch guard only
  -- matches the exact hour/model key, so half-hour-shifted or case-differing
  -- same-batch pairs would otherwise slip through). Non-trae rows and
  -- trae-cn rows pass untouched.
  WITH batch AS (
    SELECT DISTINCT ON (hour_start,source,model) * FROM jsonb_to_recordset(p_rows) AS r(
      hour_start timestamptz,source text,model text,input_tokens bigint,cached_input_tokens bigint,
      cache_creation_input_tokens bigint,output_tokens bigint,reasoning_output_tokens bigint,total_tokens bigint,
      billable_total_tokens bigint,total_cost_usd numeric,conversations integer,cache_observed_input_tokens bigint)
    ORDER BY hour_start,source,model,total_tokens DESC
  )
  INSERT INTO public.tokentracker_hourly AS h(user_id,device_id,hour_start,source,model,input_tokens,
    cached_input_tokens,cache_creation_input_tokens,output_tokens,reasoning_output_tokens,total_tokens,
    billable_total_tokens,total_cost_usd,conversations,cache_observed_input_tokens,updated_at)
  SELECT v_token.user_id,v_token.device_id,x.hour_start,x.source,x.model,x.input_tokens,
    x.cached_input_tokens,x.cache_creation_input_tokens,x.output_tokens,x.reasoning_output_tokens,x.total_tokens,
    x.billable_total_tokens,x.total_cost_usd,x.conversations,x.cache_observed_input_tokens,v_now
  FROM batch x
  WHERE x.source <> 'trae'
    OR (
      NOT EXISTS (
        SELECT 1 FROM public.tokentracker_hourly tc
        WHERE tc.user_id = v_token.user_id
          AND tc.source = 'trae-cn'
          AND lower(tc.model) = lower(x.model)
          AND tc.hour_start >= x.hour_start
          AND tc.hour_start < x.hour_start + interval '1 hour'
      )
      AND NOT EXISTS (
        SELECT 1 FROM batch tc
        WHERE tc.source = 'trae-cn'
          AND lower(tc.model) = lower(x.model)
          AND tc.hour_start >= x.hour_start
          AND tc.hour_start < x.hour_start + interval '1 hour'
      )
    )
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
