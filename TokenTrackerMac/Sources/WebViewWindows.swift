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
    static func makeWebView(frame: NSRect, headerDragRegion: Bool = false) -> WKWebView {
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
        if headerDragRegion {
            // The webview covers the whole window, so isMovableByWindowBackground
            // never sees a mousedown. Give the page's pointer stream a drag
            // gesture that reports screen deltas to native.
            let drag = """
            (function () {
              var last = null;
              document.addEventListener('pointerdown', function (e) { last = { x: e.screenX, y: e.screenY }; }, true);
              document.addEventListener('pointermove', function (e) {
                if (last && (e.buttons & 1)) {
                  window.chrome.webview.postMessage(JSON.stringify({ type: 'panel:drag', x: e.screenX, y: e.screenY }));
                }
                last = { x: e.screenX, y: e.screenY };
              }, true);
              document.addEventListener('pointerup', function (e) { last = null; window.chrome.webview.postMessage(JSON.stringify({ type: 'panel:drag-end' })); }, true);
            })();
            """
            configuration.userContentController.addUserScript(
                WKUserScript(source: drag, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        }
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


/// Desktop control panel — counterpart of TokenTrackerWin's MonitorWidgetWindow
/// (the always-visible desktop widget). Frameless, non-activating, pinned at the
/// desktop window level so it sits behind normal windows but stays on screen;
/// hosts the ROOT page in app mode (/?app=1) — the same contract as the upstream
/// macOS shell's dashboard surface.
final class DesktopWidgetWindowController: NSWindowController {
    private let serverURL: URL

    init(serverURL: URL) {
        self.serverURL = serverURL
        let rect = NSRect(x: 0, y: 0, width: 360, height: 480)
        let panel = InteractiveDesktopPanel(contentRect: rect,
                                            styleMask: [.borderless, .nonactivatingPanel],
                                            backing: .buffered, defer: false)
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.92)
        panel.hasShadow = true
        // Desktop-icon level + 1: sitting at plain desktopWindow level puts the
        // panel BELOW Finder's full-screen desktop backdrop, which eats every
        // click (the "panel unclickable" report). One level above the icons keeps
        // the panel behind all normal windows but lets clicks land.
        panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)) + 21)  // icon level + 1 (header: icon = desktop + 20)
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.contentView = WebHost.makeWebView(frame: rect, headerDragRegion: true)
        super.init(window: panel)
        placeAtDefaultCorner()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    func show() {
        guard let window else { return }
        if let webView = WebHost.webView(in: window) {
            WebHost.load(webView, path: "/?app=1", on: serverURL)
        }
        window.orderFrontRegardless()
    }

    func placeAtDefaultCorner() {
        guard let window, let screen = NSScreen.main else { return }
        let frame = window.frame
        let origin = NSPoint(x: screen.visibleFrame.maxX - frame.width - 16,
                             y: screen.visibleFrame.maxY - frame.height - 12)
        window.setFrameOrigin(origin)
    }
}


/// Desktop-level panels can't become key by default, which swallowed every
/// click into the webview; this subclass makes the desktop control panel
/// interactive (clicks, scrolling, buttons) while staying at desktop level.
final class InteractiveDesktopPanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}
