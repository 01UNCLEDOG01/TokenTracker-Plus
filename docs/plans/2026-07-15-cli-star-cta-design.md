# One-time CLI Star CTA

## Goal

Convert existing CLI users who have already received value from TokenTracker into GitHub stargazers without adding recurring noise, changing machine-readable output, or weakening the local-first product experience.

## Chosen approach

Show a short Star request after the local dashboard has successfully started in an interactive CLI. Persist a local `star-cta.json` marker before printing so the message appears at most once per machine. Reuse the same helper after `init` succeeds; when `serve` invokes first-time setup, the persisted marker prevents a duplicate prompt in the same run.

This reaches the primary `npx tokentracker-cli` path, unlike the previous CTA that only appeared after `init`. It is more focused than a permanent dashboard button and more visible than adding another line to `--help`.

## Eligibility and data flow

`src/lib/star-cta.js` owns eligibility, persistence, and rendering. It requires a TTY and the CLI shell, and skips Node tests, CI, native macOS/Windows shells, and `TOKENTRACKER_NO_STAR_PROMPT=1`. It reads only its own local state file and sends no network request.

After `cmdServe` has bound a working loopback port and optionally opened the browser, it calls `maybeShowStarCta({ trackerDir })`. The helper checks eligibility and prior state, writes the timestamp and current version atomically, then prints the GitHub URL. If state persistence fails, it stays silent so read-only installations are never prompted on every launch.

## Error handling and verification

The CTA cannot fail dashboard startup. Missing or invalid state is treated as not yet shown; state-write failure is a silent no-op. Unit tests cover first display, repeat suppression, automation/native exclusions, explicit opt-out, and write failure. Discovery metadata tests also lock the CLI onboarding list to the public count of 27 integrations, including Droid and AnythingLLM Desktop.

The release gate is `npm run ci:local`, which covers the full Node suite, copy and architecture validation, and the production dashboard build.
