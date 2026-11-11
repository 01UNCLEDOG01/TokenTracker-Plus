import Foundation

struct UsageLimitsResponse: Codable, Equatable {
    let fetchedAt: String
    let claude: ClaudeLimits
    let codex: CodexLimits
    let cursor: CursorLimits
    let gemini: GeminiLimits
    let kimi: KimiLimits?
    let kiro: KiroLimits
    let grok: GrokLimits?
    let antigravity: AntigravityLimits
    let copilot: CopilotLimits?
    let zcode: ZcodeLimits?
    let opencodeGo: OpencodeGoLimits?
    let commandCode: CommandCodeLimits?
    let qoder: QoderLimits?
    let qoderCn: QoderLimits?
    let codingPlan: CodingPlanLimits?
    let agentPlan: AgentPlanLimits?
    let devin: DevinLimits?
    let workbuddy: WorkbuddyLimits?
    let workbuddyAi: WorkbuddyLimits?
    let deepseek: DeepseekLimits?
    // B3b fork provider waves. Every one is optional so a server that predates
    // the provider (or has it disabled) still decodes; unknown ids keep falling
    // through to no section instead of failing the whole response.
    let apigoto: ApigotoLimits?
    let sensenova: SensenovaLimits?
    let raccoon: RaccoonLimits?
    let minimax: MinimaxLimits?
    let trae: TraeLimits?
    let traeMain: TraeLimits?
    let codearts: CodeartsLimits?
    let clinePass: ClinePassLimits?
    let agentRouter: AgentRouterLimits?
    let opendesign: OpendesignLimits?
    let mistral: MistralLimits?
    let openaiCredits: OpenaiCreditsLimits?
    let minimaxCode: MinimaxCodeLimits?

    enum CodingKeys: String, CodingKey {
        case fetchedAt = "fetched_at"
        case claude, codex, cursor, gemini, kimi, kiro, grok, antigravity, copilot, zcode, qoder, qoderCn, codingPlan, agentPlan, devin, workbuddy, workbuddyAi
        case opencodeGo = "opencodeGo"
        case commandCode = "commandCode"
        case deepseek
        case apigoto, sensenova, raccoon, minimax, trae, traeMain, codearts, clinePass, agentRouter, opendesign, mistral, openaiCredits, minimaxCode
    }
}

extension UsageLimitsResponse {
    /// Raw utilization percent for a menu-bar metric, with the same
    /// configured / no-error guards the menu bar applies — so the Dynamic
    /// Island never shows a stale value for an unconfigured or erroring
    /// provider. Callers format the number (display mode, rounding) via
    /// `LimitsSettingsStore.formatPercentText`.
    func utilizationPercent(for metric: MenuBarDisplayMetric) -> Double? {
        func guarded(_ configured: Bool?, _ error: String?, _ value: Double?) -> Double? {
            guard configured == true, error == nil else { return nil }
            return value
        }
        switch metric {
        case .todayTokens, .todayCost, .last7dTokens, .totalTokens, .totalCost:
            return nil
        case .claude5h:
            return guarded(claude.configured, claude.error, claude.fiveHour?.utilization)
        case .claude7d:
            return guarded(claude.configured, claude.error, claude.sevenDay?.utilization)
        case .codex5h:
            return guarded(codex.configured, codex.error, codex.primaryWindow.map { Double($0.usedPercent) })
        case .codex7d:
            return guarded(codex.configured, codex.error, codex.secondaryWindow.map { Double($0.usedPercent) })
        case .codexCredits:
            return guarded(codex.configured, codex.error, codex.creditWindow?.usedPercent)
        case .codexSpark5h:
            return guarded(codex.configured, codex.error, codex.sparkPrimaryWindow.map { Double($0.usedPercent) })
        case .codexSpark7d:
            return guarded(codex.configured, codex.error, codex.sparkSecondaryWindow.map { Double($0.usedPercent) })
        case .cursorPlan:
            return guarded(cursor.configured, cursor.error, cursor.primaryWindow?.usedPercent)
        case .cursorAuto:
            return guarded(cursor.configured, cursor.error, cursor.secondaryWindow?.usedPercent)
        case .cursorAPI:
            return guarded(cursor.configured, cursor.error, cursor.tertiaryWindow?.usedPercent)
        case .geminiPro:
            return guarded(gemini.configured, gemini.error, gemini.primaryWindow?.usedPercent)
        case .geminiFlash:
            return guarded(gemini.configured, gemini.error, gemini.secondaryWindow?.usedPercent)
        case .geminiLite:
            return guarded(gemini.configured, gemini.error, gemini.tertiaryWindow?.usedPercent)
        case .kimiWeekly:
            return guarded(kimi?.configured, kimi?.error, kimi?.primaryWindow?.usedPercent)
        case .kimi5h:
            return guarded(kimi?.configured, kimi?.error, kimi?.secondaryWindow?.usedPercent)
        case .kimiTotal:
            return guarded(kimi?.configured, kimi?.error, kimi?.tertiaryWindow?.usedPercent)
        case .kiroMonth:
            return guarded(kiro.configured, kiro.error, kiro.primaryWindow?.usedPercent)
        case .kiroBonus:
            return guarded(kiro.configured, kiro.error, kiro.secondaryWindow?.usedPercent)
        case .grokMonth:
            return guarded(grok?.configured, grok?.error, grok?.primaryWindow?.usedPercent)
        case .grokOndemand:
            return guarded(grok?.configured, grok?.error, grok?.secondaryWindow?.usedPercent)
        case .copilotPremium:
            return guarded(copilot?.configured, copilot?.error, copilot?.primaryWindow?.usedPercent)
        case .copilotChat:
            return guarded(copilot?.configured, copilot?.error, copilot?.secondaryWindow?.usedPercent)
        case .antigravityClaudeWeekly:
            return guarded(antigravity.configured, antigravity.error, antigravity.primaryWindow?.usedPercent)
        case .antigravityClaude5h:
            return guarded(antigravity.configured, antigravity.error, antigravity.secondaryWindow?.usedPercent)
        case .antigravityGeminiWeekly:
            return guarded(antigravity.configured, antigravity.error, antigravity.tertiaryWindow?.usedPercent)
        case .antigravityGemini5h:
            return guarded(antigravity.configured, antigravity.error, antigravity.quaternaryWindow?.usedPercent)
        case .zcodeGlm52:
            return guarded(zcode?.configured, zcode?.error, zcode?.primaryWindow?.usedPercent)
        case .zcodeGlm5Turbo:
            return guarded(zcode?.configured, zcode?.error, zcode?.secondaryWindow?.usedPercent)
        case .opencodeGo5h:
            return guarded(opencodeGo?.configured, opencodeGo?.error, opencodeGo?.primaryWindow?.usedPercent)
        case .opencodeGoWeekly:
            return guarded(opencodeGo?.configured, opencodeGo?.error, opencodeGo?.secondaryWindow?.usedPercent)
        case .opencodeGoMonthly:
            return guarded(opencodeGo?.configured, opencodeGo?.error, opencodeGo?.tertiaryWindow?.usedPercent)
        case .commandCode5h:
            return guarded(commandCode?.configured, commandCode?.error, commandCode?.primaryWindow?.usedPercent)
        case .commandCodeWeekly:
            return guarded(commandCode?.configured, commandCode?.error, commandCode?.secondaryWindow?.usedPercent)
        case .qoderQuota:
            return guarded(qoder?.configured, qoder?.error, qoder?.primaryWindow?.usedPercent)
        case .qoderUltimate:
            return guarded(qoder?.configured, qoder?.error, qoder?.secondaryWindow?.usedPercent)
        case .devinDaily:
            return guarded(devin?.configured, devin?.error, devin?.primaryWindow?.usedPercent)
        case .devinWeekly:
            return guarded(devin?.configured, devin?.error, devin?.secondaryWindow?.usedPercent)
        }
    }
}

