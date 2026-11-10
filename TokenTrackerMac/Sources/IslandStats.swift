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

    /// Currency mirrored from the dashboard webviews' localStorage (the same
    /// store the settings page writes; the desktop panel proved it flows).
    private(set) var currencySymbol = "¥"
    private(set) var currencyRate: Double = 7.2

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

    // MARK: Formatting (owner's 亿/万 idiom, same as the Windows pill)

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
                    var tokens = (totals["total_tokens"] as? NSNumber)?.doubleValue ?? 0
                    if tokens == 0, let t = totals["total_tokens"] as? String { tokens = Double(t) ?? 0 }
                    var cost = (totals["total_cost_usd"] as? NSNumber)?.doubleValue ?? 0
                    if cost == 0, let c = totals["total_cost_usd"] as? String { cost = Double(c) ?? 0 }
                    self.today = TodayStats(tokens: tokens, costUsd: cost, fetched: true)
                    self.pushPetBubble()
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
            let stats: [String: Any] = ["todayTokens": today.tokens, "todayCostUsd": today.costUsd]
            let statsLiteral = (try? JSONSerialization.data(withJSONObject: stats))
                .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
            let symbol = currencySymbol == "¥" ? "¥" : currencySymbol
            script += "window.__ttPetTokens=\(Int(today.tokens));" +
                "window.__ttPetCostUsd=\(today.costUsd);" +
                "window.__ttPetStats=\(statsLiteral);" +
                "window.__ttPetCurrency={symbol:\"\(symbol)\",rate:\(currencyRate)};" +
                "window.__ttPetLimits=\(limitsJSON);" +
                "window.__ttPetBubbleBand=\(Int(bubbleBandProvider?() ?? 64));"
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
            "r: JSON.parse(localStorage.getItem('tokentracker-exchange-rates') || '{}').rates || {}})"
        webView.evaluateJavaScript(script) { result, _ in
            guard let json = result as? String,
                  let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any],
                  let currency = obj["c"] as? String,
                  let rates = obj["r"] as? [String: Double] else { return }
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
