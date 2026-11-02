using Xunit;

namespace TokenTrackerWin;

public sealed class NativeReturnUriTests
{
    [Theory]
    [InlineData("tokentracker://auth/callback?insforge_code=sample-code", "sample-code")]
    [InlineData("tokentracker://auth/callback?insforge_code=sample%2Bcode%2Fwith%3Dvalue", "sample+code/with=value")]
    [InlineData("TOKENtracker://AUTH/callback?insforge_code=%61uth%2Bcode", "auth+code")]
    public void OAuthCallbackKeepsItsCodeAndEscaping(string value, string expected)
    {
        Assert.True(NativeReturnUri.TryGetAuthCode(value, out var code));
        Assert.Equal(expected, code);
    }

    [Theory]
    [InlineData("tokentracker-qa-auth://auth/callback?insforge_code=sample")]
    [InlineData("https://auth/callback?insforge_code=sample")]
    [InlineData("tokentracker://auth/other?insforge_code=sample")]
    [InlineData("tokentracker://auth/callback?insforge_code=sample&realm=sandbox")]
    [InlineData("tokentracker://auth/callback?insforge_code=sample&insforge_code=other")]
    [InlineData("tokentracker://auth/callback?insforge_code=sample#fragment")]
    [InlineData("tokentracker://user@auth/callback?insforge_code=sample")]
    [InlineData("tokentracker://@auth/callback?insforge_code=sample")]
    [InlineData("tokentracker://auth:123/callback?insforge_code=sample")]
    [InlineData("tokentracker://auth/callback?insforge_code=")]
    [InlineData("tokentracker://auth/callback?INSFORGE_CODE=sample")]
    public void OAuthRejectsOtherRoutesAndQARealmPollution(string value)
    {
        Assert.False(NativeReturnUri.TryGetAuthCode(value, out _));
    }

    [Fact]
    public void EntryPointOnlyFindsTheOrdinaryProductScheme()
    {
        Assert.Null(NativeReturnUri.FindArgument(["--startup", "tokentracker-qa-auth://auth/callback?insforge_code=sample"]));
        Assert.Equal("tokentracker://auth/callback?insforge_code=sample",
            NativeReturnUri.FindArgument(["--startup", "tokentracker://auth/callback?insforge_code=sample"]));
        Assert.Equal("TOKENtracker://AUTH/callback?insforge_code=sample",
            NativeReturnUri.FindArgument(["TOKENtracker://AUTH/callback?insforge_code=sample"]));
    }
}
