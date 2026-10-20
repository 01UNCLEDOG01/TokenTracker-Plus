-- Badge wave 2 recalibration (2026-10-21): claude_survivor thresholds lowered
-- 50M/500M/5B/50B → 1M/10M/100M/1B. Owner decision: the badge celebrates
-- surviving the ban waves, and claude-family volume is naturally small on
-- this instance — the original line made it unreachable while its hidden
-- sibling (wishing_well) already diamonded. Same shape as the upstream
-- 2026-07-14 recalibration; tiers are monotonic so already-earned tiers are
-- untouched (none exist yet at these new lower lines).
--
-- Idempotent. Rollback: UPDATE the row back to 50000000/500000000/
-- 5000000000/50000000000.

UPDATE public.tokentracker_badge_catalog
SET bronze = 1000000, silver = 10000000, gold = 100000000, diamond = 1000000000
WHERE badge_id = 'claude_survivor';
