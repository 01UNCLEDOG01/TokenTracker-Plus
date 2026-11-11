import Foundation

/// Where a menu-bar summary refresh came from.
///
/// Upstream also had `.accountUpload` (the hosted cross-device upload). Removed:
/// hosted-only, no cloud in TT-Plus. Local queue writes are the only publisher.
struct UsagePublicationSource: OptionSet, Equatable {
    let rawValue: Int

    static let localQueue = UsagePublicationSource(rawValue: 1 << 0)
}

/// Publication authority for a menu-bar summary slot. Local-first means there is
/// exactly one authority: this machine's queue.
enum UsageSummaryViewSource: Equatable {
    case localQueue
}

enum MenuBarSummarySlot: CaseIterable, Hashable {
    case today
    case rolling
    case total

    var selection: MenuBarSummarySelection {
        switch self {
        case .today: return .today
        case .rolling: return .rolling
        case .total: return .total
        }
    }
}

struct SummaryPublicationState {
    private var sourceBySlot: [MenuBarSummarySlot: UsageSummaryViewSource] = [:]

    mutating func record(
        source: UsageSummaryViewSource,
        for summaries: MenuBarSummarySelection
    ) {
        for slot in MenuBarSummarySlot.allCases where summaries.contains(slot.selection) {
            sourceBySlot[slot] = source
        }
    }

    func source(for slot: MenuBarSummarySlot) -> UsageSummaryViewSource? {
        sourceBySlot[slot]
    }
}

struct PendingUsagePublicationQueue {
    private(set) var sources = UsagePublicationSource()
    private(set) var summaries = MenuBarSummarySelection()

    var isEmpty: Bool { sources.isEmpty }

    mutating func enqueue(
        _ source: UsagePublicationSource,
        summaries nextSummaries: MenuBarSummarySelection
    ) {
        sources.formUnion(source)
        summaries.formUnion(nextSummaries)
    }

    mutating func removeAll() {
        sources = []
        summaries = []
    }

    mutating func takeIfReady(
        isLoading: Bool,
        syncInFlight: Bool,
        hiddenRefreshInFlight: Bool
    ) -> (sources: UsagePublicationSource, summaries: MenuBarSummarySelection)? {
        guard !isEmpty,
              !UsagePublicationPolicy.shouldQueueRefresh(
                isLoading: isLoading,
                syncInFlight: syncInFlight,
                hiddenRefreshInFlight: hiddenRefreshInFlight
              ) else { return nil }
        let result = (sources, summaries)
        removeAll()
        return result
    }
}

enum UsagePublicationPolicy {
    static func shouldQueueRefresh(
        isLoading: Bool,
        syncInFlight: Bool,
        hiddenRefreshInFlight: Bool
    ) -> Bool {
        isLoading || syncInFlight || hiddenRefreshInFlight
    }

    static func summariesToRefresh(
        state: SummaryPublicationState,
        sources: UsagePublicationSource,
        requested: MenuBarSummarySelection
    ) -> MenuBarSummarySelection {
        var result = MenuBarSummarySelection()
        for slot in MenuBarSummarySlot.allCases where requested.contains(slot.selection) {
            let shouldRefresh: Bool
            switch state.source(for: slot) {
            case .localQueue:
                shouldRefresh = sources.contains(.localQueue)
            case nil:
                // Before the first successful summary read, any publication is
                // useful because it also establishes this slot's authority.
                shouldRefresh = !sources.isEmpty
            }
            if shouldRefresh {
                result.formUnion(slot.selection)
            }
        }
        return result
    }
}
