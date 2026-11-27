using System.Net;
using System.Net.Http;
using System.IO;
using System.Text;
using System.Text.Json;

namespace TokenTrackerWin;

internal sealed class LocalSyncRequestException : HttpRequestException
{
    public LocalSyncRequestException(HttpStatusCode statusCode, string? code, string message)
        : base(message)
    {
        ResponseStatusCode = statusCode;
        Code = code;
    }

    public HttpStatusCode ResponseStatusCode { get; }
    public string? Code { get; }
}

/// <summary>
/// Performs the authenticated loopback exchange used by native background sync.
/// Keeping this protocol separate from the process lifecycle makes the request
/// ordering, flags, and cancellation behavior independently testable.
/// </summary>
internal sealed class LocalSyncPublisher
{
    private const string LocalAuthHeader = "x-tokentracker-local-auth";
    private const string BackgroundSyncBody =
        "{\"auto\":true,\"background\":true,\"allLocalSources\":true,\"publishAccount\":true,\"nativeOnlyWsl\":true}";

    private readonly HttpClient _httpClient;
    private readonly string _baseUrl;

    public LocalSyncPublisher(HttpClient httpClient, string baseUrl)
    {
        _httpClient = httpClient ?? throw new ArgumentNullException(nameof(httpClient));
        if (string.IsNullOrWhiteSpace(baseUrl))
            throw new ArgumentException("A loopback base URL is required.", nameof(baseUrl));
        _baseUrl = baseUrl.TrimEnd('/');
    }

    public async Task PublishAsync(CancellationToken cancellationToken = default)
    {
        using var authResponse = await _httpClient.GetAsync(
            _baseUrl + "/api/local-auth",
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        authResponse.EnsureSuccessStatusCode();

        var authPayload = await authResponse.Content.ReadAsStringAsync(cancellationToken);
        var localAuthToken = ReadLocalAuthToken(authPayload);

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            _baseUrl + "/functions/tokentracker-local-sync");
        request.Headers.TryAddWithoutValidation(LocalAuthHeader, localAuthToken);
        request.Content = new StringContent(BackgroundSyncBody, Encoding.UTF8, "application/json");

        using var response = await _httpClient.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await ReadLimitedAsync(response.Content, 16 * 1024, cancellationToken);
            var code = ReadErrorCode(errorBody);
            var suffix = string.IsNullOrWhiteSpace(code) ? "" : $" ({code})";
            throw new LocalSyncRequestException(
                response.StatusCode,
                code,
                $"Local sync failed with HTTP {(int)response.StatusCode}{suffix}.");
        }
        // The local API writes its response after the sync child exits. Consume
        // it so PublishAsync does not complete before that child is finished.
        await response.Content.ReadAsStringAsync(cancellationToken);
    }

    private static string ReadLocalAuthToken(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (document.RootElement.ValueKind == JsonValueKind.Object &&
                document.RootElement.TryGetProperty("token", out var tokenElement) &&
                tokenElement.ValueKind == JsonValueKind.String)
            {
                var token = tokenElement.GetString();
                if (!string.IsNullOrWhiteSpace(token)) return token;
            }
        }
        catch (JsonException)
        {
            // Convert malformed auth responses to the same safe protocol error
            // without echoing a response body that could contain credentials.
        }

        throw new InvalidOperationException("Local auth response did not include a token.");
    }

    private static string? ReadErrorCode(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            if (document.RootElement.ValueKind != JsonValueKind.Object ||
                !document.RootElement.TryGetProperty("code", out var codeElement) ||
                codeElement.ValueKind != JsonValueKind.String)
                return null;
            var code = codeElement.GetString();
            return !string.IsNullOrWhiteSpace(code) &&
                   code.Length <= 80 &&
                   code.All(ch => ch <= 0x7f && (char.IsLetterOrDigit(ch) || ch is '_' or '-' or '.'))
                ? code
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static async Task<string> ReadLimitedAsync(
        HttpContent content,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        await using var stream = await content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream(Math.Min(maxBytes, 4096));
        var chunk = new byte[4096];
        while (buffer.Length < maxBytes)
        {
            var read = await stream.ReadAsync(
                chunk.AsMemory(0, Math.Min(chunk.Length, maxBytes - (int)buffer.Length)),
                cancellationToken);
            if (read == 0) break;
            buffer.Write(chunk, 0, read);
        }
        return Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
    }
}
