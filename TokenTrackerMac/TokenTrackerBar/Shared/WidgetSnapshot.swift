import Foundation

// Lightweight, self-contained data model used by the desktop widgets.
//
// The main app produces this snapshot from `DashboardViewModel` after every
// refresh and writes it to a shared App Group container. The widget extension
// reads it from the same container, so widgets keep working even when the menu
// bar app is not currently running (they just show the last known data).
//
// Keep this file purely Foundation — no SwiftUI/AppKit/WidgetKit imports — so
// it can be compiled into both the main app target and the widget extension.

// MARK: - App Group constants

public enum WidgetSharedConstants {
    /// Shared App Group identifier, kept only for a future signed build. This
    /// fork ships ad-hoc signed without a provisioning profile, so the App
    /// Group container is never provisioned and `containerURL(forSecurityApplicationGroupIdentifier:)`
    /// returns nil. The widget therefore reads the host-written fallback file
    /// from its own sandbox container (see `widgetContainerSnapshotURL()`).
    public static let appGroupIdentifier = "group.com.tokentrackerplus.mac"

    /// Bundle identifier of the widget extension. Used by the host app to
    /// write snapshot files directly into the widget's sandbox container as
    /// a fallback path for ad-hoc / dev signed builds where the App Group
    /// container is not actually provisioned by the system. Must stay in sync
    /// with the TokenTrackerWidget target's PRODUCT_BUNDLE_IDENTIFIER — a
    /// mismatch silently makes widgets read an empty container ("no data").
    public static let widgetBundleIdentifier = "com.tokentrackerplus.mac.widget"

    /// Filename of the snapshot inside the App Group container.
    public static let snapshotFilename = "widget-snapshot.json"

    /// Schema version — bump when the wire format changes incompatibly.
    /// v3 (2026-11-12): adds the format block so widgets render the user's
    /// token units (万/亿) and currency instead of a hardcoded K/M/B + "$".
    /// Readers stay tolerant: a v2 snapshot (no format) still decodes and
    /// falls back to english/USD, so a stale file never blanks the widget.
    public static let snapshotSchemaVersion = 3
}

// MARK: - Format preferences

/// The user's formatting preferences, snapshotted with the data.
///
/// The widget extension is sandboxed and runs in its own container, so it can
/// never read the app's UserDefaults. The host therefore ships these four
/// values inside every snapshot, and the widget formats with them.
///
/// The formatter below must stay byte-identical in behaviour to
/// TokenFormatter.formatCompact / formatChinese / formatCost in the main app
/// (Utilities/TokenFormatter.swift): the menu bar and the widgets show the same
/// numbers, so a divergence reads as a bug to the user.
public struct WidgetFormatSettings: Codable, Equatable {
    /// "chinese" selects the 万/亿 scale; anything else uses K/M/B.
    public var tokenUnitSystem: String
    /// Currency code pushed by the dashboard (CNY, USD, EUR, …) — informational.
    public var currencyCode: String
    /// Rendered symbol (¥, $, €, …).
    public var currencySymbol: String
    /// USD -> currency multiplicand (1.0 = USD).
    public var exchangeRate: Double

    public init(
        tokenUnitSystem: String = "english",
        currencyCode: String = "USD",
        currencySymbol: String = "$",
        exchangeRate: Double = 1.0
    ) {
        self.tokenUnitSystem = tokenUnitSystem
        self.currencyCode = currencyCode
        self.currencySymbol = currencySymbol
        self.exchangeRate = exchangeRate.isFinite && exchangeRate > 0 ? exchangeRate : 1.0
    }

    /// Defaults for previews and for schema-2 snapshots without a format block.
    public static let defaults = WidgetFormatSettings()

    // MARK: Tokens

    /// Compact token count. Mirrors TokenFormatter.formatCompact exactly.
    public func tokens(_ value: Int) -> String {
        if tokenUnitSystem == "chinese" { return Self.chineseTokens(value) }
        return Self.englishTokens(value)
    }

