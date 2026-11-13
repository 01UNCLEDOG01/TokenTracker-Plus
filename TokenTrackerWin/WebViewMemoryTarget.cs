using Microsoft.Web.WebView2.Core;

namespace TokenTrackerWin;

/// <summary>Trade page cache for memory while a window is hidden.</summary>
/// <remarks>
/// WebView2's <see cref="CoreWebView2.MemoryUsageTargetLevel"/> = Low drops most
/// caches, decoded images and background buffers but keeps the document, its DOM
/// and the login state — unlike <c>TrySuspendAsync</c>, which sleeps the renderer
/// entirely and costs 1-3 seconds to resume (the dashboard delays that by 10
/// minutes because of the 2026-11-11 "first page switch after restore stalls"
/// report). The two layers therefore complement each other: Low applies the moment
/// a window is hidden, suspension still releases the rest once the delay elapses.
///
/// Setting it is cheap and idempotent; the guard avoids redundant COM calls on
/// every visibility event.
/// </remarks>
internal static class WebViewMemoryTarget
{
    public static void Apply(CoreWebView2? core, bool active, Action<string>? log = null)
    {
        if (core is null) return;
        var target = active
            ? CoreWebView2MemoryUsageTargetLevel.Normal
            : CoreWebView2MemoryUsageTargetLevel.Low;
        try
        {
            if (core.MemoryUsageTargetLevel != target) core.MemoryUsageTargetLevel = target;
        }
        catch (Exception ex)
        {
            // A navigating/disposed core is not an error worth failing the window over.
            log?.Invoke($"webview memory target level failed: {ex.Message}");
        }
    }
}
