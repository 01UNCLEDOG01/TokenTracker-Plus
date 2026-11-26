'use strict';
// WeeklyLimitResetDetector contract: the macOS reset celebration must fire only
// for windows that actually rolled over.
//
// 2026-11-24: rolling windows (Claude 7d, Antigravity, OpenCode Go …) slide
// `reset_at` forward continuously while shedding their oldest usage piece by
// piece, so every shed piece ≥5 points fired a "额度已重置" toast — the owner
// got several per day on windows that never renewed ("明明还没到七天"). Fixed by
// the emptied-percent gate.
//
// 2026-11-26: Antigravity intermittently returns an all-zero response (every
// window 0% with reset_at = now + window) — the emptied gate cannot catch it
// because the bogus reading IS empty. One such response fired three same-second
// toasts (Claude 7d / Gemini 7d / Gemini 5h) on windows the owner had not had
// reset. Owner ruling: a celebration may only follow a real renewal — a
// scheduled rollover whose time actually passed, or an official out-of-band
// reset — never an inference from a single reading. Fixed by the pending
// confirmation gate: the qualifying reading only records a PendingReset, and a
// later reading must show the renewal persisting (window still near-empty, the
// new deadline holding still) before the toast fires. Real renewals fix the
// deadline and stay empty; bogus responses are contradicted by the next poll or
// slide their "now + window" deadline every poll so it never holds still.
//
// Two layers:
// 1. source contract — the detector file stays dependency-free, keeps the
//    guard order with candidate creation (never an immediate fire) after it,
//    and the response extensions live with the model in UsageLimits.swift;
// 2. behavioral harness — on a mac with Xcode, compile the real detector file
//    against a tiny main that replays the decision table (skipped elsewhere).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const detectorRel = 'TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Models/WeeklyLimitResetDetector.swift';
const modelRel = 'TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Models/UsageLimits.swift';
const confettiRel = 'TokenTrackerMac/TokenTrackerBar/TokenTrackerBar/Services/ScreenConfettiOverlayController.swift';

