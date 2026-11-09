import AppKit
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

/// Standalone quota widget window — counterpart of MonitorWidgetWindow.cs.
/// v1 keeps it a small titled window hosting quota.html (the deskband/dock-style
/// pinned widget from Windows is a later batch).
final class WidgetWindowController: NSWindowController, NSWindowDelegate {
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
            WebHost.load(webView, path: "/quota", on: serverURL)
        }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        window?.contentView = nil
    }
}
