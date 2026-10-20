-- Badge wave 2 (self-host): nine more cloud badges + the hidden flag.
--
-- Adds:
--   phoenix         — longest gap between two active days (7/14/30/90 days)
--   iron_month      — most active UTC days inside one calendar month (10/20/26/29)
--   full_blast      — heaviest ISO week ever (50M/500M/2.5B/15B tokens)
--   deep_diver      — distinct models with lifetime >= 1B tokens (1/2/3/5)
--   multitool_day   — most distinct sources in one active day (2/3/4/6)
--   heart_model     — favorite model's share of lifetime tokens, requires
--                     >= 5 distinct models (50/70/85/95 %)
--   claude_survivor — lifetime tokens through claude-family models, HIDDEN
--                     (50M/500M/5B/50B)
--   wishing_well    — lifetime tokens through deepseek-family models, HIDDEN
--                     (10M/100M/1B/10B)
--   grand_slam      — diamond-tier badges already earned (3/6/9/all)
--
-- hidden: locked hidden badges render as "???" for the owner too; once any
-- tier is earned the face, name and description reveal. The flag lives in
-- the catalog (single source) and rides user_badges_full payloads.
--
-- grand_slam's diamond line is "every other badge": the catalog value below
-- is the CURRENT catalog size minus itself (21 - 1). Any later migration
-- that adds catalog rows MUST bump this number in the same migration.
--
-- The refresh reads diamond counts from the monotonic badge table, so a
-- newly crossed diamond lands in grand_slam one refresh tick later.
--
-- Idempotent. Rollback:
--   DELETE FROM tokentracker_user_badges WHERE badge_id IN ('phoenix',
--     'iron_month','full_blast','deep_diver','multitool_day','heart_model',
--     'claude_survivor','wishing_well','grand_slam');
--   DELETE FROM tokentracker_badge_catalog WHERE badge_id IN (...same...);
--   ALTER TABLE tokentracker_badge_catalog DROP COLUMN hidden;
--   (re-create user_badges_refresh / user_badges_full from step 04e)

ALTER TABLE public.tokentracker_badge_catalog
  ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

INSERT INTO public.tokentracker_badge_catalog
  (badge_id, sort_order, lower_is_better, hidden, bronze, silver, gold, diamond)
VALUES
  ('phoenix',         13, false, false, 7,        14,         30,          90),
  ('iron_month',      14, false, false, 10,       20,         26,          29),
  ('full_blast',      15, false, false, 50000000, 500000000,  2500000000,  15000000000),
  ('deep_diver',      16, false, false, 1,        2,          3,           5),
  ('multitool_day',   17, false, false, 2,        3,          4,           6),
  ('heart_model',     18, false, false, 50,       70,         85,          95),
  ('claude_survivor', 19, false, true,  50000000, 500000000,  5000000000,  50000000000),
  ('wishing_well',    20, false, true,  10000000, 100000000,  1000000000,  10000000000),
  ('grand_slam',      21, false, false, 3,        6,          9,           20)
ON CONFLICT (badge_id) DO UPDATE SET
  sort_order      = EXCLUDED.sort_order,
  lower_is_better = EXCLUDED.lower_is_better,
  hidden          = EXCLUDED.hidden,
  bronze  = EXCLUDED.bronze,
  silver  = EXCLUDED.silver,
  gold    = EXCLUDED.gold,
  diamond = EXCLUDED.diamond;

-- ── Refresh: same shape as 04e, extended with the wave-2 metrics ─────────────

CREATE OR REPLACE FUNCTION public.user_badges_refresh()
RETURNS bigint
LANGUAGE plpgsql
SET work_mem TO '96MB'
SET hash_mem_multiplier TO '4'
SET statement_timeout TO '120s'
AS $func$
DECLARE
  v_through timestamptz;
  v_upserted bigint;