enum UsageLimitsCache {
    static let defaultsKey = "UsageLimitsLastGoodResponse"
    private static let maximumFutureSkew: TimeInterval = 5 * 60

    static func load(
        defaults: UserDefaults = .standard,
        now: Date = Date()
    ) -> UsageLimitsResponse? {
        guard let data = defaults.data(forKey: defaultsKey) else { return nil }
        guard let limits = try? JSONDecoder().decode(UsageLimitsResponse.self, from: data) else {
            return nil
        }
        if let fetchedAt = parseTimestamp(limits.fetchedAt),
           fetchedAt.timeIntervalSince(now) > maximumFutureSkew {
            return nil
        }
        return limits
    }

    static func save(
        _ limits: UsageLimitsResponse,
        defaults: UserDefaults = .standard,
        devinSelected: Bool? = nil
    ) {
        let adjusted = devinSelected.map { limits.applyingDevinSelection($0) } ?? limits
        // Opting out must remove persisted quota even when it was the only
        // usable provider. Ordinary all-error refreshes still keep their cache.
        if devinSelected == false && !adjusted.hasAnyProviderWithoutError {
            defaults.removeObject(forKey: defaultsKey)
            return
        }
        guard adjusted.hasAnyProviderWithoutError,
              let data = try? JSONEncoder().encode(adjusted) else { return }
        defaults.set(data, forKey: defaultsKey)
    }

    private static func parseTimestamp(_ rawValue: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: rawValue) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: rawValue)
    }
}

struct ClaudeLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let fiveHour: ClaudeWindow?
    let sevenDay: ClaudeWindow?
    let sevenDayOpus: ClaudeWindow?
    let weeklyScoped: [ClaudeScopedWindow]?
    let extraUsage: ClaudeExtraUsage?
    /// When this data was last successfully fetched from the provider, and whether
    /// it is being served from the stale disk-cache fallback (e.g. during a 429
    /// cool-down when the live usage endpoint is rate-limited). Both are optional so
    /// responses from older server builds still decode; a missing `stale` reads as fresh.
    let cachedAt: String?
    let stale: Bool?
    /// Expiry of an active 429 cool-down (ISO-8601), when one is in effect. Absent in
    /// the happy path. Lets the UI show when the next refresh is due and lets the app
    /// schedule a one-shot refresh the moment the cool-down lifts.
    let retryAt: String?
    /// Active status-page incident (status.anthropic.com), present only while the
    /// provider reports a non-"none" indicator. Optional so responses from older
    /// server builds (and the incident-free happy path) still decode.
    let serviceStatus: ProviderServiceStatus?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case fiveHour = "five_hour"
        case sevenDay = "seven_day"
        case sevenDayOpus = "seven_day_opus"
        case weeklyScoped = "weekly_scoped"
        case extraUsage = "extra_usage"
        case cachedAt = "cached_at"
        case retryAt = "retry_at"
        case serviceStatus = "service_status"
    }
}

/// A provider's public status-page reading (Statuspage.io shape), attached by the
/// local server only while an incident is active. `indicator` is one of
/// minor/major/critical ("none" is filtered server-side).
struct ProviderServiceStatus: Codable, Equatable {
    let indicator: String
    let description: String?
    let updatedAt: String?
    let url: String?

