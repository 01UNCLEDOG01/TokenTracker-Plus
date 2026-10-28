using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using TokenTrackerWin;
using Xunit;

namespace TokenTrackerWin.Tests;

public sealed class UpdateReleaseClientTests
{
    private const string ApiUrl = "https://api.github.com/repos/01UNCLEDOG01/TokenTracker-plus/releases/latest";
    private const string TagUrl = "https://github.com/01UNCLEDOG01/TokenTracker-plus/releases/tag/v1.3.9";
    private static readonly DateTimeOffset Now = new(2026, 10, 12, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task SuccessfulApiDoesNotUseReleasePage()
    {
        var calls = new List<string>();
        using var http = Http(request => { calls.Add(request.RequestUri!.AbsoluteUri); return ApiRelease(); });
        var resolver = new UpdateReleaseClient(http);

        var release = await resolver.FetchLatestAsync();

        Assert.Equal("1.3.9", release.Version);
        Assert.Equal([ApiUrl], calls);
        Assert.False(resolver.UsedFallback);
        Assert.Null(resolver.ApiRetryAt);
    }

    [Fact]
    public async Task PrimaryLimitFallsBackToReleasePage()
    {
        var calls = new List<(HttpMethod Method, string Url)>();
        using var http = Http(request =>
        {
            calls.Add((request.Method, request.RequestUri!.AbsoluteUri));
            return IsApi(request) ? RateLimited(reset: Now.AddHours(1)) : ReleasePageResponse(request);
        });
        var resolver = new UpdateReleaseClient(http, () => Now);

        var release = await resolver.FetchLatestAsync();

        Assert.True(resolver.UsedFallback);
        Assert.Equal(Now.AddHours(1), resolver.ApiRetryAt);
        Assert.Equal("1.3.9", release.Version);
        Assert.Equal(new[] {
            (HttpMethod.Get, ApiUrl),
            (HttpMethod.Head, UpdateReleaseClient.ReleasePageUrl),
        }, calls);
    }

    [Fact]
    public async Task CooldownSkipsApiUntilResetThenReturnsToApi()
    {
        var now = Now;
        var apiCalls = 0;
        using var http = Http(request => !IsApi(request) ? ReleasePageResponse(request)
            : ++apiCalls == 1 ? RateLimited(reset: Now.AddHours(1)) : ApiRelease());
        var resolver = new UpdateReleaseClient(http, () => now);

        await resolver.FetchLatestAsync();
        now = Now.AddMinutes(59);
        await resolver.FetchLatestAsync();
        Assert.Equal(1, apiCalls);
        Assert.True(resolver.UsedFallback);
        now = Now.AddHours(1);
        await resolver.FetchLatestAsync();
        Assert.Equal(2, apiCalls);
        Assert.False(resolver.UsedFallback);
        Assert.Null(resolver.ApiRetryAt);
    }

    [Theory]
    [InlineData(403)]
    [InlineData(429)]
    public async Task LimitWithoutTimeWaitsOneMinuteWithoutInventingDisplayedTime(int status)
    {
        var now = Now;
        var apiCalls = 0;
        using var http = Http(request =>
        {
            if (!IsApi(request)) return ReleasePageResponse(request);
            apiCalls++;
            return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent("API rate limit exceeded") };
        });
        var resolver = new UpdateReleaseClient(http, () => now);

        await resolver.FetchLatestAsync();
        Assert.Null(resolver.ApiRetryAt);
        now = Now.AddSeconds(59);
        await resolver.FetchLatestAsync();
        Assert.Equal(1, apiCalls);
        now = Now.AddMinutes(1);
        await resolver.FetchLatestAsync();
        Assert.Equal(2, apiCalls);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SecondaryLimitHonorsRetryAfterDeltaOrDate(bool absolute)
    {
        using var http = Http(request =>
        {
            if (!IsApi(request)) return ReleasePageResponse(request);
            var response = new HttpResponseMessage(HttpStatusCode.Forbidden);
            response.Headers.RetryAfter = absolute
                ? new RetryConditionHeaderValue(Now.AddSeconds(90))
                : new RetryConditionHeaderValue(TimeSpan.FromSeconds(90));
            response.Headers.Add("x-ratelimit-remaining", "5");
            response.Headers.Add("x-ratelimit-reset", Now.AddHours(1).ToUnixTimeSeconds().ToString());
            return response;
        });
        var resolver = new UpdateReleaseClient(http, () => Now);

        await resolver.FetchLatestAsync();

        Assert.Equal(Now.AddSeconds(90), resolver.ApiRetryAt);
        Assert.True(resolver.UsedFallback);
    }

    [Fact]
    public async Task ExhaustedQuotaWaitsForBothRetryAfterAndReset()
    {
        using var http = Http(request =>
        {
            if (!IsApi(request)) return ReleasePageResponse(request);
            var response = RateLimited(reset: Now.AddMinutes(2));
            response.Headers.RetryAfter = new RetryConditionHeaderValue(TimeSpan.FromMinutes(3));
            return response;
        });
        var resolver = new UpdateReleaseClient(http, () => Now);
        await resolver.FetchLatestAsync();
        Assert.Equal(Now.AddMinutes(3), resolver.ApiRetryAt);
    }

    [Theory]
    [InlineData("not-a-number")]
    [InlineData("9223372036854775807")]
    [InlineData("0")]
    public async Task InvalidResetHeaderUsesCooldownWithoutClaimingARecoveryTime(string reset)
    {
        var apiCalls = 0;
        using var http = Http(request =>
        {
            if (!IsApi(request)) return ReleasePageResponse(request);
            apiCalls++;
            var response = RateLimited();
            response.Headers.Add("x-ratelimit-reset", reset);
            return response;
        });
        var resolver = new UpdateReleaseClient(http, () => Now);
        await resolver.FetchLatestAsync();
        await resolver.FetchLatestAsync();
        Assert.Equal(1, apiCalls);
        Assert.Null(resolver.ApiRetryAt);
    }

    [Theory]
    [InlineData(403)]
    [InlineData(500)]
    public async Task OtherHttpErrorsDoNotPretendToBeRateLimits(int status)
    {
        var calls = 0;
        using var http = Http(_ => { calls++; return new HttpResponseMessage((HttpStatusCode)status) { Content = new StringContent("Access denied") }; });
        var resolver = new UpdateReleaseClient(http);
        await Assert.ThrowsAsync<HttpRequestException>(() => resolver.FetchLatestAsync());
        Assert.Equal(1, calls);
        Assert.False(resolver.UsedFallback);
        Assert.Null(resolver.ApiRetryAt);
    }

    [Theory]
    [InlineData("https://example.test/01UNCLEDOG01/TokenTracker-plus/releases/tag/v1.3.9")]
    [InlineData("http://github.com/01UNCLEDOG01/TokenTracker-plus/releases/tag/v1.3.9")]
    [InlineData("https://github.com/another/repo/releases/tag/v1.3.9")]
    [InlineData("https://github.com/01UNCLEDOG01/TokenTracker-plus/releases/latest")]
    [InlineData("https://github.com/01UNCLEDOG01/TokenTracker-plus/releases/tag/v1.3.9-rc.1")]
    [InlineData("https://github.com/01UNCLEDOG01/TokenTracker-plus/releases/tag/v1.3.9/extra")]
    [InlineData("https://github.com/01UNCLEDOG01/TokenTracker-plus/releases/tag/plus-v1.3.9")]
    public async Task FallbackRejectsUnexpectedRedirectsAndInvalidTags(string redirect)
    {
        var calls = 0;
        using var http = Http(request => { calls++; return IsApi(request) ? RateLimited() : ReleasePageResponse(request, redirect); });
        var resolver = new UpdateReleaseClient(http);
        await Assert.ThrowsAsync<InvalidDataException>(() => resolver.FetchLatestAsync());
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task FallbackFailureKeepsApiCooldownForNextCheck()
    {
        var apiCalls = 0;
        using var http = Http(request =>
        {
            if (!IsApi(request)) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
            apiCalls++;
            return RateLimited(reset: Now.AddHours(1));
        });
        var resolver = new UpdateReleaseClient(http, () => Now);
        await Assert.ThrowsAsync<HttpRequestException>(() => resolver.FetchLatestAsync());
        await Assert.ThrowsAsync<HttpRequestException>(() => resolver.FetchLatestAsync());
        Assert.Equal(1, apiCalls);
        Assert.Equal(Now.AddHours(1), resolver.ApiRetryAt);
    }

    [Fact]
    public async Task ApiTagOnlyIsSufficientForUpdateCheck()
    {
        using var http = Http(_ => ApiRelease());
        var checker = new UpdateChecker(http);
        Assert.Equal(UpdateChecker.CheckOutcome.UpdateAvailable, await checker.CheckAsync(silent: false));
        Assert.Equal(UpdateChecker.UpdateState.UpdateAvailable, checker.State);
        Assert.Equal("1.3.9", checker.LatestVersion);
    }

    [Fact]
    public async Task BackgroundCheckIsSkippedWithoutNetwork()
    {
        var calls = 0;
        using var http = Http(_ => { calls++; return ApiRelease(); });
        var checker = new UpdateChecker(http);
        Assert.Equal(UpdateChecker.CheckOutcome.Skipped, await checker.CheckAsync(silent: true));
        Assert.Equal(0, calls);
        Assert.Equal(UpdateChecker.UpdateState.Idle, checker.State);
    }

    [Fact]
    public async Task BothPathsFailWithoutClaimingAnUpdateOrLaunchingInstallation()
    {
        var resetAt = DateTimeOffset.UtcNow.AddHours(1);
        using var http = Http(request => IsApi(request) ? RateLimited(resetAt)
            : new HttpResponseMessage(HttpStatusCode.ServiceUnavailable));
        var checker = new UpdateChecker(http);

        Assert.Equal(UpdateChecker.CheckOutcome.Failed, await checker.CheckAsync(silent: false));
        Assert.Equal(UpdateChecker.UpdateState.Idle, checker.State);
        Assert.Null(checker.LatestVersion);
        Assert.Equal(resetAt.ToUnixTimeSeconds(), checker.ApiRetryAt!.Value.ToUnixTimeSeconds());
    }

    [Fact]
    public async Task ExistingVersionStillReportsUpToDate()
    {
        using var http = Http(_ => ApiRelease("v0.0.0"));
        var checker = new UpdateChecker(http);
        Assert.Equal(UpdateChecker.CheckOutcome.UpToDate, await checker.CheckAsync(silent: false));
        Assert.Equal(UpdateChecker.UpdateState.Idle, checker.State);
    }

    [Fact]
    public async Task ManualCheckUsesFallbackAndLeavesInstallationToTheUser()
    {
        var calls = new List<HttpMethod>();
        using var http = Http(request =>
        {
            calls.Add(request.Method);
            return IsApi(request) ? RateLimited() : ReleasePageResponse(request);
        });
        var checker = new UpdateChecker(http);
        Assert.Equal(UpdateChecker.CheckOutcome.UpdateAvailable, await checker.CheckAsync(silent: false));
        Assert.Equal(UpdateChecker.UpdateState.UpdateAvailable, checker.State);
        Assert.Equal("1.3.9", checker.LatestVersion);
        Assert.Equal(new[] { HttpMethod.Get, HttpMethod.Head }, calls);
    }

    [Fact]
    public async Task RepeatedManualClickDoesNotStartAnotherRequest()
    {
        var calls = 0;
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var response = new TaskCompletionSource<HttpResponseMessage>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var http = new HttpClient(new Handler(async (_, cancellationToken) =>
        {
            calls++;
            entered.SetResult();
            return await response.Task.WaitAsync(cancellationToken);
        }));
        var checker = new UpdateChecker(http);
        var first = checker.CheckAsync(silent: false);
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(UpdateChecker.UpdateState.Checking, checker.State);
        Assert.Equal(UpdateChecker.CheckOutcome.Skipped, await checker.CheckAsync(silent: false));
        response.SetResult(ApiRelease());
        Assert.Equal(UpdateChecker.CheckOutcome.UpdateAvailable, await first);
        Assert.Equal(1, calls);
    }

    private static bool IsApi(HttpRequestMessage request) => request.RequestUri!.Host == "api.github.com";

    private static HttpResponseMessage ApiRelease(string tag = "v1.3.9")
        => new(HttpStatusCode.OK) { Content = new StringContent(JsonSerializer.Serialize(new { tag_name = tag })) };

    private static HttpResponseMessage RateLimited(DateTimeOffset? reset = null)
    {
        var response = new HttpResponseMessage(HttpStatusCode.Forbidden) { Content = new StringContent("API rate limit exceeded") };
        response.Headers.Add("x-ratelimit-remaining", "0");
        if (reset is not null) response.Headers.Add("x-ratelimit-reset", reset.Value.ToUnixTimeSeconds().ToString());
        return response;
    }

    private static HttpResponseMessage ReleasePageResponse(HttpRequestMessage request, string redirect = TagUrl)
    {
        if (request.RequestUri!.AbsoluteUri != UpdateReleaseClient.ReleasePageUrl)
            throw new InvalidOperationException("Unexpected test request: " + request.RequestUri.AbsolutePath);
        return new HttpResponseMessage(HttpStatusCode.OK) { RequestMessage = new HttpRequestMessage(HttpMethod.Head, redirect) };
    }

    private static HttpClient Http(Func<HttpRequestMessage, HttpResponseMessage> respond)
        => new(new Handler((request, _) => Task.FromResult(respond(request))));

    private sealed class Handler(Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
            => respond(request, cancellationToken);
    }
}
