-- Self-host public face: the leaderboard, profile, visibility and telemetry
-- surfaces. The upstream project created these tables before this fork's
-- migration history begins, so the schemas here are reconstructed from the
-- columns the edge functions and the dashboard actually read and write —
-- scoped to what a single-account private instance needs.

CREATE TABLE IF NOT EXISTS public.tokentracker_leaderboard_snapshots (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period text NOT NULL,
  from_day date NOT NULL,
  to_day date NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rank integer,
  display_name text,
  avatar_url text,
  github_url text,
  total_tokens bigint,
  estimated_cost_usd numeric,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  conversation_count bigint,
  models jsonb,
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (period, from_day, to_day, user_id)
);
CREATE INDEX IF NOT EXISTS tokentracker_leaderboard_snapshots_period_idx
  ON public.tokentracker_leaderboard_snapshots (period, from_day, to_day, rank);

CREATE TABLE IF NOT EXISTS public.tokentracker_user_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.tokentracker_user_settings (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  leaderboard_public boolean NOT NULL DEFAULT true,
  leaderboard_anonymous boolean NOT NULL DEFAULT false,
  github_url text,
  show_github_url boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.tokentracker_public_views (
  token_hash text PRIMARY KEY,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.tokentracker_telemetry_daily (
  machine_hash text NOT NULL,
  day date NOT NULL,
  app_version text,
  platform text,
  shell text,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  PRIMARY KEY (machine_hash, day)
);

ALTER TABLE public.tokentracker_leaderboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_public_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tokentracker_telemetry_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_leaderboard_snapshots,public.tokentracker_user_profiles,
  public.tokentracker_user_settings,public.tokentracker_public_views,public.tokentracker_telemetry_daily
  FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tokentracker_leaderboard_snapshots,public.tokentracker_user_profiles,
  public.tokentracker_user_settings,public.tokentracker_public_views,public.tokentracker_telemetry_daily
  TO project_admin;