    enum CodingKeys: String, CodingKey {
        case indicator, description, url
        case updatedAt = "updated_at"
    }
}

struct ClaudeWindow: Codable, Equatable {
    let utilization: Double
    let resetsAt: String?

    enum CodingKeys: String, CodingKey {
        case utilization
        case resetsAt = "resets_at"
    }
}

/// Model-scoped weekly window (e.g. Fable): the label is server-provided
/// (`scope.model.display_name` upstream), so rows render dynamically.
struct ClaudeScopedWindow: Codable, Equatable {
    let label: String
    let utilization: Double
    let resetsAt: String?

    enum CodingKeys: String, CodingKey {
        case label, utilization
        case resetsAt = "resets_at"
    }
}

struct ClaudeExtraUsage: Codable, Equatable {
    let isEnabled: Bool
    let monthlyLimit: Int?
    let usedCredits: Int?
    let currency: String?

    enum CodingKeys: String, CodingKey {
        case isEnabled = "is_enabled"
        case monthlyLimit = "monthly_limit"
        case usedCredits = "used_credits"
        case currency
    }
}

struct CodexLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let primaryWindow: CodexWindow?
    let secondaryWindow: CodexWindow?
    let creditWindow: CodexCreditWindow?
    let sparkPrimaryWindow: CodexWindow?
    let sparkSecondaryWindow: CodexWindow?
    let resetCredits: ResetCredits?
    /// Data-age fields, mirroring `ClaudeLimits` — Codex serves its last-successful
    /// disk cache (`stale: true`) when the live wham read times out.
    let cachedAt: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case creditWindow = "credit_window"
        case sparkPrimaryWindow = "spark_primary_window"
        case sparkSecondaryWindow = "spark_secondary_window"
        case resetCredits = "reset_credits"
        case cachedAt = "cached_at"
    }

    struct ResetCredits: Codable, Equatable {
        let availableCount: Int?
        let totalEarnedCount: Int?
        let credits: [ResetCredit]

        enum CodingKeys: String, CodingKey {
            case availableCount = "available_count"
            case totalEarnedCount = "total_earned_count"
            case credits
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            availableCount = try container.decodeIfPresent(Int.self, forKey: .availableCount)
            totalEarnedCount = try container.decodeIfPresent(Int.self, forKey: .totalEarnedCount)
            credits = try container.decodeIfPresent([ResetCredit].self, forKey: .credits) ?? []
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encodeIfPresent(availableCount, forKey: .availableCount)
            try container.encodeIfPresent(totalEarnedCount, forKey: .totalEarnedCount)
            try container.encode(credits, forKey: .credits)
        }
    }

    struct ResetCredit: Codable, Equatable {
        let status: String
        let resetType: String?
        let grantedAt: String?
        let expiresAt: String

        enum CodingKeys: String, CodingKey {
            case status
            case resetType = "reset_type"
            case grantedAt = "granted_at"
            case expiresAt = "expires_at"
        }
    }
}

struct CodexWindow: Codable, Equatable {
    let usedPercent: Int
    let resetAt: Int?
    let limitWindowSeconds: Int?

    enum CodingKeys: String, CodingKey {
        case usedPercent = "used_percent"
        case resetAt = "reset_at"
        case limitWindowSeconds = "limit_window_seconds"
    }
}

struct CodexCreditWindow: Codable, Equatable {
    let source: String?
    let usedPercent: Double
    let remainingPercent: Double?
    let resetAt: Int?
    let limitCredits: Double?
    let usedCredits: Double?
    let remainingCredits: Double?

    enum CodingKeys: String, CodingKey {
        case source
        case usedPercent = "used_percent"
        case remainingPercent = "remaining_percent"
        case resetAt = "reset_at"
        case limitCredits = "limit_credits"
        case usedCredits = "used_credits"
        case remainingCredits = "remaining_credits"
    }
}

struct GenericLimitWindow: Codable, Equatable {
    let usedPercent: Double
    let resetAt: String?
    let limitWindowSeconds: Double?
    let limitCredits: Double?
    let usedCredits: Double?
    let remainingCredits: Double?

    init(usedPercent: Double, resetAt: String? = nil, limitWindowSeconds: Double? = nil, limitCredits: Double? = nil, usedCredits: Double? = nil, remainingCredits: Double? = nil) {
        self.usedPercent = usedPercent
        self.resetAt = resetAt
        self.limitWindowSeconds = limitWindowSeconds
        self.limitCredits = limitCredits
        self.usedCredits = usedCredits
        self.remainingCredits = remainingCredits
    }

    var creditsDetail: String? {
        guard let total = limitCredits, let used = usedCredits, let remaining = remainingCredits,
              total.isFinite, used.isFinite, remaining.isFinite, total > 0, used >= 0, remaining >= 0 else { return nil }
        return Strings.limitCreditsDetail(used: used, total: total, remaining: remaining)
    }

    enum CodingKeys: String, CodingKey {
        case usedPercent = "used_percent"
        case resetAt = "reset_at"
        case limitWindowSeconds = "limit_window_seconds"
        case limitCredits = "limit_credits"
        case usedCredits = "used_credits"
        case remainingCredits = "remaining_credits"
    }
}

struct CursorLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let membershipType: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?
    let quaternaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case membershipType = "membership_type"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
        case quaternaryWindow = "quaternary_window"
    }
}

struct KimiLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let membershipLevel: String?
    let subscriptionType: String?
    let parallelLimit: Int?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case membershipLevel = "membership_level"
        case subscriptionType = "subscription_type"
        case parallelLimit = "parallel_limit"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
    }
}

