import AppKit

/// The 用量悬浮窗 capsule — the native counterpart of TokenTrackerWin's
/// MonitorWidgetWindow.cs ("the surface is one formatted string", deliberately
/// not a webview). A small rounded pill: accent dot tinted to the running pet
/// character + today's tokens/cost ("1.8亿 · ¥50.46"). Draggable with position
/// memory (frame autosave), click without drag opens the dashboard, 60s data
/// refresh comes from IslandStats.
@MainActor
final class IslandCapsuleController: NSObject, NSWindowDelegate {
    private(set) var panel: NSPanel?
    private var dotLayer: CAShapeLayer?
    private var textLabel: NSTextField?
    private var mouseDownLocation: NSPoint?

    /// Assigned by AppDelegate — Windows MonitorWidgetWindow opens the dashboard
    /// on a click without drag.
    var onOpenDashboard: (() -> Void)?
    /// Right-click pops the shell menu (Windows MenuRequested parity).
    var onMenu: ((NSPoint) -> Void)?

    var isVisible: Bool { panel?.isVisible ?? false }

    /// 悬浮形态 (MonitorWidgetWindow.IslandMode): true = pinned top-center,
    /// false = free floating at the saved position. Switching modes re-places
    /// immediately (Windows SetIslandMode -> Place(restore: !islandMode)).
    private(set) var islandMode = false
    private var isApplyingPlacement = false

    /// Fired when a drag converts island mode to free mode (Windows saves the
    /// dropped position and flips IslandMode=false) — the settings page echo.
    var onIslandModeChangedByDrag: ((Bool) -> Void)?

    private let freePosKey = "TTPCapsuleFreePos"

    /// One-time migration from the removed "NSWindow Frame TTPCapsule"
    /// autosave key (AGENTS.md: persisted state changes need migration).
    private func migrateLegacyAutosaveIfNeeded() {
        let d = UserDefaults.standard
        guard d.dictionary(forKey: freePosKey) == nil,
              let legacy = d.string(forKey: "NSWindow Frame TTPCapsule") else { return }
        let parts = legacy.split(separator: " ").compactMap { Double($0) }
        guard parts.count >= 2 else { return }
        d.set(["x": parts[0], "y": parts[1]], forKey: freePosKey)
        d.removeObject(forKey: "NSWindow Frame TTPCapsule")
        Diag.info("Capsule position migrated from legacy autosave")
    }

