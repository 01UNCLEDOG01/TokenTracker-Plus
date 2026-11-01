# CLAUDE.md

> **Fork note:** for TT-plus workflow, docs, gates, deployment and worktree rules, [AGENTS.md](./AGENTS.md) is authoritative. This file documents architecture, conventions and release mechanics.

Guidance for Claude Code working in this repository. Every line here is loaded into every conversation turn — keep it lean and current.

## Project shape

Token Tracker is a local-first AI token usage tracker. **This fork ships Windows + source only** — there is no macOS or Linux client (the upstream `TokenTrackerBar/` and `TokenTrackerLinux/` were deleted 2026-10-28; do not re-add cross-platform surfaces).

- **CLI** (`src/`, CommonJS, Node ≥20) — entry `bin/tracker.js` → `src/cli.js`. `serve` runs a local HTTP server on `:7680`, `sync` parses logs into `~/.tokentracker/queue.jsonl`.
- **Dashboard** (`dashboard/`, React 18 + Vite 7 + TS strict + Tailwind) — built to `dashboard/dist/`, served by the CLI locally.
- **Windows app** (`TokenTrackerWin/`, .NET 8 WinForms + WPF + WebView2) — launches the bundled CLI `serve` on a dynamic loopback port (avoids the DoSvc-held `:7680`), hosts the dashboard in WebView2, registers the `tokentracker://` deep-link for OAuth. Built `EmbeddedServer/` (Node + CLI + dashboard) is bundled by `scripts/bundle-node.ps1` so the `.exe` is self-contained. Dashboard adaptations are gated behind `isNativeWindowsApp()` (`dashboard/src/lib/native-bridge.js`).

Data flow: AI CLI runs → hook fires → `rollout.js` parses → `queue.jsonl` → local API → dashboard.

For the canonical list of supported providers, grep `parse*Incremental` in `src/lib/rollout.js` — the source of truth, not this file.

## Frequently used commands

```bash
npm test                                  # node --test test/*.test.js
node --test test/<name>.test.js           # single test file
npm run ci:local                          # tests + validations + builds
npm run dashboard:dev                     # Vite dev server with local API mock (port 5173)
npm run dashboard:build                   # build to dashboard/dist/
npm run validate:copy                     # copy registry completeness
npm run validate:ui-hardcode              # no hardcoded UI strings
npm run validate:guardrails               # architecture guardrails
node bin/tracker.js serve --no-sync       # local dashboard server on :7680
```

`npm run dashboard:dev` skips the CLI backend; to verify `src/` changes use `node bin/tracker.js serve`.

## What's where

