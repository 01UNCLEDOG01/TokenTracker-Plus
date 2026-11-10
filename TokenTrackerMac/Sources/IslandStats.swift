import AppKit
import WebKit

/// Today-stats + limits pipeline for the pet window — the macOS counterpart of
/// TokenTrackerWin's UsagePoller + PetWindow.FlushContextAsync.
///
/// The pet page (pet.jsx) renders everything itself:
///   - the stats pill in the bubble band (window.__ttPetTokens/__ttPetCostUsd/
///     __ttPetStats/__ttPetCurrency, re-read on pet:usage);
///   - the hover limits popup (window.__ttPetLimits);
///   - the bubble band layout (window.__ttPetBubbleBand, re-read on
///     pet:bubble-band). The page measures its own popup height and asks the
///     host to grow the window via pet:bubble-height:<n> (see PetPanel).
///
/// The「用量悬浮窗」toggle (setPetSetting key "monitor", the Windows Token
/// Monitor pill switch) turns the bubble/pill on and off.
@MainActor
final class IslandStats: NSObject {
    static let shared = IslandStats()

    private var pollTimer: Timer?
    private(set) var limitsJSON: String = "null"
    private(set) var bubbleEnabled = true

    struct TodayStats {
        var tokens: Double = 0
        var costUsd: Double = 0
        var fetched = false
    }
    private(set) var today = TodayStats()

    /// Rolling windows for the pet tap-quips (Windows UsagePoller parity).
    private(set) var last7dTokens: Double = 0
    private(set) var last7dActiveDays: Double = 0
    private(set) var last30dTokens: Double = 0
    private(set) var last30dAvgPerDay: Double = 0
    private(set) var conversations: Double = 0
    private(set) var syncing = false

    /// Currency mirrored from the dashboard webviews' localStorage (the same
    /// store the settings page writes; the desktop panel proved it flows).
    private(set) var currencySymbol = "¥"
    private(set) var currencyRate: Double = 7.2
    private(set) var tokenUnitSystem = "chinese"

    var serverURLProvider: (() -> URL?)?
    var petWebViewProvider: (() -> WKWebView?)?
    /// The band the pet PAGE measured — pushing a hardcoded value clobbers the
    /// page's layout and clips the bubble at the window top.
    var bubbleBandProvider: (() -> CGFloat)?

    func load() {
        bubbleEnabled = UserDefaults.standard.object(forKey: "TTPPetBubbleEnabled") == nil
            || UserDefaults.standard.bool(forKey: "TTPPetBubbleEnabled")
    }

    func setBubbleEnabled(_ enabled: Bool) {
        bubbleEnabled = enabled
        UserDefaults.standard.set(enabled, forKey: "TTPPetBubbleEnabled")
        pushPetBubble()
    }

    func start() {
        refreshCurrencyFromWebViews()
        fetch()
        pollTimer?.invalidate()
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.fetch() }
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    func stop() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    /// Manual sync in flight — the pet shows a syncing state (ApplySyncing parity).
    func setSyncing(_ value: Bool) {
        syncing = value
        pushPetBubble()
    }

    // MARK: Formatting (owner's 亿/万 idiom, same as the Windows pill)

    /// USD -> preferred currency (Windows pill converts the same way).
    static func costText(_ usd: Double, symbol: String, rate: Double) -> String {
        "\(symbol)\(String(format: "%.2f", usd * rate))"
    }

    /// Capsule line: "1.8亿 · ¥50.46" (the capsule draws its own accent dot).
    var capsuleText: String {
        "\(Self.tokensText(today.tokens)) · \(Self.costText(today.costUsd, symbol: currencySymbol, rate: currencyRate))"
    }

    /// Fired after every successful poll — the capsule listens.
    nonisolated var onStatsUpdated: (() -> Void)? {
        get { _onStatsUpdated }
        set { _onStatsUpdated = newValue }
    }
    private nonisolated(unsafe) var _onStatsUpdated: (() -> Void)?

    static func tokensText(_ tokens: Double) -> String {
        if tokens >= 1e8 { return String(format: "%.1f亿", tokens / 1e8) }
        if tokens >= 1e4 { return String(format: "%.0f万", tokens / 1e4) }
        return String(format: "%.0f", tokens)
    }

    // MARK: Polling

