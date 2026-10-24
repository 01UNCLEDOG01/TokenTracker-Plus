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

The 12 upstream faces, plus heart_model (copy of the unused heart-on-your-sleeve face), are unchanged.

The minted house coins are AI-painted 3D relief medallions cast programmatically onto the champagne silver house rim (house_coin()) with strict binary alpha (zero semi-transparent fringe pixels):

- **Wave 2 & Habit Coins (14 coins)**: round-the-clock, cache-alchemist, deep-diver, arly-bird, ull-blast, grand-slam, iron-month, multitool-day, 
ight-owl, phoenix, 
eal-money, session-marathon, sprinter, wordsmith. Built via scripts/art/rebuild-badge-rims.py.
- **Wave 3 Coins (11 coins)**: closed-source-loyalist, rugal-architect, offgrid-sovereign, megacontext-voyager, cache-miser, code-cannon, uzzer-beater, zen-balancer, swarm-commander, 	erminal-purist, 
efactor-titan. Source originals are stored in scripts/art/source-badges/ and compiled via scripts/art/build-wave3-house-coins.py.
- **Remodeled 3D Relief Coins (3 coins)**: deep-thinker, claude-survivor, wishing-well were remodeled from flat 2D silhouettes into authentic 3D sculpted metallic relief coins (scripts/art/source-badges/deep-thinker.jpg, claude-survivor.jpg, wishing-well.jpg) via scripts/art/rebuild-badge-rims.py.
- **Synergy Title Crests (8 crests)**: dashboard/public/achievements/titles/title-*.png (for the 8 geek title resonances). Source originals are stored in scripts/art/source-titles/ and compiled via scripts/art/build-title-crests.py with tailored zooms and strict binary alpha.

Rebuild scripts & assets:
- scripts/art/source-badges/ — original 1024px / 256px source paintings for all wave-2, wave-3, and remodeled badges.
- scripts/art/source-titles/ — original 1024px source paintings for the 8 synergy title crests.
- scripts/art/rebuild-badge-rims.py — core rim generator and face extraction pipeline.
- scripts/art/build-wave3-house-coins.py — Wave-3 coin builder.
- scripts/art/build-title-crests.py — Title crest medallion builder.
- All minted outputs enforce strict 256×256 dimensions, bounding box [9, 245] (237px), and binary alpha {0, 255}.

The remaining unused faces (`pull-shark`, `starstruck`, `pair-extraordinaire`,
`open-sourcerer`, `heart-on-your-sleeve`,
`arctic-code-vault-contributor`, `proxima-*`) keep their
GitHub-flavored meanings and stay unassigned — don't force them onto
unrelated badges.
