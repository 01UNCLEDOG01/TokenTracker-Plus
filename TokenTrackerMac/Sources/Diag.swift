import Foundation
import os

/// Diagnostics logging for the macOS shell — the counterpart of TokenTrackerWin's
/// Diag.cs. Writes to both os_log (Console.app) and a rolling text file under
/// ~/Library/Application Support/TokenTrackerPlus/, so a shell built with just the
/// Command Line Tools (no Xcode debugger) stays debuggable.
enum Diag {
    private static let log = Logger(subsystem: "com.tokentrackerplus.mac", category: "shell")

    private static var logFileURL: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("TokenTrackerPlus", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("shell.log")
    }()

    static func info(_ message: String) {
        log.info("\(message, privacy: .public)")
        append("INFO", message)
    }

    static func error(_ message: String) {
        log.error("\(message, privacy: .public)")
        append("ERROR", message)
    }

    private static func append(_ level: String, _ message: String) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let line = "\(formatter.string(from: Date())) [\(level)] \(message)\n"
        if let handle = try? FileHandle(forWritingTo: logFileURL) {
            handle.seekToEndOfFile()
            handle.write(line.data(using: .utf8)!)
            try? handle.close()
        } else {
            try? line.data(using: .utf8)?.write(to: logFileURL)
        }
    }
}
