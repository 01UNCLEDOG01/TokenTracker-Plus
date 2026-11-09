import Foundation
import ServiceManagement

/// Launch-at-login toggle — counterpart of LaunchAtStartup.cs. Uses SMAppService
/// (macOS 13+); on older systems the menu item is hidden instead of degrading.
enum LaunchAtLogin {
    static var isSupported: Bool {
        if #available(macOS 13.0, *) { return true }
        return false
    }

    static var isEnabled: Bool {
        guard isSupported else { return false }
        if #available(macOS 13.0, *) {
            return SMAppService.mainApp.status == .enabled
        }
        return false
    }

    static func setEnabled(_ enabled: Bool) -> Bool {
        guard isSupported else { return false }
        if #available(macOS 13.0, *) {
            do {
                if enabled {
                    try SMAppService.mainApp.register()
                } else {
                    try SMAppService.mainApp.unregister()
                }
                Diag.info("Launch at login -> \(enabled)")
                return true
            } catch {
                Diag.error("Launch at login toggle failed: \(error.localizedDescription)")
                return false
            }
        }
        return false
    }
}