    static func englishTokens(_ value: Int) -> String {
        let absValue = abs(value)
        let sign = value < 0 ? "-" : ""
        switch absValue {
        case 1_000_000_000...:
            return "\(sign)\(String(format: "%.1f", Double(absValue) / 1_000_000_000.0))B"
        case 1_000_000...:
            return "\(sign)\(String(format: "%.1f", Double(absValue) / 1_000_000.0))M"
        case 1_000...:
            return "\(sign)\(String(format: "%.1f", Double(absValue) / 1_000.0))K"
        default:
            return "\(value)"
        }
    }

    /// Mirrors TokenFormatter.formatChinese (itself a mirror of the
    /// dashboard's formatChineseNumber): exact digits below 1万, one decimal
    /// with a trailing ".0" dropped, and a carry into the next unit when
    /// rounding reaches 10000 (99999999 -> "1亿", not "10000万").
    static func chineseTokens(_ value: Int) -> String {
        let sign = value < 0 ? "-" : ""
        let absValue = Double(value.magnitude)
        if absValue < 10_000 { return "\(sign)\(value.magnitude)" }

        func rounded(_ v: Double) -> Double { (v * 10).rounded() / 10 }
        func text(_ v: Double, _ unit: String) -> String {
            var digits = String(format: "%.1f", rounded(v))
            if digits.hasSuffix(".0") { digits.removeLast(2) }
            return "\(sign)\(digits)\(unit)"
        }

        if absValue >= 1e12 { return text(absValue / 1e12, "万亿") }
        if absValue >= 1e8 {
            let yi = rounded(absValue / 1e8)
            return yi >= 10_000 ? text(yi / 10_000, "万亿") : text(yi, "亿")
        }
        let wan = rounded(absValue / 1e4)
        return wan >= 10_000 ? text(wan / 1e4, "亿") : text(wan, "万")
    }

    // MARK: Cost

    private static let costFormatter: NumberFormatter = {
        let fmt = NumberFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.numberStyle = .decimal
        fmt.usesGroupingSeparator = true
        fmt.minimumFractionDigits = 2
        fmt.maximumFractionDigits = 2
        return fmt
    }()

    /// Renders a USD amount in the user's currency. Mirrors
    /// TokenFormatter.formatCost: multiply by the exchange rate, then a grouped
    /// decimal with exactly two fraction digits ("¥19.26", "$1,234.56").
    public func cost(usd: Double) -> String {
        let converted = usd * exchangeRate
        let number = Self.costFormatter.string(from: NSNumber(value: converted))
            ?? String(format: "%.2f", converted)
        return "\(currencySymbol)\(number)"
    }
}

// MARK: - Snapshot

public struct WidgetSnapshot: Codable, Equatable {
    public var schemaVersion: Int
    public var generatedAt: Date
    public var serverOnline: Bool

    public var today: PeriodTotals
    public var last7d: PeriodTotals
    public var last30d: PeriodTotals
    /// All-time total across every day the user has tracked. Populated from
    /// the dashboard's "Total" range so widgets can show the lifetime number
    /// alongside the all-time active-days count on the heatmap.
    public var total: PeriodTotals
    /// Whatever period the dashboard is currently showing (week / month / total)
    public var selected: PeriodTotals

    /// 30 most recent days, oldest first. Used by the trend chart widget and
    /// the small sparkline on the summary widget.
    public var dailyTrend: [DailyPoint]

    /// Top 5 models across the selected period (matches main app behaviour).
    public var topModels: [SnapshotModelEntry]

    /// Per-source roll-up (claude / codex / cursor / ...).
    public var sources: [SnapshotSourceEntry]

    /// Compressed activity heatmap. Outer array = weeks (oldest first). Inner
    /// array length is always 7 (Sun..Sat).
    public var heatmap: HeatmapPayload

    /// Per-provider rate-limit windows.
    public var limits: [LimitProvider]

