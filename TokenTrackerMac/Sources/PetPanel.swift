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
            // Windows PetWindow navigates to the STATIC pet page with the app-mode
            // flag (/pet.html?app=1) — the bare /pet route is the SPA fallback and
            // renders the whole dashboard (the "pet window shows a stats card" bug).
            WebHost.load(webView, path: "/pet.html?app=1", on: serverURL)
        }
        panel.orderFrontRegardless()
        startHoverTracking()
    }

    func hide() {
        panel?.orderOut(nil)
        if lastHover { lastHover = false; pushHover(false) }
    }

    // MARK: Hover tracking (PetWindow.cs counterpart)

    private var hoverTimer: Timer?
    private var lastHover = false

    /// The page does NOT track the mouse itself — DOM mouse-leave is unreliable
    /// on this transparent, never-activated panel (pet.jsx says so verbatim).
    /// The host polls the OS cursor against the window rect and pushes
    /// window.__ttPetHover + a pet:hover event, exactly like PetWindow.cs.
    func startHoverTracking() {
        guard hoverTimer == nil else { return }
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
            self?.pollHover()
        }
        RunLoop.main.add(timer, forMode: .common)
        hoverTimer = timer
    }

    private func pollHover() {
        guard let panel, panel.isVisible else {
            if lastHover { lastHover = false; pushHover(false) }
            return
        }
        let inside = panel.frame.contains(NSEvent.mouseLocation)
        if inside != lastHover {
            lastHover = inside
            pushHover(inside)
        }
    }

    private func pushHover(_ hovering: Bool) {
        guard let webView = WebHost.webView(in: panel) else {
            Diag.error("Pet hover push: no webview in panel")
            return
        }
        let script = "window.__ttPetHover=\(hovering ? "true" : "false");" +
            "window.dispatchEvent(new Event('pet:hover'));" +
            "JSON.stringify({hover: window.__ttPetHover, tokens: window.__ttPetTokens, band: window.__ttPetBubbleBand})"
        webView.evaluateJavaScript(script) { result, error in
            if let error {
                Diag.error("Pet hover JS failed: \(error.localizedDescription)")
            } else if let json = result as? String {
                Diag.info("Pet page state: \(json)")
            }
        }
        Diag.info("Pet hover -> \(hovering)")
    }

    /// Base sprite window height (bubble/popup height is added on top).
    static let baseHeight: CGFloat = 340

    /// The bubble band the PAGE measured (pet:bubble-height:<n>) — the host
    /// stores it and re-pushes it; hardcoding a value here clobbers the page's
    /// own layout and clips the bubble at the window top edge.
    private(set) var bubbleBand: CGFloat = 64

    /// Grow the transparent host upward for the bubble / hover limits popup —
    /// the page measures its own content (pet:bubble-height:<n>) and the native
    /// side just obeys, keeping the sprite anchored at the bottom edge.
    func resizeForBubble(band: CGFloat) {
        bubbleBand = max(64, band)
        guard let panel else { return }
        let target = PetPanelController.baseHeight + bubbleBand
        var frame = panel.frame
        guard abs(frame.height - target) > 1 else { return }
        frame.origin.y += frame.height - target  // keep the bottom edge (sprite) anchored
        frame.size.height = target
        panel.setFrame(frame, display: true)
        Diag.info("Pet window resized for bubble band \(Int(bubbleBand)) -> \(Int(target))")
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
        // The page measures its hover limits popup / bubble and asks the host to
        // grow the window upward (PetWindow.cs: pet:bubble-height:<n>).
        window.addEventListener('pet:bubble-height', function (e) {
          var h = e && e.detail && Number(e.detail.height);
          window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tt.postMessage('pet:bubble-height:' + (Number.isFinite(h) ? h : 0));
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
            if body.hasPrefix("pet:bubble-height:") {
                let value = Int(body.dropFirst("pet:bubble-height:".count)) ?? 0
                resizeForBubble(band: CGFloat(value))
                return
            }
            Diag.info("Pet bridge message: \(body)")
        }
    }
}
