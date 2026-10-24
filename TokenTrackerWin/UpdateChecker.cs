using System.Net.Http;
using System.Reflection;

namespace TokenTrackerWin;

/// <summary>
/// Read-only upstream version check. This fork deliberately never downloads or
/// executes an upstream installer: upstream stays on 1.4.x while the fork moves
/// independently, so an upstream "newer" version is information, not an upgrade.
/// The tray owns every dialog; this type only manages state and raises
/// <see cref="Changed"/>.
/// </summary>
internal sealed class UpdateChecker
{
    public enum UpdateState { Idle, Checking, UpdateAvailable }
    public enum CheckOutcome { UpToDate, UpdateAvailable, Failed, Skipped }

    private static readonly HttpClient Http = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("TokenTracker-Windows-UpstreamCheck");
        return client;
    }

    /// <summary>Raised (off the UI thread) whenever <see cref="State"/> changes.</summary>
    public event Action? Changed;

    public UpdateState State { get; private set; } = UpdateState.Idle;
    public string? LatestVersion { get; private set; }
    public DateTimeOffset? ApiRetryAt => _releaseClient.ApiRetryAt;

    private readonly UpdateReleaseClient _releaseClient;

    public UpdateChecker(HttpClient? releaseHttp = null) => _releaseClient = new(releaseHttp ?? Http);

    public string CurrentVersion { get; } = ResolveCurrentVersion();

    /// <summary>
    /// Compare the fork version with the latest upstream release. Background
    /// checks are intentionally skipped: this is a read-only gap check, and a
    /// launch-time network call would only add noise. The manual tray action is
    /// the sole entry point.
    /// </summary>
    public async Task<CheckOutcome> CheckAsync(bool silent)
    {
        if (silent)
        {
            Diag.Log("update", "background check skipped: read-only upstream check");
            return CheckOutcome.Skipped;
        }
        if (State == UpdateState.Checking)
            return CheckOutcome.Skipped;

        SetState(UpdateState.Checking);
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            var release = await _releaseClient.FetchLatestAsync(cts.Token);
            var latest = release.Version;
            if (CompareVersions(CurrentVersion, latest) < 0)
            {
                LatestVersion = latest;
                SetState(UpdateState.UpdateAvailable);
                Diag.Log("update", $"upstream newer current={CurrentVersion} latest={latest} (read-only)");
                return CheckOutcome.UpdateAvailable;
            }

            LatestVersion = latest;
            SetState(UpdateState.Idle);
            Diag.Log("update", $"no newer upstream current={CurrentVersion} latest={latest}");
            return CheckOutcome.UpToDate;
        }
        catch (Exception ex)
        {
            Diag.Log("update", $"upstream check failed: {ex.Message}");
            SetState(UpdateState.Idle);
            return CheckOutcome.Failed;
        }
    }

    private void SetState(UpdateState state)
    {
        if (State == state) return;
        State = state;
        Changed?.Invoke();
    }

    private static string ResolveCurrentVersion()
    {
        var info = Assembly.GetExecutingAssembly()
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (string.IsNullOrWhiteSpace(info))
            return Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
        // Strip the "+<sha>" / "-<suffix>" build metadata: "1.0.0+abc123" -> "1.0.0".
        return info.Split('+', '-')[0];
    }

    /// <summary>Numeric dotted compare. Returns &lt;0 if a&lt;b, 0 if equal, &gt;0 if a&gt;b.</summary>
    private static int CompareVersions(string a, string b)
    {
        var pa = a.Split('.');
        var pb = b.Split('.');
        var count = Math.Max(pa.Length, pb.Length);
        for (var i = 0; i < count; i++)
        {
            var va = i < pa.Length && int.TryParse(pa[i], out var x) ? x : 0;
            var vb = i < pb.Length && int.TryParse(pb[i], out var y) ? y : 0;
            if (va != vb) return va < vb ? -1 : 1;
        }
        return 0;
    }
}
