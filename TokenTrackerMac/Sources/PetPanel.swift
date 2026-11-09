import AppKit
import WebKit

/// The floating pet — counterpart of PetWindow.cs. A transparent, non-activating
/// panel hosting pet.html. v1 interaction: draggable by background, left-click
/// actions come from the page's pet:* events, right-click opens the shell menu.
final class PetPanelController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    private let serverURL: URL
    private(set) var panel: NSPanel?
    /// Fired when the page asks to open the dashboard (pet:open-dashboard).
    var onOpenDashboard: (() -> Void)?
    /// Fired on right-click inside the pet (the host shows the context menu).
    var onContextMenu: ((NSPoint) -> Void)?

    init(serverURL: URL) {
        self.serverURL = serverURL
        super.init()
    }

    var isVisible: Bool { panel?.isVisible ?? false }

    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        if WebHost.webView(in: panel) == nil {
            let fresh = WebHost.makeWebView(frame: panel.contentRect(forFrameRect: panel.frame))
            configureBridge(fresh)
            panel.contentView = fresh
        }
        if let webView = WebHost.webView(in: panel) {
            WebHost.load(webView, path: "/pet", on: serverURL)
        }
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    func toggle() {
        isVisible ? hide() : show()
    }

    /// Reposition to the bottom-right corner (first show after launch) — the
    /// Windows pet's default dock spot.
    func placeAtDefaultCorner() {
        guard let panel, let screen = NSScreen.main else {
            Diag.error("Pet corner placement skipped (no screen)")
            return
        }
        let frame = panel.frame
        let origin = NSPoint(x: screen.visibleFrame.maxX - frame.width - 24,
                             y: screen.visibleFrame.minY + 8)
        panel.setFrameOrigin(origin)
        Diag.info("Pet placed at \(origin)")
    }

    // MARK: Panel construction

    private func makePanel() -> NSPanel {
        let rect = NSRect(x: 0, y: 0, width: 320, height: 340)
        let panel = NSPanel(contentRect: rect,
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.delegate = self
        self.panel = panel   // placeAtDefaultCorner reads self.panel — set before placing
        placeAtDefaultCorner()
        return panel
    }

    private func configureBridge(_ webView: WKWebView) {
        // Mirror PetWindow.cs: the page sets window.__ttPet<name> flags and
        // dispatches pet:<name> DOM events. Forward the known events to native;
        // the context menu is a plain contextmenu handler.
        let source = """
        document.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tt.postMessage('menu');
        });
        ['pet:open-dashboard', 'pet:menu', 'pet:settings'].forEach(function (name) {
          window.addEventListener(name, function () {
            window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tt.postMessage(name);
          });
        });
        """
        let script = WKUserScript(source: source, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        webView.configuration.userContentController.addUserScript(script)
        webView.configuration.userContentController.add(self, name: "tt")
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? String else { return }
        switch body {
        case "pet:open-dashboard":
            onOpenDashboard?()
        case "menu":
            onContextMenu?(NSEvent.mouseLocation)
        default:
            Diag.info("Pet bridge message: \(body)")
        }
    }
}
