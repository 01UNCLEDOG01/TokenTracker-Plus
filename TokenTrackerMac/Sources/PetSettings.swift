import AppKit
import WebKit

/// Native pet-settings bridge — the macOS counterpart of TokenTrackerWin's
/// WebView2 host contract (TrayApplicationContext.PushDashboardPetSettings +
/// PetWindow.FlushContextAsync).
///
/// The dashboard's pet settings page talks to `window.chrome.webview` (a
/// WebView2-only object): it posts `{type:"getPetSettings"}` /
/// `{type:"setPetSetting",key,value}` JSON and listens for a
/// `native:petSettings` DOM event carrying the settings detail. Without a host
/// the page hides its controls ("请在 TokenTracker 桌面 App 中打开此页面").
/// Here we shim `window.chrome.webview` onto `webkit.messageHandlers.petBridge`,
/// answer the queries, and push `window.__ttPet*` globals into the pet page —
/// the same globals the Windows host flushes (character/botColor/dark/size…).
final class PetSettingsController: NSObject, WKScriptMessageHandler {
    static let shared = PetSettingsController()

    struct Settings {
        var visible: Bool = true
        var character: String = "clawd"
        var size: String = "medium"
        var botColor: String = "auto"
        // Capability-probe fields: the settings page only renders a control when
        // its field is present in the native reply (use-pet-settings.js).
        var islandMode: Bool = false       // 悬浮形态：顶部灵动岛 / 自由悬浮
        var quota: Bool = true             // 桌面限额悬浮窗 (= 额度窗)
        var trayStyle: String = "cat"      // 奔跑小猫 / 应用图标(mascot) / 经典闪电
        var actionLock: String = "auto"    // 动作 picker
        var monitor: Bool = true           // 用量悬浮窗 = 灵动岛胶囊
    }

    private(set) var settings = Settings()

    /// Provided by AppDelegate: show/hide the pet panel + current visibility.
    var setVisible: ((Bool) -> Void)?
    var currentVisible: (() -> Bool)?
    /// The「用量悬浮窗」toggle (Windows MonitorWidgetWindow) = the desktop panel.
    var setMonitor: ((Bool) -> Void)?
    var currentMonitor: (() -> Bool)?
    /// The「桌面限额」toggle (Windows _quotaWindow.Enabled): read live, else closing
    /// the quota window with its own close button left the settings switch ON.
    var currentQuota: (() -> Bool)?

    /// Provided by AppDelegate: every live app webview (bridge replies go to all).
    var webViewProvider: (() -> [WKWebView])?

    /// Provided by AppDelegate: the pet panel (for size resize + context push).
    var petPanelProvider: (() -> PetPanelController?)?
    /// Provided by AppDelegate: shell-level state the dashboard's App & Updates
    /// section reads (Windows NativeBridge.pushSettings parity). Without it the
    /// launch-at-login toggle and check-for-updates button render but do nothing.
    var shellSettingsProvider: (() -> [String: Any])?
    /// Dashboard -> shell settings that have a native surface (menu-bar metrics,
    /// hidden icon, limits display mode, reset toasts).
    var shellSettingApplier: ((String, Any) -> Void)?
    /// Provided by AppDelegate: runs a dashboard `action` message. Returns false
    /// when this shell has no handler for it.
    var nativeActionHandler: ((String) -> Bool)?
    /// Pet character changed — the capsule dot tints to the companion.
    var characterChanged: ((String) -> Void)?
    /// bot body colour changed — its pill dot is that colour (botPillDotHex).
    var botColorChanged: ((String) -> Void)?
    /// The pet page asks the native window to move (drag) / resize (bubble).
    var petDragRequested: ((String) -> Void)?
    var petBubbleHeightChanged: ((CGFloat) -> Void)?
    var islandModeChanged: ((Bool) -> Void)?
    var quotaChanged: ((Bool) -> Void)?
    var trayStyleChanged: ((String) -> Void)?

