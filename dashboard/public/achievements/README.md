# Achievements

Badge faces in this directory are original TokenTracker artwork (256px,
pngquant-quantized), one PNG per badge id.

## Badges: how to earn them

Every badge has four tiers — Bronze / Silver / Gold / Diamond. Tiers are
monotonic (once earned, never lost) and each tier's first-achieved date is
recorded. Cloud badges are recomputed every 6 hours from the account's
deduplicated cross-device history (UTC days); local badges are computed
on-device in real time and never leave the machine.

> Threshold source of truth: the `tokentracker_badge_catalog` seed in
> `scripts/ops/user-badges.sql` (cloud) and `LOCAL_BADGE_THRESHOLDS` in
> `src/lib/local-api.js` (local). The table below is documentation — if it
> ever disagrees with those, they win.

### Cloud badges

| Badge | Condition | Bronze | Silver | Gold | Diamond |
|---|---|---|---|---|---|
| **Token Titan** (`token_titan`) | Lifetime total tokens across all tools | 100M | 1B | 10B | 100B |
| **Big Day** (`big_day`) | Most tokens in a single UTC day | 10M | 100M | 500M | 3B |
| **Wordsmith** (`wordsmith`) | Lifetime output tokens (text/code the models actually generated — cache reads don't count) | 5M | 25M | 100M | 300M |
| **Marathoner** (`marathoner`) | Total active days (any usage that UTC day) | 7 | 30 | 100 | 365 |
| **On Fire** (`streak`) | Longest run of consecutive active days | 3 | 7 | 30 | 100 |
| **Weekend Warrior** (`weekend_warrior`) | Active days falling on a UTC Saturday or Sunday | 5 | 20 | 50 | 100 |
| **Momentum** (`momentum`) | Biggest week-over-week growth between two *adjacent* ISO weeks; the earlier week must have ≥10M tokens | 2× | 6× | 15× | 40× |
| **Model Polyglot** (`polyglot`) | Distinct models used | 5 | 15 | 30 | 60 |
| **Trendsetter** (`trendsetter`) | Models you started using within 7 days of their global debut across all TokenTracker users (only models with ≥5 users count, so private/BYO model names can't self-qualify) | 2 | 5 | 10 | 20 |
| **Multitool** (`multitool`) | Distinct AI tools (providers) tracked | 2 | 4 | 6 | 10 |
| **Podium** (`podium`) | Best-ever rank on the all-time leaderboard | Top 100 | Top 30 | Top 10 | Top 3 |
| **Veteran** (`veteran`) | Days since your first tracked day | 30 | 90 | 180 | 365 |
| **Phoenix Rising** (`phoenix`) | Longest return gap between two active days (the interval spans both endpoints) | 7 days | 14 days | 30 days | 90 days |
| **Iron Month** (`iron_month`) | Most active days inside one calendar month | 10 | 20 | 26 | 29 |
| **Full Blast** (`full_blast`) | Heaviest ISO week of tokens ever | 50M | 500M | 2.5B | 15B |
| **Deep Diver** (`deep_diver`) | Distinct models past a billion lifetime tokens each | 1 | 2 | 3 | 5 |
| **One-Man Band** (`multitool_day`) | Distinct AI tools used inside a single active day | 2 | 3 | 4 | 6 |
| **The One** (`heart_model`) | Favorite model's share of lifetime tokens (needs ≥5 distinct models to qualify) | 50% | 70% | 85% | 95% |
| **Ban Wave Survivor** (`claude_survivor`, hidden) | Lifetime tokens through claude-family models (recalibrated 2026-10-21: the original 50M/500M/5B/50B line predates real claude volume) | 1M | 10M | 100M | 1B |
| **Wishing Well** (`wishing_well`, hidden) | Lifetime tokens tossed into deepseek-family models | 10M | 100M | 1B | 10B |
| **Grand Slam** (`grand_slam`) | Diamond-tier badges already earned (self excluded — every other catalog badge is the Diamond line) | 3 | 6 | 9 | all |

Hidden badges render as `???` (name, description and face) until any tier is
earned — even on their owner's own wall.

### Local badges (this device only, never uploaded)

| Badge | Condition | Bronze | Silver | Gold | Diamond |
|---|---|---|---|---|---|
| **Project Hopper** (`project_hopper`) | Distinct projects with tracked usage | 3 | 5 | 10 | 20 |
| **Project Devotion** (`project_devotion`) | Lifetime tokens poured into a single project | 1M | 10M | 100M | 1B |
| **Night Owl** (`night_owl`) | Active hours between midnight and 6 AM local time | 5 | 20 | 60 | 150 |
| **Early Bird** (`early_bird`) | Active hours between 4 AM and 10 AM local time | 5 | 20 | 60 | 150 |
| **Around the Clock** (`around_the_clock`) | Distinct local hour-of-day buckets (0–23) with any activity | 6 | 12 | 18 | 24 |
| **Sprinter** (`sprinter`) | Most tokens in a single hour bucket | 1M | 10M | 100M | 1B |
| **Cache Alchemist** (`cache_alchemist`) | Lifetime cached-input tokens (cache reads + cache writes) | 50M | 500M | 5B | 50B |
| **Deep Thinker** (`deep_thinker`) | Lifetime reasoning output tokens | 1M | 5M | 20M | 60M |
| **Real Money** (`real_money`) | Lifetime tracked cost (USD; provider-reported where available, model pricing otherwise) | $5 | $50 | $500 | $5,000 |
| **Session Marathon** (`session_marathon`) | Longest single session's active time (idle gaps excluded) | 1h | 4h | 8h | 12h |

### Face art provenance

The 12 upstream faces, plus `deep_thinker` / `heart_model` (copies of the
unused `galaxy-brain` / `heart-on-your-sleeve` faces), are unchanged.

The other 14 faces (6 habit badges + 8 wave-2 cloud badges) are AI-painted
medallions finished with the house rim. The first pass baked its own rim,
which left a beaded checker fringe and a hard dark groove between face and
frame at display size. The second pass keeps only the painted face and casts
the rim programmatically:

- `scripts/art/source-badges/` — the painted 256px faces.
- `scripts/art/source-emblem/` — the one-man-band and skull emblems.
- `scripts/art/brand-cache/deepseek.png` / `claude-code.png` — the official
  DeepSeek whale and Claude starburst used for `wishing_well` and
  `claude_survivor`. The whale's white belly is filled as light enamel
  rather than left as a hole onto the coin face.
- Rebuild with `python scripts/art/rebuild-badge-rims.py`. The house rim
  rolls from the face into a warm champagne frame with no dark groove, and
  the saved PNG has binary alpha (opaque coin, fully transparent outside),
  so a scaled edge cannot show a checkerboard or a dot fringe.
- The older self-drawn generator `scripts/art/gen-achievement-medallions.py`
  is kept for provenance and for the `deep_thinker` / `heart_model` copies;
  its draw calls for these 14 faces are commented out so a rerun cannot
  overwrite the painted art.

The remaining unused faces (`pull-shark`, `starstruck`, `pair-extraordinaire`,
`open-sourcerer`, `heart-on-your-sleeve`,
`arctic-code-vault-contributor`, `proxima-*`) keep their
GitHub-flavored meanings and stay unassigned — don't force them onto
unrelated badges.
