import Foundation

/// Menu-bar metric slots — the macOS counterpart of the dashboard's Widgets page
/// contract (dashboard/src/lib/menu-bar-display.js): the native side advertises
/// the metrics it can render via `menuBarAvailableItems`/`menuBarMaxItems`, the
/// dashboard stores the chosen slot ids as `menuBarItems`, and `showStats`
/// toggles the whole strip. Two slots, "none" allowed in both.
///
/// Only metrics the shell can already compute are advertised: today
/// tokens/cost, rolling 7-day tokens, rolling 30-day tokens and the conversation
/// count. Rate-limit slots (claude5h, codex7d, …) need the limits JSON decoded
/// into a stable table and are tracked in KNOWN_ISSUES.
enum MenuBarMetric: String, CaseIterable {
    case none
    case todayTokens = "todayTokens"
    case todayCost = "todayCost"
    case last7dTokens = "last7dTokens"
    case last30dTokens = "last30dTokens"
    case conversations

    /// Dashboard-facing descriptor ({id,label,shortLabel,category}). Labels are
    /// Chinese because the fork's native surfaces are Chinese today (KI-074).
    var descriptor: [String: String] {
        switch self {
        case .none: return ["id": rawValue, "label": "不显示", "shortLabel": "—", "category": "none"]
        case .todayTokens: return ["id": rawValue, "label": "今日 Tokens", "shortLabel": "Tokens", "category": "tokens"]
        case .todayCost: return ["id": rawValue, "label": "今日成本", "shortLabel": "Cost", "category": "cost"]
        case .last7dTokens: return ["id": rawValue, "label": "近 7 天 Tokens", "shortLabel": "7d", "category": "tokens"]
        case .last30dTokens: return ["id": rawValue, "label": "近 30 天 Tokens", "shortLabel": "30d", "category": "tokens"]
        case .conversations: return ["id": rawValue, "label": "对话数", "shortLabel": "Chats", "category": "tokens"]
        }
    }

    static let maxItems = 2
    static let defaultItems: [MenuBarMetric] = [.todayTokens, .todayCost]

    static func parse(_ raw: Any?) -> [MenuBarMetric] {
        let ids: [String]
        if let strings = raw as? [String] {
            ids = strings
        } else if let list = raw as? [[String: Any]] {
            ids = list.compactMap { $0["id"] as? String }
        } else {
            ids = []
        }
        var seen = Set<String>()
        var items: [MenuBarMetric] = []
        for id in ids where items.count < maxItems {
            guard let metric = MenuBarMetric(rawValue: id) else { continue }
            if metric != .none {
                guard !seen.contains(id) else { continue }
                seen.insert(id)
            }
            items.append(metric)
        }
        return items.isEmpty ? defaultItems : items
    }
}
