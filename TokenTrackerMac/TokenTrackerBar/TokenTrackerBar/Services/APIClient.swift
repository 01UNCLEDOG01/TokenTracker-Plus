import Foundation

struct UsageSummaryFetchResult {
    let summary: UsageSummaryResponse
    /// Publication authority for the menu-bar summary slots.
    let source: UsageSummaryViewSource
    let completedAt: Date
}

actor APIClient {
    static let shared = APIClient()
    private static let usageLimitsRequestTimeout: TimeInterval = 25
    private static let localSyncResourceTimeout: TimeInterval = 130
    private struct LocalAuthResponse: Decodable {
        let token: String
    }

    private let baseURL = Constants.serverBaseURL
    private let session: URLSession
    private let syncSession: URLSession
    private let decoder: JSONDecoder

    private init() {
        self.session = URLSession(configuration: LocalAPIConfiguration.makeSessionConfiguration())

        // Same loopback target, so it needs the same system-proxy bypass.
        let syncConfig = LocalAPIConfiguration.makeSessionConfiguration()
        syncConfig.timeoutIntervalForRequest = Self.localSyncResourceTimeout
        syncConfig.timeoutIntervalForResource = Self.localSyncResourceTimeout
        self.syncSession = URLSession(configuration: syncConfig)

        let jsonDecoder = JSONDecoder()
        // No .convertFromSnakeCase — all models use explicit CodingKeys with snake_case rawValues
        self.decoder = jsonDecoder
    }

    // MARK: - Public API

	func fetchSummary(from: String, to: String) async throws -> UsageSummaryResponse {
        try await fetchSummaryWithSource(from: from, to: to).summary
	}

    func fetchSummaryWithSource(from: String, to: String) async throws -> UsageSummaryFetchResult {
        let result: AccountFetchResult<UsageSummaryResponse> = try await fetchWithSource(
            "/functions/tokentracker-usage-summary",
            queryItems: withTimeZoneQueryItems([
                URLQueryItem(name: "from", value: from),
                URLQueryItem(name: "to", value: to)
            ])
        )
        return UsageSummaryFetchResult(
            summary: result.value,
            source: result.source,
            completedAt: result.completedAt
        )
    }

	func fetchDaily(from: String, to: String) async throws -> AccountFetchResult<DailyUsageResponse> {
		try await fetchWithSource("/functions/tokentracker-usage-daily", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchHeatmap(weeks: Int = 52) async throws -> AccountFetchResult<HeatmapResponse> {
		try await fetchWithSource("/functions/tokentracker-usage-heatmap", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "weeks", value: String(weeks))
		]))
	}

	func fetchModelBreakdown(from: String, to: String) async throws -> AccountFetchResult<ModelBreakdownResponse> {
		try await fetchWithSource("/functions/tokentracker-usage-model-breakdown", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchProjectUsage(from: String, to: String) async throws -> ProjectUsageResponse {
		try await fetch("/functions/tokentracker-project-usage-summary", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchMonthly(from: String, to: String) async throws -> AccountFetchResult<MonthlyUsageResponse> {
		try await fetchWithSource("/functions/tokentracker-usage-monthly", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "from", value: from),
			URLQueryItem(name: "to", value: to)
		]))
	}

	func fetchHourly(day: String) async throws -> AccountFetchResult<HourlyUsageResponse> {
		try await fetchWithSource("/functions/tokentracker-usage-hourly", queryItems: withTimeZoneQueryItems([
			URLQueryItem(name: "day", value: day)
		]))
	}

    /// `devinEnabled` is the user's Settings provider selection. Only when it is
    /// true does the request carry `devin=1` plus the local-auth header that
    /// lets the server read the Devin CLI credentials; omitted means off.
    /// `hiddenProviders` carries the visibility gate (#956): ids the server
    /// must skip entirely — no upstream call, no credential read. Like the
    /// Devin flag, an explicit list requires the local-auth header; omitted
    /// means "fetch every configured provider" (the legacy behavior).
    func fetchUsageLimits(devinEnabled: Bool = false, hiddenProviders: [String] = []) async throws -> UsageLimitsResponse {
        var items: [URLQueryItem] = []
        if devinEnabled {
            items.append(URLQueryItem(name: "devin", value: "1"))
        }
        if !hiddenProviders.isEmpty {
            items.append(URLQueryItem(name: "hidden", value: hiddenProviders.joined(separator: ",")))
        }
        return try await fetch(
            "/functions/tokentracker-usage-limits",
            queryItems: items,
            requestTimeout: Self.usageLimitsRequestTimeout,
            requiresLocalAuth: devinEnabled || !hiddenProviders.isEmpty
        )
    }

    func triggerSync(drain: Bool = false, auto: Bool = false) async throws -> SyncResponse {
        let body: Data
        if drain {
            // Sync Now keeps the bounded background scan, while --drain still
            // flushes the complete local backlog and gives the request lock priority.
            body = Data(
                #"{"auto":true,"background":true,"allLocalSources":true,"drain":true}"#.utf8
            )
        } else if auto {
            body = Data(
                #"{"auto":true,"background":true,"allLocalSources":true}"#.utf8
            )
        } else {
            body = Data("{}".utf8)
        }
        return try await post(
            "/functions/tokentracker-local-sync",
            body: body
        )
    }

    func checkServerHealth() async -> Bool {
        do {
            guard let url = URL(string: baseURL + "/functions/tokentracker-user-status") else {
                return false
            }
            let (_, response) = try await session.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse else { return false }
            return httpResponse.statusCode == 200
        } catch {
            return false
        }
    }

    // MARK: - Private Helpers

    /// Local-first data authority. Upstream read `X-TokenTracker-Account-View` /
    /// `X-TokenTracker-Account-Fallback` headers here and sent `?account=1` so
    /// the local server could proxy the hosted cross-device aggregate. TT-Plus
    /// has no cloud backend (hosted-only, no cloud in TT-Plus), so the query
    /// flag and header fan-out are gone and every payload is this machine's
    /// data. The wrapper stays because callers publish the value together with
    /// its authority and completion time.
    private func fetchWithSource<T: Decodable>(
        _ path: String,
        queryItems: [URLQueryItem] = [],
        requestTimeout: TimeInterval? = nil
    ) async throws -> AccountFetchResult<T> {
        let (data, _) = try await request(
            path,
            queryItems: queryItems,
            requestTimeout: requestTimeout
        )
        return AccountFetchResult(
            value: try decoder.decode(T.self, from: data),
            source: .localQueue,
            completedAt: Date()
        )
    }

    private func fetch<T: Decodable>(
        _ path: String,
        queryItems: [URLQueryItem] = [],
        requestTimeout: TimeInterval? = nil,
        requiresLocalAuth: Bool = false
    ) async throws -> T {
        let (data, _) = try await request(
            path,
            queryItems: queryItems,
            requestTimeout: requestTimeout,
            requiresLocalAuth: requiresLocalAuth
        )
        return try decoder.decode(T.self, from: data)
    }

    private func request(
        _ path: String,
        queryItems: [URLQueryItem] = [],
        requestTimeout: TimeInterval? = nil,
        requiresLocalAuth: Bool = false
    ) async throws -> (Data, HTTPURLResponse) {
        guard var components = URLComponents(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        if !queryItems.isEmpty {
            components.queryItems = queryItems
        }
        guard let url = components.url else {
            throw APIError.invalidURL
        }
        let data: Data
        let response: URLResponse
        if requestTimeout != nil || requiresLocalAuth {
            var request = URLRequest(url: url)
            if let requestTimeout {
                request.timeoutInterval = requestTimeout
            }
            if requiresLocalAuth {
                request.setValue(try await fetchLocalAuthToken(), forHTTPHeaderField: "x-tokentracker-local-auth")
            }
            (data, response) = try await session.data(for: request)
        } else {
            (data, response) = try await session.data(from: url)
        }
        try validateResponse(response)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        return (data, httpResponse)
    }

	private func withTimeZoneQueryItems(_ items: [URLQueryItem]) -> [URLQueryItem] {
		items + [
			URLQueryItem(name: "tz", value: DateHelpers.currentTimeZoneIdentifier),
			URLQueryItem(name: "tz_offset_minutes", value: String(DateHelpers.currentUTCOffsetMinutes()))
		]
	}

    private func post<T: Decodable>(_ path: String, body: Data = Data("{}".utf8)) async throws -> T {
        guard let url = URL(string: baseURL + path) else {
            throw APIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if path == "/functions/tokentracker-local-sync" {
            request.setValue(try await fetchLocalAuthToken(), forHTTPHeaderField: "x-tokentracker-local-auth")
        }
        request.httpBody = body
        let requestSession = path == "/functions/tokentracker-local-sync"
            ? syncSession
            : session
        let (data, response) = try await requestSession.data(for: request)
        try validateResponse(response)
        return try decoder.decode(T.self, from: data)
    }

    private func fetchLocalAuthToken() async throws -> String {
        guard let url = URL(string: baseURL + "/api/local-auth") else {
            throw APIError.invalidURL
        }
        let (data, response) = try await session.data(from: url)
        try validateResponse(response)
        let payload = try decoder.decode(LocalAuthResponse.self, from: data)
        guard !payload.token.isEmpty else {
            throw APIError.invalidResponse
        }
        return payload.token
    }

    private func validateResponse(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.httpError(statusCode: httpResponse.statusCode)
        }
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpError(statusCode: Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid URL"
        case .invalidResponse:
            return "Invalid response from server"
        case .httpError(let statusCode):
            return "HTTP error: \(statusCode)"
        }
    }
}
