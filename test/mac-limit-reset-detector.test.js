'use strict';
// WeeklyLimitResetDetector contract: the macOS reset celebration must fire only
// for windows that actually rolled over. Rolling windows (Claude 7d, Antigravity,
// OpenCode Go …) slide `reset_at` forward continuously while shedding their
// oldest usage piece by piece, so before the emptied-percent gate (2026-11-24)
// every shed piece ≥5 points fired a "额度已重置" toast — the owner got several
// per day on windows that never renewed ("明明还没到七天").
//
// Two layers:
// 1. source contract — the detector file stays dependency-free, keeps the
//    emptied-percent gate after the identity/drop guards, and the response
//    extensions live with the model in UsageLimits.swift;
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

test('detector keeps the identity → drop → emptied → cooldown guard order', () => {
  const swift = read(detectorRel);
  assert.match(swift, /var emptiedPercent: Double = 10/,
    'the emptied-window gate must exist with its documented default');
  const advance = swift.indexOf('curReset > prevReset + resetAdvanceTolerance');
  const drop = swift.indexOf('prevPercent - reading.usedPercent >= minDrop');
  const emptied = swift.indexOf('guard reading.usedPercent <= emptiedPercent else { continue }');
  const cooldown = swift.indexOf('now - last < cooldown');
  for (const [name, at] of [['advance', advance], ['drop', drop], ['emptied', emptied], ['cooldown', cooldown]]) {
    assert.ok(at !== -1, `guard "${name}" must stay in evaluate()`);
  }
  assert.ok(advance < drop && drop < emptied && emptied < cooldown,
    'guards must run identity jump → real drop → near-empty window → cooldown');
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
    // … and the genuine rollover afterwards still fires: usage fully drains.
    r = detector.evaluate(readings: [reading("antigravity", "antigravity.primary", "Claude 7d", 3, T + 8 * day)],
                          snapshot: snap, now: T + 8 * day)
    check("drain to near-empty fires once", r.events.count == 1 && r.events[0].windowLabel == "Claude 7d")
}

// 2. Fixed-schedule weekly window: reset lands at ~0% → celebrates.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("zcode", "zcode.bucket.wk", "Weekly", 95, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("zcode", "zcode.bucket.wk", "Weekly", 0, T + 7 * day)],
                          snapshot: snap, now: T + 7 * day)
    check("fixed weekly boundary (95→0) fires", r.events.count == 1)
}

// 3. Sub-tolerance reset_at jitter never counts as a rollover.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("codex", "codex.primary", "5h", 40, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("codex", "codex.primary", "5h", 0, T + 30)],
                          snapshot: snap, now: T + 30)
    check("sub-tolerance reset advance never fires", r.events.isEmpty)
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
    check("undersized drop (8→4) never fires", r.events.isEmpty)
}

// 5. An idle window crossing a boundary (0→0) has nothing to celebrate.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("devin", "devin.secondary", "Weekly", 0, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("devin", "devin.secondary", "Weekly", 0, T + 7 * day)],
                          snapshot: snap, now: T + 7 * day)
    check("idle rollover (0→0) does not fire", r.events.isEmpty)
}

// 6. Readings without a reset timestamp never touch the baseline (existing rule).
do {
    let snap = WeeklyLimitResetDetector.Snapshot()
    let r = detector.evaluate(readings: [reading("claude", "claude.5h", "5h", 80, nil)],
                              snapshot: snap, now: T)
    check("nil resetAt records no baseline", r.events.isEmpty && r.snapshot.lastPercent["claude.5h"] == nil)
}

// 7. Cooldown suppresses an immediate repeat after a genuine fire.
do {
    var snap = WeeklyLimitResetDetector.Snapshot()
    var r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 95, T)],
                              snapshot: snap, now: T)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 3, T + 600)],
                          snapshot: snap, now: T + 600)
    check("genuine fire happened", r.events.count == 1)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 60, T + 1200)],
                          snapshot: snap, now: T + 1200)
    snap = r.snapshot
    r = detector.evaluate(readings: [reading("opencodeGo", "opencodeGo.primary", "5h", 2, T + 1800)],
                          snapshot: snap, now: T + 1800)
    check("cooldown suppresses refire within an hour", r.events.isEmpty)
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
