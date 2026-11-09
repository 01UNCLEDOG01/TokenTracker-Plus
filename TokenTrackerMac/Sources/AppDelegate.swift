import AppKit
import WebKit

/// Wires the shell together — counterpart of TokenTrackerWin's Program.cs +
/// TrayApplicationContext boot sequence: server first, then status item, then
/// the optional windows.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let serverManager = ServerManager()
    private let updateChecker = UpdateChecker()
    private var statusItemController: StatusItemController?
    private var dashboardWindow: DashboardWindowController?
    private var widgetWindow: QuotaWidgetWindowController?
    private var desktopWidget: DesktopWidgetWindowController?
    private var petPanel: PetPanelController?
    private var didShowPetOnReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        petPanel = PetPanelController(serverURL: serverManager.serverURL)
        petPanel?.onOpenDashboard = { [weak self] in self?.openDashboard() }
        petPanel?.onContextMenu = { [weak self] point in
            self?.statusItemController?.popMenu(at: point)
        }

        self.desktopWidget = DesktopWidgetWindowController(serverURL: serverManager.serverURL)
        self.widgetWindow = QuotaWidgetWindowController(serverURL: serverManager.serverURL)

        statusItemController = StatusItemController(
            serverManager: serverManager,
            updateChecker: updateChecker,
            onOpenDashboard: { [weak self] in self?.openDashboard() },
            onOpenWidget: { [weak self] in self?.openWidget() },
            onTogglePet: { [weak self] in self?.togglePet() },
            onToggleDesktopWidget: { [weak self] in self?.toggleDesktopWidget() },
            onToggleQuotaWidget: { [weak self] in self?.toggleQuotaWidget() },
            isDesktopWidgetVisible: { [weak self] in self?.isDesktopWidgetVisible ?? false },
            isPetVisible: { [weak self] in self?.isPetVisible ?? false },
            isQuotaWidgetVisible: { [weak self] in self?.isQuotaWidgetVisible ?? false })
        statusItemController?.install()

        serverManager.onHealthChange = { [weak self] health in
            self?.statusItemController?.updateHealth(health)
            if health == .running {
                self?.refreshVisibleWebViews()
                // Windows parity: all three floating surfaces appear on the first
                // healthy poll (stored prefs win from the second launch on).
                if let self, !self.didShowPetOnReady {
                    self.didShowPetOnReady = true
                    // Stored prefs win once the user has toggled anything;
                    // only the very first launch falls back to show-all.
                    let stored: (String) -> Bool = { key in
                        UserDefaults.standard.object(forKey: key) == nil
                            ? true : UserDefaults.standard.bool(forKey: key)
                    }
                    if stored("TTPPetEnabled") { self.petPanel?.show() }
                    if stored("TTPDesktopWidgetEnabled") { self.desktopWidget?.show() }
                    if stored("TTPQuotaWidgetEnabled") { self.widgetWindow?.presentWindow() }
                }
            }
        }

        PetSettingsController.shared.load()
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
            guard let self, let desktopWidget = self.desktopWidget else { return }
            if monitor {
                desktopWidget.show()
                UserDefaults.standard.set(true, forKey: "TTPDesktopWidgetEnabled")
            } else {
                desktopWidget.window?.orderOut(nil)
                UserDefaults.standard.set(false, forKey: "TTPDesktopWidgetEnabled")
            }
        }
        PetSettingsController.shared.currentMonitor = { [weak self] in
            self?.desktopWidget?.window?.isVisible ?? false
        }
        QuotaWidgetHost.shared.windowProvider = { [weak self] in self?.widgetWindow?.window }
        QuotaWidgetHost.shared.serverURLProvider = { [weak self] in self?.serverManager.serverURL }
        QuotaWidgetHost.shared.onClose = { [weak self] in
            self?.widgetWindow?.window?.orderOut(nil)
            UserDefaults.standard.set(false, forKey: "TTPQuotaWidgetEnabled")
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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        serverManager.stop()
        return .terminateNow
    }

    // MARK: Window management

    private func openDashboard() {
        let controller = dashboardWindow ?? DashboardWindowController(serverURL: serverManager.serverURL)
        dashboardWindow = controller
        controller.presentWindow()
    }

    private func openWidget() {
        let controller = widgetWindow ?? QuotaWidgetWindowController(serverURL: serverManager.serverURL)
        widgetWindow = controller
        controller.presentWindow()
    }

    private func toggleDesktopWidget() {
        guard let desktopWidget else { return }
        let isVisible = desktopWidget.window?.isVisible ?? false
        if isVisible {
            desktopWidget.window?.orderOut(nil)
            UserDefaults.standard.set(false, forKey: "TTPDesktopWidgetEnabled")
        } else {
            desktopWidget.show()
            UserDefaults.standard.set(true, forKey: "TTPDesktopWidgetEnabled")
        }
    }

    /// Menu toggle for the floating pet — persists like the other surfaces so the
    /// startup behavior follows whatever the user last chose.
    private func togglePet() {
        let isVisible = petPanel?.isVisible ?? false
        PetSettingsController.shared.apply(key: "visible", value: !isVisible)
    }

    /// Menu toggle for the quota widget window — same persistence contract.
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

    var isDesktopWidgetVisible: Bool {
        desktopWidget?.window?.isVisible ?? false
    }

    var isPetVisible: Bool { petPanel?.isVisible ?? false }

    var isQuotaWidgetVisible: Bool { widgetWindow?.window?.isVisible ?? false }

    /// Pages loaded while the server was still starting sit on an error; once the
    /// health poll reports running, reload whatever is on screen.
    private func refreshVisibleWebViews() {
        let serverURL = serverManager.serverURL
        if let window = dashboardWindow?.window, window.isVisible,
           let webView = WebHost.webView(in: window) {
            WebHost.load(webView, path: "/dashboard", on: serverURL)
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
