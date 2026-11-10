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

    /// Provided by AppDelegate: every live app webview (bridge replies go to all).
    var webViewProvider: (() -> [WKWebView])?

    /// Provided by AppDelegate: the pet panel (for size resize + context push).
    var petPanelProvider: (() -> PetPanelController?)?
    /// Pet character changed — the capsule dot tints to the companion.
    var characterChanged: ((String) -> Void)?
    /// The pet page asks the native window to move (drag) / resize (bubble).
    var petDragRequested: ((String) -> Void)?
    var petBubbleHeightChanged: ((CGFloat) -> Void)?
    var islandModeChanged: ((Bool) -> Void)?
    var quotaChanged: ((Bool) -> Void)?
    var trayStyleChanged: ((String) -> Void)?

    private let sizeFrames: [String: NSRect] = [
        "small": NSRect(x: 0, y: 0, width: 240, height: 320),
        "medium": NSRect(x: 0, y: 0, width: 320, height: 420),
        "large": NSRect(x: 0, y: 0, width: 420, height: 560),
    ]

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
                            size: sizeFrames.keys.contains(size) ? size : "medium",
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
            guard let size = value as? String, sizeFrames.keys.contains(size) else { return }
            settings.size = size
            d.set(size, forKey: "TTPPetSize")
            resizePetPanel()
        case "botColor":
            guard let botColor = value as? String else { return }
            settings.botColor = botColor
            d.set(botColor, forKey: "TTPPetBotColor")
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
        default:
            Diag.info("Pet setting ignored: \(key)")
        }
        pushToPetPage()
        broadcastSettings()
    }

    // MARK: Reply channels

    private var settingsDetailJSON: String {
        let detail: [String: Any] = [
            "visible": currentVisible?() ?? settings.visible,
            "character": settings.character,
            "size": settings.size,
            "botColor": settings.botColor,
            "monitor": currentMonitor?() ?? settings.monitor,
            "islandMode": settings.islandMode,
            "quota": settings.quota,
            "trayStyle": settings.trayStyle,
            "actionLock": settings.actionLock,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: detail),
              let json = String(data: data, encoding: .utf8) else { return "{}" }
        return json
    }

    /// Answer every open app surface (the settings page can live in the dashboard,
    /// the desktop panel or the quota window — all share the same origin).
    func broadcastSettings() {
        for webView in webViewProvider?() ?? [] {
            let script = "window.dispatchEvent(new CustomEvent('native:petSettings',{detail:\(settingsDetailJSON)}));"
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

    private func petPanelPanelWebView(_ panel: PetPanelController) -> WKWebView? {
        WebHost.webView(in: panel.panel)
    }

    /// Resize the pet panel for the chosen size bucket and re-dock it.
    func resizePetPanel() {
        guard let petPanel = petPanelProvider?(), let panel = petPanel.panel,
              let frame = sizeFrames[settings.size] else { return }
        panel.setContentSize(frame.size)
        petPanel.placeAtDefaultCorner()
    }
}
