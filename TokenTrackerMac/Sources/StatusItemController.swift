import AppKit
import WebKit

/// Menu bar controller — counterpart of TrayApplicationContext.cs. Left-click
/// toggles the dashboard window (the Windows tray does exactly that), right-click
/// pops the shell menu.
final class StatusItemController: NSObject {
    private let serverManager: ServerManager
    private let updateChecker: UpdateChecker

    private var statusItem: NSStatusItem?
    private var menu: NSMenu?

    private var onOpenDashboard: (() -> Void)?
    private var onOpenWidget: (() -> Void)?
    private var onTogglePet: (() -> Void)?
    private var onToggleQuotaWidget: (() -> Void)?
    private var onToggleCapsule: (() -> Void)?
    private var isPetVisible: (() -> Bool)?
    private var isQuotaWidgetVisible: (() -> Bool)?
    private var isCapsuleVisible: (() -> Bool)?

    init(serverManager: ServerManager,
         updateChecker: UpdateChecker,
         onOpenDashboard: @escaping () -> Void,
         onOpenWidget: @escaping () -> Void,
         onTogglePet: @escaping () -> Void,
         onToggleQuotaWidget: @escaping () -> Void,
         onToggleCapsule: @escaping () -> Void,
         isPetVisible: @escaping () -> Bool,
         isQuotaWidgetVisible: @escaping () -> Bool,
         isCapsuleVisible: @escaping () -> Bool,
         ) {
        self.serverManager = serverManager
        self.updateChecker = updateChecker
        self.onOpenDashboard = onOpenDashboard
        self.onOpenWidget = onOpenWidget
        self.onTogglePet = onTogglePet
        self.onToggleQuotaWidget = onToggleQuotaWidget
        self.onToggleCapsule = onToggleCapsule
        self.isPetVisible = isPetVisible
        self.isQuotaWidgetVisible = isQuotaWidgetVisible
        self.isCapsuleVisible = isCapsuleVisible
        super.init()
    }

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            applyTrayStyle(PetSettingsController.shared.settings.trayStyle, button: button)
            button.toolTip = "TokenTracker Plus"
            button.target = self   // status bar buttons are NOT in the responder chain
            button.action = #selector(statusItemClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        statusItem = item
    }

    /// 托盘图标风格: 经典闪电 (bolt) / 应用图标 (app icon) / 奔跑小猫 — the cat
    /// frames ship only with the vendored native bar; the webview shell falls
    /// back to the bolt so the menu item still does something visible.
    func setTrayStyle(_ style: String) {
        guard let button = statusItem?.button else { return }
        applyTrayStyle(style, button: button)
    }

    private func applyTrayStyle(_ style: String, button: NSStatusBarButton) {
        switch style {
        case "icon":
            button.image = NSImage(named: NSImage.applicationIconName)
            button.image?.size = NSSize(width: 18, height: 18)
        case "cat":
            Diag.info("Tray style cat: frames live in the native bar; using bolt")
            button.image = NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: "TokenTracker Plus")
        default:
            button.image = NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: "TokenTracker Plus")
        }
    }

    func updateHealth(_ health: ServerManager.Health) {
        let broken = (health == .crashed || health == .failed)
        if let button = statusItem?.button {
            // Crashed/failed must be legible at a glance — a mere grayed-out
            // bolt read as "nothing happened" while the server was in a
            // restart loop (2026-11-10 incident).
            let symbolName = broken ? "bolt.badge.xmark" : "bolt.fill"
            if let image = NSImage(systemSymbolName: symbolName,
                                   accessibilityDescription: "TokenTracker Plus — server \(health.rawValue)") {
                button.image = image
            }
            button.appearsDisabled = broken
            if broken, let reason = serverManager.lastFailureReason {
                button.toolTip = "TokenTracker Plus — server \(health.rawValue)：\(reason)"
            } else {
                button.toolTip = "TokenTracker Plus — server \(health.rawValue)"
            }
        }
    }

    // MARK: Click handling

    @objc private func statusItemClicked() {
        // Synthetic clicks (AppleScript/automation) carry no currentEvent; treat
        // them as a plain left click so the shell stays scriptable. Real clicks
        // with the right button pop the menu.
        guard let event = NSApp.currentEvent, event.type == .rightMouseUp else {
            Diag.info("Status item left-clicked -> toggle dashboard (Windows tray parity)")
            onOpenDashboard?()
            return
        }
        Diag.info("Status item right-clicked -> menu")
        popMenu()
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
        pet.state = (isPetVisible?() ?? false) ? .on : .off
        // No bare "q" shortcut: with the default command modifier it hijacked
        // Cmd+Q while the menu was open — muscle memory for quitting any app.
        // 用量悬浮窗 = the native capsule (MonitorWidgetWindow counterpart).
        let capsule = NSMenuItem(title: "用量悬浮窗", action: #selector(toggleCapsule), keyEquivalent: "u")
        capsule.target = self
        capsule.state = (isCapsuleVisible?() ?? false) ? .on : .off
        let widget = NSMenuItem(title: "额度窗", action: #selector(toggleQuotaWidget), keyEquivalent: "")
        widget.target = self
        widget.state = (isQuotaWidgetVisible?() ?? false) ? .on : .off
        let sync = NSMenuItem(title: "立即同步", action: #selector(syncNow), keyEquivalent: "s")
        sync.target = self
        let login = NSMenuItem(title: "开机启动", action: #selector(toggleLoginItem), keyEquivalent: "")
        login.target = self
        login.state = LaunchAtLogin.isEnabled ? .on : .off
        login.isEnabled = LaunchAtLogin.isSupported
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
    @objc private func toggleQuotaWidget() { onToggleQuotaWidget?() }
    @objc private func toggleCapsule() { onToggleCapsule?() }
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
}
