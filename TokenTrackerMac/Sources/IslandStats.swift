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

    /// Currency + unit system mirrored from the dashboard (localStorage mirror and
    /// the dashboard's own setSetting bridge). Dashboard defaults are USD + K/M/B
    /// (dashboard/src/lib/currency.ts, token-format.js) — seeding ¥/万/亿 here made
    /// a fresh install show different units in the pet than in the dashboard.
    private(set) var currencyCode = "USD"
    private(set) var currencySymbol = "$"
    private(set) var currencyRate: Double = 1.0
    /// Page vocabulary: "chinese" (万/亿) or "western" (K/M/B).
    private(set) var tokenUnitSystem = "western"
    /// Locale the dashboard is rendering (the pet page formats with it too).
    private(set) var localePreference = Locale.preferredLanguages.first ?? "en"
    /// Embedded-server health — false shows the pet's offline pose (ApplyConnected).
    private(set) var connected = true

    var serverURLProvider: (() -> URL?)?
    var petWebViewProvider: (() -> WKWebView?)?
    /// The band the pet PAGE measured — pushing a hardcoded value clobbers the
    /// page's layout and clips the bubble at the window top.
    var bubbleBandProvider: (() -> CGFloat)?

    func load() {
        let d = UserDefaults.standard
        bubbleEnabled = d.object(forKey: "TTPPetBubbleEnabled") == nil
            || d.bool(forKey: "TTPPetBubbleEnabled")
        // Cold-launch cache: the dashboard's bridge may not have pushed yet, but a
        // previous launch persisted the real choice (TokenUnits/Currency.cs parity).
        currencyCode = CurrencyPreferences.normalizeCode(d.string(forKey: "TTPCurrencyCode"))
        currencySymbol = d.string(forKey: "TTPCurrencySymbol") ?? CurrencyPreferences.symbol(for: currencyCode)
        if let rate = d.object(forKey: "TTPExchangeRate") as? Double, rate.isFinite, rate > 0 {
            currencyRate = rate
        }
        tokenUnitSystem = Self.normalizeUnitSystem(d.string(forKey: "TTPTokenUnitSystem"), fallback: "western")
        if let saved = d.string(forKey: "TTPPetLocale"), !saved.isEmpty { localePreference = saved }
    }

    // MARK: Dashboard setting bridge (TrayApplicationContext + Currency/TokenUnits parity)

    /// The dashboard posts {type:"setSetting", key, value} for the appearance
    /// settings that affect the menu bar/pet; the mac shell used to drop all of
    /// them (log: "Pet bridge message: setSetting"), so currency/unit changes
    /// only landed after the next 60s localStorage mirror — and never for unit.
    func applyDashboardSetting(key: String, value: Any?) {
        switch key {
        case "tokenUnitSystem":
            guard let raw = value as? String else { return }
            applyTokenUnitSystem(raw)
        case "currency":
            guard let raw = value as? String else { return }
            applyCurrency(code: CurrencyPreferences.normalizeCode(raw))
        case "currencySymbol":
            guard let raw = value as? String, !raw.isEmpty else { return }
            applyCurrencySymbol(raw)
        case "exchangeRate":
            let rate: Double?
            if let d = value as? Double { rate = d }
            else if let n = value as? NSNumber { rate = n.doubleValue }
            else if let s = value as? String { rate = Double(s) }
            else { rate = nil }
            if let rate, rate.isFinite, rate > 0 { applyExchangeRate(rate) }
        case "locale":
            guard let raw = value as? String, !raw.isEmpty else { return }
            applyLocale(raw)
        default:
            // Other Windows-only native settings (toasts, confetti, theme) have no
            // menu-bar surface in this shell.
            Diag.info("Dashboard setting ignored: \(key)")
            return
        }
        publishDisplayChange()
    }

    func applyCurrency(code: String, rate: Double? = nil, persist: Bool = true) {
        currencyCode = CurrencyPreferences.normalizeCode(code)
        currencySymbol = CurrencyPreferences.symbol(for: currencyCode)
        if let rate, rate.isFinite, rate > 0 { currencyRate = rate }
        if persist {
            UserDefaults.standard.set(currencyCode, forKey: "TTPCurrencyCode")
            UserDefaults.standard.set(currencySymbol, forKey: "TTPCurrencySymbol")
            UserDefaults.standard.set(currencyRate, forKey: "TTPExchangeRate")
        }
    }

    func applyCurrencySymbol(_ symbol: String) {
        currencySymbol = symbol
        UserDefaults.standard.set(symbol, forKey: "TTPCurrencySymbol")
    }

    func applyExchangeRate(_ rate: Double) {
        guard rate.isFinite, rate > 0 else { return }
        currencyRate = rate
        UserDefaults.standard.set(rate, forKey: "TTPExchangeRate")
    }

    func applyTokenUnitSystem(_ raw: String, persist: Bool = true) {
        tokenUnitSystem = Self.normalizeUnitSystem(raw, fallback: tokenUnitSystem)
        if persist { UserDefaults.standard.set(tokenUnitSystem, forKey: "TTPTokenUnitSystem") }
    }

    func applyLocale(_ raw: String) {
        localePreference = raw
        UserDefaults.standard.set(raw, forKey: "TTPPetLocale")
    }

    /// Unit-system normalisation shared by the bridge and the localStorage mirror.
    static func normalizeUnitSystem(_ raw: String?, fallback: String = "western") -> String {
        let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if value == "chinese" { return "chinese" }
        if value == "english" || value == "western" { return "western" }
        return fallback
    }

    func setConnected(_ value: Bool) {
        guard value != connected else { return }
        connected = value
        publishDisplayChange()
    }

    /// Push both surfaces after a display-affecting change: the pet page re-reads
    /// the pushed globals, and the capsule re-renders its formatted line.
    private func publishDisplayChange() {
        pushPetBubble()
        onStatsUpdated?()
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
    /// Units follow the dashboard's choice — a K/M/B user must not get 万/亿 here.
    var capsuleText: String {
        "\(Self.tokensText(today.tokens, chineseUnits: tokenUnitSystem == "chinese")) · " +
            Self.costText(today.costUsd, symbol: currencySymbol, rate: currencyRate)
    }

    /// Fired after every successful poll — the capsule listens.
    nonisolated var onStatsUpdated: (() -> Void)? {
        get { _onStatsUpdated }
        set { _onStatsUpdated = newValue }
    }
    private nonisolated(unsafe) var _onStatsUpdated: (() -> Void)?

    /// Finite-safe JS numeric literal (NaN/inf would print as bare identifiers
    /// and abort the whole push script).
    static func jsNumber(_ value: Double) -> String {
        value.isFinite ? String(value) : "0"
    }

    static func tokensText(_ tokens: Double, chineseUnits: Bool = true) -> String {
        if chineseUnits {
            if tokens >= 1e8 { return String(format: "%.1f亿", tokens / 1e8) }
            if tokens >= 1e4 { return String(format: "%.0f万", tokens / 1e4) }
            return String(format: "%.0f", tokens)
        }
        if tokens >= 1e9 { return String(format: "%.1fB", tokens / 1e9) }
        if tokens >= 1e6 { return String(format: "%.1fM", tokens / 1e6) }
        if tokens >= 1e3 { return String(format: "%.1fK", tokens / 1e3) }
        return String(format: "%.0f", tokens)
    }

    // MARK: Polling

    private func fetch() {
        refreshCurrencyFromWebViews()  // currency pref can change any time
        guard let base = serverURLProvider?() else { return }
        // Windows UsagePoller parity: the "today" window is the USER's local day,
        // sent with the IANA zone + numeric offset. Hardcoding Asia/Shanghai (and a
        // locale-dependent date formatter) showed the wrong day for every non-UTC+8
        // user and a non-Gregorian date string in th/ja/ar locales.
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let day = formatter.string(from: Date())
        let tz = TimeZone.current
        let tzId = tz.identifier.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? tz.identifier
        let offsetMinutes = tz.secondsFromGMT() / 60
        let summary = URL(string: base.absoluteString +
            "/functions/tokentracker-usage-summary?from=\(day)&to=\(day)&tz=\(tzId)&tz_offset_minutes=\(offsetMinutes)")
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
                          let totals = payload["totals"] as? [String: Any] else {
                        self.today.fetched = false
                        Diag.error("usage-summary fetch failed: \(error?.localizedDescription ?? "bad payload")")
                        self.pushPetBubble()
                        return
                    }
                    func num(_ v: Any?) -> Double {
                        if let n = v as? NSNumber { return n.doubleValue }
                        if let t = v as? String { return Double(t) ?? 0 }
                        return 0
                    }
                    self.today = TodayStats(tokens: num(totals["total_tokens"]),
                                            costUsd: num(totals["total_cost_usd"]), fetched: true)
                    self.conversations = num(totals["conversation_count"])
                    if let rolling = payload["rolling"] as? [String: Any] {
                        // The endpoint nests the token sums under "totals"
                        // (local-api.js rolling.last_7d.totals.billable_total_tokens);
                        // reading the parent kept 7d/30d at 0 so those quips never fired.
                        if let d7 = rolling["last_7d"] as? [String: Any] {
                            let t7 = d7["totals"] as? [String: Any] ?? d7
                            self.last7dTokens = num(t7["billable_total_tokens"])
                            self.last7dActiveDays = num(d7["active_days"])
                        }
                        if let d30 = rolling["last_30d"] as? [String: Any] {
                            let t30 = d30["totals"] as? [String: Any] ?? d30
                            self.last30dTokens = num(t30["billable_total_tokens"])
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
        do {
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
            // Every string goes through jsString: the old raw interpolation meant a
            // quote/backslash in a symbol or locale aborted the whole push script
            // (silent staleness, and injection in the pathological case).
            script += "window.__ttPetTokens=\(Int(today.tokens));" +
                "window.__ttPetCostUsd=\(today.costUsd);" +
                "window.__ttPetStats=\(statsLiteral);" +
                "window.__ttPetCurrency={symbol:\(WebHost.jsString(currencySymbol)),rate:\(currencyRate)};" +
                "window.__ttPetLimits=\(limitsJSON);" +
                "window.__ttPetBubbleBand=\(Int(bubbleBandProvider?() ?? PetPanelController.minBubbleBand));" +
                "window.__ttPetLocale=\(WebHost.jsString(localePreference));" +
                "window.__ttPetTokenUnitSystem=\(WebHost.jsString(tokenUnitSystem));" +
                "window.__ttPetConnected=\(connected ? "true" : "false");" +
                "window.__ttPetSyncing=\(syncing ? "true" : "false");"
        }
        // The page re-reads currency on pet:currency and locale+unitSystem on
        // pet:locale (pet.jsx: "PushContext dispatches pet:locale on every
        // push, so it also carries unit changes") — without these the pill
        // keeps the mount-time defaults ($ / western).
        // Event set mirrors PetWindow.FlushContextAsync: the page re-reads each
        // global only on its own event — pet:limits was the missing one that
        // kept the hover limit rows empty forever.
        script += "window.dispatchEvent(new Event('pet:usage'));" +
            "window.dispatchEvent(new Event('pet:bubble-band'));" +
            "window.dispatchEvent(new Event('pet:limits'));" +
            "window.dispatchEvent(new Event('pet:currency'));" +
            "window.dispatchEvent(new Event('pet:locale'));" +
            "window.dispatchEvent(new Event('pet:connected'));" +
            "window.dispatchEvent(new Event('pet:syncing'));"
        webView.evaluateJavaScript(script) { _, error in
            if let error {
                Diag.error("Pet bubble push failed: \(error.localizedDescription)")
            } else {
                Diag.info("Pet bubble pushed (tokens=\(Int(self.today.tokens)), limits=\(self.limitsJSON == "null" ? "null" : "set"))")
            }
        }
    }

    /// Mirror the dashboard's appearance prefs out of localStorage. This is the
    /// cold-start path when no dashboard window is open (the dashboard also pushes
    /// the same values through setSetting, which lands immediately).
    func refreshCurrencyFromWebViews() {
        // Only a page that actually navigated can read localStorage: the quota
        // window's webview exists from launch but stays about:blank, and
        // localStorage on about:blank throws SecurityError — picking it as the
        // "first webview" made every mirror attempt fail with a JS exception.
        let candidate = petWebViewProvider?().flatMap { $0.url?.scheme == "http" ? $0 : nil }
            ?? NSApp.windows.compactMap({ WebHost.webView(in: $0) })
                .first(where: { $0.url?.scheme == "http" })
        guard let webView = candidate else { return }
        // The rates entry is either {rates:{...}} or the bare rates map
        // depending on where it was written — accept both shapes.
        let script = "JSON.stringify({c: localStorage.getItem('tokentracker-currency')," +
            "r: (function(){try{var d=JSON.parse(localStorage.getItem('tokentracker-exchange-rates')||'{}');return (d&&d.rates)||d||{};}catch(e){return {};}})()," +
            "u: localStorage.getItem('tt.tokenUnitSystem')})"
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self, let json = result as? String,
                  let obj = try? JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any] else {
                Diag.info("Pet prefs mirror: nothing readable (err=\(error?.localizedDescription ?? "nil") result=\(String(describing: result)))")
                return
            }
            DispatchQueue.main.async {
                // Unlike the old read, the unit system is NOT gated on the currency
                // key: a user who never touched the currency picker still gets K/M/B.
                let code = CurrencyPreferences.normalizeCode(obj["c"] as? String)
                let rates = obj["r"] as? [String: Double] ?? [:]
                let rate = rates[code] ?? CurrencyPreferences.defaultRates[code] ?? self.currencyRate
                let unit = (obj["u"] as? String).map {
                    Self.normalizeUnitSystem($0, fallback: self.tokenUnitSystem)
                } ?? self.tokenUnitSystem
                let changed = code != self.currencyCode
                    || unit != self.tokenUnitSystem
                    || abs(rate - self.currencyRate) > 0.0001
                guard changed else {
                    Diag.info("Pet prefs mirror: unchanged (\(code) \(unit) \(rate))")
                    return
                }
                self.applyCurrency(code: code, rate: rate)
                self.applyTokenUnitSystem(unit)
                Diag.info("Pet pill currency: \(self.currencySymbol) rate \(self.currencyRate) units \(self.tokenUnitSystem)")
                self.publishDisplayChange()
            }
        }
    }
}

/// Currency table shared by the pet pill, the capsule and the dashboard bridge —
/// mirrors dashboard/src/lib/currency.ts (CURRENCY_META / DEFAULT_RATES) so the
/// native surfaces never invent a symbol (the old code pushed "EUR12.34") and a
/// cold launch starts from the dashboard defaults (USD, no 7.2x guess).
enum CurrencyPreferences {
    static let supported = ["USD", "EUR", "GBP", "CNY", "JPY", "HKD"]

    static let symbols: [String: String] = [
        "USD": "$", "EUR": "€", "GBP": "£", "CNY": "¥", "JPY": "¥", "HKD": "HK$",
    ]

    static let defaultRates: [String: Double] = [
        "USD": 1, "EUR": 0.92, "GBP": 0.79, "CNY": 7.2, "JPY": 155, "HKD": 7.8,
    ]

    static func normalizeCode(_ raw: String?) -> String {
        let code = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() ?? ""
        return supported.contains(code) ? code : "USD"
    }

    static func symbol(for code: String) -> String {
        symbols[normalizeCode(code)] ?? "$"
    }
}