test('detector keeps the guard order and gates candidates behind confirmation', () => {
  const swift = read(detectorRel);
  assert.match(swift, /var emptiedPercent: Double = 10/,
    'the emptied-window gate must exist with its documented default');
  assert.match(swift, /var confirmationGap: TimeInterval = 120/,
    'the confirmation gap must exist so one refresh burst cannot self-confirm');
  assert.match(swift, /struct PendingReset: Codable, Equatable/,
    'candidates persist in the snapshot across relaunches');
  const advance = swift.indexOf('curReset > prevReset + resetAdvanceTolerance');
  const drop = swift.indexOf('prevPercent - reading.usedPercent >= minDrop');
  const emptied = swift.indexOf('guard reading.usedPercent <= emptiedPercent else { continue }');
  const cooldown = swift.indexOf('now - last < cooldown');
  for (const [name, at] of [['advance', advance], ['drop', drop], ['emptied', emptied], ['cooldown', cooldown]]) {
    assert.ok(at !== -1, `guard "${name}" must stay in evaluate()`);
  }
  assert.ok(advance < drop && drop < emptied && emptied < cooldown,
    'guards must run identity jump → real drop → near-empty window → cooldown');
  const candidate = swift.indexOf('updated.pendingReset[key] = PendingReset(');
  assert.ok(candidate > cooldown, 'a qualifying reading must record a candidate, never fire immediately');
  assert.match(swift, /reading\.usedPercent > emptiedPercent \{/,
    'a contradicting reading must discard the pending candidate');
});

test('detector file stays dependency-free so the behavior harness can compile it', () => {
  const swift = read(detectorRel);
  assert.doesNotMatch(swift, /extension UsageLimitsResponse/,
    'response extensions moved to UsageLimits.swift (2026-11-24)');
  assert.doesNotMatch(swift, /LimitsSettingsStore/,
    'icon catalog moved to ScreenConfettiOverlayController.swift (2026-11-24)');
  const model = read(modelRel);
  assert.match(model, /func limitWindowReadings\(\)/,
    'reading extraction must live with the model');
  assert.match(model, /func soonestCooldownExpiry\(\)/);
  assert.match(read(confettiRel), /enum LimitResetProviderIconCatalog/);
});

const swiftcAvailable = (() => {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('swiftc', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

test('detector decision table replays on the real source (swiftc)', { skip: swiftcAvailable ? false : 'needs macOS + Xcode swiftc' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-reset-detector-'));
  try {
    // The harness compiles the repo's detector file verbatim; main.swift asserts
    // the decision table against the exact rules documented in that file.
    const main = `
import Foundation

var failures: [String] = []
func check(_ name: String, _ cond: @autoclosure () -> Bool) {
    if !cond() { failures.append(name) }
}

func reading(_ provider: String, _ key: String, _ label: String,
             _ pct: Double, _ reset: Double?)
    -> (provider: String, windowKey: String, windowLabel: String, usedPercent: Double, resetAt: Double?) {
    (provider, key, label, pct, reset)
}

let day: Double = 86400
let poll: Double = 300          // regular limits poll interval (DashboardViewModel)
let T: Double = 1_000_000_000
let detector = WeeklyLimitResetDetector()

// 1. THE 2026-11-24 REGRESSION: a rolling 7d window sheds a piece of old usage
//    (45% → 33%) while reset_at slides forward — that is aging, not a reset.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 45, T)],
                              snapshot: snap, now: T)
    check("baseline observation never fires", r.events.isEmpty)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 33, T + day)],
                          snapshot: snap, now: T + day)
    check("rolling shed piece (45→33, reset +1d) must NOT fire", r.events.isEmpty)
    snap = r.snapshot
    // … and the genuine full drain afterwards still fires — but only after a
    // later reading confirms the renewal persisted (candidate → confirm).
    r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 3, T + 8 * day)],
                          snapshot: snap, now: T + 8 * day)
    check("drain reading only records a candidate", r.events.isEmpty && r.snapshot.pendingReset["antigravity.primary"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 3, T + 8 * day)],
                          snapshot: snap, now: T + 8 * day + poll)
    check("confirmed drain fires once with the pre-drop percent",
          r.events.count == 1 && r.events[0].windowLabel == "Claude 7d" && r.events[0].previousPercent == 33)
}

// 2. Fixed-schedule weekly window: reset lands at ~0% → celebrates on confirmation.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("zcode", "zcode.bucket.wk", "Weekly", 95, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("zcode", "zcode.bucket.wk", "Weekly", 0, T + 7 * day)],
                          snapshot: snap, now: T + 7 * day)
    check("boundary reading records a candidate, no fire yet", r.events.isEmpty)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("zcode", "zcode.bucket.wk", "Weekly", 0, T + 7 * day)],
                          snapshot: snap, now: T + 7 * day + poll)
    check("fixed weekly boundary (95→0) fires on confirmation", r.events.count == 1)
}

// 3. Sub-tolerance reset_at jitter never counts as a rollover.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("codex", "codex.primary", "5h", 40, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("codex", "codex.primary", "5h", 0, T + 30)],
                          snapshot: snap, now: T + 30)
    check("sub-tolerance reset advance never fires", r.events.isEmpty && r.snapshot.pendingReset.isEmpty)
}

// 4. A small dip that never empties the window stays silent even with a big
//    reset jump (the drop guard alone would let 8→4 through).
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("kiro", "kiro.primary", "Month", 8, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("kiro", "kiro.primary", "Month", 4, T + 7 * day)],
                          snapshot: snap, now: T + 7 * day)
    check("undersized drop (8→4) never fires", r.events.isEmpty && r.snapshot.pendingReset.isEmpty)
}

// 5. An idle window crossing a boundary (0→0) has nothing to celebrate.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("devin", "devin.secondary", "Weekly", 0, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("devin", "devin.secondary", "Weekly", 0, T + 7 * day)],
                          snapshot: snap, now: T + 7 * day)
    check("idle rollover (0→0) does not fire", r.events.isEmpty && r.snapshot.pendingReset.isEmpty)
}

// 6. Readings without a reset timestamp never touch the baseline (existing rule).
do {
    let snap = WeeklyLimitResetDetector.Snapshot()
    let r = detector.evaluate(readings: [reading("claude", "claude.5h", "5h", 80, nil)],
                              snapshot: snap, now: T)
    check("nil resetAt records no baseline", r.events.isEmpty && r.snapshot.lastPercent["claude.5h"] == nil)
}

// 7. Cooldown suppresses a repeat candidate within an hour of a genuine fire.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 95, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 3, T + 600)],
                          snapshot: snap, now: T + 600)
    check("candidate recorded", r.events.isEmpty && r.snapshot.pendingReset["opencodeGo.primary"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 3, T + 600)],
                          snapshot: snap, now: T + 600 + poll)
    check("genuine fire happened on confirmation", r.events.count == 1)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 60, T + 1200)],
                          snapshot: snap, now: T + 1200)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 2, T + 1800)],
                          snapshot: snap, now: T + 1800)
    check("cooldown suppresses re-candidate within an hour",
          r.events.isEmpty && r.snapshot.pendingReset["opencodeGo.primary"] == nil)
}

// 8. THE 2026-11-26 REGRESSION: one bogus all-zero response (every window 0%
//    with reset_at = now + window) must never fire — the next real poll shows
//    usage back high, contradicting the candidate.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 85, T + 5 * day)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    // Bogus response: usage 0, deadline "now + window".
    r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 0, T + 300 + 7 * day)],
                          snapshot: snap, now: T + 300)
    check("bogus zero only records a candidate", r.events.isEmpty && r.snapshot.pendingReset["antigravity.primary"] != nil)
    snap = r.snapshot
    // Real data resumes: usage back high — candidate discarded, baseline healed.
    r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 85, T + 5 * day + 600)],
                          snapshot: snap, now: T + 600)
    check("contradicted candidate never fires and heals the baseline",
          r.events.isEmpty && r.snapshot.pendingReset.isEmpty && r.snapshot.lastPercent["antigravity.primary"] == 85)
}

// 8b. Consecutive bogus zeros: each response's reset_at is "that response's
//     now + window", so the deadline slides every poll and never holds still —
//     no confirmation, no fire, however long the hiccup lasts.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 85, T + 5 * day)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    var fired = false
    for step in 1...4 {
        r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 0, T + Double(step) * poll + 7 * day)],
                              snapshot: snap, now: T + Double(step) * poll)
        if !r.events.isEmpty { fired = true }
        snap = r.snapshot
    }
    check("sliding bogus deadline never confirms", !fired && snap.pendingReset["antigravity.primary"] != nil)
}

// 9. Official out-of-band reset: the deadline jumps to a new fixed time before
//    the scheduled one arrived and the window empties — celebrates once the
//    renewal persists; contradicted variant stays silent.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("claude", "claude.7d", "7d", 95, T + 6 * day)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.7d", "7d", 2, T + 8 * day)],
                          snapshot: snap, now: T + 300)
    check("official reset records a candidate", r.events.isEmpty && r.snapshot.pendingReset["claude.7d"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.7d", "7d", 2, T + 8 * day)],
                          snapshot: snap, now: T + 300 + poll)
    check("official reset fires on confirmation (prev percent kept)",
          r.events.count == 1 && r.events[0].previousPercent == 95)
}
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("claude", "claude.7d", "7d", 95, T + 6 * day)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.7d", "7d", 2, T + 8 * day)],
                          snapshot: snap, now: T + 300)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.7d", "7d", 90, T + 8 * day)],
                          snapshot: snap, now: T + 300 + poll)
    check("usage back high after a candidate means no celebration", r.events.isEmpty && r.snapshot.pendingReset.isEmpty)
}

// 10. A candidate survives a nil-resetAt interlude (Claude's idle 5h window
//     reports null between real readings) and still confirms afterwards.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("claude", "claude.5h", "5h", 95, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.5h", "5h", 3, T + 300)],
                          snapshot: snap, now: T + 300)
    check("candidate recorded before the interlude", r.snapshot.pendingReset["claude.5h"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.5h", "5h", 80, nil)],
                          snapshot: snap, now: T + 450)
    check("nil reading leaves the candidate untouched", r.events.isEmpty && r.snapshot.pendingReset["claude.5h"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("claude", "claude.5h", "5h", 3, T + 300)],
                          snapshot: snap, now: T + 900)
    check("confirmation after the interlude fires", r.events.count == 1)
}

// 11. Two readings inside one refresh burst (a boundary wake followed by a
//     scheduled tick, or two quick panel opens) cannot confirm each other: a
//     low reading inside confirmationGap only refreshes the candidate.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("gemini", "gemini.primary", "Pro", 80, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("gemini", "gemini.primary", "Pro", 0, T + 300)],
                          snapshot: snap, now: T + 300)
    check("candidate recorded", r.snapshot.pendingReset["gemini.primary"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("gemini", "gemini.primary", "Pro", 0, T + 300)],
                          snapshot: snap, now: T + 350)
    check("burst reading inside the gap does not confirm",
          r.events.isEmpty && r.snapshot.pendingReset["gemini.primary"] != nil)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("gemini", "gemini.primary", "Pro", 0, T + 300)],
                          snapshot: snap, now: T + 650)
    check("confirmation after the gap fires", r.events.count == 1)
}

if failures.isEmpty {
    print("ALL OK")
} else {
    for f in failures { print("FAIL: \\(f)") }
    exit(1)
}
`;
    fs.writeFileSync(path.join(dir, 'main.swift'), main, 'utf8');
    const bin = path.join(dir, 'detector-test');
    execFileSync('swiftc', [
      '-o', bin,
      path.join(root, detectorRel),
      path.join(dir, 'main.swift'),
    ], { stdio: 'pipe', timeout: 180_000 });
    const out = execFileSync(bin, { encoding: 'utf8', timeout: 30_000 });
    assert.match(out, /ALL OK/);
  } finally {
    fs.rmSync(dir, { recursive: true, maxRetries: 3 });
  }
});
