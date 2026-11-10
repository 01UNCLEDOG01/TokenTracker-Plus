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
    private var onSetCapsuleIslandMode: ((Bool) -> Void)?
    private var isCapsuleIslandMode: (() -> Bool)?

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
         onSetCapsuleIslandMode: ((Bool) -> Void)? = nil,
         isCapsuleIslandMode: (() -> Bool)? = nil
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
        self.onSetCapsuleIslandMode = onSetCapsuleIslandMode
        self.isCapsuleIslandMode = isCapsuleIslandMode
        super.init()
    }

    /// Fixed status-item width. variableLength sized itself to the image, so
    /// switching to the mascot app icon (18pt tile) after the 28pt RunCat canvas
    /// or the SF bolt shoved every neighbouring menu-bar item sideways — the
    /// owner's "切换应用图标后状态栏间距突然改变". A constant slot keeps the gap
    /// identical for every style.
    private static let statusItemWidth: CGFloat = 30

    func install() {
        let item = NSStatusBar.system.statusItem(withLength: Self.statusItemWidth)
        if let button = item.button {
            applyTrayStyle(PetSettingsController.shared.settings.trayStyle, button: button)
            button.toolTip = "TokenTracker Plus"
            button.target = self   // status bar buttons are NOT in the responder chain
            button.action = #selector(statusItemClicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        statusItem = item

        // Self-test hook (mirrors TOKENTRACKER_MAC_WEBTEST): dump the context
        // menu tree to the diag log so menu wiring can be verified without a
        // synthetic right-click.
        if ProcessInfo.processInfo.environment["TOKENTRACKER_MAC_MENU_DUMP"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.dumpMenu()
            }
        }
    }

    private func dumpMenu() {
        let menu = buildMenu()
        func walk(_ menu: NSMenu, _ indent: String) {
            for entry in menu.items {
                if entry.isSeparatorItem { continue }
                let state = entry.state == .on ? " [x]" : ""
                Diag.info("MENU \(indent)\(entry.title)\(state)")
                if let submenu = entry.submenu { walk(submenu, indent + "  ") }
            }
        }
        walk(menu, "")
    }

    /// 托盘图标风格: 经典闪电 (bolt) / 应用图标 (app icon) / 奔跑小猫 (animated
    /// RunnerCat0-4 frames, 0.15s cadence — MenuBarAnimator parity). The mac
    /// menu bar status item is the system-tray equivalent, so the switcher
    /// applies here exactly as it does on Windows.
    func setTrayStyle(_ style: String) {
        guard let button = statusItem?.button else { return }
        applyTrayStyle(style, button: button)
    }

    private var catFrameTimer: Timer?
    private var catFrameIndex = 0

    private func restartCatTimer(frames: [NSImage], interval: TimeInterval) {
        catFrameTimer?.invalidate()
        let timer = Timer(timeInterval: interval, repeats: true) { [weak self] _ in
            guard let self, let button = self.statusItem?.button else { return }
            self.catFrameIndex = (self.catFrameIndex + 1) % frames.count
            button.image = frames[self.catFrameIndex]
        }
        RunLoop.main.add(timer, forMode: .common)
        catFrameTimer = timer
    }

    private func applyTrayStyle(_ style: String, button: NSStatusBarButton) {
        catFrameTimer?.invalidate()
        catFrameTimer = nil
        statusItem?.length = Self.statusItemWidth
        switch style {
        case "mascot":
            // Windows: 应用图标 = the mascot PNG. No loose mascot in the shell
            // bundle — reuse the app icon (same artwork family).
            button.image = NSImage(named: NSImage.applicationIconName)
            button.image?.size = NSSize(width: 18, height: 18)
        case "cat":
            // Upstream MenuBarAnimator.buildCatFrames: copy each RunCat frame,
            // pin the canvas to 28x18 and mark it a TEMPLATE — without both the
            // colored PNG renders as a giant black blob in the menu bar.
            let frames = (0..<5).compactMap { n -> NSImage? in
                guard let named = NSImage(named: "cat\(n)"),
                      let copy = named.copy() as? NSImage else { return nil }
                copy.size = NSSize(width: 28, height: 18)
                copy.isTemplate = true
                return copy
            }
            guard !frames.isEmpty else {
                button.image = NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: "TokenTracker Plus")
                return
            }
            catFrameIndex = 0
            button.image = frames[0]
            // RunCat cadence (MenuBarRunnerPace): idle 0.5s, syncing 0.2s.
            let timer = Timer(timeInterval: 0.5, repeats: true) { [weak self, weak button] _ in
                guard let self, let button else { return }
                self.catFrameIndex = (self.catFrameIndex + 1) % frames.count
                button.image = frames[self.catFrameIndex]
                // Speed up while a sync is in flight (upstream syncing = 0.2s).
                let wanted: TimeInterval = IslandStats.shared.syncing ? 0.2 : 0.5
                if abs((self.catFrameTimer?.timeInterval ?? 0) - wanted) > 0.01 {
                    self.restartCatTimer(frames: frames, interval: wanted)
                }
            }
            RunLoop.main.add(timer, forMode: .common)
            catFrameTimer = timer
        default:
            button.image = NSImage(systemSymbolName: "bolt.fill", accessibilityDescription: "TokenTracker Plus")
        }
        let imageSize = button.image.map { "\(Int($0.size.width))x\(Int($0.size.height))" } ?? "nil"
        Diag.info("Tray style \(style): image=\(imageSize) itemWidth=\(statusItem?.length ?? -1) buttonFrame=\(button.frame)")
    }

    func updateHealth(_ health: ServerManager.Health) {
        let broken = (health == .crashed || health == .failed)
        guard let button = statusItem?.button else { return }
        if broken {
            // Crashed/failed must be legible at a glance — a mere grayed-out
            // bolt read as "nothing happened" while the server was in a
            // restart loop (2026-11-10 incident). Stop the cat animation so it
            // cannot paint over the glyph half a second later.
            catFrameTimer?.invalidate()
            catFrameTimer = nil
            let symbolName = "bolt.badge.xmark"
            if let image = NSImage(systemSymbolName: symbolName,
                                   accessibilityDescription: "TokenTracker Plus — server \(health.rawValue)") {
                button.image = image
            }
            button.appearsDisabled = true
            if let reason = serverManager.lastFailureReason {
                button.toolTip = "TokenTracker Plus — server \(health.rawValue)：\(reason)"
            } else {
                button.toolTip = "TokenTracker Plus — server \(health.rawValue)"
            }
            return
        }
        // Healthy/starting: restore the user's chosen style instead of leaving a
        // plain bolt behind. The old code overwrote the cat/mascot every health
        // change, so a mascot (static, no animation to restore it) never survived.
        applyTrayStyle(PetSettingsController.shared.settings.trayStyle, button: button)
        button.appearsDisabled = false
        button.toolTip = "TokenTracker Plus — server \(health.rawValue)"
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
        let settings = PetSettingsController.shared.settings

        let dashboard = item("打开面板", #selector(openDashboard), "d")
        // 用量悬浮窗 submenu = Windows monitor context menu
        // (open / sync / island mode / free float / hide).
        let capsule = submenuItem("用量悬浮窗")
        let capsuleOpen = item("打开面板", #selector(openDashboard), "")
        let capsuleSync = item("立即同步", #selector(syncNow), "")
        let island = item("灵动岛模式", #selector(setCapsuleIslandMode), "")
        island.tag = 1
        island.state = (isCapsuleIslandMode?() ?? false) ? .on : .off
        let floating = item("自由悬浮", #selector(setCapsuleIslandMode), "")
        floating.tag = 0
        floating.state = (isCapsuleIslandMode?() ?? true) ? .off : .on
        let capsuleToggle = item((isCapsuleVisible?() ?? false) ? "隐藏用量悬浮窗" : "显示用量悬浮窗",
                                 #selector(toggleCapsule), "")
        capsule.submenu?.items = [capsuleOpen, capsuleSync, .separator(), island, floating,
                                  .separator(), capsuleToggle]

        // 宠物悬浮窗 submenu = Windows pet menu: show/hide, size and character.
        let pet = submenuItem("宠物悬浮窗")
        let petShow = item("显示宠物悬浮窗", #selector(togglePet), "p")
        petShow.state = (isPetVisible?() ?? false) ? .on : .off
        let petSize = submenuItem("宠物大小")
        for (id, title) in [("small", "小"), ("medium", "中"), ("large", "大")] {
            let entry = item(title, #selector(setPetSizeFromMenu), "")
            entry.representedObject = id
            entry.state = settings.size == id ? .on : .off
            petSize.submenu?.addItem(entry)
        }
        let petCharacter = submenuItem("宠物角色")
        for choice in petChoices() {
            let entry = item(choice.title, #selector(setPetCharacterFromMenu), "")
            entry.representedObject = choice.id
            entry.state = settings.character == choice.id ? .on : .off
            petCharacter.submenu?.addItem(entry)
        }
        let hidePetItem = item("关闭宠物", #selector(hidePet), "")
        hidePetItem.isEnabled = isPetVisible?() ?? false
        pet.submenu?.items = [petShow, .separator(), petSize, petCharacter, .separator(), hidePetItem]

        let quota = item("额度窗", #selector(toggleQuotaWidget), "")
        quota.state = (isQuotaWidgetVisible?() ?? false) ? .on : .off

        let tray = submenuItem("托盘图标风格")
        for (id, title) in [("cat", "奔跑小猫"), ("mascot", "应用图标"), ("lightning", "经典闪电")] {
            let entry = item(title, #selector(setTrayStyleFromMenu), "")
            entry.representedObject = id
            entry.state = settings.trayStyle == id ? .on : .off
            tray.submenu?.addItem(entry)
        }

        let login = item("开机启动", #selector(toggleLoginItem), "")
        login.state = LaunchAtLogin.isEnabled ? .on : .off
        login.isEnabled = LaunchAtLogin.isSupported
        let update = item("检查更新…", #selector(checkUpdates), "")
        let about = NSMenuItem(title: "TokenTracker Plus \(updateChecker.currentVersion)", action: nil, keyEquivalent: "")
        about.isEnabled = false

        // No bare "q": Cmd+Q is muscle memory for quitting any app.
        let quit = item("退出 TokenTracker Plus", #selector(quit), "q")
        quit.keyEquivalentModifierMask = [.command, .shift]

        [dashboard, .separator(), capsule, pet, quota,
         .separator(), item("立即同步", #selector(syncNow), "s"),
         .separator(), tray,
         .separator(), login, update, about,
         .separator(), quit].forEach { menu.addItem($0) }
        return menu
    }

    private func item(_ title: String, _ action: Selector?, _ key: String) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: action, keyEquivalent: key)
        entry.target = self
        return entry
    }

    private func submenuItem(_ title: String) -> NSMenuItem {
        let entry = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        entry.submenu = NSMenu()
        return entry
    }

    private struct PetChoice {
        let id: String
        let title: String
    }

    /// Built-ins followed by installed community pets (~/.tokentracker/pets), the
    /// same catalog the dashboard pet page uses. The current id is always present
    /// even if its package vanished, so the checkmark never disappears.
    private func petChoices() -> [PetChoice] {
        var choices: [PetChoice] = [
            PetChoice(id: "clawd", title: "Clawd 像素猫"),
            PetChoice(id: "bot", title: "Bot 球体"),
            PetChoice(id: "sprout", title: "Sprout 嫩芽"),
            PetChoice(id: "byte", title: "Byte 深蓝"),
            PetChoice(id: "ember", title: "Ember 火苗"),
        ]
        let root = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".tokentracker/pets", isDirectory: true)
        let dirs = (try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles])) ?? []
        for dir in dirs.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard (try? dir.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true else { continue }
            let id = dir.lastPathComponent
            guard !choices.contains(where: { $0.id == id }) else { continue }
            let manifest = dir.appendingPathComponent("pet.json")
            guard let data = try? Data(contentsOf: manifest),
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let displayName = object["displayName"] as? String,
                  !displayName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            choices.append(PetChoice(id: id, title: displayName))
        }
        let current = PetSettingsController.shared.settings.character
        if !choices.contains(where: { $0.id == current }) {
            choices.append(PetChoice(id: current, title: current))
        }
        return choices
    }

    // MARK: Actions

    @objc private func openDashboard() { onOpenDashboard?() }
    @objc private func toggleQuotaWidget() { onToggleQuotaWidget?() }
    @objc private func toggleCapsule() { onToggleCapsule?() }
    @objc private func togglePet() { onTogglePet?() }
    @objc private func syncNow() { serverManager.syncNow() }
    @objc private func checkUpdates() { updateChecker.checkAndPrompt() }

    // MARK: Menu actions (submenus)

    @objc private func setPetSizeFromMenu(_ sender: NSMenuItem) {
        guard let size = sender.representedObject as? String else { return }
        PetSettingsController.shared.apply(key: "size", value: size)
    }

    @objc private func setPetCharacterFromMenu(_ sender: NSMenuItem) {
        guard let id = sender.representedObject as? String else { return }
        PetSettingsController.shared.apply(key: "character", value: id)
    }

    @objc private func setTrayStyleFromMenu(_ sender: NSMenuItem) {
        guard let style = sender.representedObject as? String else { return }
        PetSettingsController.shared.apply(key: "trayStyle", value: style)
    }

    @objc private func setCapsuleIslandMode(_ sender: NSMenuItem) {
        onSetCapsuleIslandMode?(sender.tag == 1)
    }

    @objc private func hidePet() {
        if isPetVisible?() ?? false { onTogglePet?() }
    }

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