    /// Formatting preferences for this snapshot (nil in schema-2 files).
    /// Read it through resolvedFormat, never directly.
    public var format: WidgetFormatSettings?

    /// Formatting to use for rendering; english/USD defaults when the file
    /// predates schema 3.
    public var resolvedFormat: WidgetFormatSettings { format ?? .defaults }

    public init(
        schemaVersion: Int = WidgetSharedConstants.snapshotSchemaVersion,
        generatedAt: Date = Date(),
        serverOnline: Bool = false,
        today: PeriodTotals = .empty,
        last7d: PeriodTotals = .empty,
        last30d: PeriodTotals = .empty,
        total: PeriodTotals = .empty,
        selected: PeriodTotals = .empty,
        dailyTrend: [DailyPoint] = [],
        topModels: [SnapshotModelEntry] = [],
        sources: [SnapshotSourceEntry] = [],
        heatmap: HeatmapPayload = .empty,
        limits: [LimitProvider] = [],
        format: WidgetFormatSettings? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.generatedAt = generatedAt
        self.serverOnline = serverOnline
        self.today = today
        self.last7d = last7d
        self.last30d = last30d
        self.total = total
        self.selected = selected
        self.dailyTrend = dailyTrend
        self.topModels = topModels
        self.sources = sources
        self.heatmap = heatmap
        self.limits = limits
        self.format = format
    }

    public static let empty = WidgetSnapshot()

    // MARK: - Derived

    /// Tokens used on the calendar day before this snapshot was generated.
    /// `dailyTrend` contains only active days, so array position cannot identify yesterday.
    public var yesterdayTokens: Int {
        let calendar = Calendar.current
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: generatedAt) else {
            return 0
        }
        return dailyTrend.first { calendar.isDate($0.day, inSameDayAs: yesterday) }?.totalTokens ?? 0
    }

    /// Delta (percent) between today and yesterday. Returns nil when there
    /// is no usable baseline (yesterday was zero or no history).
    public var todayDeltaPercent: Double? {
        let y = yesterdayTokens
        guard y > 0 else { return nil }
        return Double(today.tokens - y) / Double(y) * 100.0
    }

    /// Placeholder data used by widget previews and the gallery.
    public static let placeholder: WidgetSnapshot = {
        let trend: [DailyPoint] = (0..<30).map { i in
            let day = Calendar.current.date(byAdding: .day, value: -29 + i, to: Date()) ?? Date()
            let base = 200_000 + Int.random(in: 0...600_000)
            return DailyPoint(day: day, totalTokens: base, costUsd: Double(base) / 1_500_000.0)
        }
        let weeks: [[Int]] = (0..<26).map { _ in (0..<7).map { _ in Int.random(in: 0...4) } }
        return WidgetSnapshot(
            generatedAt: Date(),
            serverOnline: true,
            today: PeriodTotals(tokens: 1_240_000, costUsd: 0.83, conversations: 12),
            last7d: PeriodTotals(tokens: 8_320_000, costUsd: 5.41, conversations: 64, activeDays: 6),
            last30d: PeriodTotals(tokens: 31_700_000, costUsd: 21.22, conversations: 248, activeDays: 22),
            total: PeriodTotals(tokens: 4_900_000_000, costUsd: 3_210.55, conversations: 1_820, activeDays: 202),
            selected: PeriodTotals(tokens: 22_900_000, costUsd: 15.10, conversations: 180),
            dailyTrend: trend,
            topModels: [
                SnapshotModelEntry(id: "claude-opus-4-6", name: "claude-opus-4-6", source: "claude", tokens: 12_400_000, sharePercent: 38.2),
                SnapshotModelEntry(id: "gpt-5.4", name: "gpt-5.4", source: "codex", tokens: 9_100_000, sharePercent: 28.0),
                SnapshotModelEntry(id: "claude-sonnet-4-6", name: "claude-sonnet-4-6", source: "claude", tokens: 5_800_000, sharePercent: 17.9),
                SnapshotModelEntry(id: "gemini-2.5-pro", name: "gemini-2.5-pro", source: "gemini", tokens: 3_200_000, sharePercent: 9.9),
                SnapshotModelEntry(id: "cursor-fast", name: "cursor-fast", source: "cursor", tokens: 1_900_000, sharePercent: 5.9)
            ],
            sources: [
                SnapshotSourceEntry(source: "claude", tokens: 18_200_000, costUsd: 12.40, sharePercent: 56.0),
                SnapshotSourceEntry(source: "codex", tokens: 9_100_000, costUsd: 6.20, sharePercent: 28.0),
                SnapshotSourceEntry(source: "gemini", tokens: 3_200_000, costUsd: 1.10, sharePercent: 9.9),
                SnapshotSourceEntry(source: "cursor", tokens: 1_900_000, costUsd: 1.52, sharePercent: 5.9)
            ],
            heatmap: HeatmapPayload(weeks: weeks, activeDays: 110, streakDays: 14),
            limits: [
                LimitProvider(source: "claude", label: "Claude · 5h",  fraction: 0.42, resetsAt: nil),
                LimitProvider(source: "claude", label: "Claude · 7d",  fraction: 0.71, resetsAt: nil),
                LimitProvider(source: "codex",  label: "Codex · 5h",   fraction: 0.18, resetsAt: nil),
                LimitProvider(source: "cursor", label: "Cursor",       fraction: 0.55, resetsAt: nil),
                LimitProvider(source: "gemini", label: "Gemini",       fraction: 0.32, resetsAt: nil)
            ]
        )
    }()
}

