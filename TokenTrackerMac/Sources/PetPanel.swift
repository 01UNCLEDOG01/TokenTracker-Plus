import AppKit
import WebKit

/// The floating pet — counterpart of PetWindow.cs. A transparent, non-activating
/// panel hosting pet.html. v1 interaction: draggable by background, left-click
/// actions come from the page's pet:* events, right-click opens the shell menu.
final class PetPanelController: NSObject, NSWindowDelegate, WKScriptMessageHandler {
    /// NSWindow frame autosave slot (Window placement memory, Windows Parity).
    private static let frameAutosaveName = "TTPPetPanel"
    /// Resolved lazily: ServerManager picks the first free port in start(), so a
    /// URL captured in the initializer would point at a port the server does not
    /// own (pet/quota then load an orphan server or a blank page).
    private let serverURLProvider: () -> URL
    private(set) var panel: NSPanel?
    /// Size bucket driving the window's fixed width + base height (Windows
    /// PetWindow.CurrentSize parity).
    private(set) var sizePreset: PetSizePreset
    /// Fired when the page asks to open the dashboard (pet:open-dashboard).
    var onOpenDashboard: (() -> Void)?
    /// Fired on right-click inside the pet (the host shows the context menu).
    var onContextMenu: ((NSPoint) -> Void)?

