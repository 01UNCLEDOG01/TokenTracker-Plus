-- Free Cloud policy and account state only.
--
-- This fork does not sell anything, so there is no catalog, order, payment,
-- subscription or event schema here. What remains is the free hosted contract
-- (preview / active launch, a one-time free trial) that device admission,
-- ingestion and the self-hosted policy migration build on.

CREATE TABLE public.tokentracker_cloud_policy (
  environment text PRIMARY KEY CHECK (environment IN ('sandbox', 'live')),
  phase text NOT NULL DEFAULT 'preview' CHECK (phase IN ('preview', 'active')),
  launch_at timestamptz,
  CHECK (phase = 'preview' OR launch_at IS NOT NULL)
);
INSERT INTO public.tokentracker_cloud_policy (environment) VALUES ('sandbox'), ('live');

CREATE TABLE public.tokentracker_cloud_accounts (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  environment text NOT NULL REFERENCES public.tokentracker_cloud_policy(environment),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  PRIMARY KEY (user_id, environment),
  CHECK ((trial_started_at IS NULL AND trial_ends_at IS NULL) OR
    (trial_started_at IS NOT NULL AND trial_ends_at > trial_started_at))
);

ALTER TABLE public.tokentracker_cloud_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_cloud_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.tokentracker_cloud_policy, public.tokentracker_cloud_accounts
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.tokentracker_cloud_policy, public.tokentracker_cloud_accounts TO project_admin;
GRANT SELECT ON public.tokentracker_cloud_accounts TO authenticated;
CREATE POLICY cloud_accounts_owner_read ON public.tokentracker_cloud_accounts
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

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

CREATE OR REPLACE FUNCTION public.cloud_start_trial(p_user_id uuid, p_environment text)
RETURNS jsonb LANGUAGE plpgsql
SET search_path = public, pg_temp AS $fn$
BEGIN
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

REVOKE ALL ON FUNCTION public.cloud_membership(uuid, text),
  public.cloud_start_trial(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cloud_membership(uuid, text),
  public.cloud_start_trial(uuid, text) TO project_admin;
