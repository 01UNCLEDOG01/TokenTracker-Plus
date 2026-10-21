@echo off
chcp 65001 >nul
setlocal
title Qoder Intl - 刷新 Cookie
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Qoder-Intl-刷新Cookie.ps1"
if errorlevel 1 (
  echo.
  echo 未写入任何内容，原文件保持不变。
  pause
  exit /b 1
)
echo.
pause
