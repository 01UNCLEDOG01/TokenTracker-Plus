# TokenTracker Plus for Windows

The Windows desktop app for this fork wraps the Node CLI, the local server and
built dashboard in a resident **system tray** application. The separate native
macOS client is documented in [TokenTrackerMac](../TokenTrackerMac/README.md).

- **Stack:** .NET 8, WinForms tray, WPF/WebView2 dashboard and native widgets.
- **Features:** tray menus, local sync, startup preferences, embedded dashboard,
  desktop pets, quota widgets, usage pill, theme/language settings and a native
  settings bridge. Usage tracking requires no cloud account.

## Install

Download `TokenTracker-Setup.exe` from this fork's [published releases](https://github.com/01UNCLEDOG01/TokenTracker-Plus/releases).
Older assets may include the version in their filename. Node and the .NET runtime
are bundled; Windows 10/11 and WebView2 Runtime are required. The .NET SDK is only
needed when building from source.

## What it does

### Token Monitor

Right-click the tray icon and enable **用量悬浮窗 / Token Monitor**. A small
always-on-top pill shows today's tokens · cost — the exact figures the tray
summary renders, in the user's currency and token-unit system (万/亿 vs K/M/B).
It is native WPF rather than a WebView2 page: the surface is one formatted
string, so a browser process per pixel buys nothing. Left-click opens the
dashboard, drag moves it (position remembered), right-click opens a small menu
(open / sync now / hide), and it hides over fullscreen apps like the quota
widget.

### Desktop quota

Use the top-right **Close widget** button in either view to hide it. This disables
the widget persistently (including after restart); reopen it from **Desktop quota**
in the tray menu. Closing the widget does not quit the app.


Right-click the tray icon and enable **Desktop quota**. The 320 × 144 DIP
surface shows two remaining-quota bars and actual reset countdowns; click to expand to 360 × 340 DIP.
Use the sliders button to choose up to two provider windows, drag the grip to
move it, and press Escape to collapse. The widget follows the app theme and
language, remembers its position and selection, and hides over fullscreen apps.
Closing the dashboard does not stop its shared 60-second quota polling.
The feature is opt-in and can be hidden from the same tray menu.

Build Windows dashboard assets with `TOKENTRACKER_BUILD_PET=1`; this includes
both `pet.html` and `quota.html`. The quota surface uses a solid layered window
with a clipped rounded region, so it does not require Windows 11 Acrylic.

1. On launch it resolves a Node runtime + the tracker CLI, picks a free loopback
   port, and starts `tracker serve --port <P> --no-sync --no-open`.
2. The tray icon stays resident. Left-click or **Open Dashboard** shows the
   dashboard in a WebView2 window pointed at `http://127.0.0.1:<P>`.
3. On quit (or crash — see Job Object below) the Node server is stopped.

### Local server port

The CLI defaults to `:7680`. On Windows that port can be taken:
**Delivery Optimization (DoSvc)** binds `::7680` dual-stack, which also reserves
IPv4 `7680`, so binding fails with `EACCES`. The desktop app prefers `:17680`
and falls back to an OS-assigned free loopback port when it is busy. It passes
that port explicitly and always uses the literal `127.0.0.1`
(never `localhost`, which resolves to `::1` first and would hit DoSvc).

### Process cleanup

`ServerManager` assigns the Node process to a Windows **Job Object** with
`KILL_ON_JOB_CLOSE`, so the server is terminated even if the tray app is
force-killed (Task Manager "End task" / crash), not just on a graceful Quit.

## Requirements

- Windows 10/11 with the **WebView2 Runtime** (preinstalled on Windows 11; the
  Evergreen runtime is otherwise auto-installed by Edge updates).
- **.NET 8 SDK** to build.
- A Node runtime + the tracker CLI — either bundled (`scripts\bundle-node.ps1`)
  or, for dev, system Node + this repo (see below).

## Build

```powershell
dotnet build -c Debug   # output: bin\Debug\net8.0-windows10.0.19041.0\TokenTracker.exe
```

The tray icon is committed at `assets\trayicon.ico`. To regenerate it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
```

## Run in dev (against this repo, no bundle)

`tracker serve` requires a built dashboard, so build it once from the repo root:

```powershell
$env:TOKENTRACKER_BUILD_PET = '1'
npm run dashboard:build
```

Then point the app at system Node + the repo CLI via env vars and run it:

```powershell
$env:TOKENTRACKER_NODE  = (Get-Command node).Source
$env:TOKENTRACKER_ENTRY = "$PWD\..\bin\tracker.js"   # from TokenTrackerWin\
.\bin\Debug\net8.0-windows10.0.19041.0\TokenTracker.exe
```

The exe runs in the tray (no console window). Right-click the tray icon to quit.

## Bundle a self-contained runtime (for distribution)

`scripts\bundle-node.ps1` downloads the pinned Node 22.22.2 win-x64 binary,
builds the dashboard with the pet/quota entries and copies the CLI and dashboard into `EmbeddedServer\`
(gitignored), which `ServerManager` prefers over the dev fallback.

```powershell
# Run from TokenTrackerWin; bundle-node builds the PET dashboard itself.
powershell -ExecutionPolicy Bypass -File scripts\bundle-node.ps1
dotnet publish -c Release -r win-x64 --self-contained true -o publish
# Use a fresh staging directory; an existing child must not be copied into itself.
if (Test-Path publish\EmbeddedServer) { throw 'Stage into a fresh publish directory before copying EmbeddedServer.' }
Copy-Item EmbeddedServer publish\EmbeddedServer -Recurse
node ..\scripts\verify-windows-package.cjs publish
dotnet test ..\TokenTrackerWin.Tests\TokenTrackerWin.Tests.csproj -c Release
```

> The published `EmbeddedServer\` must sit next to `TokenTracker.exe`. Wire it
> into the publish output (copy step / installer) when packaging an installer.

## Distribution and updates

The Inno Setup definition is `installer/TokenTracker.iss`; its version is passed
as `/DMyAppVersion=X.Y.Z`. Verify the staged package before compiling. The manual
`release-windows` GitHub workflow builds installers and portable ZIPs for an
existing tag, uploads only to a draft and titles it `vX.Y.Z`. After tests, review,
runtime verification and push, the owner can publish it or explicitly authorize
an agent to publish and verify the public download. This fork does not publish
an npm package.

The manual **Check upstream updates** action is informational: it does not
download or execute an upstream installer, and background checks are disabled.
Upgrade this fork by downloading its own latest published Windows installer.

本地加载：CLI 按需加载当前命令，服务先监听再复制运行文件和修复集成；构建会预压缩共享 JS/CSS。页面代码加载期间保留导航和骨架，悬停、聚焦或触摸导航时预载目标页面代码。DeepSeek Harness 会话异步解压、分批解析，日期筛选复用格式器。会话列表按需 gzip、重建期间复用结果，磁盘缓存带格式版本与 24 小时有效期，会话页显示快照时间。

启动排查：`%LOCALAPPDATA%\TokenTracker\windows-host.log` 中的 `[startup]` 记录 `host-main`、`server-launch`、`server-ready`、`webview-start`、`webview-ready`、`navigation-start`、`document-ready`、`shell-visible` 和 `dashboard-data-ready`。宿主的 `elapsedMs` 相对应用启动，页面消息另带相对文档导航的 `documentMs`；内嵌 Node 的同名日志使用独立的进程时钟，不能直接相减。浏览器还可读取 `tokentracker:shell-visible` 和 `tokentracker:dashboard-data-ready` 性能标记。计时只用于本机诊断，不含页面 URL、账号或数据内容。
