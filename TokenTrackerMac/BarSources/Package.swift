// swift-tools-version:5.9
// Vendored from upstream xiufengsun/TokenTracker TokenTrackerBar (MIT).
// Built with SwiftPM + Command Line Tools — no full Xcode required.
// Built with full Xcode (SwiftUI macros + actool are Xcode-only).
// Vortex: the particle engine for the reset celebration (upstream parity).
import PackageDescription

let package = Package(
    name: "TokenTrackerBar",
    platforms: [.macOS(.v12)],
    dependencies: [
        .package(url: "https://github.com/zats/Vortex.git", revision: "ef5392088d4aeb255c4eee83157dbdafcd31bf07"),
    ],
    targets: [
        .executableTarget(
            name: "TokenTrackerBar",
            dependencies: ["Vortex"],
            path: "Sources/TokenTrackerBar"
        )
    ]
)
