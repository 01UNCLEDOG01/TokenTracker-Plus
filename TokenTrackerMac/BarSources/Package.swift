// swift-tools-version:5.9
// Vendored from upstream xiufengsun/TokenTracker TokenTrackerBar (MIT).
// Built with SwiftPM + Command Line Tools — no full Xcode required.
// Vortex (particle fireworks) is dropped: the library ships an asset catalog
// that needs full-Xcode actool; the confetti controller keeps its toast.
import PackageDescription

let package = Package(
    name: "TokenTrackerBar",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(
            name: "TokenTrackerBar",
            path: "Sources/TokenTrackerBar"
        )
    ]
)
