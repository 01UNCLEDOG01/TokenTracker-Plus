-- Instance owners explicitly choose self-hosted access. Hosted instances keep the
-- free hosted contract; this fork has no paid order or subscription path.
ALTER TABLE public.tokentracker_cloud_policy ADD COLUMN hosting_mode text NOT NULL DEFAULT 'hosted'
  CHECK (hosting_mode IN ('hosted','self_hosted'));

CREATE OR REPLACE FUNCTION public.cloud_membership(
  p_user_id uuid, p_environment text
) RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_now timestamptz := statement_timestamp();
  v_policy public.tokentracker_cloud_policy%ROWTYPE;
  v_trial timestamptz;
  v_transition timestamptz;
  v_end timestamptz;
  v_history_end timestamptz;
  v_status text;
BEGIN
  SELECT * INTO STRICT v_policy FROM public.tokentracker_cloud_policy
    WHERE environment = p_environment;
  IF v_policy.hosting_mode = 'self_hosted' THEN
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
      RAISE EXCEPTION 'self-hosted account does not exist';
    END IF;
    RETURN jsonb_build_object('environment',p_environment,'phase','active','status','self_hosted',
      'hosting_mode','self_hosted','expires_at',NULL,'trial_ends_at',NULL,'trial_available',false,
      'transition_ends_at',NULL,'read_only_until',NULL,'can_read_cloud',true,'can_upload_cloud',true,
      'machine_limit',NULL,'sync_interval_seconds',0,'hourly_history_days',NULL,'daily_history_months',NULL);
  END IF;
  SELECT trial_ends_at INTO v_trial FROM public.tokentracker_cloud_accounts
    WHERE user_id = p_user_id AND environment = p_environment;
  -- Pre-launch devices keep a bounded transition window for their old slots.
  IF v_policy.launch_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tokentracker_devices
    WHERE user_id = p_user_id AND created_at < v_policy.launch_at
  ) THEN
    v_transition := v_policy.launch_at + interval '30 days';
  END IF;
  v_history_end := greatest(v_trial, v_transition);
  v_end := greatest(v_now, v_trial, v_transition);
  v_status := CASE
    WHEN v_policy.phase = 'preview' THEN 'legacy_free'
    WHEN v_trial > v_now THEN 'trial'
    WHEN v_transition > v_now THEN 'transition'
    WHEN v_history_end IS NOT NULL THEN 'expired'
    ELSE 'free' END;
  RETURN jsonb_build_object(
    'environment', p_environment, 'phase', v_policy.phase, 'status', v_status,
    'expires_at', CASE WHEN v_end > v_now THEN v_end ELSE NULL END,
    'trial_ends_at', v_trial, 'trial_available', v_trial IS NULL,
    'transition_ends_at', v_transition,
    'read_only_until', v_history_end + interval '30 days',
    'can_read_cloud', v_status IN ('legacy_free', 'trial', 'transition')
      OR (v_status = 'expired' AND v_history_end + interval '30 days' > v_now),
    'can_upload_cloud', v_status IN ('legacy_free', 'trial', 'transition'),
    'machine_limit', CASE WHEN v_status = 'legacy_free' THEN NULL
      WHEN v_status IN ('trial', 'transition') THEN 5 ELSE 1 END,
    'sync_interval_seconds', CASE WHEN v_status IN ('legacy_free', 'trial', 'transition')
      THEN 900 ELSE 86400 END,
    'hourly_history_days', 90, 'daily_history_months', 24
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_account_access(p_user_id uuid,p_environment text,p_kind text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $fn$
DECLARE v_state jsonb; v_from date;
BEGIN
  v_state:=public.cloud_membership(p_user_id,p_environment);
  IF NOT (v_state->>'can_read_cloud')::boolean THEN
    RETURN jsonb_build_object('ok',false,'status',402,'code',CASE WHEN v_state->>'status'='expired'
      THEN 'cloud_read_only_expired' ELSE 'cloud_membership_required' END,'membership',v_state);
  END IF;
  IF v_state->>'phase'='active' AND v_state->>'status'<>'self_hosted' THEN
    v_from:=CASE WHEN p_kind='hourly' THEN (now() AT TIME ZONE 'UTC')::date - 89
      ELSE ((now() AT TIME ZONE 'UTC')::date - interval '24 months')::date END;
  END IF;
  RETURN jsonb_build_object('ok',true,'membership',v_state,'available_from',v_from);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.cloud_start_trial(p_user_id uuid, p_environment text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy WHERE environment = p_environment AND hosting_mode = 'self_hosted') THEN
    RAISE EXCEPTION 'self-hosted access is free and does not require a trial';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_environment, 0));
  IF NOT EXISTS (SELECT 1 FROM public.tokentracker_cloud_policy
    WHERE environment = p_environment AND phase = 'active' AND launch_at <= clock_timestamp()) THEN
    RAISE EXCEPTION 'trial has not launched';
  END IF;
  INSERT INTO public.tokentracker_cloud_accounts (user_id, environment, trial_started_at, trial_ends_at)
    VALUES (p_user_id, p_environment, clock_timestamp(), clock_timestamp() + interval '7 days')
    ON CONFLICT (user_id, environment) DO UPDATE
      SET trial_started_at = excluded.trial_started_at, trial_ends_at = excluded.trial_ends_at
      WHERE tokentracker_cloud_accounts.trial_started_at IS NULL;
  RETURN public.cloud_membership(p_user_id, p_environment);
END;
$fn$;

REVOKE ALL ON FUNCTION public.cloud_membership(uuid,text),public.cloud_account_access(uuid,text,text),
  public.cloud_start_trial(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_membership(uuid,text),public.cloud_account_access(uuid,text,text),
  public.cloud_start_trial(uuid,text) TO project_admin;
