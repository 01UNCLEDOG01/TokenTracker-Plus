namespace TokenTrackerWin;

/// <summary>
/// Mirror of <c>TokenTrackerBar/Utilities/Constants.swift</c>. The local server
/// port and dashboard URL must match the CLI (<c>tracker serve</c> binds :7680).
/// </summary>
internal static class Constants
{
    // The live server URL is owned by ServerManager — it picks a free loopback
    // port at launch (the CLI default 7680 is unreliable on Windows: Delivery
    // Optimization holds it). Always IPv4 ("127.0.0.1"), never "localhost",
    // which would resolve to ::1 and hit DoSvc on 7680.

    /// <summary>Poll interval for the background health-check loop.</summary>
    public const int HealthCheckIntervalSeconds = 30;

    /// <summary>
    /// How long to wait for the server to answer after launch. A cold session
    /// rescan after a payload swap measured ~70s on this machine (2026-10-27),
    /// which the old 45s budget turned into a three-attempt failure loop.
    /// </summary>
    public const int StartupTimeoutSeconds = 120;

    public const string AppDisplayName = "TokenTracker Plus";
    public const string GitHubUrl = "https://github.com/01UNCLEDOG01/TokenTracker-plus";

    /// <summary>HKCU Run-key value name used for launch-at-startup.</summary>
    public const string StartupRegistryValueName = "TokenTracker Plus";
}
