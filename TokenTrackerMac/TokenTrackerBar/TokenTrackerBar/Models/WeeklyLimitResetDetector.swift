import Foundation

extension Notification.Name {
    /// Posted when a usage-limit window rolls over after the user had been
    /// meaningfully constrained — the moment worth celebrating with confetti.
    /// `object` is the first `LimitResetEvent`.
    static let weeklyLimitReset = Notification.Name("WeeklyLimitReset")
}

/// One window that just reset after the user had climbed high in it.
struct LimitResetEvent: Equatable {
    let provider: String      // "claude", "codex", "cursor", …
    let windowKey: String     // e.g. "codex.primary"
    let windowLabel: String   // display name matching the popover row, e.g. "5h", "7d", "Gemini 5h"
    let previousPercent: Double
}

/// A candidate rollover awaiting confirmation by a later reading. The owner
/// ruled (2026-11-26) that "额度已重置" may only celebrate two situations: a
/// scheduled rollover whose time actually passed, or an official out-of-band
/// reset from the provider — never an inference from a single reading.
/// Persisted in the snapshot so a candidate survives relaunches.
struct PendingReset: Codable, Equatable {
    /// Unix seconds of the first qualifying (drop + near-empty) reading; the
    /// cooldown anchor for the eventual celebration.
    var since: Double
    /// The percent before the drop — the constrained baseline the toast reports.
    var prevPercent: Double
    /// The candidate's window deadline. Updated whenever later near-empty
    /// readings slide it (a draining rolling window, or a bogus response whose
    /// `reset_at` is "now + window" and never holds still).
    var resetAt: Double
    /// Unix seconds of the most recent near-empty reading; confirmation needs
    /// `confirmationGap` seconds after this, so two readings inside one refresh
    /// burst cannot confirm each other.
    var lastLowAt: Double
}

/// Detects when a usage-limit window "resets" (rolls over) *after* the user had
/// been meaningfully constrained. Mirrors the idea behind CodexBar's
/// weekly-limit-reset detector but generalized to any provider window.
///
/// The logic is pure and the memory lives in a persisted `Snapshot`, so it
/// survives relaunches and never double-fires (a cooldown suppresses repeats).
///
/// The owner ruled (2026-11-26) that "额度已重置" may only celebrate two
/// situations: a scheduled rollover whose time actually passed, or an official
/// out-of-band reset from the provider — never an inference from a single
/// reading. Two celebration paths implement that:
///
/// - **到点重置 caught live** — the recorded deadline passed within the last
///   poll interval and the reading shows the window renewed: celebrate
///   immediately (2026-11-27). The deadline itself is evidence a bogus response
///   cannot fabricate.
/// - **Confirmed candidate** — everything else (an out-of-band drain whose
///   deadline had not arrived, a boundary missed while the app slept): the
///   qualifying reading only records a `PendingReset`, and a later reading must
///   show the renewal *persisting* — window still near-empty and the new
///   deadline holding still. A scheduled rollover (or an official reset) fixes
///   the deadline and keeps the window empty; a transient bogus response
///   (2026-11-26: Antigravity intermittently returns all-zero windows with
///   `reset_at = now + window`; one such response fired three same-second toasts
///   on windows the owner had not had reset) is contradicted by the very next
///   poll, and a bogus response whose deadline is "now + window" slides every
///   poll so it never holds still.
struct WeeklyLimitResetDetector {

