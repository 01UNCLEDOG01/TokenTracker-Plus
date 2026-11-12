-- Per-device leaderboard rows (站主 2026-11-12).
--
-- A multi-device account now publishes one snapshot row per device, so the board
-- shows each machine's own usage ("Name · DeviceName"). The writer keys rows on
-- (period, from_day, to_day, user_id, device_id), which needs the column plus a
-- matching unique key. Single-device accounts keep one row with device_id = ''.
--
-- Without this migration the refresh fails on a fresh installation:
--   * "column s.device_id does not exist" (the writer's INSERT and cleanup both
--     reference it), and once the column exists
--   * "duplicate key value violates unique constraint …" because the old
--     UNIQUE (period, from_day, to_day, user_id) rejects the second device row.
--
-- The legacy constraint's name differs between the original hosted schema and
-- the self-host baseline (and Postgres truncates identifiers to 63 bytes), so
-- drop it by shape instead of by name.

ALTER TABLE public.tokentracker_leaderboard_snapshots
  ADD COLUMN IF NOT EXISTS device_id text NOT NULL DEFAULT '';

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.tokentracker_leaderboard_snapshots'::regclass
      AND contype = 'u'
  LOOP
    EXECUTE format('ALTER TABLE public.tokentracker_leaderboard_snapshots DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS tokentracker_leaderboard_snapshots_device_key
  ON public.tokentracker_leaderboard_snapshots (period, from_day, to_day, user_id, device_id);

-- The cleanup pass compares device_id against '', so keep the column's default
-- in step with the writer for rows inserted by older revisions.
ALTER TABLE public.tokentracker_leaderboard_snapshots
  ALTER COLUMN device_id SET DEFAULT '';
