-- The settings UI writes display_name into tokentracker_user_settings; the
-- minimal 04c table predated that column.
ALTER TABLE public.tokentracker_user_settings
  ADD COLUMN IF NOT EXISTS display_name text;
