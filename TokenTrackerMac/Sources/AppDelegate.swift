import AppKit
import WebKit

/// Wires the shell together — counterpart of TokenTrackerWin's Program.cs +
/// TrayApplicationContext boot sequence: server first, then status item, then
/// the optional windows.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let serverManager = ServerManager()
    private let updateChecker = UpdateChecker()
    private var statusItemController: StatusItemController?
    private var dashboardWindow: DashboardWindowController?
    private var widgetWindow: QuotaWidgetWindowController?
    private var capsule: IslandCapsuleController?
    private var petPanel: PetPanelController?
    private var didShowPetOnReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Settings must be loaded before the status item installs — the tray
        // style is read there (a late load made the persisted style ignored).
        PetSettingsController.shared.load()
        // Windows CreateWindow parity: the saved size preset sizes the window from
        // the first show on (the old shell ignored it until the settings page was
        // touched, so a restart always came back at the medium 320x340 default).
        petPanel = PetPanelController(
            serverURLProvider: { [weak self] in
                self?.serverManager.serverURL ?? URL(string: "http://127.0.0.1:17680")!
            },
            sizePreset: PetSizePreset.normalize(PetSettingsController.shared.settings.size))
        petPanel?.onOpenDashboard = { [weak self] in self?.openDashboard() }
        petPanel?.onContextMenu = { [weak self] point in
            self?.statusItemController?.popMenu(at: point)
        }

        self.widgetWindow = QuotaWidgetWindowController(serverURLProvider: { [weak self] in
            self?.serverManager.serverURL ?? URL(string: "http://127.0.0.1:17680")!
        })

        statusItemController = StatusItemController(
            serverManager: serverManager,
            updateChecker: updateChecker,
            onOpenDashboard: { [weak self] in self?.openDashboard() },
            onOpenWidget: { [weak self] in self?.openWidget() },
            onTogglePet: { [weak self] in self?.togglePet() },
            onToggleQuotaWidget: { [weak self] in self?.toggleQuotaWidget() },
            onToggleCapsule: { [weak self] in self?.toggleCapsule() },
            isPetVisible: { [weak self] in self?.isPetVisible ?? false },
            isQuotaWidgetVisible: { [weak self] in self?.isQuotaWidgetVisible ?? false },
            isCapsuleVisible: { [weak self] in self?.isCapsuleVisible ?? false },
            onSetCapsuleIslandMode: { [weak self] island in
                UserDefaults.standard.set(island, forKey: "TTPCapsuleIslandMode")
                self?.capsule?.setIslandMode(island)
            },
            isCapsuleIslandMode: { [weak self] in self?.capsule?.islandMode ?? true })
        statusItemController?.install()

        serverManager.onHealthChange = { [weak self] health in
            self?.statusItemController?.updateHealth(health)
            // The pet shows its offline pose when the embedded server is down
            // (Windows ApplyConnected); this used to be hardcoded "connected".
            IslandStats.shared.setConnected(health == .running)
            if health == .running {
                self?.refreshVisibleWebViews()
                // Windows parity: all three floating surfaces appear on the first
                // healthy poll (stored prefs win from the second launch on).
                if let self, !self.didShowPetOnReady {
                    self.didShowPetOnReady = true
                    IslandStats.shared.start()
                    // Stored prefs win once the user has toggled anything;
                    // only the very first launch falls back to show-all.
                    let stored: (String) -> Bool = { key in
                        UserDefaults.standard.object(forKey: key) == nil
                            ? true : UserDefaults.standard.bool(forKey: key)
                    }
                    if stored("TTPPetEnabled") { self.petPanel?.show() }
                    if stored("TTPCapsuleEnabled") { self.capsule?.show() }
                    if stored("TTPQuotaWidgetEnabled") { self.widgetWindow?.presentWindow() }
                    capsule?.setPet(character: PetSettingsController.shared.settings.character,
                                    botColor: PetSettingsController.shared.settings.botColor)
                }
            }
        }

        PetSettingsController.shared.setVisible = { [weak self] visible in
            if visible { self?.petPanel?.show() } else { self?.petPanel?.hide() }
        }
        PetSettingsController.shared.currentVisible = { [weak self] in self?.petPanel?.isVisible ?? false }
        PetSettingsController.shared.webViewProvider = { [weak self] in
            guard let self else { return [] }
            var views: [WKWebView] = []
            for window in NSApp.windows {
                if let view = WebHost.webView(in: window) { views.append(view) }
            }
            if let panel = self.petPanel?.panel, let view = WebHost.webView(in: panel) { views.append(view) }
            return views
        }
        PetSettingsController.shared.petPanelProvider = { [weak self] in self?.petPanel }
        PetSettingsController.shared.setMonitor = { [weak self] monitor in
            guard let self, let capsule = self.capsule else { return }
            if monitor { capsule.show() } else { capsule.hide() }
        }
        PetSettingsController.shared.currentMonitor = { [weak self] in
            self?.capsule?.isVisible ?? false
        }
        // Live「桌面限额」state — the settings page must see the quota window's real
        // visibility, not the last value it itself wrote (Windows reads Enabled).
        PetSettingsController.shared.currentQuota = { [weak self] in
            self?.widgetWindow?.window?.isVisible ?? false
        }
        // Shell-level settings the dashboard's App & Updates section reads
        // (Windows NativeBridge.pushSettings parity). Before this, getSettings was
        // never answered, so the launch-at-login toggle and the check-for-updates
        // button were rendered but dead.
        PetSettingsController.shared.shellSettingsProvider = { [weak self] in
            var payload: [String: Any] = [
                "platform": "macos",
                "launchAtLogin": LaunchAtLogin.isEnabled,
                "launchAtLoginSupported": LaunchAtLogin.isSupported,
                "toastOnReset": UserDefaults.standard.object(forKey: "TTPShell_toastOnReset") == nil
                    ? true : UserDefaults.standard.bool(forKey: "TTPShell_toastOnReset"),
                "confettiOnReset": UserDefaults.standard.object(forKey: "TTPShell_confettiOnReset") == nil
                    ? true : UserDefaults.standard.bool(forKey: "TTPShell_confettiOnReset"),
                "autoUpdateEnabled": UserDefaults.standard.bool(forKey: "TTPShell_autoUpdateEnabled"),
                "hideMenuBarIcon": false,
                "isSyncing": IslandStats.shared.syncing,
                "dynamicIslandEnabled": self?.capsule?.isVisible ?? false,
                "updateBusy": false,
            ]
            if let self { payload["version"] = self.updateChecker.currentVersion }
            return payload
        }
        PetSettingsController.shared.nativeActionHandler = { [weak self] name in
            guard let self else { return false }
            switch name {
            case "checkForUpdates":
                self.updateChecker.checkAndPrompt()
                return true
            case "syncNow":
                self.serverManager.syncNow()
                return true
            case "quit":
                NSApp.terminate(nil)
                return true
            case "openDashboard":
                self.openDashboard()
                return true
            default:
                return false   // openWidgetGallery / openAbout have no surface here
            }
        }
        IslandStats.shared.load()
        IslandStats.shared.serverURLProvider = { [weak self] in self?.serverManager.serverURL }
        IslandStats.shared.petWebViewProvider = { [weak self] in
            guard let self, let panel = self.petPanel?.panel else { return nil }
            return WebHost.webView(in: panel)
        }
        IslandStats.shared.bubbleBandProvider = { [weak self] in
            self?.petPanel?.bubbleBand ?? PetPanelController.minBubbleBand
        }

        // Capsule (用量悬浮窗) — MonitorWidgetWindow counterpart.
        let capsule = IslandCapsuleController()
        capsule.onOpenDashboard = { [weak self] in self?.openDashboard() }
        self.capsule = capsule
        IslandStats.shared.onStatsUpdated = { [weak self] in
            self?.capsule?.setText(IslandStats.shared.capsuleText)
        }

        PetSettingsController.shared.characterChanged = { [weak self] character in
            self?.capsule?.setPet(character: character,
                                  botColor: PetSettingsController.shared.settings.botColor)
        }
        // bot's dot is its body colour, so a palette change must retint the pill
        // even though the character itself did not change.
        PetSettingsController.shared.botColorChanged = { [weak self] botColor in
            self?.capsule?.setPet(character: PetSettingsController.shared.settings.character,
                                  botColor: botColor)
        }
        PetSettingsController.shared.islandModeChanged = { [weak self] island in
            self?.capsule?.setIslandMode(island)
        }
        capsule.onIslandModeChangedByDrag = { island in
            PetSettingsController.shared.setIslandModeFromNative(island)
        }
        capsule.onMenu = { [weak self] point in
            self?.statusItemController?.popMenu(at: point)
        }
        PetSettingsController.shared.petDragRequested = { [weak self] type in
            let direction = type == "pet:drag-left" ? "running-left"
                : type == "pet:drag-right" ? "running-right" : "running-right"
            self?.petPanel?.beginNativeDrag(direction: direction)
        }
        PetSettingsController.shared.petBubbleHeightChanged = { [weak self] band in
            self?.petPanel?.resizeForBubble(band: band)
        }
        PetSettingsController.shared.quotaChanged = { [weak self] quota in
            guard let self else { return }
            if quota {
                self.openWidget()
            } else {
                self.widgetWindow?.window?.orderOut(nil)
            }
        }
        PetSettingsController.shared.trayStyleChanged = { [weak self] style in
            // Tray style is the MENU-BAR icon style only. The island dot is the
            // pet indicator and always follows the selected pet (mac divergence
            // from Windows, owner request 2026-11-10).
            self?.statusItemController?.setTrayStyle(style)
        }
        capsule.setIslandMode(PetSettingsController.shared.settings.islandMode)
        // Seed the pill appearance from the persisted settings even before the
        // first show (Windows ctor ApplyStyle).
        capsule.setAppearance(character: PetSettingsController.shared.settings.character,
                              botColor: PetSettingsController.shared.settings.botColor)
        QuotaWidgetHost.shared.windowProvider = { [weak self] in self?.widgetWindow?.window }
        QuotaWidgetHost.shared.serverURLProvider = { [weak self] in self?.serverManager.serverURL }
        QuotaWidgetHost.shared.onClose = { [weak self] in
            self?.widgetWindow?.window?.orderOut(nil)
            UserDefaults.standard.set(false, forKey: "TTPQuotaWidgetEnabled")
            QuotaWidgetHost.shared.stop()
            // Re-push the pet settings so the 桌面限额 switch turns itself off
            // (Windows EnabledChanged -> PushDashboardPetSettings).
            PetSettingsController.shared.apply(key: "quota", value: false)
        }
        QuotaWidgetHost.shared.onOpenDashboard = { [weak self] in
            self?.openDashboard()
        }

        serverManager.start()
        Diag.info("Shell launched (v\(updateChecker.currentVersion))")

        // Self-test hook: TOKENTRACKER_MAC_WEBTEST=1 opens the dashboard in a
        // plain titled window right away — isolates bundle-level WebKit breakage
        // (titled window fails too) from borderless-panel specifics (titled works).
        if ProcessInfo.processInfo.environment["TOKENTRACKER_MAC_WEBTEST"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                self?.openDashboard()
            }
        }
    }

    /// Windows re-pushes the pet context when the system theme flips
    /// (TrayApplicationContext -> PetWindow.ApplyTheme). Without this the pet
    /// ignored a runtime light/dark switch until the next reload/settings change.
    func applicationDidChangeEffectiveAppearance(_ notification: Notification) {
        PetSettingsController.shared.pushToPetPage()
        PetSettingsController.shared.broadcastSettings()
        // bot "auto" body colour flips with the theme, so the pill dot follows.
        let settings = PetSettingsController.shared.settings
        capsule?.setPet(character: settings.character, botColor: settings.botColor)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        serverManager.stop()
        return .terminateNow
    }

    // MARK: Window management

    private func openDashboard() {
        let controller = dashboardWindow ?? DashboardWindowController(serverURLProvider: { [weak self] in
            self?.serverManager.serverURL ?? URL(string: "http://127.0.0.1:17680")!
        })
        dashboardWindow = controller
        controller.presentWindow()
    }

    private func openWidget() {
        let controller = widgetWindow ?? QuotaWidgetWindowController(serverURLProvider: { [weak self] in
            self?.serverManager.serverURL ?? URL(string: "http://127.0.0.1:17680")!
        })
        widgetWindow = controller
        controller.presentWindow()
    }

    private func togglePet() {
        let isVisible = petPanel?.isVisible ?? false
        PetSettingsController.shared.apply(key: "visible", value: !isVisible)
    }

    private func toggleCapsule() {
        guard let capsule else { return }
        let isVisible = capsule.isVisible
        if isVisible {
            capsule.hide()
            UserDefaults.standard.set(false, forKey: "TTPCapsuleEnabled")
        } else {
            capsule.show()
            UserDefaults.standard.set(true, forKey: "TTPCapsuleEnabled")
        }
    }

    var isCapsuleVisible: Bool { capsule?.isVisible ?? false }

    private func toggleQuotaWidget() {
        guard let controller = widgetWindow else { return }
        let isVisible = controller.window?.isVisible ?? false
        if isVisible {
            controller.window?.orderOut(nil)
            UserDefaults.standard.set(false, forKey: "TTPQuotaWidgetEnabled")
        } else {
            controller.presentWindow()
            UserDefaults.standard.set(true, forKey: "TTPQuotaWidgetEnabled")
        }
    }

    var isPetVisible: Bool { petPanel?.isVisible ?? false }

    var isQuotaWidgetVisible: Bool { widgetWindow?.window?.isVisible ?? false }

    /// Pages loaded while the server was still starting sit on an error; once the
    /// health poll reports running, reload whatever is on screen.
    private func refreshVisibleWebViews() {
        let serverURL = serverManager.serverURL
        if let window = dashboardWindow?.window, window.isVisible,
           let webView = WebHost.webView(in: window) {
            WebHost.load(webView, path: "/?app=1", on: serverURL)
        }
        if let window = widgetWindow?.window, window.isVisible,
           let webView = WebHost.webView(in: window) {
            WebHost.load(webView, path: "/quota.html?app=1", on: serverURL)
        }
        if let panel = petPanel?.panel, panel.isVisible,
           let webView = WebHost.webView(in: panel) {
            WebHost.load(webView, path: "/pet.html?app=1", on: serverURL)
        }
    }
}
