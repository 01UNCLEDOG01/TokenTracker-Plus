namespace TokenTrackerWin;

internal static class NativeReturnUri
{
    private const string AuthPrefix = "tokentracker://auth/callback?";
    private const string AuthQueryKey = "insforge_code=";

    internal static string? FindArgument(string[] args) =>
        args.FirstOrDefault(value => value.StartsWith("tokentracker://", StringComparison.OrdinalIgnoreCase));

    internal static bool TryGetAuthCode(string? value, out string code)
    {
        code = "";
        if (value is null || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !value.StartsWith(AuthPrefix, StringComparison.OrdinalIgnoreCase)
            || uri.AbsolutePath != "/callback"
            || uri.Query.Contains('&') || !string.IsNullOrEmpty(uri.Fragment)
            || value != value.Trim()) return false;

        var query = value[AuthPrefix.Length..];
        if (!query.StartsWith(AuthQueryKey, StringComparison.Ordinal)) return false;
        var rawCode = query[AuthQueryKey.Length..];
        if (rawCode.Length == 0) return false;
        code = Uri.UnescapeDataString(rawCode);
        return code.Length > 0;
    }
}
