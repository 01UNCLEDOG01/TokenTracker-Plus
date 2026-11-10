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
            // Load only when the page has never navigated — a re-show must not
            // reload (state/animation/scroll would reset; Windows only navigates
            // when the webview is new).
            if webView.url == nil {
                // Windows PetWindow navigates to the STATIC pet page with the
                // app-mode flag (/pet.html?app=1).
                WebHost.load(webView, path: "/pet.html?app=1", on: serverURL)
            } else {
                lastHover = false
                pushHover(false)
            }
        }
        panel.orderFrontRegardless()
        startHoverTracking()
    }

    func hide() {
        panel?.orderOut(nil)
        if lastHover { lastHover = false; pushHover(false) }
        // A hide mid-drag must not leave the 60Hz loop running.
        dragTimer?.invalidate()
        dragTimer = nil
        dragStartMouse = nil
        dragStartFrame = nil
    }

    // MARK: Hover tracking (PetWindow.cs counterpart)

    private var hoverTimer: Timer?
    private var lastHover = false
    // Mouse idle / wake tracking (PetWindow.cs: >=60s stillness -> pet:sleep,
    // first movement afterwards -> pet:wake).
    private var lastMouseActive = Date()
    private var lastMousePos = NSPoint(x: -1, y: -1)
    private var mouseIdle = false

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
        pollIdle()
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

    // MARK: Native drag (WM_NCLBUTTONDOWN/HTCAPTION counterpart)

    private var dragTimer: Timer?
    private var dragStartMouse: NSPoint?
    private var dragStartFrame: NSPoint?
    private var dragStartedAt = Date.distantPast

    /// The page hands the press to the host once the pointer travels past its
    /// drag threshold (pet.jsx: post "pet:drag-left/right"). Windows starts the
    /// OS modal move loop; here a 60Hz cursor-follow loop plays that role and
    /// the drag-state events drive the run animation.
    func beginNativeDrag(direction: String) {
        guard let panel else { return }
        dragTimer?.invalidate()
        dragStartMouse = NSEvent.mouseLocation
        dragStartFrame = panel.frame.origin
        dragStartedAt = Date()
        pushPetEvent("window.__ttPetDragState=\"\(direction)\";window.dispatchEvent(new Event('pet:drag-state'));")
        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in
            self?.stepNativeDrag()
        }
        RunLoop.main.add(timer, forMode: .common)
        dragTimer = timer
        Diag.info("Pet native drag started (\(direction))")
    }

    private func stepNativeDrag() {
        guard let panel, let startMouse = dragStartMouse, let startFrame = dragStartFrame else { return }
        // Watchdog: a lost mouse-up (Mission Control, secure input) must not
        // leave the pet glued to the cursor forever (Windows finally-parity).
        if NSEvent.pressedMouseButtons == 0 || Date().timeIntervalSince(dragStartedAt) > 120 {
            dragTimer?.invalidate()
            dragTimer = nil
            dragStartMouse = nil
            dragStartFrame = nil
            pushPetEvent("window.__ttPetDragState=null;window.dispatchEvent(new Event('pet:drag-end'));")
            clampIntoVisibleFrame(panel)
            Diag.info("Pet native drag ended at \(panel.frame.origin)")
            return
        }
        let mouse = NSEvent.mouseLocation
        panel.setFrameOrigin(NSPoint(x: startFrame.x + (mouse.x - startMouse.x),
                                    y: startFrame.y + (mouse.y - startMouse.y)))
    }

    /// 60s mouse stillness -> pet:sleep; movement -> pet:wake (PetWindow.cs).
    private func pollIdle() {
        let now = NSEvent.mouseLocation
        let moved = now != lastMousePos
        if moved {
            lastMousePos = now
            lastMouseActive = Date()
            if mouseIdle {
                mouseIdle = false
                pushPetEvent("window.dispatchEvent(new CustomEvent('pet:wake'));")
            }
        } else if !mouseIdle, Date().timeIntervalSince(lastMouseActive) >= 60 {
            mouseIdle = true
            pushPetEvent("window.dispatchEvent(new CustomEvent('pet:sleep', { detail: { phase: 'sleeping' } }));")
        }
    }

    private func pushPetEvent(_ script: String) {
        // Hidden windows don't need sleep/wake ticks pushed into them.
        guard let panel, panel.isVisible, let webView = WebHost.webView(in: panel) else { return }
        webView.evaluateJavaScript(script, completionHandler: nil)
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

    /// Windows Place() clamps placement into the work area; an off-screen saved
    /// frame (or a drag that ran past the edge) must snap back.
    func clampIntoVisibleFrame(_ panel: NSWindow) {
        guard let screen = panel.screen ?? NSScreen.main else { return }
        let visible = screen.visibleFrame
        var frame = panel.frame
        frame.origin.x = min(max(frame.origin.x, visible.minX), visible.maxX - frame.width)
        frame.origin.y = min(max(frame.origin.y, visible.minY), visible.maxY - frame.height)
        if frame.origin != panel.frame.origin {
            panel.setFrameOrigin(frame.origin)
        }
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
        panel.setFrameAutosaveName("TTPPetPanel")   // position memory (Windows saves placement)
        self.panel = panel   // placeAtDefaultCorner reads self.panel — set before placing
        // A stored frame wins; only first launch falls back to the corner dock.
        if UserDefaults.standard.dictionary(forKey: "NSWindow Frame TTPPetPanel") == nil {
            placeAtDefaultCorner()
        } else {
            clampIntoVisibleFrame(panel)
            Diag.info("Pet restored saved position \(panel.frame.origin)")
        }
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
