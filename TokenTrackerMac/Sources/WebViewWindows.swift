import AppKit
import CoreGraphics
import WebKit

/// Logs WKWebView navigation outcomes — without this, an unpainted webview in a
/// borderless panel is undiagnosable (the window shows only its backdrop).
final class WebNavLogger: NSObject, WKNavigationDelegate {
    static let shared = WebNavLogger()

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        Diag.info("[web] start \(webView.url?.absoluteString ?? "?")")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
        Diag.info("[web] done \(webView.url?.absoluteString ?? "?") title=\(webView.title ?? "")")
        if webView.url?.path.hasSuffix("/pet.html") == true {
            PetSettingsController.shared.pushToPetPage()
            // Windows NavigationCompleted -> PushContext: without this every
            // reopen sat blank until the next 60s poll.
            IslandStats.shared.pushPetBubble()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation?, withError error: Error) {
        Diag.error("[web] fail \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        Diag.error("[web] provisional fail \(error.localizedDescription)")
    }
}

/// Shared plumbing for windows that host a page of the local dashboard
/// (counterparts of TokenTrackerWin's WebView2-hosted windows).
enum WebHost {
    /// ATS: the shell loads plain http://127.0.0.1 — WKWebView allows loopback
    /// only with NSAllowsLocalNetworking (set in Info.plist), and this keeps the
    /// configuration in one place.
    static func makeWebView(frame: NSRect) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Pet-settings bridge shim: the dashboard's pet page posts to
        // `window.chrome.webview` (a WebView2-only object). Mirror it onto the
        // WKWebView message handler so the settings page sees a native host.
        // Shim v2: two-way chrome.webview — postMessage out, addEventListener +
        // native dispatch in (the quota widget listens for quota:context pushes).
        let shim = "window.chrome = window.chrome || {};" +
            "(function () {" +
            "  var listeners = {};" +
            "  window.chrome.webview = {" +
            "    postMessage: function (msg) {" +
            "      try { window.webkit.messageHandlers.petBridge.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) {}" +
            "    }," +
            "    addEventListener: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); }," +
            "    removeEventListener: function (type, fn) { var a = listeners[type] || []; var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }," +
            "    __dispatch: function (payload) { var a = (listeners['message'] || []).slice(); for (var i = 0; i < a.length; i++) { try { a[i]({ data: payload }); } catch (e) {} } }" +
            "  };" +
            "})();"
        configuration.userContentController.addUserScript(
            WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.add(PetSettingsController.shared, name: "petBridge")

        let webView = WKWebView(frame: frame, configuration: configuration)
        webView.setValue(false, forKey: "drawsBackground") // transparent surface
        if #available(macOS 12.0, *) {
            // The documented knob behind the same effect — drawsBackground KVC
            // alone left the pet panel painting white on this macOS build.
            webView.underPageBackgroundColor = .clear
        }
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = WebNavLogger.shared
        return webView
    }

    /// The webview IS the contentView in these windows (assigned directly), so
    /// look there first; the subview scan is only a fallback for container
    /// layouts. Getting this wrong meant load() was never called — the windows
    /// shipped as blank surfaces (the "black empty popup" bug).
    static func webView(in window: NSWindow?) -> WKWebView? {
        if let contentView = window?.contentView as? WKWebView {
            return contentView
        }
        return window?.contentView?.subviews.compactMap { $0 as? WKWebView }.first
    }

    /// JSON-encoded JS string literal — never interpolate raw user/page data
    /// (character ids, currency symbols from localStorage, locale ids) straight
    /// into evaluateJavaScript; a stray quote breaks or injects the script.
    static func jsString(_ value: String) -> String {
        // JSONSerialization rejects a bare top-level String (ObjC exception ->
        // abort); JSONEncoder happily encodes a fragment as "…".
        guard let data = try? JSONEncoder().encode(value),
              let literal = String(data: data, encoding: .utf8) else { return "\"\"" }
        return literal
    }

    static func load(_ webView: WKWebView, path: String, on serverURL: URL) {
        if let url = URL(string: serverURL.absoluteString + path) {
            Diag.info("[web] load \(url.absoluteString)")
            webView.load(URLRequest(url: url))
        } else {
            Diag.error("[web] bad URL for path \(path)")
        }
    }
}

/// The full dashboard in a regular titled window — counterpart of DashboardWindow.cs.
final class DashboardWindowController: NSWindowController, NSWindowDelegate {
    private let serverURL: URL

    init(serverURL: URL) {
        self.serverURL = serverURL
        let rect = NSRect(x: 0, y: 0, width: 1280, height: 840)
        let window = NSWindow(contentRect: rect,
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "TokenTracker Plus"
        window.contentView = WebHost.makeWebView(frame: rect)
        window.setFrameAutosaveName("TTPDashboardWindow")
        window.center()
        super.init(window: window)
        window.delegate = self
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// Own presenter (not an override of `showWindow:`) — the ObjC method name
    /// made Swift treat the call site as ambiguous.
    func presentWindow() {
        guard let window else { return }
        if WebHost.webView(in: window) == nil {
            window.contentView = WebHost.makeWebView(frame: window.contentRect(forFrameRect: window.frame))
        }
        if let webView = WebHost.webView(in: window) {
            WebHost.load(webView, path: "/dashboard", on: serverURL)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        // WebKit keeps buffers alive; drop the view so a reopen reloads fresh.
        window?.contentView = nil
    }
}

/// Quota widget window — counterpart of TokenTrackerWin's QuotaWidgetWindow.cs
/// (loads the static quota page in app mode: /quota.html?app=1).
final class QuotaWidgetWindowController: NSWindowController, NSWindowDelegate {
    private let serverURL: URL

    init(serverURL: URL) {
        self.serverURL = serverURL
        let rect = NSRect(x: 0, y: 0, width: 420, height: 560)
        let window = NSWindow(contentRect: rect,
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "额度窗"
        window.contentView = WebHost.makeWebView(frame: rect)
        window.setFrameAutosaveName("TTPWidgetWindow")
        window.center()
        super.init(window: window)
        window.delegate = self
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func presentWindow() {
        guard let window else { return }
        if WebHost.webView(in: window) == nil {
            window.contentView = WebHost.makeWebView(frame: window.contentRect(forFrameRect: window.frame))
        }
        if let webView = WebHost.webView(in: window) {
            WebHost.load(webView, path: "/quota.html?app=1", on: serverURL)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        window?.contentView = nil
    }
}