    init(serverURLProvider: @escaping () -> URL, sizePreset: PetSizePreset = .medium) {
        self.serverURLProvider = serverURLProvider
        self.sizePreset = sizePreset
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
                WebHost.load(webView, path: "/pet.html?app=1", on: serverURLProvider())
            } else {
                lastHover = false
                pushHover(false)
            }
        }
        panel.orderFrontRegardless()
        startHoverTracking()
    }

    func hide() {
        // A hide mid-drag must clear the page's run pose (PetWindow.HidePet pushes
        // drag-state null); otherwise the pet runs forever when re-shown.
        if dragStartMouse != nil {
            pushPetEvent("window.__ttPetDragState=null;window.dispatchEvent(new Event('pet:drag-end'));")
        }
        panel?.orderOut(nil)
        stopHoverTracking()
        if lastHover { lastHover = false; pushHover(false) }
        lastLookDirection = -1
        // A hide mid-drag must not leave the 60Hz loop running.
        dragTimer?.invalidate()
        dragTimer = nil
        dragStartMouse = nil
        dragStartFrame = nil
    }

    // MARK: Hover tracking (PetWindow.cs counterpart)

    private var hoverTimer: Timer?
    private var clickThroughTimer: Timer?
    private var lastHover = false
    // Mouse idle / wake tracking (PetWindow.cs: >=60s stillness -> pet:sleep,
    // first movement afterwards -> pet:wake).
    private var lastMouseActive = Date()
    private var lastMousePos = NSPoint(x: -1, y: -1)
    private var mouseIdle = false
    /// Last 16-way look cell pushed to the page (Windows PetWindow._lastLookDirection).
    private var lastLookDirection = -1

    /// The page does NOT track the mouse itself — DOM mouse-leave is unreliable
    /// on this transparent, never-activated panel (pet.jsx says so verbatim).
    /// The host polls the OS cursor against the sprite square and pushes
    /// window.__ttPetHover + a pet:hover event, exactly like PetWindow.HoverTick.
    func startHoverTracking() {
        guard hoverTimer == nil else { return }
        // Windows HoverTick interval (150ms).
        let timer = Timer(timeInterval: 0.15, repeats: true) { [weak self] _ in
            self?.pollHover()
        }
        RunLoop.main.add(timer, forMode: .common)
        hoverTimer = timer
        // Windows ClickThroughTick runs on its own 50ms timer: the transparent
        // parts of the panel must not swallow clicks meant for whatever sits
        // behind the pet.
        guard clickThroughTimer == nil else { return }
        let clickTimer = Timer(timeInterval: 0.05, repeats: true) { [weak self] _ in
            self?.pollClickThrough()
        }
        RunLoop.main.add(clickTimer, forMode: .common)
        clickThroughTimer = clickTimer
    }

    private func stopHoverTracking() {
        hoverTimer?.invalidate()
        hoverTimer = nil
        clickThroughTimer?.invalidate()
        clickThroughTimer = nil
    }

    private func pollHover() {
        pollIdle()
        guard let panel, panel.isVisible else {
            if lastHover { lastHover = false; pushHover(false) }
            return
        }
        let inside = isPointOnPet(NSEvent.mouseLocation)
        if inside != lastHover {
            lastHover = inside
            pushHover(inside)
        }
        updateLookDirection()
    }

    /// Windows PetWindow LookTick: V2 atlases expose sixteen cursor-facing cells
    /// at 22.5° steps. The page (pet.jsx `pet:look`) only applies it for V2 pets,
    /// and it wants the direction even when the cursor is outside the window.
    private func updateLookDirection() {
        guard let panel, panel.isVisible else { return }
        let mouse = NSEvent.mouseLocation
        let frame = panel.frame
        // Windows PointToScreen(ActualWidth/2, (band + height)/2); mac origin is
        // bottom-left, so that top-down Y is mirrored below.
        let center = NSPoint(x: frame.midX,
                             y: frame.minY + (frame.height - bubbleBand) / 2)
        let dx = mouse.x - center.x
        let dyUp = mouse.y - center.y          // Windows uses -dy with Y growing down
        let degrees = (atan2(dx, dyUp) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
        let direction = Int((degrees / 22.5).rounded()) % 16
        guard direction != lastLookDirection else { return }
        lastLookDirection = direction
        pushPetEvent("window.__ttPetLookDirectionIndex=\(direction);" +
                     "window.dispatchEvent(new Event('pet:look'));")
        Diag.info("Pet look -> \(direction)")
    }

    /// Windows PetWindow.ClickThroughTick: skip while a drag is in flight (the
    /// moving window would otherwise thrash the hit test) and while hidden.
    private func pollClickThrough() {
        guard let panel, panel.isVisible else { return }
        if dragTimer != nil { return }
        let clickThrough = !isPointOnPet(NSEvent.mouseLocation)
        if panel.ignoresMouseEvents != clickThrough {
            panel.ignoresMouseEvents = clickThrough
        }
    }

    /// Windows PetWindow.IsPointOnPet: the WebView surface is rectangular even
    /// though most of it is transparent, so keep only the lower centered sprite
    /// square mouse-active — the bubble band and the horizontal padding pass
    /// through to whatever is behind.
    private func isPointOnPet(_ screenPoint: NSPoint) -> Bool {
        guard let panel else { return false }
        let frame = panel.frame
        guard frame.width > 0, frame.height > 0 else { return true }
        guard frame.contains(screenPoint) else { return false }
        let s = Self.spriteSize(width: frame.width, height: frame.height, band: bubbleBand)
        let pad = max(8, s * 0.08)
        let area = max(0, frame.height - bubbleBand)
        let pageTop = bubbleBand + max(0, (area - s) / 2)
        let top = frame.height - pageTop           // page top-left -> window bottom-left
        let bottom = top - s
        let left = (frame.width - s) / 2
        let right = left + s
        let dx = screenPoint.x - frame.minX
        let dy = screenPoint.y - frame.minY
        return dx >= left - pad && dx <= right + pad
            && dy >= bottom - pad && dy <= top + pad
    }

    /// pet.jsx:sizeFor() — the page sizes the sprite from the live viewport, so
    /// the host must use the identical formula for its hit rectangle.
    static func spriteSize(width: CGFloat, height: CGFloat, band: CGFloat) -> CGFloat {
        max(40, min(width, height - band) - 8)
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

    /// Windows PetWindow.MinBubbleBand — pet.jsx:MIN_BUBBLE_BAND. The preset
    /// base heights below are measured with this band already reserved.
    static let minBubbleBand: CGFloat = 138

    /// Base sprite-window height for the current preset (Windows
    /// PetWindow.SizeDimensions; it already includes the 138pt bubble band).
    private var baseHeight: CGFloat { sizePreset.baseHeight }

    /// The bubble band the PAGE measured (pet:bubble-height:<n>) — the host
    /// stores it and re-pushes it; hardcoding a value here clobbers the page's
    /// own layout and clips the bubble at the window top edge.
    private(set) var bubbleBand: CGFloat = PetPanelController.minBubbleBand

    /// Grow the transparent host upward for the bubble / hover limits popup —
    /// the page measures its own content (pet:bubble-height:<n>) and the native
    /// side just obeys, keeping the sprite anchored at the bottom edge.
    ///
    /// Windows ApplyBubbleBand parity: height = base + (band - MinBubbleBand).
    /// Height and band must move together — pet.jsx derives the sprite size from
    /// `innerHeight - band`, so adding the raw band to a fixed base (the old
    /// 340 + band math) scaled the pet up and slid it off its feet on hover.
    func resizeForBubble(band: CGFloat) {
        guard band.isFinite else { return }
        let spriteArea = max(0, baseHeight - Self.minBubbleBand)
        var maxBand = CGFloat.greatestFiniteMagnitude
        if let screen = panel?.screen ?? NSScreen.main {
            maxBand = max(Self.minBubbleBand, screen.visibleFrame.height - spriteArea)
        }
        let nextBand = min(max(Self.minBubbleBand, ceil(band)), maxBand)
        guard abs(nextBand - bubbleBand) >= 0.5 else { return }
        bubbleBand = nextBand
        guard let panel else { return }
        let target = baseHeight + (bubbleBand - Self.minBubbleBand)
        var frame = panel.frame
        frame.size = NSSize(width: PetSizePreset.windowWidth, height: target)
        if let screen = panel.screen ?? NSScreen.main {
            let visible = screen.visibleFrame
            frame.origin.y = max(visible.minY, min(frame.origin.y, visible.maxY - frame.height))
        }
        panel.setFrame(frame, display: true)
        pushBubbleBand()
        Diag.info("Pet window sized for bubble band \(Int(bubbleBand)) -> \(Int(target))")
    }

    /// Windows PetWindow.PushBubbleBand — the page re-reads the band and
    /// recomputes the sprite size from it.
    private func pushBubbleBand() {
        guard let panel, panel.isVisible, let webView = WebHost.webView(in: panel) else { return }
        let script = "window.__ttPetBubbleBand=\(Int(bubbleBand));" +
            "window.dispatchEvent(new Event('pet:bubble-band'));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// Change the size bucket. Windows ApplySize parity: the window keeps its
    /// bottom edge and x (the pet never jumps to a corner just because the user
    /// picked a size); width does not change between presets.
    func setSize(_ preset: PetSizePreset) {
        guard preset != sizePreset else { return }
        sizePreset = preset
        guard let panel else { return }
        let target = baseHeight + (bubbleBand - Self.minBubbleBand)
        var frame = panel.frame
        frame.size = NSSize(width: PetSizePreset.windowWidth, height: target)
        if let screen = panel.screen ?? NSScreen.main {
            let visible = screen.visibleFrame
            frame.origin.x = min(max(frame.origin.x, visible.minX), visible.maxX - frame.width)
            frame.origin.y = max(visible.minY, min(frame.origin.y, visible.maxY - frame.height))
        }
        panel.setFrame(frame, display: true)
        panel.saveFrame(usingName: Self.frameAutosaveName)
        Diag.info("Pet size -> \(preset.rawValue) (\(Int(frame.width))x\(Int(frame.height)))")
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
        // Windows CreateWindow parity: the width is shared by every preset and
        // the height is the preset's base (bubble band included). The old fixed
        // 320x340 ignored both the saved size and the page's geometry.
        let size = NSSize(width: PetSizePreset.windowWidth, height: baseHeight)
        let rect = NSRect(origin: .zero, size: size)
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
        panel.setFrameAutosaveName(Self.frameAutosaveName)   // position memory (Windows saves placement)
        self.panel = panel   // placeAtDefaultCorner reads self.panel — set before placing
        // A stored frame wins; only first launch falls back to the corner dock.
        // NB: AppKit stores the autosaved frame as a STRING under
        // "NSWindow Frame <name>", so a dictionary(forKey:) probe is always nil —
        // that bug re-docked the pet at the corner on every launch.
        if panel.setFrameUsingName(Self.frameAutosaveName) {
            // Keep only the restored ORIGIN — the saved size may belong to another
            // preset or to an older build whose window math was wrong.
            var restored = panel.frame
            restored.size = size
            panel.setFrame(restored, display: false)
            clampIntoVisibleFrame(panel)
            Diag.info("Pet restored saved position \(panel.frame.origin)")
        } else {
            placeAtDefaultCorner()
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

/// The three desktop-pet size buckets. Sizes follow the UPSTREAM macOS client
/// (TokenTrackerBar DesktopPetWindowController.PetSizePreset: scales
/// 1.0 / 1.4 / 1.85 on the 15x16 artboard at 4pt per unit = 60 / 84 / 111pt),
/// so the webview pet reads the same size as the author's native mac build.
///
/// The webview geometry itself follows Windows PetWindow: one shared window
/// width (the 340pt bubble needs the room; the surplus is transparent and
/// click-through), and pet.jsx derives the sprite from `min(width, height - band)
/// - 8`, so `baseHeight = sprite + band + 8`. The live window only adds band
/// growth above that base, so `height - band` — the sprite input — stays
/// constant: a bubble appearing can never resize or move the pet.
enum PetSizePreset: String, CaseIterable {
    case small, medium, large

    /// Windows PetWindow.WindowWidth — wider than the sprite so the bubble and
    /// its shadow never hit the layered-window edge.
    static let windowWidth: CGFloat = 400

    /// The pet.jsx inset (sizeFor(): `- 8`).
    static let pageSpriteInset: CGFloat = 8

    /// Painted sprite box, matching the upstream native scales.
    var spriteSize: CGFloat {
        switch self {
        case .small: return 60   // 15 * 4 * 1.0
        case .medium: return 84  // 15 * 4 * 1.4
        case .large: return 111  // 15 * 4 * 1.85
        }
    }

    /// Window base height (MinBubbleBand reserved) that makes pet.jsx paint the
    /// sprite at `spriteSize`: sizeFor() = (height - band) - 8.
    var baseHeight: CGFloat {
        spriteSize + PetPanelController.minBubbleBand + Self.pageSpriteInset
    }

    /// Stored prefs may hold anything (older builds, hand edits); fall back to
    /// the Windows default rather than leaving the panel un-sized.
    static func normalize(_ raw: String?) -> PetSizePreset {
        guard let raw, let preset = PetSizePreset(rawValue: raw) else { return .medium }
        return preset
    }
}
