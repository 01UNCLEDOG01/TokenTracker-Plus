import AppKit
import WebKit

/// Host for `quota.html?app=1` — the native counterpart of TokenTrackerWin's
/// QuotaWidgetWindow.cs ("a tray-owned quota surface"). A small borderless
/// panel whose webview never fetches anything itself: the page posts
/// `quota:ready` / `quota:expand` / `quota:collapse` / `quota:drag` /
/// `quota:close` / `quota:select` through the chrome.webview shim, and this
/// host pushes `quota:context` back ({limits, failed, selected, locale, light}).
///
/// Windows contract parity: enable state + free position + the two picked rows
/// persist (`QuotaWidgetSettings`), `quota:close` disables the surface
/// entirely (not just hides it), the window reopens at its saved spot else
/// right edge − 16pt, one third down from the top, and `quota:ready` resets
/// the context de-dupe cache so a reopened window is never blank. Fullscreen
/// suppression is deliberately absent (the island/pet lack it too — KI-073).
@MainActor
final class QuotaPanelController: NSObject {
    static let shared = QuotaPanelController()

    private var panel: NSPanel?
    private var webView: WKWebView?
    private var ready = false
    private var pollTimer: Timer?
    private var retryTimer: Timer?
    private var retryCount = 0
    private let maxRetries = 5
    /// De-dupe cache for context pushes (Windows `_lastContext`): repeated
    /// identical payloads are skipped, and `quota:ready` drops it so a fresh
    /// page load always receives its first context.
    private var lastContextJSON: String?
    private(set) var expanded = false
    private(set) var failed = false
    /// Last fetched limits literal — re-pushed verbatim on theme/locale flips.
    private var limitsLiteral: String = "null"

    /// Provided by the app entry: opens the main dashboard window.
    var onOpenDashboard: (() -> Void)?

    /// Live drag state: the page posts ONE `quota:drag` when the grab passes
    /// its 4pt threshold, so the host runs the follow loop itself (Windows
    /// drags via a modal WM_NCLBUTTONDOWN loop; the legacy mac host followed
    /// the cursor at 60Hz — same approach here).
    private var dragTimer: Timer?
    private var dragAnchor: (mouse: NSPoint, window: NSPoint)?
    /// Position persists at most once a second while a drag moves the panel;
    /// a forced flush lands when the drag settles.
    private var lastPersistAt = Date.distantPast
    private var effectiveAppearanceObservation: NSKeyValueObservation?

    var isVisible: Bool { panel?.isVisible ?? false }

    // MARK: - Persistence keys

    /// The enable toggle persisted by NativeBridge's `PetSurfacePreference`
    /// ("QuotaWidgetEnabled") — one key so the pet-page toggle, the menu item
    /// and the window's own close button all agree.
    private var isEnabledStored: Bool { NativeBridge.PetSurfacePreference.quotaEnabled }
    /// Saved free position ({x, y}), mirroring QuotaWidgetSettings.X/Y.
    private static let frameKey = "TTPQuotaFrame"
    /// Picked compact rows (Windows `Selected`, max 2).
    private static let selectedKey = "TTPQuotaSelected"

    // MARK: - Enable / show

    func setEnabled(_ enabled: Bool) {
        // Idempotent: the bridge setter may have persisted the value already,
        // the page's ✕ arrives with the stored value still true. The panel is
        // the single source of teardown, the preference the single source of
        // enable state — both paths converge here.
        if NativeBridge.PetSurfacePreference.quotaEnabled != enabled {
            NativeBridge.PetSurfacePreference.setQuotaEnabled(enabled)
        }
        if enabled {
            show()
        } else if panel != nil {
            teardown()
        }
        // The pet page's 桌面限额 checkbox and the getSettings capability echo
        // must follow — same channel the bridge's own `quota` setter uses.
        NativeBridge.shared.pushPetSettings()
        NativeBridge.shared.pushSettings()
    }

