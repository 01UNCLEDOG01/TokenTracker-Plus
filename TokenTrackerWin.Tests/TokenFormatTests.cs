using TokenTrackerWin;
using Xunit;

namespace TokenTrackerWin.Tests;

/// <summary>
/// The tray summary must render the same 万/亿 strings the dashboard shows, so these
/// pin <c>FormatTokensChinese</c> to <c>formatChineseNumber</c> in dashboard/src/lib/format.ts.
/// </summary>
public class TokenFormatTests
{
    [Theory]
    [InlineData(0, "0")]
    [InlineData(9_999, "9999")]
    [InlineData(10_000, "1万")]
    [InlineData(12_345, "1.2万")]
    [InlineData(99_950_000, "9995万")]
    [InlineData(99_999_999, "1亿")]        // rounds to 10000万 → carries into 亿
    [InlineData(123_456_789, "1.2亿")]
    [InlineData(999_999_999_999, "1万亿")] // 10000亿 → carries into 万亿
    [InlineData(1_500_000_000_000, "1.5万亿")]
    [InlineData(-12_345, "-1.2万")]
    public void Chinese_matches_dashboard_formatter(long n, string expected)
        => Assert.Equal(expected, UsagePoller.FormatTokensChinese(n));

    [Fact]
    public void English_units_are_unchanged()
    {
        Assert.Equal("12.3K", UsagePoller.FormatTokens(12_345, chineseUnits: false));
        Assert.Equal("1.2M", UsagePoller.FormatTokens(1_234_567, chineseUnits: false));
        Assert.Equal("1.2万", UsagePoller.FormatTokens(12_345, chineseUnits: true));
    }

    [Theory]
    [InlineData("chinese", "chinese")]
    [InlineData(" Chinese ", "chinese")]
    [InlineData("english", "english")]
    [InlineData(null, "english")]
    [InlineData("bogus", "english")]
    public void Normalize_defaults_to_english(string? raw, string expected)
        => Assert.Equal(expected, TokenUnits.Normalize(raw));
}

public class TokenFormatPillTests
{
    [Theory]
    [InlineData(97_684_000L, "9768万")] // was "9768.4万" — the wrap culprit
    [InlineData(99_999_000L, "1亿")] // 9999.9万 rounds to 10000万 and carries
    [InlineData(110_000_000L, "1.1亿")] // 亿 tier keeps its decimal
    [InlineData(99_999L, "10万")] // 9.9999万 rounds to 10万
    [InlineData(9_999L, "9999")]
    public void PillFormatKeepsWanTierFixedWidth(long n, string expected)
        => Assert.Equal(expected, UsagePoller.FormatTokensPill(n, chineseUnits: true));

    [Fact]
    public void PillFormatLeavesEnglishUnitsAlone()
        => Assert.Equal("9.8M", UsagePoller.FormatTokensPill(9_768_400_000L / 1000, chineseUnits: false));
}
