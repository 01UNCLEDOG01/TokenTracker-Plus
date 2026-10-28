namespace TokenTrackerWin;

/// <summary>
/// Localized strings for the read-only release check. Format placeholders:
/// <c>{0}</c> = latest version; <c>UpstreamStatus</c> also uses <c>{1}</c> =
/// current version; <c>UpToDateMessage</c> uses <c>{0}</c> = current.
/// </summary>
internal sealed record UpdateStrings(
    string CheckForUpdates,
    string Checking,
    string UpstreamAvailable,   // "{0}" = upstream version
    string UpstreamStatus,      // "{0}" = upstream, "{1}" = current fork
    string UpToDateTitle,
    string UpToDateMessage,     // "{0}" = current fork version
    string UpdateFoundTitle,
    string UpdateFoundPrompt,   // "{0}" = upstream, "{1}" = current fork
    string ErrorTitle,
    string ErrorMessage,
    string OpenReleasePagePrompt,
    string ApiRetryAtMessage)   // "{0}" = local date/time, only when reported by GitHub
{
    public static UpdateStrings For(string locale)
    {
        return locale switch
        {
            NativeLocalization.ChineseLocale => new(
                "检查更新",
                "正在检查更新…",
                "新版本 v{0}（仅查看）",
                "最新 v{0} · 当前 v{1}（只读检查）",
                "已是最新版本",
                "当前为 {0}，没有更新的版本。",
                "有新版本",
                "最新版本为 {0}，当前版本为 {1}。\n\n只读检查：不会自动下载或安装。\n\n是否打开 GitHub 查看发布页？",
                "暂时无法检查更新",
                "本次未能获取最新版本，请稍后重试。\n你也可以打开发布页手动查看。",
                "是否打开发布页？",
                "GitHub 接口可重试时间：{0}"),
            NativeLocalization.TraditionalChineseLocale => new(
                "檢查更新",
                "正在檢查更新…",
                "新版本 v{0}（僅檢視）",
                "最新 v{0} · 目前 v{1}（唯讀檢查）",
                "已是最新版本",
                "目前為 {0}，沒有更新的版本。",
                "有新版本",
                "最新版本為 {0}，目前版本為 {1}。\n\n唯讀檢查：不會自動下載或安裝。\n\n是否開啟 GitHub 查看發佈頁？",
                "暫時無法檢查更新",
                "本次未能取得最新版本，請稍後重試。\n你也可以開啟發佈頁手動查看。",
                "是否開啟發佈頁？",
                "GitHub 介面可重試時間：{0}"),
            NativeLocalization.JapaneseLocale => new(
                "更新を確認",
                "更新を確認中…",
                "新しいバージョン v{0}（表示のみ）",
                "最新 v{0} · 現在 v{1}（読み取り専用）",
                "最新バージョンです",
                "現在は {0} です。新しいリリースはありません。",
                "新しいバージョンがあります",
                "最新は {0}、現在は {1} です。\n\n読み取り専用の確認です。自動でダウンロードやインストールは行いません。\n\nGitHub でリリースページを開きますか？",
                "更新を確認できません",
                "最新バージョンを取得できませんでした。後でもう一度お試しください。\nリリースページを手動で開くこともできます。",
                "リリースページを開きますか？",
                "GitHub API の再試行可能日時：{0}"),
            NativeLocalization.KoreanLocale => new(
                "업데이트 확인",
                "업데이트 확인 중…",
                "새 버전 v{0} (보기 전용)",
                "최신 v{0} · 현재 v{1} (읽기 전용)",
                "최신 버전입니다",
                "현재 {0}이며 새 릴리스가 없습니다.",
                "새 버전이 있습니다",
                "최신은 {0}, 현재는 {1}입니다.\n\n읽기 전용 확인입니다. 자동으로 다운로드하거나 설치하지 않습니다.\n\nGitHub에서 릴리스 페이지를 여시겠습니까?",
                "업데이트를 확인할 수 없습니다",
                "최신 버전을 가져오지 못했습니다. 나중에 다시 시도하세요.\n릴리스 페이지를 직접 열 수도 있습니다.",
                "릴리스 페이지를 여시겠습니까?",
                "GitHub API 재시도 가능 시간: {0}"),
            _ => new(
                "Check for updates",
                "Checking for updates…",
                "New version v{0} (view only)",
                "Latest v{0} · current v{1} (read-only)",
                "You're up to date",
                "You're on {0}; no newer release.",
                "New version available",
                "Latest is {0}; you're on {1}.\n\nRead-only check: nothing is downloaded or installed.\n\nOpen the release page on GitHub?",
                "Couldn't check for updates",
                "Couldn't get the latest version. Try again later.\nYou can also open the release page manually.",
                "Open the release page?",
                "GitHub API can be retried after: {0}"),
        };
    }
}