// MARK: - Sub-models

public struct PeriodTotals: Codable, Equatable {
    public var tokens: Int
    public var costUsd: Double
    public var conversations: Int
    public var activeDays: Int

    public init(tokens: Int = 0, costUsd: Double = 0, conversations: Int = 0, activeDays: Int = 0) {
        self.tokens = tokens
        self.costUsd = costUsd
        self.conversations = conversations
        self.activeDays = activeDays
    }

    public static let empty = PeriodTotals()
}

public struct DailyPoint: Codable, Equatable {
    public var day: Date
    public var totalTokens: Int
    public var costUsd: Double

    public init(day: Date, totalTokens: Int, costUsd: Double) {
        self.day = day
        self.totalTokens = totalTokens
        self.costUsd = costUsd
    }
}

public struct SnapshotModelEntry: Codable, Equatable, Identifiable {
    public var id: String
    public var name: String
    public var source: String
    public var tokens: Int
    public var sharePercent: Double

    public init(id: String, name: String, source: String, tokens: Int, sharePercent: Double) {
        self.id = id
        self.name = name
        self.source = source
        self.tokens = tokens
        self.sharePercent = sharePercent
    }
}

public struct SnapshotSourceEntry: Codable, Equatable, Identifiable {
    public var id: String { source }
    public var source: String
    public var tokens: Int
    public var costUsd: Double
    public var sharePercent: Double

    public init(source: String, tokens: Int, costUsd: Double, sharePercent: Double) {
        self.source = source
        self.tokens = tokens
        self.costUsd = costUsd
        self.sharePercent = sharePercent
    }
}

public struct HeatmapPayload: Codable, Equatable {
    /// Levels 0–4. Outer = weeks (oldest first), inner length is always 7.
    public var weeks: [[Int]]
    public var activeDays: Int
    public var streakDays: Int

    public init(weeks: [[Int]] = [], activeDays: Int = 0, streakDays: Int = 0) {
        self.weeks = weeks
        self.activeDays = activeDays
        self.streakDays = streakDays
    }

    public static let empty = HeatmapPayload()
}

public struct LimitProvider: Codable, Equatable, Identifiable {
    public var id: String { label }
    public var source: String
    public var label: String
    /// 0.0 – 1.0+ (clamped at render time).
    public var fraction: Double
    public var resetsAt: Date?