BEGIN
  -- Concurrency/throttle guard — reuse the leaderboard claim primitive with a
  -- dedicated key. Anything other than true means another attempt claimed the
  -- window recently: skip (the refresh is idempotent; next tick catches up).
  IF public.leaderboard_refresh_try_claim('badges', 300) IS DISTINCT FROM true THEN
    RETURN 0;
  END IF;

  SELECT m.through INTO v_through
  FROM tokentracker_leaderboard_rollup_meta m
  WHERE m.id = 1;
  v_through := COALESCE(v_through, '-infinity'::timestamptz);

  WITH
  -- (user, source, model, day): rollup base + live tail. The watermark sits on
  -- a UTC midnight, so no hourly bucket spans the cut — base + tail is exactly
  -- the deduped full history.
  usm AS (
    SELECT x.user_id, x.source, x.model, x.day,
           SUM(x.total_tokens)  AS tokens,
           SUM(x.output_tokens) AS output_tokens
    FROM (
      SELECT r.user_id, r.source, r.model, r.day, r.total_tokens, r.output_tokens
      FROM tokentracker_leaderboard_rollup_daily r
      UNION ALL
      SELECT t.user_id, t.source, t.model,
             (t.hour_start AT TIME ZONE 'UTC')::date AS day, t.total_tokens, t.output_tokens
      FROM leaderboard_hourly_dedup(v_through, now()) t
    ) x
    GROUP BY x.user_id, x.source, x.model, x.day
  ),
  -- Active day := any tokens that UTC day.
  daily AS (
    SELECT user_id, day, SUM(tokens) AS tokens, SUM(output_tokens) AS output_tokens
    FROM usm
    GROUP BY user_id, day
    HAVING SUM(tokens) > 0
  ),
  base AS (
    SELECT user_id,
           SUM(tokens)                    AS total_tokens,
           SUM(output_tokens)             AS output_tokens,
           COUNT(*)                       AS active_days,
           -- Weekend := Saturday/Sunday of the UTC day bucket. Local weekends
           -- shift by a few hours per timezone; at day grain that only blurs
           -- the edges, and no timezone context exists cloud-side.
           COUNT(*) FILTER (WHERE EXTRACT(isodow FROM day) IN (6, 7)) AS weekend_days,
           MIN(day)                       AS first_day,
           (current_date - MIN(day))      AS veteran_days,
           MAX(tokens)                    AS max_day_tokens
    FROM daily
    GROUP BY user_id
  ),
  best_day AS (
    SELECT DISTINCT ON (user_id) user_id, day AS best_day
    FROM daily
    ORDER BY user_id, tokens DESC, day ASC
  ),
  -- Longest streak: gaps-and-islands (day minus row_number is constant within
  -- a consecutive run).
  islands AS (
    SELECT user_id, grp, COUNT(*) AS len, MIN(day) AS run_start, MAX(day) AS run_end
    FROM (
      SELECT user_id, day,
             day - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day))::int AS grp
      FROM daily
    ) g
    GROUP BY user_id, grp
  ),
  streaks AS (
    SELECT DISTINCT ON (user_id) user_id, len AS longest_streak, run_start, run_end
    FROM islands
    ORDER BY user_id, len DESC, run_end DESC
  ),
  -- Max week-over-week growth over ADJACENT ISO weeks (prev_wk = wk - 7 is
  -- load-bearing: LAG alone returns the previous ACTIVE week, which may be
  -- months earlier). Prior week must clear a 10M floor to count. A partial
  -- current week can only understate the ratio — no false positives.
  weekly AS (
    SELECT user_id, date_trunc('week', day)::date AS wk, SUM(tokens) AS wtok
    FROM daily
    GROUP BY user_id, date_trunc('week', day)::date
  ),
  momentum AS (
    SELECT DISTINCT ON (user_id) user_id,
           (wtok::numeric / prev_wtok::numeric) AS max_wow,
           wk AS wow_week
    FROM (
      SELECT user_id, wk, wtok,
             LAG(wk)   OVER (PARTITION BY user_id ORDER BY wk) AS prev_wk,
             LAG(wtok) OVER (PARTITION BY user_id ORDER BY wk) AS prev_wtok
      FROM weekly
    ) w
    WHERE prev_wk = wk - 7 AND prev_wtok >= 10000000
    ORDER BY user_id, (wtok::numeric / prev_wtok::numeric) DESC
  ),
  variety AS (
    SELECT user_id,
           COUNT(DISTINCT model)  AS models,
           COUNT(DISTINCT source) AS sources
    FROM usm
    WHERE tokens > 0
    GROUP BY user_id
  ),
  -- trendsetter: models this user first touched within 7 days of the model's
  -- GLOBAL debut. Two guards: a >=5 distinct-user floor (private/BYO model
  -- strings would otherwise self-debut and auto-qualify their only user) and
  -- a 30-day dataset burn-in (at data start every model "debuts" at once).
  model_debut AS (
    SELECT model, MIN(day) AS debut
    FROM usm
    GROUP BY model
    HAVING COUNT(DISTINCT user_id) >= 5
       AND MIN(day) >= (SELECT MIN(day) + 30 FROM usm)
  ),
  trend AS (
    SELECT uf.user_id, COUNT(*) AS early_models
    FROM (
      SELECT user_id, model, MIN(day) AS first_day
      FROM usm GROUP BY user_id, model
    ) uf
    JOIN model_debut d USING (model)
    WHERE uf.first_day <= d.debut + 7
    GROUP BY uf.user_id
  ),
  fav AS (
    SELECT DISTINCT ON (user_id) user_id,
           model AS favorite_model, t AS favorite_tokens
    FROM (
      SELECT user_id, model, SUM(tokens) AS t
      FROM usm GROUP BY user_id, model
    ) m
    ORDER BY user_id, t DESC
  ),
  -- phoenix: longest return interval between two active days (the gap spans
  -- both endpoints — a Friday-active, Monday-active week gaps 3). First day
  -- has no predecessor and never counts as "coming back".
  phoenix AS (
    SELECT DISTINCT ON (user_id) user_id,
           (day - prev_day) AS gap_days,
           prev_day AS gap_start,
           day AS return_day
    FROM (
      SELECT user_id, day,
             LAG(day) OVER (PARTITION BY user_id ORDER BY day) AS prev_day
      FROM daily
    ) g
    WHERE prev_day IS NOT NULL
    ORDER BY user_id, (day - prev_day) DESC, day ASC
  ),
  -- iron_month: most active UTC days inside one calendar month.
  monthly AS (
    SELECT user_id, date_trunc('month', day)::date AS mon, COUNT(*) AS month_active
    FROM daily
    GROUP BY user_id, date_trunc('month', day)::date
  ),
  iron_month AS (
    SELECT DISTINCT ON (user_id) user_id, month_active, mon AS best_month
    FROM monthly
    ORDER BY user_id, month_active DESC, mon ASC
  ),
  -- full_blast: heaviest ISO week ever (weekly already aggregates daily).
  full_blast AS (
    SELECT DISTINCT ON (user_id) user_id,
           wtok AS max_week_tokens, wk AS best_week
    FROM weekly
    ORDER BY user_id, wtok DESC, wk ASC
  ),
  -- deep_diver: distinct models whose lifetime total crossed 1B tokens.
  deep_diver AS (
    SELECT user_id, COUNT(*) AS big_models,
           COALESCE(jsonb_agg(model ORDER BY t DESC), '[]'::jsonb) AS big_model_list
    FROM (
      SELECT user_id, model, SUM(tokens) AS t
      FROM usm
      WHERE tokens > 0
      GROUP BY user_id, model
    ) m
    WHERE t >= 1000000000
    GROUP BY user_id
  ),
  -- multitool_day: most distinct sources inside one active UTC day.
  daily_tools AS (
    SELECT user_id, day, COUNT(DISTINCT source) AS day_tools,
           COALESCE(jsonb_agg(DISTINCT source), '[]'::jsonb) AS tool_list
    FROM usm
    WHERE tokens > 0
    GROUP BY user_id, day
  ),
  multitool_day AS (
    SELECT DISTINCT ON (user_id) user_id,
           day_tools, day AS tool_day, tool_list
    FROM daily_tools
    ORDER BY user_id, day_tools DESC, day ASC
  ),
  -- heart_model: the favorite model's share of lifetime tokens, in percent.
  -- Guard: >= 5 distinct models — a one-model history is 100% by definition,
  -- not devotion. total_tokens > 0 mirrors the val IS NOT NULL skip below.
  heart AS (
    SELECT f.user_id,
           f.favorite_model AS top_model,
           (f.favorite_tokens::numeric * 100 / b.total_tokens) AS share_pct
    FROM fav f
    JOIN base b USING (user_id)
    JOIN variety v USING (user_id)
    WHERE v.models >= 5 AND b.total_tokens > 0
  ),
  -- Family badges: lifetime tokens through model-name prefixes. Claude family
  -- ("封号幸存者") and deepseek family ("许愿池") are the hidden ones.
  claude_family AS (
    SELECT user_id, SUM(tokens) AS claude_tokens
    FROM usm
    WHERE model LIKE 'claude%' AND tokens > 0
    GROUP BY user_id
  ),
  deepseek_family AS (
    SELECT user_id, SUM(tokens) AS deepseek_tokens
    FROM usm
    WHERE model LIKE 'deepseek%' AND tokens > 0
    GROUP BY user_id
  ),
  -- grand_slam: diamond-tier badges already earned, self excluded. Reads the
  -- monotonic badge table (last refresh's tiers), so a newly crossed diamond
  -- lands in the slam count one refresh tick later.
  diamonds AS (
    SELECT user_id, COUNT(*) AS diamond_badges
    FROM tokentracker_user_badges
    WHERE tier = 4
      AND badge_id <> 'grand_slam'
    GROUP BY user_id
  ),
  -- Current rank from the newest total-period snapshot window (sampled; the
  -- monotonic upsert turns samples into best-ever).
  cur_rank AS (
    SELECT s.user_id, MIN(s.rank) AS rank
    FROM tokentracker_leaderboard_snapshots s
    WHERE s.period = 'total'
      AND s.to_day = (SELECT MAX(to_day) FROM tokentracker_leaderboard_snapshots
                      WHERE period = 'total')
    GROUP BY s.user_id
  ),
  facts AS (
    SELECT b.user_id,
           b.total_tokens, b.output_tokens, b.max_day_tokens, bd.best_day,
           b.active_days, b.weekend_days, b.first_day, b.veteran_days,
           s.longest_streak, s.run_start, s.run_end,
           mo.max_wow, mo.wow_week,
           v.models, v.sources, f.favorite_model,
           t.early_models,
           p.gap_days, p.gap_start, p.return_day,
           im.month_active, im.best_month,
           fb.max_week_tokens, fb.best_week,
           dd.big_models, dd.big_model_list,
           mt.day_tools, mt.tool_day, mt.tool_list,
           h.share_pct, h.top_model,
           cf.claude_tokens, ds.deepseek_tokens,
           dz.diamond_badges,
           r.rank AS current_rank
    FROM base b
    LEFT JOIN best_day bd USING (user_id)
    LEFT JOIN streaks  s  USING (user_id)
    LEFT JOIN momentum mo USING (user_id)
    LEFT JOIN variety  v  USING (user_id)
    LEFT JOIN fav      f  USING (user_id)
    LEFT JOIN trend    t  USING (user_id)
    LEFT JOIN phoenix  p  USING (user_id)
    LEFT JOIN iron_month im USING (user_id)
    LEFT JOIN full_blast fb USING (user_id)
    LEFT JOIN deep_diver dd USING (user_id)
    LEFT JOIN multitool_day mt USING (user_id)
    LEFT JOIN heart    h  USING (user_id)
    LEFT JOIN claude_family cf USING (user_id)
    LEFT JOIN deepseek_family ds USING (user_id)
    LEFT JOIN diamonds dz USING (user_id)
    LEFT JOIN cur_rank r  USING (user_id)
  )
  INSERT INTO tokentracker_user_badges AS ub
    (user_id, badge_id, tier, metric_value, meta,
     bronze_at, silver_at, gold_at, diamond_at, updated_at)
  SELECT f.user_id, c.badge_id, ev.tier, m.val, m.meta,
         CASE WHEN ev.tier >= 1 THEN now() END,
         CASE WHEN ev.tier >= 2 THEN now() END,
         CASE WHEN ev.tier >= 3 THEN now() END,
         CASE WHEN ev.tier >= 4 THEN now() END,
         now()
  FROM facts f
  CROSS JOIN LATERAL (VALUES
    ('token_titan',     f.total_tokens::numeric,   '{}'::jsonb),
    ('big_day',         f.max_day_tokens::numeric, jsonb_build_object('date', f.best_day)),
    ('wordsmith',       f.output_tokens::numeric,  '{}'::jsonb),
    ('marathoner',      f.active_days::numeric,    '{}'::jsonb),
    ('streak',          f.longest_streak::numeric, jsonb_build_object('run_start', f.run_start, 'run_end', f.run_end)),
    ('weekend_warrior', f.weekend_days::numeric,   '{}'::jsonb),
    ('momentum',        f.max_wow,                 jsonb_build_object('week', f.wow_week)),
    ('polyglot',        f.models::numeric,         jsonb_build_object('favorite_model', f.favorite_model)),
    ('trendsetter',     f.early_models::numeric,   '{}'::jsonb),
    ('multitool',       f.sources::numeric,        '{}'::jsonb),
    ('podium',          f.current_rank::numeric,   '{}'::jsonb),
    ('veteran',         f.veteran_days::numeric,   jsonb_build_object('first_day', f.first_day)),
    ('phoenix',         f.gap_days::numeric,       jsonb_build_object('gap_start', f.gap_start, 'return_day', f.return_day)),
    ('iron_month',      f.month_active::numeric,   jsonb_build_object('month', f.best_month)),
    ('full_blast',      f.max_week_tokens::numeric, jsonb_build_object('week', f.best_week)),
    ('deep_diver',      f.big_models::numeric,     jsonb_build_object('models', f.big_model_list)),
    ('multitool_day',   f.day_tools::numeric,      jsonb_build_object('day', f.tool_day, 'tools', f.tool_list)),
    ('heart_model',     f.share_pct::numeric,      jsonb_build_object('model', f.top_model)),
    ('claude_survivor', f.claude_tokens::numeric,  '{}'::jsonb),
    ('wishing_well',    f.deepseek_tokens::numeric, '{}'::jsonb),
    ('grand_slam',      f.diamond_badges::numeric, '{}'::jsonb)
  ) AS m(badge_id, val, meta)
  JOIN tokentracker_badge_catalog c ON c.badge_id = m.badge_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN m.val IS NULL THEN 0
      WHEN c.lower_is_better THEN CASE
        WHEN m.val <= c.diamond THEN 4
        WHEN m.val <= c.gold    THEN 3
        WHEN m.val <= c.silver  THEN 2
        WHEN m.val <= c.bronze  THEN 1
        ELSE 0 END
      ELSE CASE
        WHEN m.val >= c.diamond THEN 4
        WHEN m.val >= c.gold    THEN 3
        WHEN m.val >= c.silver  THEN 2
        WHEN m.val >= c.bronze  THEN 1
        ELSE 0 END
      END AS tier
  ) ev
  -- momentum/podium/heart_model/phoenix have no value until a qualifying
  -- week / a rank / a 5-model history / a second active day exists; skip
  -- those rows (the dashboard renders missing rows as locked at zero).
  WHERE m.val IS NOT NULL
  ON CONFLICT (user_id, badge_id) DO UPDATE SET
    -- MONOTONIC: tier only ever ratchets up.
    tier = GREATEST(ub.tier, EXCLUDED.tier),
    -- podium keeps the best-ever (lowest) rank; every other metric is a
    -- whole-history aggregate and simply takes the latest computation.
    metric_value = CASE
      WHEN (SELECT lower_is_better FROM tokentracker_badge_catalog cc
            WHERE cc.badge_id = ub.badge_id)
        THEN LEAST(ub.metric_value, EXCLUDED.metric_value)
      ELSE EXCLUDED.metric_value END,
    meta = ub.meta || EXCLUDED.meta,
    -- First-achieved timestamps: set once, never overwritten.
    bronze_at  = COALESCE(ub.bronze_at,  EXCLUDED.bronze_at),
    silver_at  = COALESCE(ub.silver_at,  EXCLUDED.silver_at),
    gold_at    = COALESCE(ub.gold_at,    EXCLUDED.gold_at),
    diamond_at = COALESCE(ub.diamond_at, EXCLUDED.diamond_at),
    updated_at = now();

  GET DIAGNOSTICS v_upserted = ROW_COUNT;
  RETURN v_upserted;