    func load() {
        let d = UserDefaults.standard
        let character = d.string(forKey: "TTPPetCharacter") ?? "clawd"
        let size = d.string(forKey: "TTPPetSize") ?? "medium"
        let botColor = d.string(forKey: "TTPPetBotColor") ?? "auto"
        // Windows defaults to "cat" (MonitorWidgetSettings.Load()?.TrayStyle ?? "cat").
        let trayStyle = d.string(forKey: "TTPTrayStyle") ?? "cat"
        let actionLock = d.string(forKey: "TTPPetActionLock") ?? "auto"
        // Default true — the island is the shipped default (MonitorWidgetSettings).
        let islandMode = d.object(forKey: "TTPCapsuleIslandMode") == nil
            ? true : d.bool(forKey: "TTPCapsuleIslandMode")
        let quota = d.object(forKey: "TTPQuotaWidgetEnabled") == nil
            ? true : d.bool(forKey: "TTPQuotaWidgetEnabled")
        let monitor = d.object(forKey: "TTPCapsuleEnabled") == nil
            ? true : d.bool(forKey: "TTPCapsuleEnabled")
        settings = Settings(visible: true, character: character,
                            size: PetSizePreset.normalize(size).rawValue,
                            botColor: botColor,
                            islandMode: islandMode,
                            quota: quota,
                            trayStyle: trayStyle,
                            actionLock: actionLock,
                            monitor: monitor)
        Diag.info("Pet settings loaded: \(settings.character)/\(settings.size)")
    }

