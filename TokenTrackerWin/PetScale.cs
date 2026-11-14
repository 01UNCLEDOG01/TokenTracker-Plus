namespace TokenTrackerWin;

/// <summary>
/// Free-size slider math for the desktop pet (1.27.0 parity with the macOS host).
/// Pure constants/rules extracted from PetWindow so the test project (net8.0, no
/// WPF) can compile them — same pattern as AutoUpdatePolicy/ServerRecoveryPolicy.
/// The host echoes `petScale` (a number); the pet page then swaps the preset
/// buttons for a continuous slider and posts setPetSetting { key: "petScale" }.
/// Anchors stay in lockstep with PetPage.jsx PET_SCALE_ANCHORS (1.0/1.4/1.85); the
/// height formula mirrors macOS PetSizePreset.panelHeight — max(230, 172 + 64*scale)
/// — which tops every legacy hand-tuned preset height (236 ≥ 230, 261.6 ≥ 254,
/// 290.4 ≥ 286), so a slider value can never clip where a preset didn't.
/// </summary>
internal static class PetScale
{
    public const string SizeSmall = "small";
    public const string SizeMedium = "medium";
    public const string SizeLarge = "large";

    public const double Min = 0.7;
    public const double Max = 2.2;
    public const double Small = 1.0;
    public const double Medium = 1.4;
    public const double Large = 1.85;

    public static double Normalize(double value) =>
        double.IsFinite(value) ? Math.Clamp(value, Min, Max) : Medium;

    public static double AnchorForSize(string size) => size switch
    {
        SizeSmall => Small,
        SizeLarge => Large,
        _ => Medium,
    };

    /// <summary>Closest preset anchor for tray-menu checkmarks from a continuous scale.</summary>
    public static string NearestSize(double scale)
    {
        var s = Normalize(scale);
        var (best, bestDist) = (SizeSmall, Math.Abs(s - Small));
        foreach (var (preset, anchor) in new[] { (SizeMedium, Medium), (SizeLarge, Large) })
        {
            var dist = Math.Abs(s - anchor);
            if (dist < bestDist) (best, bestDist) = (preset, dist);
        }
        return best;
    }

    /// <summary>Continuous base panel height for the free-size slider (mac parity formula).</summary>
    public static double HeightFor(double scale) =>
        Math.Max(230.0, 172.0 + 64.0 * Normalize(scale));
}
