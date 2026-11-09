import AppKit
import WebKit

/// Menu bar + quota panel — counterpart of TrayApplicationContext.cs. Left-click
/// toggles the quota panel under the icon; right-click pops the shell menu.
final class StatusItemController: NSObject, NSWindowDelegate {
    private let serverManager: ServerManager
    private let updateChecker: UpdateChecker
    private let launchAtLogin: LaunchAtLogin.Type = LaunchAtLogin.self

    private var statusItem: NSStatusItem?
    private var panel: QuotaPanel?
    private var panelPinned = false
    private var menu: NSMenu?

    private var onOpenDashboard: (() -> Void)?
    private var onOpenWidget: (() -> Void)?
    private var onTogglePet: (() -> Void)?

    init(serverManager: ServerManager,
         updateChecker: UpdateChecker,
         onOpenDashboard: @escaping () -> Void,
         onOpenWidget: @escaping () -> Void,
         onTogglePet: @escaping () -> Void) {
        self.serverManager = serverManager
        self.updateChecker = updateChecker
        self.onOpenDashboard = onOpenDashboard
        self.onOpenWidget = onOpenWidget
        self.onTogglePet = onTogglePet
        super.init()
    }

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if let image = NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: "TokenTracker Plus") {
                button.image = image
            } else {
                button.title = "⚡"
            }
            button.toolTip = "TokenTracker Plus"
            button.target = self   // status bar buttons are NOT in the responder chain
            button.action = #selector(statusItemClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        statusItem = item
    }

    func updateHealth(_ health: ServerManager.Health) {
        statusItem?.button?.appearsDisabled = (health == .crashed || health == .failed)
        statusItem?.button?.toolTip = "TokenTracker Plus — server \(health.rawValue)"
    }

    // MARK: Click handling

    @objc private func statusItemClicked() {
        // Synthetic clicks (AppleScript/automation) carry no currentEvent; treat
        // them as a plain left click so the shell stays scriptable. Real clicks
        // with the right button pop the menu.
        guard let event = NSApp.currentEvent, event.type == .rightMouseUp else {
            Diag.info("Status item clicked (no right-button event) -> toggle panel")
            togglePanel()
            return
        }
        Diag.info("Status item right-clicked -> menu")
        popMenu()
    }

    // MARK: Quota panel

    private func togglePanel() {
        if let panel, panel.isVisible {
            panel.orderOut(nil)
            return
        }
        showPanel()
    }

    private func showPanel() {
        Diag.info("showPanel enter (pinned=\(panelPinned))")
        let panel = self.panel ?? makePanel()
        self.panel = panel
        if WebHost.webView(in: panel) == nil {
            panel.contentView = WebHost.makeWebView(frame: panel.contentRect(forFrameRect: panel.frame))
        }
        if let webView = WebHost.webView(in: panel) {
            WebHost.load(webView, path: "/quota", on: serverManager.serverURL)
        }
        positionPanel(panel)
        panel.orderFrontRegardless()
        panel.makeKey()
        Diag.info("showPanel done frame=\(panel.frame) visible=\(panel.isVisible)")
    }

    private func makePanel() -> QuotaPanel {
        let rect = NSRect(x: 0, y: 0, width: 420, height: 560)
        // Borderless + nonactivating is the canonical floating-panel recipe;
        // .titled mixed with .borderless produces undefined frame behavior.
        let panel = QuotaPanel(contentRect: rect,
                               styleMask: [.borderless, .nonactivatingPanel],
                               backing: .buffered, defer: false)
        panel.isOpaque = false
        // Translucent backdrop: the quota page paints its own content on top, and
        // a fully clear window would be invisible whenever the webview is empty
        // (slow load, navigation error) — an "invisible panel" bug is undiagnosable.
        panel.backgroundColor = NSColor(calibratedWhite: 0.08, alpha: 0.88)
        panel.hasShadow = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false
        panel.delegate = self
        return panel
    }

    private func positionPanel(_ panel: NSPanel) {
        let buttonWindow = statusItem?.button?.window
        let panelWidth = panel.frame.width
        if let screen = buttonWindow?.screen ?? NSScreen.main {
            let anchorX = buttonWindow?.frame.midX ?? screen.visibleFrame.midX
            let x = min(max(screen.visibleFrame.minX + 8, anchorX - panelWidth / 2),
                        screen.visibleFrame.maxX - panelWidth - 8)
            let anchorY = buttonWindow?.frame.minY ?? screen.visibleFrame.maxY
            let y = anchorY - panel.frame.height - 6
            panel.setFrameOrigin(NSPoint(x: x, y: y))
        } else {
            panel.center()
        }
    }

    // MARK: Context menu (shared by status item right-click and pet right-click)

    func popMenu(at point: NSPoint? = nil) {
        let menu = buildMenu()
        self.menu = menu
        if let point {
            menu.popUp(positioning: nil, at: point, in: nil)
        } else if let button = statusItem?.button, let window = button.window {
            let location = window.convertPoint(toScreen: NSPoint(x: button.bounds.midX, y: 0))
            menu.popUp(positioning: nil, at: NSPoint(x: location.x, y: location.y - 4), in: nil)
        }
    }

    private func buildMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false

        let dashboard = NSMenuItem(title: "打开面板", action: #selector(openDashboard), keyEquivalent: "d")
        dashboard.target = self
        let pet = NSMenuItem(title: "宠物悬浮窗", action: #selector(togglePet), keyEquivalent: "p")
        pet.target = self
        let widget = NSMenuItem(title: "额度窗", action: #selector(openWidget), keyEquivalent: "q")
        widget.target = self
        let sync = NSMenuItem(title: "立即同步", action: #selector(syncNow), keyEquivalent: "s")
        sync.target = self
        let login = NSMenuItem(title: "开机启动", action: #selector(toggleLoginItem), keyEquivalent: "")
        login.target = self
        login.state = launchAtLogin.isEnabled ? .on : .off
        login.isEnabled = launchAtLogin.isSupported
        let update = NSMenuItem(title: "检查更新…", action: #selector(checkUpdates), keyEquivalent: "")
        update.target = self
        let quit = NSMenuItem(title: "退出 TokenTracker Plus", action: #selector(quit), keyEquivalent: "q")
        quit.target = self
        quit.keyEquivalentModifierMask = [.command, .shift]

        [dashboard, pet, widget, NSMenuItem.separator(), sync, NSMenuItem.separator(),
         login, update, NSMenuItem.separator(), quit].forEach { menu.addItem($0) }
        return menu
    }

    // MARK: Actions

    @objc private func openDashboard() { onOpenDashboard?() }
    @objc private func openWidget() { onOpenWidget?() }
    @objc private func togglePet() { onTogglePet?() }
    @objc private func syncNow() { serverManager.syncNow() }
    @objc private func checkUpdates() { updateChecker.checkAndPrompt() }

    @objc private func toggleLoginItem() {
        let enabled = !LaunchAtLogin.isEnabled
        if !LaunchAtLogin.setEnabled(enabled) {
            Diag.error("Launch-at-login toggle failed")
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    // MARK: NSWindowDelegate

    func windowDidResignKey(_ notification: Notification) {
        // Click-outside dismisses the panel unless it was opened pinned from the
        // widget menu entry (pinned panels survive focus loss).
        guard let panel, !panelPinned else { return }
        panel.orderOut(nil)
    }
}

/// Borderless panels only receive key focus when canBecomeKey is overridden.
final class QuotaPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}
