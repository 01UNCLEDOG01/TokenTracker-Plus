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
    /// Live drag state: the page posts ONE quota:drag when the grab passes its
    /// threshold (quota.jsx onPointerMove), so the host has to run the follow loop
    /// itself. The old delta arithmetic against a stale lastDragPoint made the
    /// first drag a no-op and every later grab teleport.
    private var dragTimer: Timer?
    private var dragAnchor: (mouse: NSPoint, window: NSPoint)?
    /// Expanded (360x340) vs compact (320x144) — Windows ResizeWidget parity.
    private(set) var expanded = false
    private(set) var failed = false
    private(set) var limitsJSON: String? = "null"

    /// Provided by AppDelegate: the quota widget window + visibility persistence.
    var windowProvider: (() -> NSWindow?)?
    var serverURLProvider: (() -> URL?)?
    var onClose: (() -> Void)?
    var onOpenDashboard: (() -> Void)?

    func handle(type: String, payload: [String: Any], webView: WKWebView) {
        switch type {
        case "quota:ready":
            // A fresh page load re-registers its listener; the de-dupe cache
            // must drop so the first context actually arrives (Windows sets
            // _lastContext = null here — otherwise reopen = blank forever).
            ready = true
            lastLimitsJSON = nil
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
            beginDrag()
        case "quota:close":
            ready = false
            pollTimer?.invalidate()
            onClose?()
        case "quota:dashboard":
            onOpenDashboard?()
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
        stopDrag()
    }

    /// Called by the window controller when the user closes the window with its
    /// own close affordance — the page's quota:close path and this one converge.
    func notifyWindowClosed() {
        stop()
        onClose?()
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
            .map { entries in "[" + entries.map { WebHost.jsString($0) }.joined(separator: ",") + "]" } ?? "null"
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

    /// Windows QuotaWidgetWindow.ResizeWidget sizes: 320x144 compact, 360x340
    /// expanded. The old 420x112/420x600 pair clipped the compact row and left a
    /// large empty card when expanded.
    private func resize(expanded: Bool) {
        self.expanded = expanded
        guard let window = windowProvider?() else { return }
        var frame = window.frame
        let width: CGFloat = expanded ? 360 : 320
        let height: CGFloat = expanded ? 340 : 144
        frame.origin.y += frame.height - height  // keep the top edge anchored
        frame.origin.x += (frame.width - width) / 2
        frame.size = NSSize(width: width, height: height)
        window.setFrame(frame, display: true)
    }

    /// Windows drags the borderless window with a modal WM_NCLBUTTONDOWN loop;
    /// follow the cursor at 60Hz until the mouse button is released.
    private func beginDrag() {
        guard let window = windowProvider?() else { return }
        stopDrag()
        dragAnchor = (mouse: NSEvent.mouseLocation, window: window.frame.origin)
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            self?.stepDrag()
        }
        RunLoop.main.add(timer, forMode: .common)
        dragTimer = timer
    }

    private func stepDrag() {
        guard let window = windowProvider?(), let anchor = dragAnchor else {
            stopDrag()
            return
        }
        guard NSEvent.pressedMouseButtons != 0 else {
            stopDrag()
            // Borderless window: no titlebar to grab it back, so never let a fling
            // leave it fully off-screen.
            clampToVisible(window)
            return
        }
        let mouse = NSEvent.mouseLocation
        window.setFrameOrigin(NSPoint(x: anchor.window.x + (mouse.x - anchor.mouse.x),
                                      y: anchor.window.y + (mouse.y - anchor.mouse.y)))
    }

    private func stopDrag() {
        dragTimer?.invalidate()
        dragTimer = nil
        dragAnchor = nil
    }

    private func clampToVisible(_ window: NSWindow) {
        guard let screen = window.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        var frame = window.frame
        frame.origin.x = min(max(frame.origin.x, visible.minX), visible.maxX - frame.width)
        frame.origin.y = min(max(frame.origin.y, visible.minY), visible.maxY - frame.height)
        if frame.origin != window.frame.origin {
            window.setFrameOrigin(frame.origin)
        }
    }
}
