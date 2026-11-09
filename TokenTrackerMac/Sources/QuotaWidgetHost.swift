import AppKit
import WebKit

/// Host for quota.html?app=1 — the macOS counterpart of TokenTrackerWin's
/// QuotaWidgetWindow.cs protocol.
///
/// The quota page is host-driven: it never fetches anything itself. It posts
/// `quota:ready` / `quota:expand` / `quota:collapse` / `quota:drag` /
/// `quota:close` / `quota:select` through chrome.webview, and the host pushes
/// `quota:context` messages back ({limits, failed, selected, locale, light}).
final class QuotaWidgetHost {
    static let shared = QuotaWidgetHost()

    private var ready = false
    private var pollTimer: Timer?
    private var lastLimitsJSON: String?
    private var lastDragPoint: NSPoint?
    private(set) var failed = false
    private(set) var limitsJSON: String? = "null"

    /// Provided by AppDelegate: the quota widget window + visibility persistence.
    var windowProvider: (() -> NSWindow?)?
    var serverURLProvider: (() -> URL?)?
    var onClose: (() -> Void)?

    func handle(type: String, payload: [String: Any], webView: WKWebView) {
        switch type {
        case "quota:ready":
            ready = true
            fetchAndPush()
            startPolling()
        case "quota:select":
            if let ids = payload["ids"] as? [String] {
                UserDefaults.standard.set(ids, forKey: "TTPQuotaSelected")
                pushContext(limitsLiteral: limitsJSON ?? "null")
            }
        case "quota:expand":
            resize(expanded: true)
        case "quota:collapse":
            resize(expanded: false)
        case "quota:drag":
            dragWindow()
        case "quota:close":
            ready = false
            pollTimer?.invalidate()
            onClose?()
        default:
            break
        }
    }

    // MARK: Context push

    private func startPolling() {
        pollTimer?.invalidate()
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            self?.fetchAndPush()
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    func stop() {
        ready = false
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func fetchAndPush() {
        guard ready, let window = windowProvider?(), window.isVisible else { return }
        guard let base = serverURLProvider?(),
              let url = URL(string: base.absoluteString + "/functions/tokentracker-usage-limits") else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            DispatchQueue.main.async {
                let httpOK = (response as? HTTPURLResponse)?.statusCode == 200
                if error == nil, httpOK, let data,
                   let obj = try? JSONSerialization.jsonObject(with: data) {
                    self.failed = false
                    self.pushContext(limitsLiteral: self.jsonLiteral(obj))
                } else {
                    self.failed = true
                    self.pushContext(limitsLiteral: "null")
                }
            }
        }.resume()
    }

    private func pushContext(limitsLiteral: String) {
        guard let window = windowProvider?(),
              let webView = WebHost.webView(in: window) else { return }
        let selected = (UserDefaults.standard.array(forKey: "TTPQuotaSelected") as? [String])
            .map { entries in "[" + entries.map { "\"\($0)\"" }.joined(separator: ",") + "]" } ?? "null"
        let locale = Self.localeLiteral
        let light = !NSApp.effectiveAppearance.name.rawValue.contains("Dark")
        let payload = "{type:\"quota:context\",limits:\(limitsLiteral),failed:\(failed ? "true" : "false")," +
            "selected:\(selected),locale:\(locale),light:\(light ? "true" : "false")}"
        // Dedupe: identical payloads are skipped on the Windows side too.
        if payload == lastLimitsJSON { return }
        lastLimitsJSON = payload
        webView.evaluateJavaScript("window.chrome.webview.__dispatch(\(payload));", completionHandler: nil)
    }

    private func jsonLiteral(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else { return "null" }
        return json
    }

    private static var localeLiteral: String {
        let raw = Locale.current.identifier  // e.g. zh_CN
        let normalized = raw.replacingOccurrences(of: "_", with: "-")
        return "\"\(normalized)\""
    }

    // MARK: Window gestures

    private func resize(expanded: Bool) {
        guard let window = windowProvider?() else { return }
        var frame = window.frame
        let width: CGFloat = 420
        let height: CGFloat = expanded ? 600 : 112
        frame.origin.y += frame.height - height  // keep the top edge anchored
        frame.size.width = width
        frame.size.height = height
        window.setFrame(frame, display: true)
    }

    private func dragWindow() {
        guard let window = windowProvider?() else { return }
        let mouse = NSEvent.mouseLocation
        if let last = lastDragPoint {
            let dx = mouse.x - last.x, dy = mouse.y - last.y
            // A huge jump means a fresh grab — skip that first delta.
            if hypot(dx, dy) < 200 {
                window.setFrameOrigin(NSPoint(x: window.frame.origin.x + dx,
                                              y: window.frame.origin.y + dy))
            }
        }
        lastDragPoint = mouse
    }
}
