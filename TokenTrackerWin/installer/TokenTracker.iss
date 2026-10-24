; ─────────────────────────────────────────────────────────────────────────
; TokenTracker.iss — Inno Setup script for the Windows tray app.
;
; Builds a per-user installer (no admin / UAC) that matches the app's own
; design: tokentracker:// protocol and launch-at-startup are registered by
; the app at runtime under HKCU, so the installer only lays down files +
; shortcuts and never touches machine-wide state.
;
; Inputs:
;   ISCC.exe /DMyAppVersion=0.31.1 TokenTracker.iss
;
; Expects the self-contained publish output next to this script at
; ..\publish\ (TokenTracker.exe + the .NET runtime + EmbeddedServer\),
; produced by:
;   dotnet publish ... --self-contained true -o TokenTrackerWin\publish
;   Copy-Item TokenTrackerWin\EmbeddedServer  TokenTrackerWin\publish\EmbeddedServer
; ─────────────────────────────────────────────────────────────────────────

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif

#define MyAppName "TokenTracker Plus"
#define MyAppPublisher "TokenTracker Plus"
#define MyAppURL "https://github.com/01UNCLEDOG01/TokenTracker-plus"
#define MyAppExeName "TokenTracker.exe"

[Setup]
; Stable per-product GUID — keep constant so upgrades replace in place and
; uninstall stays a single Add/Remove Programs entry.
AppId={{8F2A6C71-4E9D-4B7A-9C3E-1D5F0A2B6E84}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
; The fork owns D:\TokenTrackerPlus; keep the app under app\ next to repo\,
; archive\ and cloud\. UsePreviousAppDir=no prevents Inno from reusing the
; legacy D:\TokenTracker install path.
PrivilegesRequired=lowest
DefaultDirName=D:\TokenTrackerPlus\app
UsePreviousAppDir=no
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
SetupIconFile=..\assets\trayicon.ico
OutputDir=Output
OutputBaseFilename=TokenTracker-plus-Setup-v{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Close a running tray instance (and its EmbeddedServer\node.exe child, which
; holds a file lock) before overwriting its files on upgrade. We drive the
; relaunch ourselves after a silent update, so don't let Restart Manager do it.
CloseApplications=yes
RestartApplications=no

; A language picker appears at setup start (Inno shows it automatically when more
; than one language is listed). English ships with Inno; the Chinese message files
; are bundled here (UTF-8 with BOM) since Inno does not include them.
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "chinesetraditional"; MessagesFile: "ChineseTraditional.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; Flags: unchecked

[Files]
; The whole self-contained publish folder, including EmbeddedServer\ which
; ServerManager resolves from AppContext.BaseDirectory at runtime.
Source: "..\publish\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
