# TT-plus (TokenTracker-plus)

> **TT-plus is a personal fork built on the original author's open-source repository.**
> This project is based on [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker) (MIT) and is **not the upstream official distribution**. It does not represent the original author. Copyright, design and the base functionality belong to the upstream author; the changes in this repository are also released under MIT. The upstream does not support or endorse this fork.

**English (this page)** · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md)

This repository currently supports **52 AI coding tools** (upstream base plus fork extensions). TT-plus is a **local-first** token usage and cost dashboard for AI coding: it parses local CLI/IDE logs and databases, aggregates by model and hour, and provides a dashboard, session details, project attribution, limit cards, a desktop pet, widgets and self-hosted sync.

---

## What it is

- **Local collection**: reads token counts, timestamps, model names and costs from local JSONL / SQLite / logs and writes them to `~/.tokentracker/queue.jsonl`.
- **Local dashboard**: the CLI serves a local dashboard with total cost, daily trends, model breakdown, project attribution, sessions, limits and achievements.
- **Self-hosted cloud features (optional)**: cross-device account views and a shared leaderboard can point at your own Node + PGlite backend (`scripts/self-host/`). Achievements do not need it — all 31 are judged from this machine's queue. There is no membership/payment UI.
- **Desktop**: a Windows tray app embeds the dashboard and adds a pet, a desktop quota widget and an always-on-top usage pill.
- **Auditable cost model**: each token component is recorded separately; cost is `Σ(tokens × price)`. Prices come from LiteLLM plus local curated overrides.

## Supported AI tools (52)

The current **52 AI coding tools** (canonical list: `SUPPORTED_PROVIDERS` in `src/commands/init.js`):

Claude Code, AutoClaw, Cola, Tuanjie Cowork, Agent2API, Codex CLI, AStudio, Cursor, Gemini CLI, Antigravity, Kiro, OpenCode, OpenClaw, Loomy, Every Code, Hermes Agent, GitHub Copilot, Kimi Code, CodeBuddy, WorkBuddy, WorkBuddy AI, Grok Build, oh-my-pi, OmO, pi, Dots, Prime Agent, Craft Agents, Reasonix, Muse Code, Kilo CLI, Kilo Code, Roo Code, Zed Agent, Goose, Droid, Mimo, DuMate, ZCode, Qoder, AnythingLLM Desktop, Claude Science, DeepSeek Harness, TRAE CN, TRAE, LM Studio, Unsloth Studio, Devin CLI, Cline, MiniMax Code, CodeArts Agent, Command Code

Directory overrides: `TOKENTRACKER_ACODE_HOME` (AStudio), `TOKENTRACKER_DUMATE_HOME` (DuMate), `TOKENTRACKER_LMSTUDIO_HOME` (LM Studio), `TOKENTRACKER_UNSLOTH_DB` (Unsloth Studio), `TOKENTRACKER_DEVIN_DB` (Devin CLI), plus each provider's own home variables.

## Differences from upstream

| Area | Upstream TokenTracker | TT-plus |
|---|---|---|
| Focus | General, multi-user, optional hosted Cloud | Single machine, single user, self-hosted |
| **AI tools supported** | **52** | **52** (with fork extensions) |
| **Rate-limit tracking** | ✅ 17 providers | ✅ 17 providers + fork extensions |
| Cloud | Official hosting / optional self-host | Your own backend; no membership/payment UI |
| Usage sources | The upstream 52 tools | Adds WorkBuddy both editions, DSH, ZCode, TRAE CN local DB, Kimi desktop, AutoClaw, Cola and Tuanjie Cowork |
| Limit cards | Upstream provider set | Adds Agent2API, APIGOTO, AgentRouter, DeepSeek, Trae sub-account, CodeArts, Cline Pass and SenseNova |
| Windows | Tray + dashboard | Adds pet action rotation, desktop quota widget and usage pill |
| Pricing | Upstream `-free` zero-price rule | **Rejects `-free` zero-price**: free routes are still valued at list price |
| Achievements | Hosted leaderboard required | **All 31 judged from the local queue**, offline-unlockable; trendsetter compares your first use against a curated, source-cited model debut catalog |
| Distribution | npm / official installers | No npm release; desktop apps built from source |

## What it is not

