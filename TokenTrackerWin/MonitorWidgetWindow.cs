using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Threading;

namespace TokenTrackerWin;

/// <summary>
/// A tray-owned floating "Token Monitor" pill: today's tokens · cost, the same
/// figures the tray summary renders, in a tiny always-on-top window. Native WPF
/// rather than a WebView2 page on purpose — the surface is one formatted string,
/// so the quota widget's web pipeline would add a browser process per pixel.
/// Left-click opens the dashboard, drag moves it, right-click raises
/// <see cref="MenuRequested"/> so the tray context can show its own styled menu.
/// </summary>
internal sealed class MonitorWidgetWindow : Window
{
    private const uint EventSystemForeground = 0x0003;
    private const uint EventObjectLocationChange = 0x800B;
    private const uint WineventOutOfContext = 0x0000;
    private const double DragThresholdDips = 4;

    private readonly Action _openDashboard;
    private readonly MonitorWidgetSettings _settings;
    private readonly WinEventDelegate _winEventCallback;
    private readonly TextBlock _text = new()
    {
        FontSize = 13,
        FontWeight = FontWeights.SemiBold,
        Margin = new Thickness(0),
    };
    private bool _light;
    private bool _closed;
    private bool _placed;
    private bool _fullscreenHidden;
    private int _fullscreenCheckQueued;
    private nint _hwnd;
    private nint _foregroundHook;
    private nint _locationChangeHook;

    /// <summary>Raised with the cursor's screen coordinates when the pill is right-clicked.</summary>
    public event Action<int, int>? MenuRequested;

    public bool Enabled => _settings.Enabled;
    public event Action? EnabledChanged;

    public MonitorWidgetWindow(Action openDashboard)
    {
        _openDashboard = openDashboard;
        _settings = MonitorWidgetSettings.Load();
        _light = NativeTheme.ResolveIsLight(NativeTheme.CurrentPreference);
        _winEventCallback = OnWinEvent;

        Title = Constants.AppDisplayName;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        SizeToContent = SizeToContent.WidthAndHeight;
        AllowsTransparency = true;
        Background = System.Windows.Media.Brushes.Transparent;
        Topmost = true;
        ShowInTaskbar = false;
        ShowActivated = false;
        Content = new Border
        {
            CornerRadius = new CornerRadius(14),
            Padding = new Thickness(12, 6, 12, 7),
            Child = _text,
        };
        SourceInitialized += (_, _) =>
        {
            _hwnd = new WindowInteropHelper(this).Handle;
            // Tool window: excluded from Alt+Tab. Explicit clicks can still focus controls.
            SetWindowLongPtr(_hwnd, -20, GetWindowLongPtr(_hwnd, -20) | 0x80);
        };
        IsVisibleChanged += (_, _) =>
        {
            if (IsVisible && !_closed && _settings.Enabled)
            {
                Place(!_placed);
                _placed = true;
            }
        };
        MouseLeftButtonDown += OnButtonDown;
        MouseMove += OnMove;
        MouseLeftButtonUp += OnUp;
        MouseRightButtonUp += (_, e) =>
        {
            e.Handled = true;
            var screen = PointToScreen(e.GetPosition(this));
            MenuRequested?.Invoke((int)screen.X, (int)screen.Y);
        };
        ApplyTheme(_light);
    }

    public void SetEnabled(bool enabled)
    {
        if (_closed) return;
        _settings.Enabled = enabled;
        _settings.Save();

        if (enabled)
        {
            Show();
            StartFullscreenMonitoring();
            CheckFullscreenState();
        }
        else
        {
            _fullscreenHidden = false;
            StopFullscreenMonitoring();
            Hide();
        }
        EnabledChanged?.Invoke();
    }

    /// <summary>Render the tray's current snapshot. Null stats show a quiet dash.</summary>
    public void ApplyStats(UsagePoller.UsageStats? stats, string symbol, decimal rate, bool chineseUnits)
    {
        if (_closed) return;
        _text.Text = stats is { } s
            ? $"{UsagePoller.FormatTokens(s.TodayTokens, chineseUnits)} · {symbol}{(s.TodayCostUsd * rate).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture)}"
            : "—";
    }