    func setIslandMode(_ island: Bool) {
        islandMode = island
        // Only persist once the panel exists — the startup apply runs before
        // the panel is created and used to write a stale default (P0).
        guard let panel else { return }
        UserDefaults.standard.set(island, forKey: "TTPCapsuleIslandMode")
        isApplyingPlacement = true
        if island {
            placeTopCenter(panel, force: true)
        } else {
            restoreFreePosition(panel)
        }
        isApplyingPlacement = false
    }

    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        isApplyingPlacement = true
        if islandMode {
            placeTopCenter(panel, force: true)
        } else {
            restoreFreePosition(panel)
        }
        isApplyingPlacement = false
        panel.orderFrontRegardless()
    }

    /// Windows Place(restore:true): saved X/Y, else the current spot.
    private func restoreFreePosition(_ panel: NSPanel) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let saved = UserDefaults.standard.dictionary(forKey: freePosKey)
        // Windows Place(): saved X/Y when present, otherwise a deterministic
        // fallback (right of centre, ~a third up) — never the (0,0) corner.
        let x = (saved?["x"] as? Double) ?? (visible.maxX - panel.frame.width - 16)
        let y = (saved?["y"] as? Double) ?? (visible.minY + visible.height / 3)
        let clampedX = min(max(x, visible.minX), visible.maxX - panel.frame.width)
        let clampedY = min(max(y, visible.minY), visible.maxY - panel.frame.height)
        panel.setFrameOrigin(NSPoint(x: clampedX, y: clampedY))
    }

    private var lastPersistAt = Date.distantPast

    private func persistFreePosition(force: Bool = false) {
        guard let panel else { return }
        // windowDidMove fires at drag rate (~60/s); flushing UserDefaults that
        // often churns the disk for nothing. Persist at most once a second,
        // with a forced flush when the drag settles.
        let now = Date()
        guard force || now.timeIntervalSince(lastPersistAt) >= 1 else { return }
        lastPersistAt = now
        UserDefaults.standard.set(["x": panel.frame.origin.x, "y": panel.frame.origin.y],
                                  forKey: freePosKey)
    }

    /// Persist the free position on user moves. Mode conversion happens ONLY in
    /// the drag path (noteDragEnded) — windowDidMove also fires for programmatic
    /// moves like setText's re-centring, which used to flip island -> free on
    /// every data refresh (P0).
    func windowDidMove(_ notification: Notification) {
        guard !isApplyingPlacement, let panel, !islandMode else { return }
        persistFreePosition()
    }

    /// Called by the content view after performDrag: a real drag out of the
    /// pinned island converts to free mode (Windows OnMove).
    func noteDragEnded(movedBy delta: NSPoint) {
        guard let panel else { return }
        if islandMode, hypot(delta.x, delta.y) >= 4 {
            islandMode = false
            UserDefaults.standard.set(false, forKey: "TTPCapsuleIslandMode")
            onIslandModeChangedByDrag?(false)
            Diag.info("Capsule dragged while pinned -> free mode")
        }
        persistFreePosition(force: true)
        let _ = panel
    }

    func hide() {
        panel?.orderOut(nil)
    }

    /// Accent dot tinted to the companion (MonitorWidgetWindow.ApplyStyle):
    /// hues follow each character's own art; unknown ids keep neutral gray.
    func setCharacter(_ character: String) {
        let rgb: (Int, Int, Int)
        switch character {
        case "clawd": rgb = (217, 119, 87)
        case "byte": rgb = (96, 165, 250)
        case "sprout": rgb = (74, 222, 128)
        case "ember": rgb = (248, 113, 113)
        case "gengxu": rgb = (167, 139, 250)
        default: rgb = (156, 163, 175)
        }
        guard let dotLayer else { return }
        dotLayer.fillColor = NSColor(calibratedRed: CGFloat(rgb.0) / 255,
                                     green: CGFloat(rgb.1) / 255,
                                     blue: CGFloat(rgb.2) / 255, alpha: 1).cgColor
    }

    func setText(_ text: String) {
        textLabel?.stringValue = text
        // Hug the content: re-measure and keep the top-center anchor when the
        // width changes (Windows sizes the pill to content as well).
        guard let panel, let label = textLabel else { return }
        let intrinsic = label.intrinsicContentSize
        let width = max(150, intrinsic.width + 34)
        if abs(panel.frame.width - width) > 1 {
            isApplyingPlacement = true
            var frame = panel.frame
            let delta = width - frame.width
            frame.size.width = width
            frame.origin.x -= delta / 2
            panel.setFrame(frame, display: true)
            isApplyingPlacement = false
        }
    }

    // MARK: Panel construction

    private func makePanel() -> NSPanel {
        // Persisted mode: default pinTop-center island unless the user chose
        // free floating (or dragged it out of the island).
        migrateLegacyAutosaveIfNeeded()
        islandMode = UserDefaults.standard.object(forKey: "TTPCapsuleIslandMode") == nil
            ? true : UserDefaults.standard.bool(forKey: "TTPCapsuleIslandMode")
        let rect = NSRect(x: 0, y: 0, width: 170, height: 34)
        let panel = NSPanel(contentRect: rect,
                            styleMask: [.borderless, .nonactivatingPanel],
                            backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.isMovableByWindowBackground = true   // no webview — native drag works
        panel.delegate = self

        let capsule = CapsuleContentView(frame: rect)
        capsule.onClick = { [weak self] in self?.onOpenDashboard?() }
        capsule.onMenu = { [weak self] point in self?.onMenu?(point) }
        capsule.onDragEnded = { [weak self] delta in self?.noteDragEnded(movedBy: delta) }

        let dot = NSView(frame: NSRect(x: 14, y: 13, width: 8, height: 8))
        dot.wantsLayer = true
        let shape = CAShapeLayer()
        shape.path = CGPath(ellipseIn: dot.bounds, transform: nil)
        dot.layer?.addSublayer(shape)
        shape.fillColor = NSColor(calibratedWhite: 0.6, alpha: 1).cgColor
        self.dotLayer = shape
        dot.autoresizingMask = [.minYMargin]

        let label = NSTextField(labelWithString: "—")
        label.font = .systemFont(ofSize: 13, weight: .semibold)
        label.textColor = .white
        label.frame = NSRect(x: 28, y: 8, width: 130, height: 18)
        label.autoresizingMask = [.width]
        self.textLabel = label

        capsule.addSubview(dot)
        capsule.addSubview(label)
        panel.contentView = capsule

        // No placement here: show() applies the mode (island pin / free
        // restore) under the isApplyingPlacement guard — placing here fired
        // windowDidMove and overwrote the saved free position.
        return panel
    }

    private func placeTopCenter(_ panel: NSPanel, force: Bool = false) {
        guard let screen = NSScreen.main else { return }
        let work = screen.visibleFrame
        // Windows Place(): work.Top + 6, horizontally centered.
        let frame = panel.frame
        panel.setFrameOrigin(NSPoint(x: work.midX - frame.width / 2,
                                     y: work.maxY - frame.height - 6))
    }
}

/// Rounded pill backdrop + click-without-drag detection (the drag is window
/// background movement, so a plain click gesture can't be used).
@MainActor
final class CapsuleContentView: NSView {
    var onClick: (() -> Void)?
    /// Right-click pops the shell menu (Windows MenuRequested parity).
    var onMenu: ((NSPoint) -> Void)?
    private var downLocation: NSPoint?

    override func draw(_ dirtyRect: NSRect) {
        let dark = NSApp.effectiveAppearance.name.rawValue.contains("Dark")
        NSColor(calibratedRed: 24 / 255, green: 24 / 255, blue: 27 / 255,
                alpha: dark ? 0.90 : 0.92).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: 15, yRadius: 15).fill()
        NSColor(calibratedWhite: dark ? 1 : 0, alpha: 0.18).setStroke()
        let border = NSBezierPath(roundedRect: bounds.insetBy(dx: 0.5, dy: 0.5), xRadius: 15, yRadius: 15)
        border.lineWidth = 1
        border.stroke()
    }

    override func mouseDown(with event: NSEvent) {
        // Hand the press to the OS modal drag loop — the mac equivalent of the
        // Windows WM_NCLBUTTONDOWN/HTCAPTION handoff. A custom contentView
        // swallows window-background dragging, so isMovableByWindowBackground
        // alone never fires; performDrag is what actually moves the pill.
        guard let window else { return }
        let before = window.frame.origin
        window.performDrag(with: event)
        let after = window.frame.origin
        let delta = NSPoint(x: after.x - before.x, y: after.y - before.y)
        onDragEnded?(delta)
        // Click without drag opens the dashboard (Windows OnUp parity).
        if hypot(delta.x, delta.y) < 4 {
            onClick?()
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        onMenu?(NSEvent.mouseLocation)
    }

    var onDragEnded: ((NSPoint) -> Void)?
}