struct KiroLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
    }
}

struct GeminiLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let accountEmail: String?
    let accountPlan: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case accountEmail = "account_email"
        case accountPlan = "account_plan"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
    }
}

/// One product's share of the Grok pool (Grok Build, Grok Bot, Imagine, …).
/// `window.usedPercent` is points of the shared cap, not a separate quota.
struct GrokProductUsage: Codable, Equatable {
    let product: String?
    let label: String?
    let window: GenericLimitWindow?
}

struct GrokLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    /// "weekly" | "monthly" | "daily" from the billing API period type (null if unknown).
    let periodType: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    /// Absent on payloads from older servers.
    let products: [GrokProductUsage]?

    enum CodingKeys: String, CodingKey {
        case configured, error, products
        case planLabel = "plan_label"
        case periodType = "period_type"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
    }
}

struct CopilotLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
    }
}

struct ZcodeLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planKind: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?
    let buckets: [ZcodeBucket]?
    /// Inventory of unused 5h / weekly reset cards (dashboard `reset_credits`).
    let resetCredits: ZcodeResetCredits?
    /// Separate Start-plan grant payload (dashboard `start_plan`).
    let startPlan: ZcodeStartPlan?

    enum CodingKeys: String, CodingKey {
        case configured, error, buckets
        case planLabel = "plan_label"
        case planKind = "plan_kind"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
        case resetCredits = "reset_credits"
        case startPlan = "start_plan"
    }
}

/// Unused ZCode reset-card inventory. Cards with a past `expires_at` are filtered
/// at render time so a stale payload still decodes.
struct ZcodeResetCredits: Codable, Equatable {
    let error: String?
    let fiveHour: [ZcodeResetCard]?
    let weekly: [ZcodeResetCard]?

    enum CodingKeys: String, CodingKey {
        case error
        case fiveHour = "five_hour"
        case weekly
    }
}

struct ZcodeResetCard: Codable, Equatable {
    let expiresAt: String

    enum CodingKeys: String, CodingKey {
        case expiresAt = "expires_at"
    }
}

/// Start-plan grants shipped beside a coding-plan ZCode card.
struct ZcodeStartPlan: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planKind: String?
    let buckets: [ZcodeStartPlanBucket]?

    enum CodingKeys: String, CodingKey {
        case configured, error, buckets
        case planLabel = "plan_label"
        case planKind = "plan_kind"
    }
}

struct ZcodeStartPlanBucket: Codable, Equatable {
    let label: String?
    let entitlementId: String?
    let planName: String?
    let period: String?
    let remainingUnits: Double?
    let totalUnits: Double?
    let window: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case label, window, period
        case entitlementId = "entitlement_id"
        case planName = "plan_name"
        case remainingUnits = "remaining_units"
        case totalUnits = "total_units"
    }
}

/// One ZCode start-plan balance (daily allowance or one-time promotional grant)
/// when the server still nests balances under top-level `buckets` (legacy).
struct ZcodeBucket: Codable, Equatable {
    let label: String?
    let entitlementId: String?
    let window: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case label, window
        case entitlementId = "entitlement_id"
    }
}

extension ZcodeLimits {
    /// Start-plan buckets that carry a server label, de-duplicated by label; nil when the
    /// payload predates bucket labels so callers keep their fixed GLM fallback.
    var labeledBuckets: [(key: String, label: String, window: GenericLimitWindow)]? {
        var out: [(key: String, label: String, window: GenericLimitWindow)] = []
        for b in buckets ?? [] {
            guard let label = b.label, !label.isEmpty, let window = b.window,
                  !out.contains(where: { $0.label == label }) else { continue }
            let entitlement = b.entitlementId ?? ""
            out.append((entitlement.isEmpty ? label : entitlement, label, window))
        }
        return out.isEmpty ? nil : out
    }
}

// OpenCode Go: $12/5h + $30/week + $60/month rolling usage scraped from
// https://opencode.ai/workspace/<id>/go. No public REST API yet (tracked at
// anomalyco/opencode#16017), so the backend HTML-parses the workspace page.
struct OpencodeGoLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
    }
}

/// Command Code (commandcode.ai): subscription windows (5h + weekly rolling
/// caps over included monthly credits) read from the CLI's own alpha endpoints
/// by the local server. Mirror of OpencodeGoLimits minus the monthly window.
struct CommandCodeLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let subscriptionStatus: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let cachedAt: String?
    let stale: Bool?
    let authActionRequired: String?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case subscriptionStatus = "subscription_status"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case cachedAt = "cached_at"
        case authActionRequired = "auth_action_required"
    }
}

/// One of Qoder's three credit pools (套餐内 / 资源包 / SOTA 专属积分). The
/// dashboard renders these as one row each instead of the summed
/// `total_quota` bar, because "resource pack already at 100% while SOTA still
/// holds credits" is invisible in a single aggregate row.
struct QoderCreditPool: Codable, Equatable {
    let key: String?
    let used: Double?
    let limit: Double?
    let remaining: Double?
    let percent: Double?
    let unit: String?
    /// Earliest future expiry among the pool's still-unspent grants.
    let expiresAt: String?

    enum CodingKeys: String, CodingKey {
        case key, used, limit, remaining, percent, unit
        case expiresAt = "expires_at"
    }

    /// A 0/0 pool carries no quota to read and would draw a full bar in
    /// remaining mode, so callers drop it like a missing window.
    var hasQuota: Bool { (limit ?? 0) > 0 }

