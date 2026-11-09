import Foundation
import AppKit

/// Checks GitHub Releases for a newer version — counterpart of UpdateChecker.cs.
/// v1 opens the releases page for a manual download (the Windows shell installs
/// in place; on macOS the v1 install gesture is dragging the dmg, so the shell
/// only points the user at the download).
final class UpdateChecker {
    private let repo = "01UNCLEDOG01/TokenTracker-Plus"

    var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    /// Fetches the latest release tag and completes with the new version string
    /// (without the leading "v") when one is newer, or nil.
    func fetchLatestRelease(completion: @escaping (String?, String?) -> Void) {
        guard let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest") else {
            completion(nil, nil)
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                  let data, error == nil,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tagName = payload["tag_name"] as? String else {
                completion(nil, nil)
                return
            }
            let latest = tagName.hasPrefix("v") ? String(tagName.dropFirst()) : tagName
            completion(latest, self.isNewer(latest) ? tagName : nil)
        }.resume()
    }

    private func isNewer(_ candidate: String) -> Bool {
        let current = currentVersion.split(separator: ".").compactMap { Int($0) }
        let latest = candidate.split(separator: ".").compactMap { Int($0) }
        for index in 0..<max(current.count, latest.count) {
            let c = index < current.count ? current[index] : 0
            let l = index < latest.count ? latest[index] : 0
            if l != c { return l > c }
        }
        return false
    }

    func checkAndPrompt() {
        fetchLatestRelease { [weak self] _, newerTag in
            guard let self, let newerTag else {
                Diag.info("Update check: already on the latest release")
                return
            }
            DispatchQueue.main.async {
                let alert = NSAlert()
                alert.messageText = "发现新版本 \(newerTag)"
                alert.informativeText = "当前版本 v\(self.currentVersion)。前往 GitHub Releases 下载新的 dmg（拖进「应用程序」覆盖安装即可）。"
                alert.addButton(withTitle: "前往下载")
                alert.addButton(withTitle: "以后再说")
                if alert.runModal() == .alertFirstButtonReturn,
                   let url = URL(string: "https://github.com/\(self.repo)/releases") {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }
}