    /// A real rollover must drop usage by at least this much — a small floor that
    /// confirms the window actually emptied, and guards providers (e.g. Kiro) whose
    /// `reset_at` slides forward continuously instead of jumping only on rollover.
    /// Not a "used enough to celebrate" gate: any genuine reset fires.
    var minDrop: Double = 5
    /// The window's `reset_at` must advance by at least this much to count as a real
    /// rollover — filters sub-second jitter in provider timestamps. A true rollover
    /// jumps hours-to-days ahead, so this never suppresses a genuine reset. Also the
    /// deadline-stability tolerance: a confirmed renewal's deadline must not move
    /// more than this between the last two readings.
    var resetAdvanceTolerance: TimeInterval = 60
    /// A rollover is only worth celebrating when the window actually renewed: the
    /// usage left in it afterwards must be at most this percent. Fixed-schedule
    /// windows land at ~0% on reset, and a rolling window only gets here when its
    /// usage fully drained — that is the point: rolling windows (Claude 7d,
    /// Antigravity, OpenCode Go …) slide `reset_at` forward continuously and shed
    /// their oldest usage piece by piece, and a shed piece alone used to read as a
    /// "reset" (2026-11-24 owner report: daily "Claude 7d 额度已重置" toasts on
    /// windows that never renewed). Kept loose rather than 0 so a first post-reset
    /// poll that already shows a sliver of fresh usage still celebrates.
    var emptiedPercent: Double = 10
    /// A candidate is confirmed only by a near-empty reading at least this long
    /// after the previous one — regular polls sit 300s apart, so this only
    /// rejects confirmations attempted inside one refresh burst (a boundary wake
    /// followed seconds later by a scheduled tick, or two manual panel opens).
    var confirmationGap: TimeInterval = 120
    /// A qualifying reading that lands within this long after the recorded
    /// deadline counts as having *caught the scheduled rollover live* (the
    /// boundary passed between the previous poll and this one — one regular
    /// poll interval bounds it, and the boundary-wake refresh lands seconds
    /// after). The deadline itself is evidence no bogus response can fabricate
    /// (owner ruling 2026-11-27: a live-caught 到点重置 celebrates immediately),
    /// so this path skips the confirming poll. Readings that arrive later than
    /// this (the app slept through the boundary) or whose deadline had not yet
    /// arrived (an official out-of-band reset — indistinguishable from the
    /// 2026-11-26 all-zero Antigravity response in one reading) still go
    /// through the pending confirmation.
    var immediateFireWindow: TimeInterval = 300
    /// After firing for a key, suppress re-fires for this long.
    var cooldown: TimeInterval = 3600

    struct Snapshot: Codable, Equatable {
        var lastPercent: [String: Double] = [:]
        var lastEventAt: [String: Double] = [:]   // unix seconds
        var lastResetAt: [String: Double] = [:]   // unix seconds — last seen window reset_at
        var pendingReset: [String: PendingReset] = [:]

        init() {}

