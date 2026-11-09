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
    private var widgetWindow: WidgetWindowController?
    private var petPanel: PetPanelController?
    private var didShowPetOnReady = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        petPanel = PetPanelController(serverURL: serverManager.serverURL)
        petPanel?.onOpenDashboard = { [weak self] in self?.openDashboard() }
        petPanel?.onContextMenu = { [weak self] point in
            self?.statusItemController?.popMenu(at: point)
        }

        statusItemController = StatusItemController(
            serverManager: serverManager,
            updateChecker: updateChecker,
            onOpenDashboard: { [weak self] in self?.openDashboard() },
            onOpenWidget: { [weak self] in self?.openWidget() },
            onTogglePet: { [weak self] in self?.petPanel?.toggle() })
        statusItemController?.install()

        serverManager.onHealthChange = { [weak self] health in
            self?.statusItemController?.updateHealth(health)
            if health == .running {
                self?.refreshVisibleWebViews()
                // Windows parity: the desktop pet is visible as soon as the
                // server is up on first launch (toggled off and back on via menu).
                if let self, !self.didShowPetOnReady {
                    self.didShowPetOnReady = true
                    self.petPanel?.show()
                }
            }
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
        let controller = widgetWindow ?? WidgetWindowController(serverURL: serverManager.serverURL)
        widgetWindow = controller
        controller.presentWindow()
    }

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
            WebHost.load(webView, path: "/quota", on: serverURL)
        }
        if let panel = petPanel?.panel, panel.isVisible,
           let webView = WebHost.webView(in: panel) {
            WebHost.load(webView, path: "/pet", on: serverURL)
        }
    }
}
