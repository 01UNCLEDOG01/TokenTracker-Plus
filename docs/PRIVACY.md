# Privacy Policy

_Last updated: 2026-11-11 · Applies to TokenTracker Plus: the Windows and macOS desktop apps, the CLI, and the bundled dashboard._

This build ships **no first-party cloud service**. There is no TokenTracker-operated backend, account system, or leaderboard server, and no shared key is bundled. Cloud-only features are inactive unless you explicitly configure your own compatible instance (`--base-url` with your own public anon key, or `TOKENTRACKER_INSFORGE_BASE_URL`). Local usage works offline. Provider quota reads, public model rankings, service-status pages and other optional requests below can still use the network without a cloud account.

TokenTracker reads the local logs that AI coding tools already write to your disk, and turns them into token counts and cost estimates. It is local-first: the dashboard, the parsers and the database all run on your machine.

There is no paid Cloud tier: this build ships no checkout, order or payment flow, and Cloud history retention is inactive unless you operate your own instance.

This document lists **every** network request the software can make, what each one sends, and how to switch it off. If you find a request that is not listed here, that is a bug — please [open an issue](https://github.com/01UNCLEDOG01/TokenTracker-Plus/issues).

---

## 1. What never leaves your machine

TokenTracker's parsers extract numbers and timestamps only. The TRAE CN cloud usage read is a narrow exception to the local-only source model, and it is off by default: only when you explicitly set `TOKENTRACKER_TRAE_CN_USAGE=1`, during an eligible non-background sync, when local TRAE CN auth exists, does TokenTracker transmit the existing sign-in authorization from the locally signed-in app to TRAE's internal API for a read-only usage request. Without that variable nothing is ever sent. It is not an unconditional or default generic network request. That authorization is never persisted or logged. Local TRAE CN database collection is independent of this flag: background refresh reads projected usage metadata from the on-device database and WAL without sending the TRAE sign-in authorization.

Windows TRAE reads take brief shared locks on the existing WAL shared-memory file to defer checkpoint/reset while reading. Database, WAL and shared-memory contents are not modified by the reader. TRAE CN retains only hashed local turn identities and normalized token contributions so delayed or corrected usage can be reconciled. Legacy migration reads retained cloud observations from the local queue; it does not authorize or perform a cloud request.

**Never retained as usage data or uploaded to TokenTracker:**

- **Prompts, responses, and conversation bodies** — TokenTracker may parse local tool files containing conversation records to extract usage metrics, but prompt and response texts are never persisted, collected, or transmitted
- **File contents** from your projects
- **Commit messages and diffs** — Git attribution runs `git log` locally, uses the subject line only to detect reverts, and keeps nothing
- **Provider credentials** are never uploaded to a TokenTracker-operated service. Locally configured keys/cookies can be stored in your user directory or `.env.local`; quota integrations send the required authorization only to the corresponding provider. Secret values must not be committed or exposed in dashboard bundles.

**Recorded locally, never uploaded:**

- **File paths, project names, and repository names.** The Projects view needs to know which repo a session belonged to, so `project.queue.jsonl` stores a project key and git remote URL, and `session.queue.jsonl` stores each session's working directory. Both files stay on your machine — they are excluded from cloud sync (see §4) and the Projects view is computed entirely locally. Set `TOKENTRACKER_DISABLE_GIT_ATTRIBUTION=1` to stop deriving them at all.

You can verify this in [`src/lib/rollout.js`](../src/lib/rollout.js): every `parse*Incremental` function emits only the queue row shapes described below.

---

## 2. What is stored locally

Everything lives under `~/.tokentracker/` (`%USERPROFILE%\.tokentracker\` on Windows):

| Path | Contents |
|---|---|
| `tracker/queue.jsonl` | Append-only hourly buckets: source, model, token counts, timestamp |
| `tracker/project.queue.jsonl` | The same hourly buckets, split per project: git remote URL and `owner/repo` key. Never uploaded |
| `tracker/session.queue.jsonl` | Per-session token totals and timing for the Sessions view, plus each session's working directory. Never uploaded |
| `tracker/cursors.json` | Compatibility read offsets; large active cursor state can reside in the versioned store below |
| `tracker/cursor-store-v2/` | Active cursor generations, including normalized usage contributions and project attribution; no conversation text |
| `tracker/config.json` | Your preferences |
| `tracker/*-usage-limits-cache.json` | Last successful quota reading per provider, so a timeout shows stale bars instead of an error |
| `pets/`, `skills/`, `cache/` | Desktop pet assets, skill index, misc caches |

To erase everything TokenTracker knows about you, delete that directory. `tokentracker uninstall` additionally removes the hooks it installed into your AI tools.

---

## 3. Network requests

### 3.1 Enabled by default

| Request | Destination | What is sent | Frequency |
|---|---|---|---|
| **Dashboard analytics** | `us.i.posthog.com` (PostHog) | Pageviews and explicitly instrumented feature events, plus which shell you use. Autocapture and session recording are **off**; browser Do-Not-Track is respected. | While the dashboard is open |
| **Provider quota reads** | The provider's own API (`api.anthropic.com`, `chatgpt.com`, `cursor.com`, `api.github.com`, `api.kimi.com`, `api.z.ai`, `qoder.com`, `qoder.com.cn`, `openapi.qoder.sh`, `openapi.qoder.com.cn`, `cloudcode-pa.googleapis.com`, …) | Whatever that provider's own endpoint requires, authenticated with the credentials **that provider already stored on your machine**. These requests go directly from your machine to the provider — they never pass through our servers, and we never see the response. | While quota bars are visible |
| **TRAE CN usage read** | TRAE's internal API | Transmits the existing sign-in authorization from the locally signed-in TRAE CN app to TRAE; reads usage metadata only. TokenTracker never persists or logs the auth token or prompt/response content. | Off unless you set `TOKENTRACKER_TRAE_CN_USAGE=1`; then during eligible non-background sync when local TRAE CN auth exists |
| **GitHub star count** | `api.github.com` | Nothing but the request itself (public repo metadata) | On dashboard load |
| **Pricing data refresh** | `raw.githubusercontent.com` | Nothing but the request itself (public model pricing JSON from BerriAI/litellm) | At most once every 24 hours when the local pricing cache is missing or stale |

Both telemetry items are disabled together by a single switch:

```bash
export TOKENTRACKER_NO_TELEMETRY=1     # or DO_NOT_TRACK=1
```

You can also set `"telemetry": false` in `~/.tokentracker/tracker/config.json`. On localhost and inside the desktop apps, the dashboard asks the local server for this preference before initialising analytics — and if the answer cannot be confirmed, analytics stays **off** (fail-closed).

Audit: [`src/lib/telemetry.js`](../src/lib/telemetry.js), [`dashboard/src/lib/analytics.js`](../dashboard/src/lib/analytics.js), [`src/lib/pricing/litellm-fetcher.js`](../src/lib/pricing/litellm-fetcher.js).

### 3.2 Only after you opt in or click something

| Request | Destination | What is sent | Trigger |
|---|---|---|---|
| **Devin quota read** | `server.codeium.com` (Devin's official `GetPlanStatus` RPC) | An empty JSON body, authenticated with the Devin CLI session token already stored on your machine. The token is never persisted or logged by TokenTracker. | Off by default — only while the Devin provider switch in Settings → Usage & Limits → Providers is on, and only on a locally authenticated request |
| **Anonymous heartbeat** | The cloud instance you configured | A one-way hash of the machine id, plus the app version, OS platform, and app shell (`cli` / `macos` / `windows` / `linux`) as separate plain fields. Nothing else. | At most once per day, and only while a cloud instance is configured |
| **Cloud sync / leaderboard** | The InsForge-compatible instance you configured | Hourly buckets only — see §4 | Signing in to an account on that instance |
| **Exchange rates** | `open.er-api.com` | Nothing but the request itself | Selecting a non-USD display currency |
| **Desktop pet download** | `codex-pets.net` | The pet id you chose | Importing a pet from a link |
| **IP check page** | `ip.net.coffee`, `claude.ai`, `1.1.1.1` | Your IP address is, by design, what these endpoints observe — that page exists to tell you how providers see your network | Opening the IP Check page |
| **Service status page** | Provider status pages (`status.claude.com`, `status.openai.com`, `status.cursor.com`, `status.opencode.ai`, …) | Nothing but the request itself; relayed by the local server | Opening the Service Status page |
| **Global model rankings** | Artificial Analysis and AIHOT public pages | Nothing but the request itself; fetched and cached locally | Opening the global model rankings; each source has an independent cache and snapshot fallback |
| **Upstream update check** | `api.github.com` | Nothing but the request itself | Only the manual Windows “Check upstream updates” action; no automatic download or installation |
| **Share card fonts** | `fonts.googleapis.com` | Standard web-font request; Google can see your IP address | Generating a share image |

### 3.3 Never

- No request contains prompt text, responses, file contents, paths, or project names.
- We operate no ad network, no data broker integration, and no cross-site tracking.
- We do not sell or rent your data. The service providers listed below process the information needed for the features you use, as described in this policy.

---

## 4. Cloud account and leaderboard

**This build operates no cloud service**, so by default there is nothing to sign in to: local history, achievements, sessions and every card are computed on your machine. If you point the app at an InsForge-compatible instance you control, the account features below become available on that instance, and it — not the TokenTracker authors — operates and stores them.

Signing in is **entirely optional**. Local history, local achievements and sessions work without an account. Account aggregation and public profiles require your configured cloud instance. A usage-scope badge identifies local/account reads; temporary read-only comparison is available only when signed in, sync is enabled and cloud reads are available. Selecting a comparison does not change upload preferences and resets on account changes or disabled sync.

**Sent when signed in:**

- Hourly usage buckets, containing token counters such as `hour_start`, `source`, `model`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `reasoning_output_tokens`, `total_tokens`, `conversation_count`, plus supported speed-tier counters
- A machine id at device-registration time, so usage from several computers can be merged into one account without double-counting
- The email address and display name from your OAuth provider (GitHub or Google)

**Not sent, ever:**

- Prompts, responses, file contents, project or repository names, file paths
- Local session records — `session.queue.jsonl` stays on your machine
- Per-project breakdowns — `project.queue.jsonl` is never uploaded
- Any provider credential

**Public visibility:** your profile appears on the public leaderboard only while `Settings → Account → Public profile` is on. Turning it off removes you from the leaderboard and turns badges into a "private" placeholder.

**Deleting cloud data:** use your own instance's account controls or contact its operator. This fork's maintainers do not operate that instance and cannot delete its rows. Local data is managed separately under `~/.tokentracker/`. Do not include account credentials or receipts in a public issue.

---

## 5. Third parties

| Service | Role | Their policy |
|---|---|---|
| InsForge | The backend software you may self-host for accounts, cloud sync and the leaderboard | [github.com/InsForge](https://github.com/InsForge) |
| PostHog | Anonymous product analytics | [posthog.com/privacy](https://posthog.com/privacy) |

| GitHub | Source hosting, releases, OAuth, star counts, upstream pricing data (`raw.githubusercontent.com`) | [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement) |
| Google | OAuth sign-in, fonts on share cards | [policies.google.com/privacy](https://policies.google.com/privacy) |

AI providers whose quota endpoints TokenTracker reads (Anthropic, OpenAI, Cursor, GitHub Copilot, Google, Moonshot, Z.ai, Qoder, Devin, …) are governed by their own policies. TokenTracker acts on your behalf with credentials already on your machine; it does not create any new relationship with them.

---

## 6. Turning things off

| Variable | Effect |
|---|---|
| `TOKENTRACKER_NO_TELEMETRY=1` | Disables the daily heartbeat **and** dashboard analytics |
| `DO_NOT_TRACK=1` | Same as above (respects the standard) |
| `TOKENTRACKER_DISABLE_GIT_ATTRIBUTION=1` | Stops TokenTracker running `git log` inside your project directories |

Signing out removes cloud sync. Not signing in means it never starts.

---

## 7. Children

TokenTracker is a developer tool and is not directed at children under 13. We do not knowingly collect personal information from children.

## 8. Changes

Material changes to this policy will be noted in the release notes and in the `Last updated` date above. The full history is in [this file's Git log](https://github.com/01UNCLEDOG01/TokenTracker-Plus/commits/main/docs/PRIVACY.md).

## 9. Contact

Questions or corrections: [this fork's issues](https://github.com/01UNCLEDOG01/TokenTracker-Plus/issues). Cloud data requests belong with your own instance's operator.