    var window: GenericLimitWindow? {
        guard let percent else { return nil }
        return GenericLimitWindow(
            usedPercent: percent,
            resetAt: expiresAt,
            limitCredits: limit,
            usedCredits: used,
            remainingCredits: remaining
        )
    }
}

struct QoderLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?
    /// Team credits (shared team allowance). Absent unless the account is on a
    /// team plan — a 0/0 shared quota is omitted server-side on purpose.
    let quaternaryWindow: GenericLimitWindow?
    /// Per-pool split when the payload carries it; older servers omit it.
    let pools: [QoderCreditPool]?
    let cachedAt: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale, pools
        case planLabel = "plan_label"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
        case quaternaryWindow = "quaternary_window"
        case cachedAt = "cached_at"
    }
}

struct CodingPlanLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?
    let cachedAt: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
        case cachedAt = "cached_at"
    }
}

typealias AgentPlanLimits = CodingPlanLimits

/// WorkBuddy's reward pool (gift / top-up / platform grants). The server names
/// this `reward_window`; it is a separate row from the plan window and carries
/// the "by <day>, N credits expire" lapse fields added upstream (#976).
struct WorkbuddyRewardWindow: Codable, Equatable {
    let usedPercent: Double
    let resetAt: String?
    let limitCredits: Double?
    let usedCredits: Double?
    let remainingCredits: Double?
    let expiringCredits: Double?
    let expiringAt: String?
    /// Beijing calendar day of the earliest lapse, server-precomputed.
    let expiringDay: String?

    enum CodingKeys: String, CodingKey {
        case usedPercent = "used_percent"
        case resetAt = "reset_at"
        case limitCredits = "limit_credits"
        case usedCredits = "used_credits"
        case remainingCredits = "remaining_credits"
        case expiringCredits = "expiring_credits"
        case expiringAt = "expiring_at"
        case expiringDay = "expiring_day"
    }

    var creditsDetail: String? {
        guard let total = limitCredits, let used = usedCredits, let remaining = remainingCredits,
              total.isFinite, used.isFinite, remaining.isFinite, total > 0, used >= 0, remaining >= 0 else { return nil }
        return Strings.limitCreditsDetail(used: used, total: total, remaining: remaining)
    }

    /// "by <day>, N credits expire" — the pool has no shared cycle, so the
    /// soonest lapse is the only honest reset hint.
    var expiringNote: String? {
        guard let credits = expiringCredits, credits > 0,
              let day = expiringDay, !day.isEmpty else { return nil }
        return Strings.workbuddyExpiringNote(credits: Strings.creditAmountText(credits), day: day)
    }
}

/// One WorkBuddy edition's credits (China and AI each publish their own row).
/// The plan window is the subscription's base credits with its cycle reset;
/// `reward_window` pools every non-plan credit group (gift, top-up and
/// platform rewards) and carries no shared cycle. `secondary_window` stays as
/// the legacy grouped pool older servers sent — still decoded so cached and
/// pre-upgrade payloads keep rendering.
struct WorkbuddyLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let rewardWindow: WorkbuddyRewardWindow?
    let cachedAt: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case rewardWindow = "reward_window"
        case cachedAt = "cached_at"
    }
}

/// Devin (devin.ai): daily + weekly subscription quota read from the official
/// GetPlanStatus RPC by the local server, keyed by the Devin CLI's saved
/// sign-in. Mirror of CommandCodeLimits minus the subscription status.
struct DevinLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let cachedAt: String?
    let stale: Bool?
    let authActionRequired: String?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case cachedAt = "cached_at"
        case authActionRequired = "auth_action_required"
    }

    /// The shape published while the Devin provider switch is off — no
    /// previously fetched windows may outlive the user's selection.
    static let unconfigured = DevinLimits(
        configured: false,
        error: nil,
        planLabel: nil,
        primaryWindow: nil,
        secondaryWindow: nil,
        cachedAt: nil,
        stale: nil,
        authActionRequired: nil
    )
}

/// DeepSeek (platform.deepseek.com) is pay-as-you-go with no quota windows:
/// the official balance endpoint is the only documented programmatic source,
/// so this carries a balance card — one entry per currency, no bars (#960).
struct DeepseekLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let isAvailable: Bool?
    let balances: [DeepseekBalance]?
    let credentialSource: String?
    let cachedAt: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale, balances
        case isAvailable = "is_available"
        case credentialSource = "credential_source"
        case cachedAt = "cached_at"
    }
}

struct DeepseekBalance: Codable, Equatable {
    let currency: String
    let total: Double
    let granted: Double?
    let toppedUp: Double?

    enum CodingKeys: String, CodingKey {
        case currency, total, granted
        case toppedUp = "topped_up"
    }
}

struct AntigravityLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let accountEmail: String?
    let accountPlan: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?
    let quaternaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case accountEmail = "account_email"
        case accountPlan = "account_plan"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
        case quaternaryWindow = "quaternary_window"
    }
}


// MARK: - B3b provider waves
//
// One model per fork provider that had no native surface. All windows use the
// shared GenericLimitWindow shape (used_percent + reset_at + optional
// limit_window_seconds / credit detail); providers without percentage windows
// carry the wallet/balance fields their server module emits.
// Provider JSON shapes are defined in src/lib/*-limits.js; keep these fields in
// step with the modules named in the comments.

/// APIGOTO (apigoto.com): one weekly TCredits window plus the subscription's own
/// lifetime as an expiry-paced window (`src/lib/apigoto-limits.js`).
struct ApigotoLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
    }
}

