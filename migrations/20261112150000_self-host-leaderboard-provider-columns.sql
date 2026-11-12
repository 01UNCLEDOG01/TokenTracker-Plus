-- Leaderboard provider columns.
--
-- The self-host reconstruction of tokentracker_leaderboard_snapshots
-- (20261014020000_self-host-public-face.sql) carried only the account-level
-- columns, so the dashboard's per-source cells all read NULL and rendered "-".
--
-- Two halves: the upstream per-source columns (codex / claude / gemini / …)
-- and the sources this fork collects and its own users actually burn. Without
-- the second half ~70% of a private instance's usage lands in other_tokens and
-- the board still looks empty.
--
-- Device-level keying lives in 20261112120000_self-host-leaderboard-device-rows.sql.

ALTER TABLE public.tokentracker_leaderboard_snapshots
  ADD COLUMN IF NOT EXISTS gpt_tokens bigint,
  ADD COLUMN IF NOT EXISTS claude_tokens bigint,
  ADD COLUMN IF NOT EXISTS gemini_tokens bigint,
  ADD COLUMN IF NOT EXISTS cursor_tokens bigint,
  ADD COLUMN IF NOT EXISTS opencode_tokens bigint,
  ADD COLUMN IF NOT EXISTS openclaw_tokens bigint,
  ADD COLUMN IF NOT EXISTS hermes_tokens bigint,
  ADD COLUMN IF NOT EXISTS kiro_tokens bigint,
  ADD COLUMN IF NOT EXISTS copilot_tokens bigint,
  ADD COLUMN IF NOT EXISTS kimi_tokens bigint,
  ADD COLUMN IF NOT EXISTS zcode_tokens bigint,
  ADD COLUMN IF NOT EXISTS dsh_tokens bigint,
  ADD COLUMN IF NOT EXISTS trae_cn_tokens bigint,
  ADD COLUMN IF NOT EXISTS workbuddy_tokens bigint,
  ADD COLUMN IF NOT EXISTS workbuddy_ai_tokens bigint,
  ADD COLUMN IF NOT EXISTS antigravity_tokens bigint,
  ADD COLUMN IF NOT EXISTS qoder_tokens bigint,
  ADD COLUMN IF NOT EXISTS qoder_cn_tokens bigint,
  ADD COLUMN IF NOT EXISTS codearts_tokens bigint,
  ADD COLUMN IF NOT EXISTS agent2api_tokens bigint,
  ADD COLUMN IF NOT EXISTS other_tokens bigint;