    /// Startup restore: the shell calls this once the server is reachable and
    /// floating surfaces may open.
    func restoreFromSettingsIfNeeded() {
        guard isEnabledStored, panel == nil else { return }
        show()
    }

    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        panel.orderFrontRegardless()
        registerEffectiveAppearanceObserverIfNeeded()
        load()
    }

    func hide() {
        panel?.orderOut(nil)
        ready = false
        stopPolling()
        stopDrag()
    }

    /// Full teardown (Windows `SetEnabled(false)` → `Hide` + `ReleaseView`):
    /// the webview is dropped so an invisible quota page holds no process.
    private func teardown() {
        hide()
        retryTimer?.invalidate(); retryTimer = nil
        effectiveAppearanceObservation?.invalidate()
        effectiveAppearanceObservation = nil
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "quotaBridge")
        webView = nil
        panel = nil
        ready = false
        lastContextJSON = nil
        limitsLiteral = "null"
    }

    // MARK: - Page messages

    func handle(message: WKScriptMessage) {
        // The page sends plain command strings for everything except selection
        // ("quota:ready" / "quota:expand" / "quota:collapse" / "quota:drag" /
        // "quota:close" / "quota:dashboard"); only "quota:select" is a JSON
        // object because it carries the ids array. Parse JSON first, then fall
        // back to the plain command — requiring JSON here silently dropped five
        // of the six host messages.
        if let body = message.body as? String {
            if let data = body.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                handle(type: obj["type"] as? String ?? "", payload: obj)
                return
            }
            handle(type: body, payload: [:])
            return
        }
        if let obj = message.body as? [String: Any] {
            handle(type: obj["type"] as? String ?? "", payload: obj)
        }
    }

    private func handle(type: String, payload: [String: Any]) {
        switch type {
        case "quota:ready":
            // Windows quota:ready: compact size, drop the de-dupe cache so the
            // first context arrives, push immediately, start polling.
            ready = true
            lastContextJSON = nil
            resize(expanded: false)
            fetchAndPush()
            startPolling()
        case "quota:select":
            if let ids = payload["ids"] as? [String] {
                // Windows clamps the selection to two rows and drops blanks.
                let cleaned: [String] = ids.filter { !$0.isEmpty }.prefix(2).map { $0 }
                UserDefaults.standard.set(cleaned, forKey: Self.selectedKey)
                pushContext()
            }
        case "quota:expand":
            resize(expanded: true)
        case "quota:collapse":
            resize(expanded: false)
        case "quota:drag":
            beginDrag()
        case "quota:close":
            // The page's ✕ is a full disable (Windows SetEnabled(false)).
            setEnabled(false)
        case "quota:dashboard":
            onOpenDashboard?()
        default:
            break
        }
    }

    // MARK: - Context push

    private func startPolling() {
        pollTimer?.invalidate()
        let timer = Timer(timeInterval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.fetchAndPush() }
        }
        RunLoop.main.add(timer, forMode: .common)
        pollTimer = timer
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }

    private func fetchAndPush() {
        guard ready, isVisible else { return }
        var request = URLRequest(url: URL(string: Constants.serverBaseURL + "/functions/tokentracker-usage-limits")!)
        request.timeoutInterval = 8
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                let httpOK = (response as? HTTPURLResponse)?.statusCode == 200
                if error == nil, httpOK, let data,
                   let obj = try? JSONSerialization.jsonObject(with: data) {
                    self.failed = false
                    self.limitsLiteral = Self.jsonLiteral(obj)
                } else {
                    self.failed = true
                    self.limitsLiteral = "null"
                }
                self.pushContext()
            }
        }.resume()
    }

    private func pushContext() {
        guard ready, isVisible, let webView else { return }
        let selected = (UserDefaults.standard.array(forKey: Self.selectedKey) as? [String])?
            .map { Self.jsString($0) }.joined(separator: ",")
        let selectedLiteral = selected == nil ? "null" : "[\(selected!)]"
        let locale = Self.localeLiteral
        let light = !NSApp.effectiveAppearance.name.rawValue.contains("Dark")
        let payload = "{type:\"quota:context\",limits:\(limitsLiteral),failed:\(failed ? "true" : "false")," +
            "selected:\(selectedLiteral),locale:\(locale),light:\(light ? "true" : "false")}"
        // Windows skips identical payloads; a theme flip forces a change, so
        // nothing on this surface goes stale.
        if payload == lastContextJSON { return }
        lastContextJSON = payload
        webView.evaluateJavaScript("window.chrome?.webview?.__dispatch?.(\(payload));", completionHandler: nil)
    }

    private static func jsonLiteral(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let json = String(data: data, encoding: .utf8) else { return "null" }
        return json
    }

    /// JSON-encoded JS string literal — JSONEncoder, never interpolation (the
    /// legacy host's jsString: JSONSerialization aborts on bare strings).
    private static func jsString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value),
              let literal = String(data: data, encoding: .utf8) else { return "\"\"" }
        return literal
    }

    private static var localeLiteral: String {
        // The page feeds this to setCopyLocale + Intl formatting; the shell's
        // resolved preference (zh-CN / de / …) is what the dashboard itself uses.
        let raw = NativeLocalization.currentPreference
        let normalized = raw.replacingOccurrences(of: "_", with: "-")
        return jsString(normalized)
    }

    // MARK: - Window gestures

    /// Windows QuotaWidgetWindow.ResizeWidget sizes: 320x144 compact, 360x340
    /// expanded — top edge anchored, horizontally re-centred.
    private func resize(expanded: Bool) {
        self.expanded = expanded
        guard let panel else { return }
        var frame = panel.frame
        let width: CGFloat = expanded ? 360 : 320
        let height: CGFloat = expanded ? 340 : 144
        frame.origin.y += frame.height - height  // keep the top edge anchored
        frame.origin.x += (frame.width - width) / 2
        frame.size = NSSize(width: width, height: height)
        panel.setFrame(frame, display: true)
        persistPosition(force: true)
    }

    private func beginDrag() {
        guard let panel else { return }
        stopDrag()
        dragAnchor = (mouse: NSEvent.mouseLocation, window: panel.frame.origin)
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.stepDrag() }
        }
        RunLoop.main.add(timer, forMode: .common)
        dragTimer = timer
    }

    private func stepDrag() {
        guard let panel, let anchor = dragAnchor else {
            stopDrag()
            return
        }
        guard NSEvent.pressedMouseButtons != 0 else {
            stopDrag()
            persistPosition(force: true)
            return
        }
        let mouse = NSEvent.mouseLocation
        panel.setFrameOrigin(NSPoint(x: anchor.window.x + (mouse.x - anchor.mouse.x),
                                     y: anchor.window.y + (mouse.y - anchor.mouse.y)))
        persistPosition()
    }

    private func stopDrag() {
        dragTimer?.invalidate()
        dragTimer = nil
        dragAnchor = nil
    }

    private func persistPosition(force: Bool = false) {
        guard let panel else { return }
        let now = Date()
        guard force || now.timeIntervalSince(lastPersistAt) >= 1 else { return }
        lastPersistAt = now
        UserDefaults.standard.set(["x": panel.frame.origin.x, "y": panel.frame.origin.y],
                                  forKey: Self.frameKey)
    }

    // MARK: - Panel construction

    private func makePanel() -> NSPanel {
        let rect = NSRect(x: 0, y: 0, width: 320, height: 144)
        let panel = NSPanel(contentRect: rect,
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false  // the page draws its own rounded card + shadow
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = false  // dragging is host-driven
        panel.delegate = self

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // chrome.webview shim (same proven shape as the legacy shell): the page
        // posts out through the quotaBridge handler; pushes arrive via __dispatch.
        let shim = "window.chrome = window.chrome || {};" +
            "(function () {" +
            "  var listeners = {};" +
            "  window.chrome.webview = {" +
            "    postMessage: function (msg) {" +
            "      try { window.webkit.messageHandlers.quotaBridge.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) {}" +
            "    }," +
            "    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); }," +
            "    removeEventListener: function (type, fn) { var a = listeners[type] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }," +
            "    __dispatch: function (payload) { var a = (listeners['message'] || []).slice(); for (var i = 0; i < a.length; i++) { try { a[i]({ data: payload }); } catch (e) {} } }" +
            "  };" +
            "})();"
        configuration.userContentController.addUserScript(
            WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(self, name: "quotaBridge")

        let webView = WKWebView(frame: rect, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = .clear
        }
        webView.navigationDelegate = self
        self.webView = webView
        panel.contentView = webView

        place(panel, restore: true)
        return panel
    }

    /// Windows Place(restore): saved X/Y, else right edge − 16pt, one third
    /// down from the top of the work area; clamped fully on screen. Applied on
    /// every show so a display change cannot strand the panel off-screen.
    private func place(_ panel: NSPanel, restore: Bool) {
        guard let screen = panel.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        let saved = restore ? UserDefaults.standard.dictionary(forKey: Self.frameKey) : nil
        let x = (saved?["x"] as? Double) ?? (visible.maxX - panel.frame.width - 16)
        let y = (saved?["y"] as? Double) ?? (visible.maxY - visible.height / 3 - panel.frame.height)
        let clampedX = min(max(x, visible.minX), visible.maxX - panel.frame.width)
        let clampedY = min(max(y, visible.minY), visible.maxY - panel.frame.height)
        panel.setFrameOrigin(NSPoint(x: clampedX, y: clampedY))
    }

    private func load() {
        guard let webView else { return }
        // Only the local quota page may load here (Windows AllowedSource).
        guard let url = URL(string: Constants.serverBaseURL + "/quota.html?app=1") else { return }
        webView.load(URLRequest(url: url))
    }

    private func registerEffectiveAppearanceObserverIfNeeded() {
        guard effectiveAppearanceObservation == nil else { return }
        effectiveAppearanceObservation = NSApp.observe(\.effectiveAppearance, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async {
                self?.lastContextJSON = nil
                self?.pushContext()
            }
        }
    }
}

extension QuotaPanelController: NSWindowDelegate {
    func windowWillClose(_ notification: Notification) {
        // An external close (⌘W routed to the panel) means disable, matching
        // the page's ✕ and the Windows shell.
        setEnabled(false)
    }
}

extension QuotaPanelController: WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        handle(message: message)
    }
}

extension QuotaPanelController: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        // Same-origin /quota.html only — anything else is cancelled outright.
        if let url = navigationAction.request.url,
           url.absoluteString.hasPrefix(Constants.serverBaseURL + "/quota.html"),
           url.host == URL(string: Constants.serverBaseURL)?.host {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        retryCount = 0
        retryTimer?.invalidate(); retryTimer = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        scheduleLoadRetry()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        // Cold start ordering: the panel may show before ServerManager has a
        // listener on 17680 — retry with the same budget as the dashboard.
        scheduleLoadRetry()
    }

    private func scheduleLoadRetry() {
        guard isEnabledStored, retryCount < maxRetries else { return }
        retryCount += 1
        retryTimer?.invalidate()
        let timer = Timer(timeInterval: TimeInterval(2 * retryCount), repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.load() }
        }
        RunLoop.main.add(timer, forMode: .common)
        retryTimer = timer
    }
}