/// SenseNova (商汤日日新): two credit pools, each with a 5h and a 7d window
/// (`src/lib/sensenova-limits.js`). Granted credits are a balance, not a window.
struct SensenovaLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let tertiaryWindow: GenericLimitWindow?
    let quaternaryWindow: GenericLimitWindow?
    let grantCredits: Double?
    let grantExpiresAt: String?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case tertiaryWindow = "tertiary_window"
        case quaternaryWindow = "quaternary_window"
        case grantCredits = "grant_credits"
        case grantExpiresAt = "grant_expires_at"
    }
}

/// One 小浣熊 wallet bucket (daily points, reward points, …). Balances refill on
/// their own schedules, so the card shows a balance line and never a fake bar.
struct RaccoonWallet: Codable, Equatable {
    let type: String?
    let name: String?
    let balance: Double?
}

/// Raccoon (raccoon.sensetime.com) credit pools via the local Agent2API gateway
/// (`src/lib/raccoon-limits.js`).
struct RaccoonLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let raccoonWallets: [RaccoonWallet]?
    let raccoonAvailableCredits: Double?
    let raccoonUnit: String?
    let raccoonUpdatedAt: String?
    let source: String?
    let stale: Bool?
    /// Today's grant-vs-consumption window from the desktop session's bills
    /// lane (`src/lib/raccoon-daily-usage.js`, attached by
    /// `attachRaccoonDailyUsage`) — the one real percentage on the raccoon
    /// card, rendered through LimitBar like every other row. Nil when the
    /// bills lane is absent (the wallet lines alone then carry the card).
    let raccoonDailyUsageWindow: GenericLimitWindow?
    /// The bills lane failing must not blank the wallet lines; the web card
    /// shows the lane error as its own status line instead.
    let raccoonDailyUsageError: String?

    enum CodingKeys: String, CodingKey {
        case configured, error, source, stale
        case planLabel = "plan_label"
        case raccoonWallets = "raccoon_wallets"
        case raccoonAvailableCredits = "raccoon_available_credits"
        case raccoonUnit = "raccoon_unit"
        case raccoonUpdatedAt = "raccoon_updated_at"
        case raccoonDailyUsageWindow = "raccoon_daily_usage_window"
        case raccoonDailyUsageError = "raccoon_daily_usage_error"
    }
}

/// MiniMax Coding Plan: 5h + weekly remaining-percent windows in token-plan
/// billing mode; API billing mode returns a balance instead
/// (`src/lib/minimax-limits.js`).
struct MinimaxLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let minimaxBalance: Double?
    let minimaxCurrency: String?
    let minimaxBillingMode: String?
    let capturedAt: String?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case minimaxBalance = "minimax_balance"
        case minimaxCurrency = "minimax_currency"
        case minimaxBillingMode = "minimax_billing_mode"
        case capturedAt = "captured_at"
    }
}

/// One TRAE rolling check-in grant; each batch carries its own expiry.
struct TraeGrant: Codable, Equatable {
    let name: String?
    let remain: Double?
    let total: Double?
    let expireAt: String?

    enum CodingKeys: String, CodingKey {
        case name, remain, total
        case expireAt = "expire_at"
    }
}

/// TRAE SOLO account points via the local Agent2API gateway
/// (`src/lib/gateway-limits.js` shapeTrae). The whole-account total comes from
/// `raw.entUsage.usage_summary`, never from summing grants.
struct TraeLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let traeAvailablePoints: Double?
    let traeTotalPoints: Double?
    let traeUsedPoints: Double?
    let traeConsumptionRatio: Double?
    let traeGrants: [TraeGrant]?
    let traeNearestPoints: Double?
    let traeNearestExpireAt: String?
    let gatewayUpdatedAt: String?
    let source: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, source, stale
        case planLabel = "plan_label"
        case planName = "plan_name"
        case traeAvailablePoints = "trae_available_points"
        case traeTotalPoints = "trae_total_points"
        case traeUsedPoints = "trae_used_points"
        case traeConsumptionRatio = "trae_consumption_ratio"
        case traeGrants = "trae_grants"
        case traeNearestPoints = "trae_nearest_points"
        case traeNearestExpireAt = "trae_nearest_expire_at"
        case gatewayUpdatedAt = "gateway_updated_at"
    }

    /// Used share of the account's points pool; nil when the snapshot carries no
    /// denominator (the card then draws no bar, matching the dashboard).
    var usedPercent: Double? {
        guard let total = traeTotalPoints, total > 0 else { return nil }
        let used = traeUsedPoints ?? max(0, total - (traeAvailablePoints ?? total))
        return min(100, max(0, used / total * 100))
    }
}

/// One CodeArts credit meter bucket (remaining / total).
struct CodeartsBucket: Codable, Equatable {
    let remaining: Double?
    let total: Double?
}

/// Huawei CodeArts Agent trial credits (`src/lib/gateway-limits.js` shapeCodearts).
struct CodeartsLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let codeartsAvailableCredits: Double?
    let codeartsPackage: CodeartsBucket?
    let codeartsBonus: CodeartsBucket?
    let codeartsBasic: CodeartsBucket?
    let codeartsResetDate: String?
    let codeartsTokensUsed: Double?
    let gatewayUpdatedAt: String?
    let source: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, source, stale
        case planLabel = "plan_label"
        case planName = "plan_name"
        case codeartsAvailableCredits = "codearts_available_credits"
        case codeartsPackage = "codearts_package"
        case codeartsBonus = "codearts_bonus"
        case codeartsBasic = "codearts_basic"
        case codeartsResetDate = "codearts_reset_date"
        case codeartsTokensUsed = "codearts_tokens_used"
        case gatewayUpdatedAt = "gateway_updated_at"
    }

    var usedPercent: Double? {
        guard let total = codeartsPackage?.total, total > 0 else { return nil }
        let available = codeartsAvailableCredits ?? codeartsPackage?.remaining ?? 0
        return min(100, max(0, (total - available) / total * 100))
    }
}

