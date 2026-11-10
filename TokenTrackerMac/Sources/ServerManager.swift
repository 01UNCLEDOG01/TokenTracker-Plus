import Foundation

/// Spawns and supervises the embedded tokentracker server — the counterpart of
/// TokenTrackerWin's ServerManager.cs.
///
/// Layout inside the .app (produced by TokenTrackerMac/scripts/bundle-node.sh):
///   Contents/Resources/EmbeddedServer/node            (pinned Node binary, darwin-arm64)
///   Contents/Resources/EmbeddedServer/tokentracker/bin/tracker.js
///   Contents/Resources/EmbeddedServer/tokentracker/dashboard/dist/...
///
/// Port: 17680, matching the Windows shell and the mac handover order
/// (mac-盘点交接 §macOS 壳开发建议 #1, "first priority"): the bare CLI default
/// 7680 collides with macOS **AirPlay Receiver** (on by default), which kills
/// the server at bind time and puts the shell into an endless restart loop.
/// An explicit --port keeps serve.js's strict behavior (it errors when busy
/// instead of silently hopping ports) — a busy port is surfaced as a health
/// state, never hidden.
final class ServerManager {
    enum Health: String {
        case idle, starting, running, crashed, failed
    }

    static let preferredPort: Int = 17680

    private(set) var health: Health = .idle
    private(set) var port: Int = ServerManager.preferredPort
    var serverURL: URL { URL(string: "http://127.0.0.1:\(port)")! }

    private var process: Process?
    private var restartAttempts = 0
    private var restartTimer: Timer?
    private var healthTimer: Timer?
    private var isSupposedToRun = false
    private let queue = DispatchQueue(label: "com.tokentrackerplus.servermanager")
    /// Human-readable cause of the latest failure, surfaced in the menu-bar
    /// tooltip while the health is crashed/failed (e.g. an occupied port).
    private(set) var lastFailureReason: String?

    /// Fired on the main thread whenever the health state changes.
    var onHealthChange: ((Health) -> Void)?

    // MARK: Runtime discovery

    private struct Runtime {
        let nodeURL: URL
        let entryURL: URL
    }

    /// Embedded runtime first, then the dev overrides the Windows shell uses
    /// (TOKENTRACKER_NODE / TOKENTRACKER_ENTRY — entry may come alone with a
    /// PATH-resolvable node), never a hardcoded checkout path.
    private func findRuntime() -> Runtime? {
        if let resources = Bundle.main.resourceURL {
            let embed = resources.appendingPathComponent("EmbeddedServer", isDirectory: true)
            let entry = embed.appendingPathComponent("tokentracker/bin/tracker.js")
            // The bundle carries both architectures (universal .app); pick by machine.
            let arch = Self.machineArch == "x86_64" ? "node-x64" : "node-arm64"
            let node = embed.appendingPathComponent(arch)
            let fallback = embed.appendingPathComponent("node")
            let nodeURL = FileManager.default.fileExists(atPath: node.path) ? node : fallback
            if FileManager.default.fileExists(atPath: nodeURL.path)
                && FileManager.default.fileExists(atPath: entry.path) {
                return Runtime(nodeURL: nodeURL, entryURL: entry)
            }
        }
        let env = ProcessInfo.processInfo.environment
        guard let entryPath = env["TOKENTRACKER_ENTRY"],
              FileManager.default.fileExists(atPath: entryPath) else { return nil }
        let nodePath: String?
        if let explicit = env["TOKENTRACKER_NODE"], FileManager.default.fileExists(atPath: explicit) {
            nodePath = explicit
        } else {
            nodePath = which("node")
        }
        guard let nodePath, FileManager.default.isExecutableFile(atPath: nodePath) else { return nil }
        return Runtime(nodeURL: URL(fileURLWithPath: nodePath),
                       entryURL: URL(fileURLWithPath: entryPath))
    }

    /// "arm64" or "x86_64" — decides which embedded Node binary runs.
    static var machineArch: String {
        var sysinfo = utsname()
        uname(&sysinfo)
        return withUnsafeBytes(of: &sysinfo.machine) { raw in
            String(cString: raw.baseAddress!.assumingMemoryBound(to: CChar.self))
        }
    }

    /// Minimal PATH lookup — the shell must not depend on the user's login shell
    /// profile being loaded (GUI apps do not inherit it).
    private func which(_ name: String) -> String? {
        let searchPaths = ["/usr/local/bin", "/opt/homebrew/bin",
                           NSHomeDirectory() + "/tools/node22/bin",
                           NSHomeDirectory() + "/.nvm/versions/node"]
        for dir in searchPaths {
            let candidate = dir + "/" + name
            if FileManager.default.isExecutableFile(atPath: candidate) {
                return candidate
            }
        }
        return nil
    }

    // MARK: Lifecycle

    func start() {
        isSupposedToRun = true
        restartAttempts = 0
        spawnOrSchedule()
        startHealthPolling()
    }

