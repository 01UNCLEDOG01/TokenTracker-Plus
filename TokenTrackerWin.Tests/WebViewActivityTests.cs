using Xunit;

namespace TokenTrackerWin;

public class WebViewActivityTests
{
    [Fact]
    public async Task HiddenDocumentSleepsAndVisibleDocumentResumes()
    {
        var visible = true;
        var sleeps = 0;
        var resumes = 0;
        using var activity = new WebViewActivity(value => visible = value,
            () => resumes++, () => { Assert.False(visible); sleeps++; return Task.FromResult(true); }, _ => { });
        activity.Update(false);
        await activity.WhenSettled;
        Assert.Equal(1, sleeps);
        activity.Update(true);
        Assert.True(visible);
        Assert.Equal(1, resumes);
    }

    [Fact]
    public async Task ReopenDuringPendingSuspendResumesAgainAfterTheLateCompletion()
    {
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var resumes = 0;
        using var activity = new WebViewActivity(_ => { }, () => resumes++,
            () => { started.SetResult(); return finish.Task; }, _ => { });
        activity.Update(false);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        activity.Update(true);
        Assert.Equal(1, resumes);
        finish.SetResult(true);
        await activity.WhenSettled;
        Assert.Equal(2, resumes);
    }

    [Fact]
    public async Task HiddenOAuthStaysAwakeUntilTheExchangeCompletes()
    {
        var sleeps = 0;
        var resumes = 0;
        using var activity = new WebViewActivity(_ => { }, () => resumes++,
            () => { sleeps++; return Task.FromResult(true); }, _ => { });
        activity.Update(false, keepRunning: true);
        await activity.WhenSettled;
        Assert.Equal(0, sleeps);
        Assert.Equal(1, resumes);
        activity.Update(false);
        await activity.WhenSettled;
        Assert.Equal(1, sleeps);
    }

    [Fact]
    public async Task FailureCanRetryAndOldDisposedControllerCannotResumeItsReplacement()
    {
        var calls = 0;
        using var retry = new WebViewActivity(_ => { }, () => { },
            () => ++calls == 1 ? Task.FromException<bool>(new InvalidOperationException("renderer exited")) : Task.FromResult(true), _ => { });
        retry.Update(false);
        await retry.WhenSettled;
        retry.Update(false);
        await retry.WhenSettled;
        Assert.Equal(2, calls);

        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var resumes = 0;
        var old = new WebViewActivity(_ => { }, () => resumes++,
            () => { started.SetResult(); return finish.Task; }, _ => { });
        old.Update(false);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));
        old.Update(true);
        old.Dispose();
        finish.SetResult(true);
        await old.WhenSettled;
        old.Update(true);
        Assert.Equal(1, resumes);
    }

    [Fact]
    public async Task DelayedSuspendKeepsShortHidesAwakeAndSleepsOnlyAfterTheThreshold()
    {
        var visible = true;
        var sleeps = 0;
        using var activity = new WebViewActivity(value => visible = value, () => { },
            () => { Assert.False(visible); sleeps++; return Task.FromResult(true); }, _ => { },
            TimeSpan.FromMilliseconds(200));

        // A short hide must not suspend at all — cancelling beats sleeping.
        activity.Update(false);
        await Task.Delay(80);
        activity.Update(true);
        await Task.Delay(300);
        Assert.Equal(0, sleeps);

        // A hide that outlasts the threshold suspends exactly once.
        activity.Update(false);
        await Task.Delay(450);
        Assert.Equal(1, sleeps);
        Assert.True(activity.WhenSettled.IsCompleted);
        activity.Update(true);
        Assert.True(visible);
    }

    [Fact]
    public void DelayedSuspendCollapsesTheVisualImmediatelyForTheGhostWindowFix()
    {
        var visible = true;
        using var activity = new WebViewActivity(value => visible = value, () => { },
            () => Task.FromResult(true), _ => { }, TimeSpan.FromMinutes(10));
        activity.Update(false);
        // The composition collapse (ghost-window fix) is not deferred with the sleep.
        Assert.False(visible);
        activity.Update(true);
        Assert.True(visible);
    }
}
