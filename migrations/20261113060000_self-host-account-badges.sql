-- Account-level achievements (成就跨设备并集, 站主 2026-11-13).
--
-- Achievements are computed on each device from that device's own queue
-- (sessions, projects, JoyCode/raccoon ledgers only exist locally), so two
-- machines on one account used to show different unlock sets. The union
-- semantics: every device keeps computing locally and uploads its unlocked
-- badges here; a read merges across devices — any device's unlock shows on
-- all of them, tier = highest observed, unlock timestamp = earliest.
--
-- One row per (user, badge). `achieved` holds the merged per-tier map
-- ({"bronze": iso|null, "silver": ..., "gold": ..., "diamond": ...});
-- `tier` is the highest non-null tier and is kept in step with the map so
-- readers never have to re-derive it. RLS is enabled with no policy: only the
-- badge-sync function's service-role key touches this table, matching
-- tokentracker_profile_likes.

CREATE TABLE IF NOT EXISTS public.tokentracker_account_badges (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id text NOT NULL,
  achieved jsonb NOT NULL,
  tier integer NOT NULL DEFAULT 0,
  device_id text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, badge_id),
  CONSTRAINT tokentracker_account_badges_tier_range CHECK (tier >= 0 AND tier <= 4)
);
ALTER TABLE public.tokentracker_account_badges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tokentracker_account_badges FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tokentracker_account_badges TO project_admin;

CREATE INDEX IF NOT EXISTS tokentracker_account_badges_user_idx
  ON public.tokentracker_account_badges (user_id);