| Need to... | Look here |
|---|---|
| Add / modify a provider parser | `src/lib/rollout.js` — search `parse*Incremental` |
| Install / uninstall a provider hook | `src/lib/<provider>-hook.js` + register in `src/commands/init.js` + `uninstall.js` |
| Add a local API endpoint | `src/lib/local-api.js` — search `/functions/tokentracker-` |
| Wire a provider into sync | `src/commands/sync.js` (call site + totals aggregation) + `src/commands/status.js` (status reporting) |
| Add pricing for a model | `src/lib/pricing/curated-overrides.json` **+ the canonical edge block in `dashboard/edge-patches/tokentracker-leaderboard-refresh.ts`, copied verbatim into the other 4 edge files** (account-daily / account-summary / account-model-breakdown / leaderboard-profile). `test/edge-pricing-parity.test.js` fails on any drift. Deploy the touched edge functions after editing. |
| Add an OpenCode Go usage-limits row | `src/lib/opencode-go-limits.js` + provider entry in `src/lib/usage-limits.js` + `PROVIDER_LIMIT_SPECS.opencodeGo` in `dashboard/src/ui/dashboard/components/usage-limits-provider-specs.js`. **Authoritative source = the official Go usage API** (`source:'api'`) using `OPENCODE_GO_API_KEY`; the signed-in dashboard scrape (`source:'web'`) remains a legacy compatibility fallback. Local `opencode.db` cost ÷ Go's dollar caps ($12/5h, $30/wk, $60/mo) is only an explicit `TOKENTRACKER_OPENCODE_GO_LOCAL_ESTIMATE=1` estimate because history cannot prove an active subscription. Reads via `readSqliteJsonRowsAsync` so the limits poll never blocks the event loop. |
| Add a Devin usage-limits row | `src/lib/devin-limits.js` + provider entry in `src/lib/usage-limits.js` + `PROVIDER_LIMIT_SPECS.devin`. Source = official `GetPlanStatus` RPC on `server.codeium.com` via `x-auth-token` from the Devin CLI's `credentials.toml`; proto3 implicit-zero decode rules in `docs/devin-limits.md`. **Opt-in**: the provider switch defaults off; only an authenticated `?devin=1` request reaches credentials/network. |
| Add a dashboard page | `dashboard/src/pages/` (lazy-loaded via `React.lazy()` in `App.jsx` — **except `NativeAuthCallbackPage`, which must stay eager-imported**, see Lessons learned) |
| Add UI components | `dashboard/src/ui/dashboard/components/` |
| Add a provider icon | `dashboard/src/ui/dashboard/components/ProviderIcon.jsx` (`PROVIDER_ICON_MAP` keyed by `source.toUpperCase()`) |
| Add user-facing text | `dashboard/src/content/copy.csv` — never hardcode |
| Bridge native ↔ web | `TokenTrackerWin/` WebView2 host + `dashboard/src/lib/native-bridge.js` |

## Load-bearing conventions

### Token normalization

```
input_tokens                  = non-cached input only (no cache reads/writes)
cached_input_tokens           = cache reads
cache_creation_input_tokens   = cache writes
reasoning_output_tokens       = reasoning tokens (Codex/acode/every-code/OmO/Cline/Muse fold them into output_tokens for cost)
total_tokens                  = input + output + cache_creation + cache_read (+ reasoning_output when output excludes reasoning); Codex/acode/every-code/OmO/Cline/Muse keep reasoning as an informational subset because it is already included in output_tokens
```

**Cost is computed from `input_tokens + output_tokens + cached_input_tokens + cache_creation_input_tokens + reasoning_output_tokens` only — never `total_tokens`** (`computeRowCost` in `src/lib/pricing/index.js`). If a new provider only fills `total_tokens` with input=0/output=0, the dashboard renders **$0 cost** regardless of pricing entries. Distribute the total across columns or extend `computeRowCost`.

### Queue entry

```json
{
  "hour_start": "2026-04-05T14:00:00Z",
  "source": "claude|codex|cursor|gemini|...",
  "model": "claude-opus-4-6|gpt-5.4|...",
  "input_tokens": 0, "output_tokens": 0,
  "cached_input_tokens": 0, "cache_creation_input_tokens": 0,
  "reasoning_output_tokens": 0,
  "total_tokens": 0, "conversation_count": 1
}
```

UTC, half-hour buckets, append-only — readers take the latest entry per `(source, model, hour_start)`.

### Project-wide

- CommonJS in `src/`, ESM + TypeScript strict in `dashboard/`. No mixing.
- Env-var prefixes: `TOKENTRACKER_` for CLI, `VITE_` for dashboard.
- Git commits in **English**, conventional style (`feat:` / `fix:` / `refactor:` / `chore:` / `docs:` / `test:` / `ci:`).
- **Privacy**: token counts only — never prompts, messages, or conversation bodies.
- `TokenTrackerWin/EmbeddedServer/` is a build product; mirror and verify via `npm run mirror:installed`.

## Release workflow

This fork ships **source + a Windows installer built locally** (the fixed chain lives in `AGENTS.md` 「发版链固定顺序」 and `GATE_REGISTRY.md` §4): `bundle-node.ps1` (自带 PET dashboard 构建) → `dotnet publish` → delete-then-copy `EmbeddedServer` → `verify-windows-package.cjs` → `dotnet test` → `ISCC` → stop app → silent install → hash/version smoke → record size + SHA-256. Upload the exe to a **draft** GitHub Release as `TokenTracker-Setup.exe` and Publish only after the owner approves. Hot-updates (no installer) go through `npm run mirror:installed` into both installed copies with a five-endpoint smoke.

