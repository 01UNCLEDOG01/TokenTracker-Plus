#requires -version 5
<#
  Qoder 国际版 用量 Cookie 刷新工具

  从剪贴板读取一枚 qoder.com 的网站 Cookie，校验后写入 TokenTracker 的 cookie 文件：
      %USERPROFILE%\.tokentracker\tracker\qoder-usage-cookie.txt

  安全约定：
    * 全程不把 Cookie 的值打印或写进日志，只打印「形态摘要」和 cookie 名字；
    * 空剪贴板、含中文、明显不是 name=value 形式的内容一律拒绝，且不改动原文件；
    * 写入前自动备份原文件；
    * 以 UTF-8 无 BOM 写入（BOM 会被当成 Cookie 的一部分发给服务器）。

  兼容性：从 DevTools 复制整段请求头、或复制成多行，也能用——会自动去掉
          "Cookie:" 前缀并移除所有空白（真实 Cookie 值不含空白）。

  用法：在浏览器登录 qoder.com，复制整条 Cookie，然后双击同目录的
        Qoder-Intl-刷新Cookie.cmd。
#>
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$cookieFile = Join-Path $env:USERPROFILE ".tokentracker\tracker\qoder-usage-cookie.txt"

function Show-Shape([string]$s) {
  $names = @()
  if ($s) {
    $names = ($s -split ';') |
      ForEach-Object { (($_ -split '=')[0]).Trim() } |
      Where-Object { $_ } |
      ForEach-Object { if ($_.Length -gt 24) { $_.Substring(0, 24) + "…" } else { $_ } }
  }
  Write-Host ("   长度        : {0}" -f $s.Length)
  Write-Host ("   含 '='      : {0}" -f [bool]($s -match '='))
  Write-Host ("   含中文      : {0}" -f [bool]($s -match '[\u4e00-\u9fff]'))
  Write-Host ("   含空白/换行 : {0}" -f [bool]($s -match '\s'))
  if ($names.Count -gt 0) {
    $joined = ($names -join ', ')
    if ($joined.Length -gt 200) { $joined = $joined.Substring(0, 200) + "…" }
    Write-Host ("   名字(无值)  : {0}" -f $joined)
  }
}

Write-Host "Qoder 国际版 用量 Cookie 刷新工具"
Write-Host "目标文件: $cookieFile"
Write-Host ""

try {
  $raw = Get-Clipboard -Raw -ErrorAction Stop
} catch {
  Write-Host "[失败] 读不到剪贴板。"
  exit 1
}

$text = if ($null -eq $raw) { "" } else { ([string]$raw) }

Write-Host "剪贴板原始形态自检（不显示 Cookie 值）："
Show-Shape $text
Write-Host ""

# 兼容粘贴进来的 "Cookie:" 请求头与多行内容：
#   1. 去掉可能存在的 "Cookie:" 前缀；
#   2. 换行/制表符当作分隔符变成 ';'（真实 Cookie 值不含换行）；
#   3. 去掉空格（真实 Cookie 值不含空格；`; ` 分隔符的空格可安全删除）。
$text = $text -replace '(?im)^\s*cookie\s*:\s*', ''
$text = $text -replace '[\r\n\t]+', ';'
$text = $text -replace ' ', ''
$text = $text.Trim()
while ($text.StartsWith(';')) { $text = $text.Substring(1) }
while ($text.EndsWith(';')) { $text = $text.Substring(0, $text.Length - 1) }

if (-not $text) {
  Write-Host "[失败] 剪贴板是空的。请先在浏览器登录 qoder.com，复制整条 Cookie 再运行。"
  exit 1
}
if ($text.Length -lt 8) {
  Write-Host "[失败] 内容太短，不像 Cookie，未改动原文件。"
  exit 1
}
if ($text -match '[\u4e00-\u9fff]') {
  Write-Host "[失败] 内容含中文，这不是 Cookie，未改动原文件。"
  Write-Host "       提示：请复制浏览器里 qoder.com 请求头的 Cookie 值，而不是聊天/文档文本。"
  exit 1
}
if ($text -notmatch '=') {
  Write-Host "[失败] 内容不含 '='，不是 name=value 形式的 Cookie，未改动原文件。"
  exit 1
}
Write-Host "归一化后形态（将写入的就是这段的字节数，值仍不回显）："
Show-Shape $text
Write-Host ""

if (Test-Path -LiteralPath $cookieFile) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backup = "$cookieFile.bak-$stamp"
  Copy-Item -LiteralPath $cookieFile -Destination $backup -Force
  Write-Host "已备份原文件 -> $backup"
}

$dir = Split-Path -Parent $cookieFile
if (-not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

try {
  [System.IO.File]::WriteAllText($cookieFile, $text, (New-Object System.Text.UTF8Encoding($false)))
} catch {
  Write-Host "[失败] 写入失败：$($_.Exception.Message)"
  exit 1
}

Write-Host ""
Write-Host ("[完成] 已写入 {0} 字节（值不回显）。" -f $text.Length)
Write-Host "刷新 TokenTracker 面板即可看到最新的 qoder-intl 消耗与逐日明细。"
exit 0
