namespace TokenTrackerWin;

/// <summary>Sleep hidden renderers, retaining the document and its login state.</summary>
/// <remarks>
/// Suspension frees the renderer's memory while a window sits hidden or
/// minimised, but resuming costs 1–3 seconds of unresponsiveness — visible as a
/// multi-second stall on the first interaction after reopening the dashboard.
/// <paramref name="suspendDelay"/> therefore schedules the sleep instead of
/// applying it at once: the composition visual is still collapsed immediately
/// (the minimise "ghost window" fix lives in <paramref name="setVisible"/>), and
/// the renderer is only suspended once it has stayed hidden for the whole delay.
/// A short hide (tray → check something → back) never pays the resume tax;
/// an hour in the tray still frees the memory. Pass <see cref="TimeSpan.Zero"/>
/// for the legacy immediate behaviour (the default keeps the unit tests honest).
/// </remarks>
internal sealed class WebViewActivity : IDisposable
{
    private readonly Action<bool> _setVisible;
    private readonly Action _resume;
    private readonly Func<Task<bool>> _suspend;
    private readonly Action<string> _log;
    private readonly TimeSpan _suspendDelay;
    private CancellationTokenSource? _delayedSuspend;
    private bool _shouldRun;
    private Task? _suspensionTask;
    private bool _disposed;

    internal Task WhenSettled => _suspensionTask ?? Task.CompletedTask;

    public WebViewActivity(Action<bool> setVisible, Action resume,
        Func<Task<bool>> suspend, Action<string> log,
        TimeSpan suspendDelay = default)
    {
        _setVisible = setVisible;
        _resume = resume;
        _suspend = suspend;
        _log = log;
        _suspendDelay = suspendDelay;
    }

    public void Update(bool visible, bool keepRunning = false)
    {
        if (_disposed) return;
        _shouldRun = visible || keepRunning;
        try
        {
            _setVisible(visible);
            if (_shouldRun)
            {
                CancelScheduledSuspend();
                _resume();
            }
            else if (_suspendDelay > TimeSpan.Zero)
            {
                ScheduleSuspend();
            }
            else if (_suspensionTask is not { IsCompleted: false })
            {
                _suspensionTask = SuspendAsync();
            }
        }
        catch (Exception ex) { _log($"webview activity update failed: {ex.Message}"); }
    }

    private void ScheduleSuspend()
    {
        CancelScheduledSuspend();
        var cts = new CancellationTokenSource();
        _delayedSuspend = cts;
        var token = cts.Token;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(_suspendDelay, token).ConfigureAwait(false);
            }
            catch (TaskCanceledException)
            {
                return; // the window came back before the delay elapsed
            }
            if (_disposed || token.IsCancellationRequested || _shouldRun) return;
            if (_suspensionTask is not { IsCompleted: false })
            {
                try { _suspensionTask = SuspendAsync(); }
                catch (Exception ex) { _log($"delayed webview suspend failed: {ex.Message}"); }
            }
        });
    }

    private void CancelScheduledSuspend()
    {
        try { _delayedSuspend?.Cancel(); } catch { /* already cancelled */ }
        _delayedSuspend = null;
    }

    private async Task SuspendAsync()
    {
        try
        {
            // Allow WPF's Visibility change to reach the composition controller.
            await Task.Yield();
            if (_disposed || _shouldRun) return;
            var suspended = await _suspend();
            if (!_disposed) _log($"hidden webview suspended={suspended}");
        }
        catch (Exception ex)
        {
            if (!_disposed) _log($"webview suspend failed: {ex.Message}");
        }
        finally
        {
            // A suspend can finish after a tray click or OAuth has reopened the
            // document. Never leave that document sleeping.
            if (!_disposed && _shouldRun)
            {
                try { _resume(); }
                catch (Exception ex) { _log($"webview resume failed: {ex.Message}"); }
            }
        }
    }

    public void Dispose()
    {
        _disposed = true;
        CancelScheduledSuspend();
    }
}