/// One Cline Pass micro-credit wallet.
struct ClineWallet: Codable, Equatable {
    let name: String?
    let balance: Double?
}

/// Cline Pass micro-credits via the gateway snapshot
/// (`src/lib/gateway-limits.js` shapeClinePass).
struct ClinePassLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let clineWallets: [ClineWallet]?
    let clineAvailableCredits: Double?
    let clineUnit: String?
    let gatewayUpdatedAt: String?
    let source: String?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, source, stale
        case planLabel = "plan_label"
        case planName = "plan_name"
        case clineWallets = "cline_wallets"
        case clineAvailableCredits = "cline_available_credits"
        case clineUnit = "cline_unit"
        case gatewayUpdatedAt = "gateway_updated_at"
    }
}

/// AgentRouter.org prepaid balance read from its New API panel
/// (`src/lib/agentrouter-limits.js`). Balances in USD, not quota windows.
struct AgentRouterLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let agentrouterBalanceUsd: Double?
    let agentrouterUsedUsd: Double?
    let agentrouterRequests: Double?
    let agentrouterQuotaUnits: Double?
    let stale: Bool?

    enum CodingKeys: String, CodingKey {
        case configured, error, stale
        case planLabel = "plan_label"
        case planName = "plan_name"
        case agentrouterBalanceUsd = "agentrouter_balance_usd"
        case agentrouterUsedUsd = "agentrouter_used_usd"
        case agentrouterRequests = "agentrouter_requests"
        case agentrouterQuotaUnits = "agentrouter_quota_units"
    }

    /// Used share of the prepaid wallet (spent / (left + spent)); the dashboard
    /// draws this as one bar rather than a fake plan window.
    var usedPercent: Double? {
        guard let balance = agentrouterBalanceUsd, balance >= 0 else { return nil }
        let used = agentrouterUsedUsd ?? 0
        let total = balance + max(0, used)
        guard total > 0 else { return nil }
        return min(100, max(0, used / total * 100))
    }
}

/// OpenDesign's raw credit allowance window (used / limit / remaining).
struct OpendesignWindow: Codable, Equatable {
    let used: Double?
    let limit: Double?
    let remaining: Double?
}

/// OpenDesign subscription: a 5-hour session window plus the weekly allowance
/// (`src/lib/opendesign-limits.js`).
struct OpendesignLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let opendesignSessionWindow: OpendesignWindow?
    let opendesignWeeklyWindow: OpendesignWindow?
    let source: String?
    let workspaceId: String?
    let capturedAt: String?

    enum CodingKeys: String, CodingKey {
        case configured, error, source
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case opendesignSessionWindow = "opendesign_session_window"
        case opendesignWeeklyWindow = "opendesign_weekly_window"
        case workspaceId = "workspace_id"
        case capturedAt = "captured_at"
    }
}

/// Mistral subscription: two monthly allowances (Included API + Included Vibe
/// Code) plus the wallet balance (`src/lib/mistral-limits.js`).
struct MistralLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let mistralBalance: Double?
    let mistralCurrency: String?
    let capturedAt: String?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case mistralBalance = "mistral_balance"
        case mistralCurrency = "mistral_currency"
        case capturedAt = "captured_at"
    }
}

/// OpenAI Platform API credits: a prepaid wallet plus a meter window when the
/// grant list reconciles with the available total
/// (`src/lib/openai-credits-limits.js`).
struct OpenaiCreditsLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let openaiCreditsAvailable: Double?
    let openaiCreditsCurrency: String?
    let openaiCreditsExpiresAt: String?
    let capturedAt: String?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case openaiCreditsAvailable = "openai_credits_available"
        case openaiCreditsCurrency = "openai_credits_currency"
        case openaiCreditsExpiresAt = "openai_credits_expires_at"
        case capturedAt = "captured_at"
    }
}

/// MiniMax Code quota lane: used-percent plan windows plus a video-generation
/// count row and a points balance (`src/lib/minimax-code-limits.js`).
struct MinimaxCodeLimits: Codable, Equatable {
    let configured: Bool
    let error: String?
    let planLabel: String?
    let planName: String?
    let primaryWindow: GenericLimitWindow?
    let secondaryWindow: GenericLimitWindow?
    let minimaxCodeVideoWindow: GenericLimitWindow?
    let minimaxCodePoints: Double?
    let minimaxCodeUnlimited: Bool?
    let minimaxCodeRegion: String?
    let capturedAt: String?

    enum CodingKeys: String, CodingKey {
        case configured, error
        case planLabel = "plan_label"
        case planName = "plan_name"
        case primaryWindow = "primary_window"
        case secondaryWindow = "secondary_window"
        case minimaxCodeVideoWindow = "minimax_code_video_window"
        case minimaxCodePoints = "minimax_code_points"
        case minimaxCodeUnlimited = "minimax_code_unlimited"
        case minimaxCodeRegion = "minimax_code_region"
        case capturedAt = "captured_at"
    }
}

