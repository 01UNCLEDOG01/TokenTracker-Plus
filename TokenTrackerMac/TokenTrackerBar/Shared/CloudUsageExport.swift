import Foundation
import Darwin

// Vendored from upstream as `CloudUsageExport`: the native side of the hosted
// cloud-export IPC (dashboard `saveCloudUsageExport` -> `tokentracker-cloud-*.csv|json`).
// TT-Plus is local-first (hosted-only, no cloud in TT-Plus), so the cloud message
// type, the cloud filename pattern and the csv path are gone. What remains is the
// local snapshot export the dashboard's Settings -> Local data flow uses.
// The file name is kept because the committed Xcode project references this path.

/// A bounded metadata export, with no caller-selected directory or overwrite mode.
struct UsageExport {
    enum Failure: String, Error { case invalidExport = "invalid_export", saveFailed = "save_failed" }
    static let maximumBytes = 5 * 1024 * 1024
    let requestID: String
    let filename: String
    let format: String
    let bytes: Data

    init(message: [String: Any]) throws {
        guard Set(message.keys) == ["type", "requestId", "filename", "format", "content"],
              message["type"] as? String == "saveLocalUsageExport",
              let requestID = message["requestId"] as? String, UUID(uuidString: requestID) != nil,
              let filename = message["filename"] as? String,
              filename.range(of: "^tokentracker-local-[A-Za-z0-9][A-Za-z0-9_-]{0,150}\\.json$", options: .regularExpression) != nil,
              let format = message["format"] as? String, format == "json",
              filename.hasSuffix(".json"),
              let content = message["content"] as? String, !content.isEmpty, !content.contains("\0"),
              content.utf8.count <= Self.maximumBytes else {
            throw Failure.invalidExport
        }
        let bytes = Data(content.utf8)
        guard (try? JSONSerialization.jsonObject(with: bytes)) is [String: Any] else { throw Failure.invalidExport }
        self.requestID = requestID
        self.filename = filename
        self.format = format
        self.bytes = bytes
    }

    static func permitsSource(_ source: URL?, current: URL?, expected: URL, mainFrame: Bool, ownWebView: Bool) -> Bool {
        guard mainFrame, ownWebView else { return false }
        return [source, current].allSatisfy { candidate in
            guard let url = candidate else { return false }
            return url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "") &&
                url.host == expected.host && url.port == expected.port && expected.scheme == "http" &&
                url.user == nil && url.password == nil
        }
    }

    func save(in directory: URL) throws -> String {
        let stem = String(filename.dropLast(format.count + 1))
        for suffix in 0..<1000 {
            let name = suffix == 0 ? filename : "\(stem)-\(suffix).\(format)"
            let target = directory.appendingPathComponent(name)
            let descriptor = open(target.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            if descriptor < 0 {
                if errno == EEXIST { continue }
                throw Failure.saveFailed
            }
            var succeeded = false
            defer {
                close(descriptor)
                if !succeeded { try? FileManager.default.removeItem(at: target) }
            }
            let written = bytes.withUnsafeBytes { buffer -> Bool in
                guard let address = buffer.baseAddress else { return false }
                var offset = 0
                while offset < buffer.count {
                    let count = Darwin.write(descriptor, address.advanced(by: offset), buffer.count - offset)
                    if count < 0 && errno == EINTR { continue }
                    guard count > 0 else { return false }
                    offset += count
                }
                return fsync(descriptor) == 0
            }
            guard written else { throw Failure.saveFailed }
            succeeded = true
            return name
        }
        throw Failure.saveFailed
    }
}
