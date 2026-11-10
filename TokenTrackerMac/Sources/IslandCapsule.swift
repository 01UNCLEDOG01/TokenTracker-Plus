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

    var isVisible: Bool { panel?.isVisible ?? false }

    /// 悬浮形态: true = pinned top-center (顶部灵动岛), false = free floating
    /// with position memory (自由悬浮).
    func setIslandMode(_ island: Bool) {
        islandMode = island
        guard let panel else { return }
        if island {
            placeTopCenter(panel, force: true)
        } else {
            panel.setFrameAutosaveName("TTPCapsule")  // resume remembering
        }
    }
    private var islandMode = false

    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        if islandMode { placeTopCenter(panel, force: true) }
        panel.orderFrontRegardless()
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
            var frame = panel.frame
            let delta = width - frame.width
            frame.size.width = width
            frame.origin.x -= delta / 2
            panel.setFrame(frame, display: true)
        }
    }

    // MARK: Panel construction

    private func makePanel() -> NSPanel {
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
        panel.setFrameAutosaveName("TTPCapsule")   // position memory
        panel.delegate = self

        let capsule = CapsuleContentView(frame: rect)
        capsule.onClick = { [weak self] in self?.onOpenDashboard?() }

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

        placeTopCenter(panel)
        return panel
    }

    private func placeTopCenter(_ panel: NSPanel, force: Bool = false) {
        guard let screen = NSScreen.main else { return }
        let work = screen.visibleFrame
        // Island mode pins top-center just under the menu bar; free mode keeps
        // the autosaved user position (unless force).
        if !force, panel.frameAutosaveName.isEmpty == false,
           UserDefaults.standard.dictionary(forKey: "NSWindow Frame \(panel.frameAutosaveName)") != nil,
           !islandMode {
            return
        }
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
        downLocation = NSEvent.mouseLocation
    }

    override func mouseUp(with event: NSEvent) {
        guard let down = downLocation else { return }
        downLocation = nil
        let up = NSEvent.mouseLocation
        if hypot(up.x - down.x, up.y - down.y) < 4 {
            onClick?()
        }
    }
}
