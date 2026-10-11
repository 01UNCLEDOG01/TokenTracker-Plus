@echo off
rem ============================================================
rem  Usage Desk - launcher for the station owner's TokenTracker fork
rem  Fork branch: usage-desk   Built from: D:\tt-fork
rem  Installed in place at: D:\TokenTracker\TokenTracker.exe
rem  Local panel: http://127.0.0.1:17680/?app=1
rem
rem  Already running  -> opens the panel in your default browser.
rem  Not running yet  -> starts the app and waits for its local server.
rem  The desktop pet and the quota widget use the same server, so this
rem  launcher is also the way to bring them back after a reboot.
rem ============================================================
setlocal EnableExtensions
set "APP=D:\TokenTracker\TokenTracker.exe"
set "URL=http://127.0.0.1:17680/?app=1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 17680 -State Listen -ErrorAction SilentlyContinue) { 'UP' } else { 'DOWN' }" | findstr /C:"UP" >nul
if not errorlevel 1 goto warm
goto cold

:warm
start "" "%URL%"
echo Usage Desk: panel opened in your default browser.
ping -n 3 127.0.0.1 >nul
goto end

:cold
if not exist "%APP%" goto missing
echo Usage Desk: starting the app, the window shows your panel...
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
