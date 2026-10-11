@echo off
rem ============================================================
rem  Usage Desk - launcher for the station owner's TokenTracker fork
rem  Fork branch: usage-desk   Built from: D:\tt-fork
rem  Installed in place at: D:\TokenTracker\TokenTracker.exe
rem  Local panel: http://127.0.0.1:17680/?app=1
rem
rem  This is a desktop app, not a web page. The launcher always aims at the
rem  native window first:
rem    app already showing a window -> bring that window to the front
rem    app running with no window    -> open the local panel in the browser
rem    app not running               -> start it and wait for its local server
rem  The desktop pet and the quota widget share the same local server, so this
rem  is also the way to bring them back after a reboot.
rem ============================================================
setlocal EnableExtensions
set "APP=D:\TokenTracker\TokenTracker.exe"
set "URL=http://127.0.0.1:17680/?app=1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $p = Get-Process -Name 'TokenTracker' | Select-Object -First 1; if (-not $p) { 'NOTRUNNING'; exit }; if ($p.MainWindowHandle -ne 0) { $ok = (New-Object -ComObject WScript.Shell).AppActivate($p.Id); if ($ok) { 'FOCUSED' } else { 'NOWINDOW' } } else { 'NOWINDOW' }" | findstr /C:"NOTRUNNING" >nul
if not errorlevel 1 goto cold

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; $p = Get-Process -Name 'TokenTracker' | Select-Object -First 1; if ($p -and $p.MainWindowHandle -ne 0) { 'FOCUSED' } else { 'NOWINDOW' }" | findstr /C:"FOCUSED" >nul
if not errorlevel 1 goto focused
goto panel

:focused
echo Usage Desk: the app window is in front of you.
ping -n 3 127.0.0.1 >nul
goto end

:panel
echo Usage Desk: the app is running without a window, opening the local panel...
start "" "%URL%"
ping -n 3 127.0.0.1 >nul
goto end

:cold
if not exist "%APP%" goto missing
echo Usage Desk: starting the app...
start "" "%APP%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok = $false; for ($i = 0; $i -lt 40; $i++) { if (Get-NetTCPConnection -LocalPort 17680 -State Listen -ErrorAction SilentlyContinue) { $ok = $true; break }; Start-Sleep -Seconds 1 }; if ($ok) { 'READY' } else { 'SLOW' }" | findstr /C:"SLOW" >nul
if not errorlevel 1 goto slow
echo Usage Desk: ready.
ping -n 3 127.0.0.1 >nul
goto end

:slow
echo Usage Desk: the app window opened but the local server did not answer within 40 seconds.
echo Try again, or start D:\TokenTracker\TokenTracker.exe manually.
ping -n 8 127.0.0.1 >nul
goto end

:missing
echo Usage Desk: app not found at %APP%
echo The fork is installed in place; nothing was renamed.
ping -n 8 127.0.0.1 >nul

:end
endlocal