    public void ApplyTheme(bool light)
    {
        _light = light;
        var border = (Border)Content;
        if (light)
        {
            border.Background = new SolidColorBrush(System.Windows.Media.Color.FromArgb(238, 245, 245, 247));
            _text.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(26, 26, 26));
        }
        else
        {
            border.Background = new SolidColorBrush(System.Windows.Media.Color.FromArgb(238, 24, 24, 27));
            _text.Foreground = new SolidColorBrush(System.Windows.Media.Color.FromRgb(245, 245, 245));
        }
    }

    public void ApplyFont(string family)
    {
        try { _text.FontFamily = new System.Windows.Media.FontFamily(family); }
        catch { /* an unknown family name keeps the previous font */ }
    }

    // ── Click vs drag ──────────────────────────────────────────────────

    private bool _capturing;
    private bool _dragging;
    private System.Windows.Point _pressPoint;
    private int _pressLeft, _pressTop;

    private void OnButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (_hwnd == 0) return;
        _pressPoint = e.GetPosition(this);
        _dragging = false;
        _capturing = true;
        GetWindowRect(_hwnd, out var rect);
        _pressLeft = rect.Left;
        _pressTop = rect.Top;
        CaptureMouse();
        e.Handled = true;
    }

    private void OnMove(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (!_capturing || _hwnd == 0) return;
        var pos = e.GetPosition(this);
        if (!_dragging)
        {
            if (Math.Abs(pos.X - _pressPoint.X) < DragThresholdDips
                && Math.Abs(pos.Y - _pressPoint.Y) < DragThresholdDips) return;
            _dragging = true;
        }
        // Move in device pixels: the press origin was captured in screen space,
        // so DPI scaling is already baked into the delta.
        var scale = GetDpiForWindow(_hwnd) / 96d;
        var left = (int)Math.Round(_pressLeft + (pos.X - _pressPoint.X) * scale);
        var top = (int)Math.Round(_pressTop + (pos.Y - _pressPoint.Y) * scale);
        SetWindowPos(_hwnd, 0, left, top, 0, 0, 0x15); // NOSIZE | NOZORDER | NOACTIVATE
        e.Handled = true;
    }

    private void OnUp(object sender, MouseButtonEventArgs e)
    {
        if (!_capturing) return;
        _capturing = false;
        ReleaseMouseCapture();
        if (_dragging)
        {
            _dragging = false;
            if (GetWindowRect(_hwnd, out var rect))
            {
                _settings.X = rect.Left;
                _settings.Y = rect.Top;
                _settings.Save();
            }
        }
        else
        {
            _openDashboard();
        }
        e.Handled = true;
    }

    // ── Placement + fullscreen hide (same recipe as the quota widget) ──

    private void Place(bool restore)
    {
        if (_hwnd == 0) return;
        GetWindowRect(_hwnd, out var rect);
        var x = restore ? _settings.X : rect.Left;
        var y = restore ? _settings.Y : rect.Top;
        var screen = x.HasValue && y.HasValue
            ? System.Windows.Forms.Screen.FromPoint(new System.Drawing.Point(x.Value, y.Value))
            : System.Windows.Forms.Screen.PrimaryScreen!;
        var work = screen.WorkingArea;
        var width = rect.Right - rect.Left;
        var height = rect.Bottom - rect.Top;
        var left = Math.Clamp(x ?? work.Right - width - 16, work.Left, Math.Max(work.Left, work.Right - width));
        var top = Math.Clamp(y ?? work.Top + work.Height / 3, work.Top, Math.Max(work.Top, work.Bottom - height));
        if (rect.Left != left || rect.Top != top)
            SetWindowPos(_hwnd, 0, left, top, 0, 0, 0x15); // NOSIZE | NOZORDER | NOACTIVATE
    }

    private void StartFullscreenMonitoring()
    {
        if (_hwnd == 0) return;
        if (_foregroundHook == 0)
            _foregroundHook = SetWinEventHook(
                EventSystemForeground, EventSystemForeground, 0, _winEventCallback, 0, 0,
                WineventOutOfContext);
        if (_locationChangeHook == 0)
            _locationChangeHook = SetWinEventHook(
                EventObjectLocationChange, EventObjectLocationChange, 0, _winEventCallback, 0, 0,
                WineventOutOfContext);
        if (_foregroundHook == 0 || _locationChangeHook == 0)
            Diag.Log("monitor", "fullscreen event hook could not be installed");
    }

    private void StopFullscreenMonitoring()
    {
        if (_foregroundHook != 0) UnhookWinEvent(_foregroundHook);
        if (_locationChangeHook != 0) UnhookWinEvent(_locationChangeHook);
        _foregroundHook = 0;
        _locationChangeHook = 0;
    }

    private void OnWinEvent(nint hook, uint eventType, nint hwnd, int idObject, int idChild, uint eventThread, uint eventTime)
    {
        if (eventType == EventObjectLocationChange
            && (idObject != 0 || idChild != 0 || hwnd != GetForegroundWindow())) return;
        QueueFullscreenCheck();
    }

    private void QueueFullscreenCheck()
    {
        if (Interlocked.Exchange(ref _fullscreenCheckQueued, 1) != 0) return;
        try
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                Interlocked.Exchange(ref _fullscreenCheckQueued, 0);
                CheckFullscreenState();
            }));
        }
        catch { Interlocked.Exchange(ref _fullscreenCheckQueued, 0); }
    }

    private void CheckFullscreenState()
    {
        if (_closed || !_settings.Enabled) return;
        if (ForegroundIsFullscreen())
        {
            if (IsVisible)
            {
                _fullscreenHidden = true;
                Hide();
            }
        }
        else if (_fullscreenHidden)
        {
            _fullscreenHidden = false;
            if (!IsVisible) Show();
            Place(false);
        }
    }

    private bool ForegroundIsFullscreen()
    {
        var foreground = GetForegroundWindow();
        if (foreground == 0 || foreground == _hwnd || !GetWindowRect(foreground, out var rect)) return false;
        var className = new System.Text.StringBuilder(256);
        GetClassName(foreground, className, className.Capacity);
        if (className.ToString() is "Progman" or "WorkerW") return false;
        var screen = System.Windows.Forms.Screen.FromHandle(_hwnd);
        var bounds = screen.Bounds;
        return rect.Left <= bounds.Left && rect.Top <= bounds.Top && rect.Right >= bounds.Right && rect.Bottom >= bounds.Bottom;
    }

    public void Shutdown()
    {
        if (_closed) return;
        _closed = true;
        StopFullscreenMonitoring();
        Close();
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(nint hwnd, nint after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(nint hwnd, System.Text.StringBuilder value, int size);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")] private static extern nint GetWindowLongPtr(nint hwnd, int index);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtrW")] private static extern nint SetWindowLongPtr(nint hwnd, int index, nint value);
    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint eventMin, uint eventMax, nint eventHookModule, WinEventDelegate eventHook, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(nint eventHook);

    private delegate void WinEventDelegate(nint hook, uint eventType, nint hwnd, int idObject, int idChild, uint eventThread, uint eventTime);
}