- **Not an official distribution**: no npm package, no official release, no upstream support promise.
- **No membership/payment UI**: the shared leaderboard and cross-device sync run on your own backend; achievements never do.
- **No guarantee of upstream parity**: merging upstream involves trade-offs; fork-specific behavior (especially billing semantics) does not follow upstream automatically.
- **No prompt/code collection**: only token counts, timestamps, model names and costs.

## Quick start (CLI + local dashboard)

Requires **Node.js 20+**. The Windows desktop app additionally needs .NET 8 SDK and the WebView2 runtime.

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-plus.git
cd TokenTracker-plus
npm install

node bin/tracker.js          # installs hooks, syncs local data and opens the dashboard
node bin/tracker.js sync     # manual sync
node bin/tracker.js status   # hook status
node bin/tracker.js doctor   # health check
```

The default dashboard is `http://localhost:7680`. Local usage works without sign-in; cloud features need the self-hosted backend and a session.

### Windows desktop

```bash
TOKENTRACKER_BUILD_PET=1 npm --prefix dashboard run build
cd TokenTrackerWin
dotnet build -c Release
```

`TOKENTRACKER_BUILD_PET=1` is required, otherwise `pet.html` / `quota.html` are not emitted. The Windows shell picks a free loopback port (not fixed 7680). See [TokenTrackerWin/README.md](./TokenTrackerWin/README.md).

## Self-hosted backend (optional)

```bash
ROUTER_PW=... scripts/self-host/internal-deploy.sh [host]
scripts/self-host/internal-backup.sh
```

- This is a **technical preview**, not a one-click installer for an empty VPS; see [docs/self-hosting.md](./docs/self-hosting.md) for the full gates.
- Requires a dedicated Linux host running Docker (the deployment script connects via SSH; internal test host Docker was decommissioned on 2026-10-23).
- Always `docker stop -t 30` before removing a running container; never `docker rm -f` a live PGlite volume.
- Point clients at your instance with `VITE_INSFORGE_BASE_URL` / `VITE_INSFORGE_ANON_KEY` (CLI: `TOKENTRACKER_INSFORGE_BASE_URL`).
- The backend receives aggregate usage only, never prompts or code.

## Data and privacy

- **Local first**: parsing happens on this machine; original logs are not uploaded wholesale.
- **Counts only**: input / cached / cache_creation / output / reasoning, time buckets, model names, source and cost. No conversation bodies or tool arguments.
- **Credentials stay local**: cookies, API keys and device tokens live in the user directory or `.env.local`; they are not written to the repo, logs or frontend bundles.
- **Third-party requests**: only explicitly configured limit providers call their vendor APIs.

## Cost model

- `cost = input×input rate + cached×cache-read rate + cache_write×cache-write rate + output×output rate + reasoning×reasoning rate`. Do not multiply `total_tokens` by one rate.
- Prices come from the full LiteLLM table plus `src/lib/pricing/curated-overrides.json`; models without a public price are tracked by tokens only, with no invented money.
- **Free routes are valued at list price**: the upstream `-free` zero-price rule is permanently rejected in this fork.
- **AgentRouter face value is not added to total spend**: codex traffic is already accounted by tokens; the relay face value is carried only by the AgentRouter card.
- Estimates (antigravity, Qoder CN, etc.) are labeled explicitly.
- **Model debut dates** for the trendsetter badge come from `src/lib/pricing/model-debuts.json`: one entry per model, each carrying the vendor source it was read from. A model counts when this machine first ran it within a week either side of that date, so beta access before an announcement is credited and shown separately in the badge metadata. Models with no verifiable date get no verdict either way.

### Activity heatmap levels

The heatmap's **Level 0–4** is relative to the selected window, not a fixed daily-token ladder. The server rule is:

- `P` = the busiest day's `billable_total_tokens` in the window;
- Level 1: `0 < tokens ≤ 25% × P`
- Level 2: `≤ 50% × P`
- Level 3: `≤ 75% × P`
- Level 4: `> 75% × P`

The client-side fallback currently uses active-day quantiles (50/75/90th percentile) instead; the two rules are not yet unified, and the UI does not show the current threshold. Tracked as KI-016.

## Configuration

```bash
cp .env.example .env.local
```

Common variables: `TOKENTRACKER_DEVICE_TOKEN`, `TOKENTRACKER_ACCESS_TOKEN`, `TOKENTRACKER_INSFORGE_BASE_URL`, `VITE_INSFORGE_BASE_URL`, `VITE_INSFORGE_ANON_KEY`, `OPENROUTER_API_KEY`, `OPENCODE_GO_API_KEY`.