    // MARK: WKScriptMessageHandler ("petBridge")

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "petBridge",
              let body = message.body as? String else { return }
        // Bare strings are real messages too ("quota:ready", "quota:drag"…);
        // only structured posts arrive as JSON.
        let obj: [String: Any]
        if let data = body.data(using: .utf8),
           let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
           parsed["type"] is String {
            obj = parsed
        } else {
            obj = ["type": body]
        }
        guard let type = obj["type"] as? String else { return }
        if type.hasPrefix("quota:"), let webView = message.webView {
            QuotaWidgetHost.shared.handle(type: type, payload: obj, webView: webView)
            return
        }
        // The pet page posts these through chrome.webview (petBridge channel):
        // drag requests (native move loop) and the self-measured bubble height
        // (host grows the window upward).
        if type == "pet:drag" || type == "pet:drag-left" || type == "pet:drag-right" {
            petDragRequested?(type)
            return
        }
        if type.hasPrefix("pet:bubble-height:") {
            let band = Double(type.dropFirst("pet:bubble-height:".count)) ?? 0
            petBubbleHeightChanged?(CGFloat(band))
            return
        }
        switch type {
        case "setSetting":
            // The dashboard posts Windows native-bridge shapes here. Appearance
            // controls (currency, unit system, locale) land in IslandStats; the
            // shell-level ones (launch-at-login, toggles) go to apply().
            let key = obj["key"] as? String ?? ""
            if Self.systemSettingKeys.contains(key) {
                apply(key: key, value: obj["value"])
            } else {
                IslandStats.shared.applyDashboardSetting(key: key, value: obj["value"])
            }
        case "getSettings":
            Diag.info("Dashboard requested native settings — pushed")
            broadcastSettings()
        case "getSystemAppearance":
            pushSystemAppearance()
        case "setChromeAppearance":
            applyChromeAppearance(isDark: obj["isDark"] as? Bool ?? false,
                                  theme: obj["theme"] as? String ?? "system")
        case "action":
            let name = obj["name"] as? String ?? ""
            if nativeActionHandler?(name) == true {
                Diag.info("Native action: \(name)")
            } else {
                Diag.info("Native action ignored: \(name)")
            }
        case "nativeSetting", "notify", "getNotificationStatus":
            // Windows-only shapes (theme persistence, native notifications); this
            // shell has no notification surface, the dashboard stays on defaults.
            break
        case "getPetSettings":
            broadcastSettings()
        case "setPetSetting":
            apply(key: obj["key"] as? String ?? "", value: obj["value"])
        case "refreshPetCatalog":
            broadcastSettings()  // catalog lives server-side; nothing to refresh natively
        default:
            Diag.info("Pet bridge message: \(type)")
        }
    }

    /// The capsule converted island -> free by being dragged; reflect it in the
    /// settings page (Windows IslandModeChanged -> PushDashboardPetSettings).
    func setIslandModeFromNative(_ island: Bool) {
        settings.islandMode = island
        UserDefaults.standard.set(island, forKey: "TTPCapsuleIslandMode")
        broadcastSettings()
    }

    /// Keys the dashboard posts as system settings (Windows TrayApplicationContext
    /// applySetting) rather than pet/appearance settings.
    private static let systemSettingKeys: Set<String> = [
        "launchAtLogin", "toastOnReset", "confettiOnReset", "autoUpdateEnabled",
        "showStats", "menuBarIconStyle", "menuBarItems", "hideMenuBarIcon",
        "dynamicIslandEnabled", "autoCheckUpdates",
    ]

    func apply(key: String, value: Any?) {
        let d = UserDefaults.standard
        switch key {
        case "visible":
            let visible = (value as? Bool) ?? false
            settings.visible = visible
            setVisible?(visible)
            d.set(visible, forKey: "TTPPetEnabled")
        case "character":
            guard let character = value as? String, !character.isEmpty else { return }
            settings.character = character
            d.set(character, forKey: "TTPPetCharacter")
            characterChanged?(character)
        case "size":
            guard let size = value as? String, PetSizePreset(rawValue: size) != nil else { return }
            settings.size = PetSizePreset.normalize(size).rawValue
            d.set(size, forKey: "TTPPetSize")
            resizePetPanel()
        case "botColor":
            guard let botColor = value as? String else { return }
            settings.botColor = botColor
            d.set(botColor, forKey: "TTPPetBotColor")
            botColorChanged?(botColor)
        case "monitor":
            // Windows TrayApplicationContext: case "monitor" -> _monitorWindow
            // SetEnabled (MonitorWidgetWindow = the 灵动岛 capsule), NOT the pet
            // bubble. The pet bubble/hover is always live.
            let monitor = (value as? Bool) ?? false
            settings.monitor = monitor
            d.set(monitor, forKey: "TTPCapsuleEnabled")
            setMonitor?(monitor)
        case "islandMode":
            let island = (value as? Bool) ?? false
            settings.islandMode = island
            d.set(island, forKey: "TTPCapsuleIslandMode")
            islandModeChanged?(island)
        case "quota":
            let quota = (value as? Bool) ?? true
            settings.quota = quota
            d.set(quota, forKey: "TTPQuotaWidgetEnabled")
            quotaChanged?(quota)
        case "trayStyle":
            guard let style = value as? String else { return }
            settings.trayStyle = style
            d.set(style, forKey: "TTPTrayStyle")
            trayStyleChanged?(style)
        case "actionLock":
            guard let lock = value as? String else { return }
            settings.actionLock = lock
            d.set(lock, forKey: "TTPPetActionLock")
            pushToPetPage()
        case "launchAtLogin":
            // Real control (menu-bar item 开机启动 uses the same SMAppService path).
            let enabled = (value as? Bool) ?? false
            if !LaunchAtLogin.setEnabled(enabled) {
                Diag.error("Launch-at-login toggle failed for dashboard request")
            }
        case "dynamicIslandEnabled":
            // The dashboard's Labs toggle means "show the monitor pill" here.
            let enabled = (value as? Bool) ?? false
            settings.monitor = enabled
            d.set(enabled, forKey: "TTPCapsuleEnabled")
            setMonitor?(enabled)
        case "toastOnReset", "confettiOnReset", "autoUpdateEnabled", "showStats",
             "menuBarIconStyle", "menuBarItems", "hideMenuBarIcon", "autoCheckUpdates",
             "limitsDisplayMode":
            // Persist the dashboard's echo AND apply it: the reset toast/confetti,
            // menu-bar metric slots, hide-icon toggle and limits display mode all
            // have native surfaces now (StatusItemController).
            d.set(value, forKey: "TTPShell_\(key)")
            shellSettingApplier?(key, value)
        default:
            Diag.info("Pet setting ignored: \(key)")
        }
        pushToPetPage()
        broadcastSettings()
    }

    // MARK: Reply channels

    private var settingsDetailJSON: String {
        var detail: [String: Any] = [
            "visible": currentVisible?() ?? settings.visible,
            "character": settings.character,
            "size": settings.size,
            "botColor": settings.botColor,
            "monitor": currentMonitor?() ?? settings.monitor,
            "islandMode": settings.islandMode,
            "quota": currentQuota?() ?? settings.quota,
            "trayStyle": settings.trayStyle,
            "actionLock": settings.actionLock,
        ]
        // Shell-level fields (launch-at-login, version, update state…) last, so
        // AppDelegate stays the single source for them.
        for (key, value) in shellSettingsProvider?() ?? [:] {
            detail[key] = value
        }
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    /// Answer every open app surface (the settings page can live in the dashboard,
    /// the desktop panel or the quota window — all share the same origin).
    func broadcastSettings() {
        for webView in webViewProvider?() ?? [] {
            // useNativeSettings listens on native:settings (Windows DashboardWindow
            // channel) while the pet page listens on native:petSettings. Dispatch
            // both: answering getSettings on the pet channel only kept the App &
            // Updates section empty.
            let script = "window.dispatchEvent(new CustomEvent('native:settings',{detail:\(settingsDetailJSON)}));" +
                "window.dispatchEvent(new CustomEvent('native:petSettings',{detail:\(settingsDetailJSON)}));"
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// Push the __ttPet* context the pet page renders from — the FlushContextAsync
    /// counterpart. Called after the pet page loads and on every change.
    func pushToPetPage() {
        guard let petPanel = petPanelProvider?(), let webView = petPanelPanelWebView(petPanel) else { return }
        let dark = NSApp.effectiveAppearance.name.rawValue.contains("Dark")
        let script = "window.__ttPetCharacter=\(WebHost.jsString(settings.character));" +
            "window.__ttPetBotColor=\(WebHost.jsString(settings.botColor));" +
            "window.__ttPetSize=\(WebHost.jsString(settings.size));" +
            "window.__ttPetActionLock=\(WebHost.jsString(settings.actionLock));" +
            "window.__ttPetDark=\(dark ? "true" : "false");" +
            "window.dispatchEvent(new Event('pet:character'));" +
            "window.dispatchEvent(new Event('pet:action-lock'));" +
            "window.dispatchEvent(new Event('pet:botColor'));" +
            "window.dispatchEvent(new Event('pet:dark'));" +
            "window.dispatchEvent(new Event('pet:settings'));"
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// ThemeProvider asks for the host's appearance and listens for
    /// native:systemAppearanceChanged (matchMedia is unreliable in a WKWebView).
    private func pushSystemAppearance() {
        let isDark = NSApp.effectiveAppearance.name.rawValue.contains("Dark")
        let script = "window.dispatchEvent(new CustomEvent('native:systemAppearanceChanged'," +
            "{detail:{isDark:\(isDark ? "true" : "false")}}));"
        for webView in webViewProvider?() ?? [] {
            webView.evaluateJavaScript(script, completionHandler: nil)
        }
    }

    /// Dashboard windows sync their NSWindow chrome to the web theme
    /// (syncNativeChromeAppearance): "system" clears the override.
    private func applyChromeAppearance(isDark: Bool, theme: String) {
        let appearance: NSAppearance? = theme == "system"
            ? nil : NSAppearance(named: isDark ? .darkAqua : .aqua)
        for window in NSApp.windows where WebHost.webView(in: window) != nil {
            window.appearance = appearance
        }
    }

    private func petPanelPanelWebView(_ panel: PetPanelController) -> WKWebView? {
        WebHost.webView(in: panel.panel)
    }

    /// Resize the pet panel for the chosen size bucket. The window keeps the
    /// position the user docked it at (Windows ApplySize keeps the bottom edge;
    /// only the first launch parks at the default corner), so picking a size
    /// never teleports the pet.
    func resizePetPanel() {
        guard let petPanel = petPanelProvider?() else { return }
        settings.size = PetSizePreset.normalize(settings.size).rawValue
        petPanel.setSize(PetSizePreset.normalize(settings.size))
    }
}