END
$func$;

REVOKE EXECUTE ON FUNCTION public.user_badges_refresh() FROM anon, authenticated, PUBLIC;

-- Full list for the profile edge: same shape as 04e, plus the hidden flag so
-- the frontend can render locked hidden badges as "???".
CREATE OR REPLACE FUNCTION public.user_badges_full(p_user_id uuid, p_include_unearned boolean)
RETURNS jsonb
LANGUAGE sql STABLE
SET statement_timeout TO '5s'
AS $func$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.badge_id,
    'tier', b.tier,
    'metric_value', b.metric_value,
    'thresholds', jsonb_build_array(c.bronze, c.silver, c.gold, c.diamond),
    'lower_is_better', c.lower_is_better,
    'hidden', c.hidden,
    'next_threshold', CASE b.tier
      WHEN 4 THEN NULL
      WHEN 3 THEN c.diamond
      WHEN 2 THEN c.gold
      WHEN 1 THEN c.silver
      ELSE c.bronze END,
    'achieved', jsonb_build_object(
      'bronze', b.bronze_at, 'silver', b.silver_at,
      'gold', b.gold_at, 'diamond', b.diamond_at),
    'serials', jsonb_build_object(
      'bronze', b.bronze_no, 'silver', b.silver_no,
      'gold', b.gold_no, 'diamond', b.diamond_no),
    'meta', b.meta,
    'updated_at', b.updated_at
  ) ORDER BY b.tier DESC, c.sort_order ASC), '[]'::jsonb)
  FROM tokentracker_user_badges b
  JOIN tokentracker_badge_catalog c USING (badge_id)
  WHERE b.user_id = p_user_id
    AND (p_include_unearned OR b.tier >= 1);
$func$;

REVOKE EXECUTE ON FUNCTION public.user_badges_full(uuid, boolean) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_badges_full(uuid, boolean) TO project_admin;