    func stop() {
        isSupposedToRun = false
        restartTimer?.invalidate()
        healthTimer?.invalidate()
        if let process = process, process.isRunning {
            process.terminate()
            // Wait synchronously (bounded) for SIGTERM to land. The app is
            // quitting anyway — an asyncAfter SIGKILL fallback would never run
            // after process exit, leaving an orphaned node holding the port and
            // dooming the next launch to a busy-port restart loop.
            let deadline = Date().addingTimeInterval(2.0)
            while process.isRunning && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.05)
            }
            if process.isRunning {
                Diag.error("Server ignored SIGTERM for 2s — SIGKILL")
                kill(process.processIdentifier, SIGKILL)
            }
            process.waitUntilExit()
        }
        process = nil
        setHealth(.idle)
    }

    private func spawnOrSchedule() {
        guard isSupposedToRun else { return }
        guard let runtime = findRuntime() else {
            Diag.error("No runtime found: EmbeddedServer missing and no TOKENTRACKER_NODE/TOKENTRACKER_ENTRY override")
            setHealth(.failed)
            return
        }

        let process = Process()
        process.executableURL = runtime.nodeURL
        process.arguments = [runtime.entryURL.path, "serve", "--port", String(port)]
        var environment = ProcessInfo.processInfo.environment
        // The serve.js env guard skips auto-opening a browser for native shells.
        environment["TOKENTRACKER_APP_SHELL"] = "macos"
        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            if !data.isEmpty, let text = String(data: data, encoding: .utf8) {
                Diag.info("[server] \(text.trimmingCharacters(in: .whitespacesAndNewlines))")
                DispatchQueue.main.async { [weak self] in
                    self?.observeDiagnostics(from: text)
                }
            }
        }

        process.terminationHandler = { [weak self] proc in
            guard let self = self else { return }
            self.queue.async {
                guard self.isSupposedToRun else { return }
                Diag.error("Server exited unexpectedly (status \(proc.terminationStatus))")
                self.setHealth(.crashed)
                self.scheduleRestart()
            }
        }

        do {
            try process.run()
        } catch {
            Diag.error("Failed to launch server: \(error.localizedDescription)")
            setHealth(.failed)
            scheduleRestart()
            return
        }
        self.process = process
        lastFailureReason = nil
        setHealth(.starting)
        Diag.info("Server spawned: node \(runtime.entryURL.path) --port \(port)")
    }

    /// Watches the server's stderr for the busy-port signature so the crashed
    /// state can say *why* instead of just "crashed" (AirPlay on :7680 was the
    /// 2026-11-10 incident that made the shell look permanently broken).
    private func observeDiagnostics(from text: String) {
        if text.contains("EADDRINUSE") || text.contains("EADDR") {
            lastFailureReason = "端口 \(port) 被占用（EADDRINUSE）——多半是 AirPlay 接收或另一个 server 实例"
        } else if text.lowercased().contains("error") && lastFailureReason == nil {
            lastFailureReason = "server 启动报错，详见 shell.log"
        }
    }

    private func scheduleRestart() {
        guard isSupposedToRun else { return }
        restartAttempts += 1
        let delay = min(pow(2.0, Double(restartAttempts)), 30.0)
        Diag.info("Restarting server in \(delay)s (attempt \(restartAttempts))")
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.spawnOrSchedule()
        }
    }

    // MARK: Health polling

    private func startHealthPolling() {
        healthTimer?.invalidate()
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
            self?.pollHealth()
        }
        RunLoop.main.add(timer, forMode: .common)
        healthTimer = timer
    }

    private func pollHealth() {
        guard isSupposedToRun else { return }
        var request = URLRequest(url: serverURL.appendingPathComponent("usage-limits"))
        request.timeoutInterval = 4
        request.cachePolicy = .reloadIgnoringLocalCacheData
        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            guard let self = self else { return }
            DispatchQueue.main.async {
                if let http = response as? HTTPURLResponse, error == nil,
                   (200..<500).contains(http.statusCode) {
                    if self.health != .running {
                        self.restartAttempts = 0
                        Diag.info("Server healthy on port \(self.port)")
                    }
                    self.setHealth(.running)
                } else if self.health == .starting || self.health == .running {
                    // A poll failure alone is not a crash: the process supervision
                    // (terminationHandler) decides between "slow" and "dead".
                    if let process = self.process, !process.isRunning, self.health != .crashed {
                        self.setHealth(.crashed)
                    }
                }
            }
        }.resume()
    }

    private func setHealth(_ value: Health) {
        guard health != value else { return }
        health = value
        Diag.info("Server health: \(value.rawValue)")
        onHealthChange?(value)
    }

    /// Fire-and-forget manual sync (menu item "立即同步"). Runs against the same
    /// embedded runtime so it cannot drift from what the server reads.
    func syncNow() {
        guard let runtime = findRuntime() else {
            Diag.error("syncNow: no runtime found")
            return
        }
        let process = Process()
        process.executableURL = runtime.nodeURL
        process.arguments = [runtime.entryURL.path, "sync", "--auto", "--background", "--all-local-sources"]
        var environment = ProcessInfo.processInfo.environment
        environment["TOKENTRACKER_APP_SHELL"] = "macos"
        process.environment = environment
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            Diag.info("Manual sync started")
            DispatchQueue.main.async { IslandStats.shared.setSyncing(true) }
            process.terminationHandler = { proc in
                Diag.info("Manual sync finished (status \(proc.terminationStatus))")
                DispatchQueue.main.async { IslandStats.shared.setSyncing(false) }
            }
            // Watchdog: a hung sync must not keep the pet in "syncing" forever.
            DispatchQueue.global().asyncAfter(deadline: .now() + 900) {
                if process.isRunning {
                    Diag.error("Manual sync exceeded 15 min — clearing syncing state")
                    DispatchQueue.main.async { IslandStats.shared.setSyncing(false) }
                }
            }
        } catch {
            Diag.error("Manual sync failed to launch: \(error.localizedDescription)")
        }
    }
}
