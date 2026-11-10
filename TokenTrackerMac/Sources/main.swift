import AppKit

// Single instance guard — counterpart of SingleInstance.cs. GUI apps do not
// inherit the login shell profile, so nothing here may depend on PATH.
let bundleID = Bundle.main.bundleIdentifier ?? "com.tokentrackerplus.mac"
let others = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID)
    .filter { $0 != NSRunningApplication.current }
if !others.isEmpty {
    // A second launch just nudges the first one to the front and exits.
    others.first?.activate()
    exit(0)
}

let app = NSApplication.shared
let delegate: AppDelegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.setActivationPolicy(.accessory)  // menu-bar app: no Dock icon (Windows tray parity)
app.run()
