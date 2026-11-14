using Xunit;

namespace TokenTrackerWin;

/// <summary>
/// Free-size slider parity tests (1.27.0 macOS slider brought to the Windows host).
/// The height formula must mirror macOS PetSizePreset.panelHeight so both platforms
/// derive identical geometry from one scale value.
/// </summary>
public sealed class PetScaleTests
{
    [Theory]
    [InlineData(0.5, 0.7)]   // below the slider range clamps up
    [InlineData(0.7, 0.7)]
    [InlineData(1.4, 1.4)]
    [InlineData(2.2, 2.2)]
    [InlineData(3.0, 2.2)]   // above the slider range clamps down
    public void NormalizeClampsToSliderRange(double value, double expected)
        => Assert.Equal(expected, PetScale.Normalize(value));

    [Fact]
    public void NormalizeRejectsNonFiniteValues()
    {
        Assert.Equal(PetScale.Medium, PetScale.Normalize(double.NaN));
        Assert.Equal(PetScale.Medium, PetScale.Normalize(double.PositiveInfinity));
        Assert.Equal(PetScale.Medium, PetScale.Normalize(double.NegativeInfinity));
    }

    [Theory]
    [InlineData(0.7, 230)]    // floor term governs at small scales
    [InlineData(1.0, 236)]    // small anchor: 172 + 64 * 1.0
    [InlineData(1.4, 261.6)]  // medium anchor
    [InlineData(1.85, 290.4)] // large anchor
    [InlineData(2.2, 312.8)]
    public void HeightForMatchesMacFormula(double scale, double expected)
        => Assert.Equal(expected, PetScale.HeightFor(scale), precision: 2);

    // The mac formula was chosen to top every hand-tuned preset height so a slider
    // value can never clip where a preset didn't (mac acceptance 2026-11-13). The
    // Windows host must keep that guarantee over the legacy preset heights.
    [Theory]
    [InlineData(1.0, 230.0)]
    [InlineData(1.4, 254.0)]
    [InlineData(1.85, 286.0)]
    public void HeightForTopsLegacyPresetHeights(double scale, double legacyHeight)
        => Assert.True(PetScale.HeightFor(scale) >= legacyHeight);

    [Theory]
    [InlineData("small", 1.0)]
    [InlineData("medium", 1.4)]
    [InlineData("large", 1.85)]
    public void AnchorForSizeMapsPresets(string size, double expected)
        => Assert.Equal(expected, PetScale.AnchorForSize(size));

    [Theory]
    [InlineData(0.7, "small")]
    [InlineData(1.05, "small")]
    [InlineData(1.25, "medium")]
    [InlineData(1.6, "medium")]
    [InlineData(1.7, "large")]
    [InlineData(2.2, "large")]
    public void NearestSizeSnapsToClosestAnchor(double scale, string expected)
        => Assert.Equal(expected, PetScale.NearestSize(scale));
}
