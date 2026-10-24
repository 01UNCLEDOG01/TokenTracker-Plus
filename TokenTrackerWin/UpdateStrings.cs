namespace TokenTrackerWin;

/// <summary>
/// Localized strings for the read-only upstream check. Format placeholders:
/// <c>{0}</c> = upstream version; <c>UpstreamStatus</c> also uses <c>{1}</c> =
/// current fork version; <c>UpToDateMessage</c> uses <c>{0}</c> = current.
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
                "检查上游更新",
                "正在检查上游更新…",
                "上游 v{0}（仅查看）",
                "上游 v{0} · 当前 fork v{1}（只读检查）",
                "上游暂无更新",
                "当前 fork 为 {0}，上游没有更新的版本。",
                "上游有新版本",
                "上游最新为 {0}，当前 fork 为 {1}。\n\n只读检查：不会下载或安装上游安装包。\n\n是否打开 GitHub 查看上游发布页？",
                "暂时无法检查上游",
                "本次未能获取上游最新版本，请稍后重试。\n你也可以打开上游发布页手动查看。",
                "是否打开上游发布页？",
                "GitHub 接口可重试时间：{0}"),
            NativeLocalization.TraditionalChineseLocale => new(
                "檢查上游更新",
                "正在檢查上游更新…",
                "上游 v{0}（僅檢視）",
                "上游 v{0} · 目前 fork v{1}（唯讀檢查）",
                "上游暫無更新",
                "目前 fork 為 {0}，上游沒有更新的版本。",
                "上游有新版本",
                "上游最新為 {0}，目前 fork 為 {1}。\n\n唯讀檢查：不會下載或安裝上游安裝檔。\n\n是否開啟 GitHub 查看上游發佈頁？",
                "暫時無法檢查上游",
                "本次未能取得上游最新版本，請稍後重試。\n你也可以開啟上游發佈頁手動查看。",
                "是否開啟上游發佈頁？",
                "GitHub 介面可重試時間：{0}"),
            NativeLocalization.JapaneseLocale => new(
                "上流の更新を確認",
                "上流を確認中…",
                "上流 v{0}（表示のみ）",
                "上流 v{0} · このフォーク v{1}（読み取り専用）",
                "上流に新しいリリースはありません",
                "このフォークは {0} です。上流に新しいリリースはありません。",
                "上流に新しいリリースがあります",
                "上流の最新は {0}、このフォークは {1} です。\n\n読み取り専用の確認です。上流のインストーラーはダウンロードもインストールもされません。\n\nGitHub で上流のリリースページを開きますか？",
                "上流を確認できません",
                "上流の最新バージョンを取得できませんでした。後でもう一度お試しください。\n上流のリリースページを手動で開くこともできます。",
                "上流のリリースページを開きますか？",
                "GitHub API の再試行可能日時：{0}"),
            NativeLocalization.KoreanLocale => new(
                "업스트림 업데이트 확인",
                "업스트림 확인 중…",
                "업스트림 v{0} (보기 전용)",
                "업스트림 v{0} · 현재 포크 v{1} (읽기 전용)",
                "업스트림에 새 릴리스가 없습니다",
                "현재 포크는 {0}이며 업스트림에 새 릴리스가 없습니다.",
                "업스트림 새 릴리스 있음",
                "업스트림 최신은 {0}, 현재 포크는 {1}입니다.\n\n읽기 전용 확인입니다. 업스트림 설치 프로그램을 다운로드하거나 설치하지 않습니다.\n\nGitHub에서 업스트림 릴리스 페이지를 여시겠습니까?",
                "업스트림을 확인할 수 없습니다",
                "업스트림 최신 버전을 가져오지 못했습니다. 나중에 다시 시도하세요.\n업스트림 릴리스 페이지를 직접 열 수도 있습니다.",
                "업스트림 릴리스 페이지를 여시겠습니까?",
                "GitHub API 재시도 가능 시간: {0}"),
            _ => new(
                "Check upstream updates",
                "Checking upstream…",
                "Upstream v{0} (view only)",
                "Upstream v{0} · this fork v{1} (read-only)",
                "No newer upstream release",
                "This fork is on {0}; upstream has no newer release.",
                "Upstream release available",
                "Upstream latest is {0}; this fork is {1}.\n\nRead-only check: the upstream installer will not be downloaded or installed.\n\nOpen the upstream release page on GitHub?",
                "Couldn't check upstream",
                "Couldn't get the upstream version. Try again later.\nYou can also open the upstream release page manually.",
                "Open the upstream release page?",
                "GitHub API can be retried after: {0}"),
        };
    }
}