/// Helper to decide whether a response from the limits API contains at least one
/// usable (configured + no error) provider record. Used by the ViewModel to
/// protect the "last good record" on partial failures (do not overwrite a
/// previously successful snapshot with an all-error response).
extension UsageLimitsResponse {
    var hasAnyProviderWithoutError: Bool {
        let providers: [(Bool, String?)] = [
            (claude.configured, claude.error),
            (codex.configured, codex.error),
            (cursor.configured, cursor.error),
            (gemini.configured, gemini.error),
            (kimi?.configured ?? false, kimi?.error),
            (kiro.configured, kiro.error),
            (grok?.configured ?? false, grok?.error),
            (antigravity.configured, antigravity.error),
            (copilot?.configured ?? false, copilot?.error),
            (zcode?.configured ?? false, zcode?.error),
            (opencodeGo?.configured ?? false, opencodeGo?.error),
            (commandCode?.configured ?? false, commandCode?.error),
            (qoder?.configured ?? false, qoder?.error),
            (qoderCn?.configured ?? false, qoderCn?.error),
            (codingPlan?.configured ?? false, codingPlan?.error),
            (agentPlan?.configured ?? false, agentPlan?.error),
            (devin?.configured ?? false, devin?.error),
            (workbuddy?.configured ?? false, workbuddy?.error),
            (workbuddyAi?.configured ?? false, workbuddyAi?.error),
            (deepseek?.configured ?? false, deepseek?.error),
            (apigoto?.configured ?? false, apigoto?.error),
            (sensenova?.configured ?? false, sensenova?.error),
            (raccoon?.configured ?? false, raccoon?.error),
            (minimax?.configured ?? false, minimax?.error),
            (trae?.configured ?? false, trae?.error),
            (traeMain?.configured ?? false, traeMain?.error),
            (codearts?.configured ?? false, codearts?.error),
            (clinePass?.configured ?? false, clinePass?.error),
            (agentRouter?.configured ?? false, agentRouter?.error),
            (opendesign?.configured ?? false, opendesign?.error),
            (mistral?.configured ?? false, mistral?.error),
            (openaiCredits?.configured ?? false, openaiCredits?.error),
            (minimaxCode?.configured ?? false, minimaxCode?.error),
        ]
        return providers.contains { $0.0 && $0.1 == nil }
    }

    /// Decide which record the UI should display after a successful fetch:
    /// adopt the incoming response unless it has no usable provider data while a
    /// previous record exists (keeps the last good snapshot on an all-error response).
    static func displayRecord(
        current: UsageLimitsResponse?,
        incoming: UsageLimitsResponse
    ) -> UsageLimitsResponse {
        guard let current, !incoming.hasAnyProviderWithoutError else { return incoming }
        return current
    }

    /// Devin rows must never outlive the user's provider selection. While the
    /// switch is off, retained/cached payloads are rewritten to the
    /// not-configured shape so views, widgets and reset detection all agree.
    func applyingDevinSelection(_ selected: Bool) -> UsageLimitsResponse {
        guard !selected, let devin, devin != .unconfigured else { return self }
        return UsageLimitsResponse(
            fetchedAt: fetchedAt,
            claude: claude,
            codex: codex,
            cursor: cursor,
            gemini: gemini,
            kimi: kimi,
            kiro: kiro,
            grok: grok,
            antigravity: antigravity,
            copilot: copilot,
            zcode: zcode,
            opencodeGo: opencodeGo,
            commandCode: commandCode,
            qoder: qoder,
            qoderCn: qoderCn,
            codingPlan: codingPlan,
            agentPlan: agentPlan,
            devin: .unconfigured,
            workbuddy: workbuddy,
            workbuddyAi: workbuddyAi,
            deepseek: deepseek,
            apigoto: apigoto,
            sensenova: sensenova,
            raccoon: raccoon,
            minimax: minimax,
            trae: trae,
            traeMain: traeMain,
            codearts: codearts,
            clinePass: clinePass,
            agentRouter: agentRouter,
            opendesign: opendesign,
            mistral: mistral,
            openaiCredits: openaiCredits,
            minimaxCode: minimaxCode
        )
    }
}

/// Latest-request authority for usage-limits publications. Every refresh takes
/// a ticket when it starts and a Devin selection transition invalidates every
/// outstanding ticket immediately — even before the replacement refresh has
/// begun. Only the newest ticket may publish, so a late response fetched under
/// a superseded selection (including on→off→on cycles) can never overwrite the
/// display record, the disk cache, reset detection or boundary scheduling.
struct UsageLimitsPublicationAuthority {
    private var generation = 0

    /// Ticket identifying a new refresh. Overlapping same-selection requests
    /// resolve latest-wins because every begin supersedes the previous ticket.
    mutating func beginRequest() -> Int {
        generation += 1
        return generation
    }

    /// A selection transition supersedes in-flight work before its replacement
    /// refresh has even started.
    mutating func invalidateForSelectionChange() {
        generation += 1
    }

    /// `ticket` still owns the publication right only while no newer refresh
    /// or selection change has superseded it.
    func isCurrent(_ ticket: Int) -> Bool {
        ticket == generation
    }

    /// The publication decision every completed refresh must pass: superseded
    /// work returns nil and may not touch display, cache, reset detection or
    /// scheduling; current work returns the display record — incoming unless
    /// it carries no usable provider while a good record exists — with Devin
    /// rows rewritten when the selection is off.
    func publish(
        ticket: Int,
        incoming: UsageLimitsResponse,
        devinSelected: Bool,
        current: UsageLimitsResponse?
    ) -> UsageLimitsResponse? {
        guard isCurrent(ticket) else { return nil }
        return UsageLimitsResponse.displayRecord(
            current: current?.applyingDevinSelection(devinSelected),
            incoming: incoming.applyingDevinSelection(devinSelected)
        )
    }
}
