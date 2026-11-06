# Antivirus false positives

A small number of Windows users running Kaspersky have reported its behavioral
engine flagging the tracker's Node service script — typically
`~\.tokentracker\tracker\app\bin\tracker.js` (or `~\.tokentracker-plus\...`
when `TOKENTRACKER_HOME` overrides the default root) — as
`PDM:Trojan.Win32.Generic`.

## What PDM means

PDM is Kaspersky's **behavioral** detection category, not a signature match: it
fires on what a process *does* (a script that spawns helpers, reads other
apps' local databases and credentials stores, writes cache files), not on what
it *is*. A local-first usage tracker does all of those things by design — it
reads the local session stores and quota endpoints of the AI CLIs it tracks.

## Treat reports as suspected false positives

Behavioral detections are vendor judgments. Treat every report as a
**suspected** false positive until the vendor says otherwise:

- Compare the SHA-256 of the quarantined file against the matching GitHub
  release asset before drawing any conclusion. A matching hash establishes
  release identity, **not** why a behavioral PDM alert fired — it supports the
  suspected-false-positive hypothesis, but does not substitute for vendor
  adjudication, and is not by itself a recommendation to restore the file or
  bypass the detection.
- File or refresh a Kaspersky false-positive report with the product version,
  the detection name, and the SHA-256.
- Until the vendor responds, follow your security admin's guidance — restore,
  reinstall from the official GitHub release (never a third-party mirror), or
  a narrowly scoped temporary exclusion.

## What the project does

- Windows installers and release binaries are published with SHA-256 hashes on
  the GitHub Releases page.
- Code signing remains on the roadmap; a signature reduces but does not
  eliminate behavioral detections.
- If your antivirus flags a file shipped by TokenTracker Plus, please open an
  issue with the detection name, the quarantined path, and the file's SHA-256.