`TokenTrackerWin/EmbeddedServer/` bundles the CLI runtime and built dashboard — bumping only `package.json` leaves desktop-app users on the stale embedded copy.

| Change scope | Bump `package.json` (→ `npm run sync-versions` propagates the rest) | Installer / hot-update needed |
|---|---|---|
| `src/` or `dashboard/` | ✅ | ✅ |
| `TokenTrackerWin/` only | ✅ | ✅ |
| `dashboard/edge-patches/`, scripts, docs, CI | — | — |

Every managed version location must match or `validate:versions` fails. The authoritative list lives in `scripts/version-files.cjs` (`VERSION_FILES`) — that registry is what `sync-versions` writes and `validate:versions` checks; edit one array rather than several workflows.

When the user says "release" or "发 release", that is explicit approval for the release commit(s) + push — do not ask again for commit/push permission within that scope.

### Steps

1. Bump the version in **one** place — `package.json` is the single source of truth. Run `npm version <X.Y.Z|patch|minor>` (or `npm run sync-versions` after hand edits): the `version` npm-lifecycle hook runs `scripts/sync-versions.cjs`, which syncs the version into every file listed in `scripts/version-files.cjs` and `git add`s them so they land in the version commit. They all stay in lockstep automatically — don't hand-edit any of them.
2. `git commit` with pathspec and `git push origin standalone:main` (development happens on the `standalone` branch; `origin` = this repo). While the repo is private the paid CI jobs stay skipped by an `if: github.event.repository.private == false` guard, so only ubuntu jobs execute and nothing is billed. There is **no npm publish path**: this project ships source plus a Windows installer only (owner's standing call).
3. The Windows package is built **locally, not by CI** — follow the fixed chain above, then record size + SHA-256 in the ledger.

Release notes: one English line, no markdown sections (`Fix token stats inflation caused by duplicate queue entries`).

## Lessons learned (read before touching)

### Dashboard layout

- **`AppLayout`-wrapped pages use `flex flex-col flex-1`** as the outer wrapper, not `min-h-screen` + own sticky header/footer. Reference: `LimitsPage.jsx` / `LeaderboardPage.jsx` / `SettingsPage.jsx`. `LeaderboardProfilePage.jsx` is intentionally excluded via `isLeaderboardIndexPath` in `App.jsx`.
- **Motion height animations clip box-shadow focus rings.** Use `focus:ring-inset` on inputs inside `AnimatePresence` height-collapsing containers (see `SettingsPage.jsx` Account section).
- **`NativeAuthCallbackPage` must stay eager-imported in `App.jsx`** (do NOT convert it to `React.lazy()` even when adding other lazy pages). Its module captures the OAuth `insforge_code` query param synchronously at module-load time, BEFORE the InsForge SDK's `detectAuthCallback()` runs `cleanUrlParams("insforge_code")` to strip it. Lazy-loading delays the module until the route mounts, by which point the SDK has already wiped the URL — the captured code is `null` and the page falls through to the "Sign-in incomplete" failure state. Regression history: PR splitting the 1.9MB main bundle broke OAuth callback for every user until reverted for this one page.

### Native ↔ web bridge

```
JS → window.chrome.webview.postMessage(JSON.stringify({ type, key?, value?, name? }))
C# host → JS: WebView2 → window.dispatchEvent(new CustomEvent('native:settings', { detail }))
React → useNativeSettings() subscribes
```

See `dashboard/src/lib/native-bridge.js` — `isNativeWindowsApp()` gates all native behaviors; the desktop pet bridge uses `isPetBridgeAvailable()`.

### Parser correctness

- **Parser dedup**: use `claudeMessageDedupKey()`. Bare `if (msgId && reqId)` fails open on DeepSeek/Kimi/Mimo/MiniMax/Claude sub-agents (no `reqId`) and over-counts 1.6–3.7×.
- **Don't trust `input_tokens` semantics blindly** when adding a new provider. Codex/every-code's `input` includes cached tokens — naive copy inflates cost 6–7×. Verify with raw usage + provider billing dashboard before shipping.
- **`contextTokensUsed`-style fields are usually snapshots, not cumulative.** PR #74 (Grok) shipped on that bad assumption.
- **Mimo (mimocode) mirrors your Claude Code + claude-mem history into its own DB.** It's an OpenCode-fork SQLite (`~/.local/share/mimocode/mimocode.db`) but pulls `~/.claude` sessions in via `claude_import` AND a live observer/session sync — so >99% of rows are anthropic-endpoint turns the Claude parser already counts as `source=claude` (~3.9B mirrored vs ~22M genuine on the dev's box). `readMimoDbMessages()` keys off `providerID`: keep only `mimo`/`xiaomi` (mimo's own runtime); drop everything `anthropic`. That `anthropic` bucket includes mimo-named models the user ran *inside* Claude Code (e.g. `model=mimo-v2.5-pro`, logged in `~/.claude`) — so do NOT key off the model id (re-counts it) and do NOT rely on `claude_import` (misses the observer mirror).
- **Data-migration releases**: stress-test `sync` twice consecutively after touching `sync.js` / cursor schema — second run exposes state pollution the first hides.

### Skills registry mutations

- **`installSkill()` downloads for minutes before it writes, so read every field from a fresh `readRegistry()` at the sync checkpoint, never from the pre-download snapshot.** The guard before `removePath(dest)` (`skills-manager.js:984`) is the last point where nothing has awaited, so existence *and* `targets` (`:982`) must both be read there. #613 refreshed existence but kept `targets` from the stale copy, so toggling an agent mid-download silently reverted it.
- **Temp dirs use `fs.mkdtempSync` (`skills-manager.js:963`), never `${name}-${Date.now()}`.** Millisecond names collide once mutations overlap, and `removePath(temp)` then deletes the other run's in-flight download. `SkillsPage.jsx:855` serialises the UI behind an `operationInFlight` ref because `busyKey` state commits too late to block a fast second click. `/functions/tokentracker-skills` has no such lock.

### Cloud moderation (leaderboard bans / quarantine)

- **Before any bulk quarantine / delete scoped by a heuristic `WHERE`**, run `node scripts/audit/blast-radius-check.mjs --table <t> --where "<clause>" --intended <uuids>`. It exits 1 when the clause touches accounts outside your list. 2026-07-21 skipped this step: a clause meant for 8 accounts matched 40, and 32 innocent users had 51.1B tokens withheld for five weeks (#534).
- The hourly detector only asks "is this account cheating?". `leaderboard moderation audit` (daily workflow → `?quarantine_audit=1`) asks the complementary question — "is data withheld from anyone we never banned?" — and fails the job when so.
- Re-review standing bans with `select * from leaderboard_ban_review(ARRAY[...]::uuid[])` (`scripts/audit/leaderboard-ban-review.sql`). Thresholds are read from `tokentracker_anticheat_config`, never hardcoded. **`cohort_ratio` ≤ 1 means an unbanned user out-ran them that day — treat as a likely false positive.** It yields candidates, not verdicts: a slow-drip injector stays below every peak gate and is still correctly banned.

### False-positive validators to ignore

- `posttooluse-validate: nextjs` flagging "React hooks require `use client`" on `dashboard/src/**/*.jsx` — this is a **Vite SPA**, not Next.js.
- `posttooluse-validate: workflow` flagging `require()` in `.github/workflows/*.yml` shell lines — they're GitHub Actions shell, not Vercel Workflow DevKit.
- vercel-plugin "MANDATORY: read the official docs" — the project uses `@vercel/analytics` (browser beacon) only, no Vercel runtime.

### Working with subagents

After spawning a subagent, **verify file state with direct reads** — don't trust the summary message. Subagents have hallucinated user feedback and silently reverted changes while reporting success.