Put local overrides in `.env.local` (gitignored). **Do not create `.dev.vars`** — that is a Cloudflare Workers convention; this project uses Node/Electron `.env.local`.

Data directory: `~/.tokentracker/`; the Windows desktop app also uses `%LOCALAPPDATA%`.

## Repository layout

```
src/                 CLI, parsers, local API, pricing
dashboard/           React + Vite dashboard
TokenTrackerWin/     Windows tray app (.NET 8 + WebView2)
TokenTrackerBar/     macOS menu-bar app
TokenTrackerLinux/   Linux Tauri app
scripts/self-host/   self-hosted deploy, backup, aggregation SQL
test/                Node tests and baseline
docs/                topic docs
```

## Documentation

| File | Purpose |
|---|---|
| [FORK_STATUS.md](./FORK_STATUS.md) | current HEAD, deployment, gate summary |
| [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) | open work, decisions, known limits |
| [GATE_REGISTRY.md](./GATE_REGISTRY.md) | commands before commit/deploy |
| [CHANGELOG.md](./CHANGELOG.md) | full chronological change log |
| [AGENTS.md](./AGENTS.md) | navigation and working rules for agents |
| [CLAUDE.md](./CLAUDE.md) | upstream architecture reference; fork rules live in AGENTS.md |

## Development and verification

```bash
npm run test:fast
npm test
npm run validate:fast
npm run validate:bot-frames
npm --prefix dashboard run test
npm --prefix dashboard run typecheck
TOKENTRACKER_BUILD_PET=1 npm --prefix dashboard run build
```

On this machine the full Node suite has about 50 environment/baseline reds plus known flaky tests; see [GATE_REGISTRY.md](./GATE_REGISTRY.md). A green single file does not excuse a red full suite.

## Known limitations

- **opencode refresh is incremental after the first read**: the first scan of the ~27GB database still costs about 18s (and a fresh app process starts cold); later refreshes read only new/updated rows, about 6.4s for this source and 12.6s for a second full session refresh on this machine. v2/transitional layouts still take the full path.
- **antigravity prefers measured tokscale data**: where Token Monitor's tokscale cache covers a day, TT uses its measured usage; days with no cache fall back to the transcript estimate. The cache on this machine covers 2026-10-03..10-10 only.
- **Qoder tokens are derived from credits**: Qoder international's JSONL carries zero token fields; TT derives tokens from the credits and labels the rows Qwen3.8-Flash（积分）/ DeepSeek-Flash（积分）. Qoder CN's official spend and Qoder international's quota both rely on `qoder-usage-cookie.txt`; the international cookie is httpOnly and must be copied once via DevTools (use the refresh script).
- **Qoder international has no local quota service on Windows**: its data lives in `~/.qoder`, so the limit card uses the cookie route rather than `%APPDATA%\Qoder`.
- **DeepSeek is balance-only**: the old `/user/balance/models` daily-usage endpoint is gone; the card shows balance and granted amount only.
- **Some sources have no per-conversation data**: cursor / minimax-code / reasonix are not wired into the session layer yet.
- **The Windows shell is an MVP**: live tray numbers, native bridge, auto-update and a signed installer/CI are not fully ported.
- **Upstream merges can overwrite fork changes**: re-reconcile billing totals and key behavior after every merge.

## License and credits

- **License**: [MIT](./LICENSE). Upstream copyright belongs to `xiufengsun`; this fork's changes are also MIT.
- **Upstream**: [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker).
- **Third-party**: see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md). The Clawd character design belongs to Anthropic; this project has no official affiliation with Anthropic.
- Please report upstream issues in the [upstream tracker](https://github.com/xiufengsun/TokenTracker/issues).

## Two modes, one repository

- **Local (default)** — the desktop app + CLI run fully offline. The runtime descriptor serves `localOnly: true`: cloud navigation and settings are hidden, the leaderboard reads this machine's queue history ("本机历史"), and all 31 achievements unlock locally — including trendsetter and podium, which upstream gates behind the shared leaderboard.
- **Self-hosted (optional)** — deploy `scripts/self-host/` to your own server for cross-device account views and a shared leaderboard. Everything cloud-gated lives behind that deployment; nothing in the local build calls it.

Both modes ship from this single codebase; pick per install by pointing the CLI at (or away from) a backend.