    private func fetch() {
        refreshCurrencyFromWebViews()  // currency pref can change any time
        guard let base = serverURLProvider?() else { return }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let day = formatter.string(from: Date())
        let summary = URL(string: base.absoluteString +
            "/functions/tokentracker-usage-summary?from=\(day)&to=\(day)&tz=Asia/Shanghai")
        let limits = URL(string: base.absoluteString + "/functions/tokentracker-usage-limits")

        if let url = summary {
            var request = URLRequest(url: url)
            request.timeoutInterval = 8
            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self else { return }
                DispatchQueue.main.async {
                    let httpOK = (response as? HTTPURLResponse)?.statusCode == 200
                    guard error == nil, httpOK, let data,
                          let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let totals = payload["totals"] as? [String: Any] else { return }
                    func num(_ v: Any?) -> Double {
                        if let n = v as? NSNumber { return n.doubleValue }
                        if let t = v as? String { return Double(t) ?? 0 }
                        return 0
                    }
                    self.today = TodayStats(tokens: num(totals["total_tokens"]),
                                            costUsd: num(totals["total_cost_usd"]), fetched: true)
                    self.conversations = num(totals["conversation_count"])
                    if let rolling = payload["rolling"] as? [String: Any] {
                        if let d7 = rolling["last_7d"] as? [String: Any] {
                            self.last7dTokens = num(d7["billable_total_tokens"])
                            self.last7dActiveDays = num(d7["active_days"])
                        }
                        if let d30 = rolling["last_30d"] as? [String: Any] {
                            self.last30dTokens = num(d30["billable_total_tokens"])
                            self.last30dAvgPerDay = num(d30["avg_per_active_day"])
                        }
                    }
                    self.pushPetBubble()
                    self.onStatsUpdated?()
                }
            }.resume()
        }
        if let url = limits {
            var request = URLRequest(url: url)
            request.timeoutInterval = 8
            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                guard let self else { return }
                DispatchQueue.main.async {
                    let httpOK = (response as? HTTPURLResponse)?.statusCode == 200
                    guard error == nil, httpOK, let data,
                          let obj = try? JSONSerialization.jsonObject(with: data) else { return }
                    if let json = try? JSONSerialization.data(withJSONObject: obj),
                       let jsonText = String(data: json, encoding: .utf8) {
                        self.limitsJSON = jsonText
                        self.pushPetBubble()
                    }
                }
            }.resume()
        }
    }

    // MARK: Pet page push (FlushContextAsync counterpart)

    func pushPetBubble() {
        guard let webView = petWebViewProvider?() else { return }
        var script = ""
        if bubbleEnabled {
            let stats: [String: Any] = [
                "todayTokens": today.tokens, "todayCostUsd": today.costUsd,
                "conversations": conversations,
                "last7dTokens": last7dTokens, "last7dActiveDays": last7dActiveDays,
                "last30dTokens": last30dTokens, "last30dAvgPerDay": last30dAvgPerDay,
                // streakDays/activeDaysAllTime/topModels need the heatmap
                // aggregates (Windows UsagePoller computes them there); the
                // page falls back to 0 — the pill and hover popup don't use them.
            ]
            let statsLiteral = (try? JSONSerialization.data(withJSONObject: stats))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            let symbol = currencySymbol == "¥" ? "¥" : currencySymbol
            let locale = Locale.preferredLanguages.first ?? "en"
            script += "window.__ttPetTokens=\(Int(today.tokens));" +
                "window.__ttPetCostUsd=\(today.costUsd);" +
                "window.__ttPetStats=\(statsLiteral);" +
                "window.__ttPetCurrency={symbol:\"\(symbol)\",rate:\(currencyRate)};" +
                "window.__ttPetLimits=\(limitsJSON);" +
                "window.__ttPetBubbleBand=\(Int(bubbleBandProvider?() ?? 64));" +
                "window.__ttPetLocale=\"\(locale)\";" +
                "window.__ttPetTokenUnitSystem=\"\(tokenUnitSystem)\";" +
                "window.__ttPetConnected=true;" +
                "window.__ttPetSyncing=\(syncing ? "true" : "false");"
        } else {
            script += "window.__ttPetBubbleBand=0;window.__ttPetLimits=null;"
        }
        script += "window.dispatchEvent(new Event('pet:usage'));" +
            "window.dispatchEvent(new Event('pet:bubble-band'));"
        webView.evaluateJavaScript(script) { _, error in
            if let error {
                Diag.error("Pet bubble push failed: \(error.localizedDescription)")
            } else {
                Diag.info("Pet bubble pushed (tokens=\(Int(self.today.tokens)), limits=\(self.limitsJSON == "null" ? "null" : "set"))")
            }
        }
    }

    /// Mirror the dashboard's currency preference out of its localStorage (the
    /// settings page writes tokentracker-currency + exchange rates there).
    func refreshCurrencyFromWebViews() {
        var source: WKWebView?
        for window in NSApp.windows {
            if let view = WebHost.webView(in: window) { source = view; break }
        }
        guard let webView = source else { return }
        let script = "JSON.stringify({c: localStorage.getItem('tokentracker-currency')," +
            "r: JSON.parse(localStorage.getItem('tokentracker-exchange-rates') || '{}').rates || {}," +
            "u: localStorage.getItem('tt.tokenUnitSystem')})"
        webView.evaluateJavaScript(script) { result, _ in
            guard let json = result as? String,
                  let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  let currency = obj["c"] as? String,
                  let rates = obj["r"] as? [String: Double] else { return }
            if let unit = obj["u"] as? String {
                self.tokenUnitSystem = unit == "western" ? "western" : "chinese"
            }
            DispatchQueue.main.async {
                let code = currency.uppercased()
                if code == "CNY" {
                    self.currencySymbol = "¥"
                    self.currencyRate = rates["CNY"] ?? 7.2
                } else if code == "USD" {
                    self.currencySymbol = "$"
                    self.currencyRate = 1.0
                } else {
                    self.currencySymbol = code
                    self.currencyRate = rates[code] ?? self.currencyRate
                }
                Diag.info("Pet pill currency: \(self.currencySymbol) rate \(self.currencyRate)")
            }
        }
    }
}