        /// Tolerate older persisted snapshots that predate `lastResetAt` or
        /// `pendingReset` (or any missing field) so an upgrade keeps the existing
        /// baseline + cooldown memory instead of discarding it.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            lastPercent = try c.decodeIfPresent([String: Double].self, forKey: .lastPercent) ?? [:]
            lastEventAt = try c.decodeIfPresent([String: Double].self, forKey: .lastEventAt) ?? [:]
            lastResetAt = try c.decodeIfPresent([String: Double].self, forKey: .lastResetAt) ?? [:]
            pendingReset = try c.decodeIfPresent([String: PendingReset].self, forKey: .pendingReset) ?? [:]
        }
    }

    /// Given the persisted snapshot and the current readings, return the events to
    /// celebrate plus the snapshot to persist for next time. The snapshot *is* the
    /// memory of the previous reading, so callers need not track the prior response.
    func evaluate(
        readings: [(provider: String, windowKey: String, windowLabel: String, usedPercent: Double, resetAt: Double?)],
        snapshot: Snapshot,
        now: Double
    ) -> (events: [LimitResetEvent], snapshot: Snapshot) {
        var updated = snapshot
        var events: [LimitResetEvent] = []

        for reading in readings {
            let key = reading.windowKey
            // A reading without a reset timestamp (e.g. Claude's 5h window sitting idle
            // after rollover reports 0% / null) carries no window identity, so it must
            // not touch the baseline: overwriting the percent with 0 here would make the
            // next real reading fail the minDrop check and silently lose the celebration.
            guard let curReset = reading.resetAt else { continue }
            let prevPercent = snapshot.lastPercent[key]
            let prevReset = snapshot.lastResetAt[key]
            updated.lastPercent[key] = reading.usedPercent
            updated.lastResetAt[key] = curReset

            // Need a full prior baseline (percent + reset time). First observation only
            // records a baseline — never celebrates.
            guard let prevPercent, let prevReset else { continue }

            // A candidate never fires on its own reading — see PendingReset.
            if var pending = snapshot.pendingReset[key] {
                if reading.usedPercent > emptiedPercent {
                    // Usage is back: the "reset" did not persist — a bogus reading
                    // (2026-11-26: one all-zero Antigravity response used to fire
                    // three same-second toasts here). Discard; the healed baseline
                    // re-qualifies on the next genuine drop.
                    updated.pendingReset[key] = nil
                } else if abs(curReset - pending.resetAt) <= resetAdvanceTolerance,
                          now - pending.lastLowAt >= confirmationGap {
                    // The renewal persisted: window still near-empty and the new
                    // deadline held still across polls — a scheduled rollover or an
                    // official reset. Celebrate, anchored at the candidate's birth.
                    updated.pendingReset[key] = nil
                    updated.lastEventAt[key] = pending.since
                    events.append(LimitResetEvent(
                        provider: reading.provider,
                        windowKey: key,
                        windowLabel: reading.windowLabel,
                        previousPercent: pending.prevPercent
                    ))
                } else {
                    // Still near-empty but not confirmable yet: either too soon
                    // after the previous reading (one refresh burst) or the
                    // deadline is sliding (a draining rolling window whose entries
                    // keep exiting, or a bogus response whose `reset_at` is
                    // "now + window" and therefore never holds still). Track the
                    // newest deadline and wait for it to hold still across the
                    // confirmation gap.
                    pending.resetAt = curReset
                    pending.lastLowAt = now
                    updated.pendingReset[key] = pending
                }
                continue
            }

            // The window must have actually rolled over: its reset_at advanced to a
            // new period, not merely a percentage that dipped.
            guard curReset > prevReset + resetAdvanceTolerance else { continue }
            // … and the rollover actually emptied the window (also guards Kiro's
            // continuously-sliding reset_at from firing without a real drop).
            guard prevPercent - reading.usedPercent >= minDrop else { continue }
            // … and the window must now be (near) empty. Rolling windows shed their
            // oldest usage piece by piece while `reset_at` slides forward, and a shed
            // piece alone satisfies both guards above — without this gate the
            // celebration fired every day on windows that never actually renewed.
            guard reading.usedPercent <= emptiedPercent else { continue }
            if let last = snapshot.lastEventAt[key], now - last < cooldown { continue }

            // A qualifying reading that caught the scheduled boundary live (the
            // recorded deadline passed within the last poll interval) is
            // time-anchored — no fabricated response can move the clock. Celebrate
            // immediately; everything else waits for the confirming poll.
            if now >= prevReset, now - prevReset <= immediateFireWindow {
                updated.lastEventAt[key] = now
                events.append(LimitResetEvent(
                    provider: reading.provider,
                    windowKey: key,
                    windowLabel: reading.windowLabel,
                    previousPercent: prevPercent
                ))
                continue
            }

            // Qualifying reading: record the candidate, celebrate only when a later
            // reading confirms the renewal persisted.
            updated.pendingReset[key] = PendingReset(
                since: now,
                prevPercent: prevPercent,
                resetAt: curReset,
                lastLowAt: now
            )
        }

        return (events, updated)
    }
}

// MARK: - Persistence + settings keys

extension WeeklyLimitResetDetector {
    static let snapshotKey = "WeeklyLimitResetSnapshot"
    static let toastEnabledKey = "LimitsToastOnResetEnabled"
    static let confettiEnabledKey = "LimitsConfettiOnResetEnabled"
    /// Reset information and its celebratory effect are separate opt-outs.
    static let toastEnabledDefault = true
    static let confettiEnabledDefault = true

    /// Whether the informative reset toast is enabled, honoring the shared default.
    static func toastEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: toastEnabledKey) as? Bool ?? toastEnabledDefault
    }

    /// Whether the celebration confetti is enabled, honoring the shared default.
    static func confettiEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: confettiEnabledKey) as? Bool ?? confettiEnabledDefault
    }

    static func loadSnapshot(_ defaults: UserDefaults = .standard) -> Snapshot {
        guard let data = defaults.data(forKey: snapshotKey),
              let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else {
            return Snapshot()
        }
        return snapshot
    }

    static func saveSnapshot(_ snapshot: Snapshot, _ defaults: UserDefaults = .standard) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        defaults.set(data, forKey: snapshotKey)
    }
}