    public init(source: String, label: String, fraction: Double, resetsAt: Date?) {
        self.source = source
        self.label = label
        self.fraction = fraction
        self.resetsAt = resetsAt
    }
}

// MARK: - Container IO

public enum WidgetSnapshotStore {

    /// URL of the shared snapshot file inside the App Group container.
    /// Returns `nil` if the App Group is not provisioned (e.g. unsigned dev
    /// build) — callers should fall back to the per-user Application Support
    /// directory in that case.
    public static func sharedSnapshotURL() -> URL? {
        let fm = FileManager.default
        guard let dir = fm.containerURL(
            forSecurityApplicationGroupIdentifier: WidgetSharedConstants.appGroupIdentifier
        ) else {
            return nil
        }
        return dir.appendingPathComponent(WidgetSharedConstants.snapshotFilename)
    }

    /// Per-target Application Support fallback used when the App Group
    /// container is unavailable. The host (unsandboxed) resolves this to
    /// `~/Library/Application Support/TokenTrackerBar/`; a sandboxed widget
    /// extension resolves it inside its own container.
    public static func fallbackSnapshotURL() -> URL? {
        let fm = FileManager.default
        guard let support = try? fm.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ) else { return nil }
        let dir = support.appendingPathComponent("TokenTrackerBar", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(WidgetSharedConstants.snapshotFilename)
    }

    /// Absolute path of the snapshot inside the widget extension's sandbox
    /// container. The host writes here as a third fallback so ad-hoc /
    /// Developer-ID-less dev builds can still feed the widget without
    /// relying on a provisioned App Group. The sandboxed widget extension
    /// reads this same path via `fallbackSnapshotURL()` (resolves to its
    /// own container).
    ///
    /// Returns `nil` when called from inside a sandbox — only the
    /// unsandboxed host should ever write here.
    public static func widgetContainerSnapshotURL() -> URL? {
        let fm = FileManager.default
        let home = fm.homeDirectoryForCurrentUser
        // Detect sandbox: a sandboxed process's home is inside ~/Library/Containers
        if home.path.contains("/Library/Containers/") { return nil }
        let dir = home
            .appendingPathComponent("Library/Containers", isDirectory: true)
            .appendingPathComponent(WidgetSharedConstants.widgetBundleIdentifier, isDirectory: true)
            .appendingPathComponent("Data/Library/Application Support/TokenTrackerBar", isDirectory: true)
        if !fm.fileExists(atPath: dir.path) {
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir.appendingPathComponent(WidgetSharedConstants.snapshotFilename)
    }

    private static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }

    private static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }

    /// Atomically writes the snapshot. Tries the App Group container first,
    /// falls back to Application Support. Returns `true` on success.
    @discardableResult
    public static func write(_ snapshot: WidgetSnapshot) -> Bool {
        do {
            let data = try encoder().encode(snapshot)
            let urls = [
                sharedSnapshotURL(),
                fallbackSnapshotURL(),
                widgetContainerSnapshotURL()
            ].compactMap { $0 }
            guard !urls.isEmpty else { return false }
            var anySuccess = false
            for url in urls {
                do {
                    try data.write(to: url, options: [.atomic])
                    anySuccess = true
                } catch {
                    // Try the next location
                }
            }
            return anySuccess
        } catch {
            return false
        }
    }

    /// Reads the most recent snapshot. Tries shared container first, then
    /// the per-user fallback. Returns `nil` if neither file exists or
    /// decoding fails (e.g. schema mismatch from an old install).
    public static func read() -> WidgetSnapshot? {
        let candidates = [sharedSnapshotURL(), fallbackSnapshotURL()].compactMap { $0 }
        for url in candidates {
            guard let data = try? Data(contentsOf: url),
                  let snapshot = try? decoder().decode(WidgetSnapshot.self, from: data),
                  (2...WidgetSharedConstants.snapshotSchemaVersion).contains(snapshot.schemaVersion)
            else { continue }
            return snapshot
        }
        return nil
    }
}
