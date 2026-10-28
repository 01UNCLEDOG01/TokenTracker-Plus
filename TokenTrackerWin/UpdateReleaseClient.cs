using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text.Json;

namespace TokenTrackerWin;

/// <summary>
/// Resolves the latest release tag of this fork for the read-only gap check.
/// Nothing here downloads or executes an installer. A throttled REST API falls
/// back to the release redirect, so the check keeps working when the
/// unauthenticated GitHub quota is exhausted.
/// </summary>
internal sealed class UpdateReleaseClient(HttpClient http, Func<DateTimeOffset>? utcNow = null)
{
    internal const string ReleasePageUrl = "https://github.com/01UNCLEDOG01/TokenTracker-plus/releases/latest";
    private const string ApiUrl = "https://api.github.com/repos/01UNCLEDOG01/TokenTracker-plus/releases/latest";
    private const string TagPath = "/01UNCLEDOG01/TokenTracker-plus/releases/tag/";
    private readonly Func<DateTimeOffset> _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    private DateTimeOffset? _apiNotBefore;

    internal readonly record struct ReleaseInfo(string Version);

    public DateTimeOffset? ApiRetryAt { get; private set; }
    public bool UsedFallback { get; private set; }

    public async Task<ReleaseInfo> FetchLatestAsync(CancellationToken cancellationToken = default)
    {
        UsedFallback = false;
        if (_apiNotBefore is not { } retryAt || retryAt <= _utcNow())
        {
            ApiRetryAt = null;
            using var request = new HttpRequestMessage(HttpMethod.Get, ApiUrl);
            request.Headers.Accept.ParseAdd("application/vnd.github+json");
            using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            Diag.Log("update", $"github api status {(int)response.StatusCode}");
            if (response.IsSuccessStatusCode)
                return await ReadApiReleaseAsync(response, cancellationToken);

            if (response.StatusCode is not (HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests))
                response.EnsureSuccessStatusCode();

            var body = await response.Content.ReadAsStringAsync(cancellationToken);
            var exhausted = Header(response, "x-ratelimit-remaining") == "0";
            if (response.StatusCode != HttpStatusCode.TooManyRequests && !exhausted
                && response.Headers.RetryAfter is null
                && !body.Contains("rate limit", StringComparison.OrdinalIgnoreCase))
                response.EnsureSuccessStatusCode();

            ApiRetryAt = ResolveRetryAt(response, exhausted);
            _apiNotBefore = ApiRetryAt ?? _utcNow().AddMinutes(1);
            Diag.Log("update", $"github api rate limited; retry_at={_apiNotBefore:O}");
        }

        UsedFallback = true;
        Diag.Log("update", "checking upstream release page (api cooldown)");
        return await ReadReleasePageAsync(cancellationToken);
    }

    private static async Task<ReleaseInfo> ReadApiReleaseAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var tag = doc.RootElement.TryGetProperty("tag_name", out var t) ? t.GetString() ?? "" : "";
        return new ReleaseInfo(ParseVersion(tag));
    }

    private async Task<ReleaseInfo> ReadReleasePageAsync(CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Head, ReleasePageUrl);
        request.Headers.Accept.ParseAdd("text/html");
        using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        Diag.Log("update", $"release page status {(int)response.StatusCode}");
        response.EnsureSuccessStatusCode();
        var uri = response.RequestMessage?.RequestUri;
        if (uri is null || uri.Scheme != Uri.UriSchemeHttps
            || !uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase) || !uri.IsDefaultPort
            || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0
            || !uri.AbsolutePath.StartsWith(TagPath, StringComparison.Ordinal))
            throw new InvalidDataException("The release page did not resolve to the official version tag.");

        var tag = uri.AbsolutePath[TagPath.Length..];
        var version = ParseVersion(tag);
        Diag.Log("update", $"upstream release page resolved version={version}");
        return new ReleaseInfo(version);
    }

    private DateTimeOffset? ResolveRetryAt(HttpResponseMessage response, bool exhausted)
    {
        var now = _utcNow();
        DateTimeOffset? retryAt = response.Headers.RetryAfter?.Date;
        if (response.Headers.RetryAfter?.Delta is { } delta)
            retryAt = now + delta;
        if (exhausted && long.TryParse(Header(response, "x-ratelimit-reset"), NumberStyles.None,
                CultureInfo.InvariantCulture, out var epoch)
            && epoch is >= 0 and <= 253402300799)
        {
            var resetAt = DateTimeOffset.FromUnixTimeSeconds(epoch);
            if (retryAt is null || resetAt > retryAt) retryAt = resetAt;
        }
        return retryAt is { } candidate && candidate > now ? candidate : null;
    }

    private static string? Header(HttpResponseMessage response, string name)
        => response.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;

    /// <summary>
    /// Our own releases use plain semver tags (<c>v1.3.0</c>). The check only
    /// reads this repo's API, so no prefix beyond the conventional `v` is
    /// involved — and no upstream numbering is compared against.
    /// </summary>
    private static string ParseVersion(string tag)
    {
        var version = tag.StartsWith('v') ? tag[1..] : tag;
        if (!Version.TryParse(version, out var parsed) || parsed.Build < 0 || parsed.Revision >= 0)
            throw new InvalidDataException("The release tag is not a stable three-part version.");
        return version;
    }
}
