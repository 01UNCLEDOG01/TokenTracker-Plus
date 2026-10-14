using System.IO;
using System.Text.Json;

namespace TokenTrackerWin;

/// <summary>Persisted state of the floating Token Monitor pill (mirrors QuotaWidgetSettings).</summary>
internal sealed class MonitorWidgetSettings
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TokenTracker", "monitor-widget.json");
    public bool Enabled { get; set; }
    public int? X { get; set; }
    public int? Y { get; set; }

    public static MonitorWidgetSettings Load()
    {
        try
        {
            return JsonSerializer.Deserialize<MonitorWidgetSettings>(File.ReadAllText(FilePath)) ?? new();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { return new(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath + ".tmp", JsonSerializer.Serialize(this));
            File.Move(FilePath + ".tmp", FilePath, true);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { Diag.Log("monitor", $"settings save failed: {ex.Message}"); }
    }
}
