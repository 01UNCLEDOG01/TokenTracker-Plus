-- The visibility GET filters tokentracker_public_views on revoked_at;
-- the minimal 04c table predates that column.
ALTER TABLE public.tokentracker_public_views
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
