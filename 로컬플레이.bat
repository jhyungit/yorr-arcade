@echo off
chcp 65001 >nul
title YORR - Local (same Wi-Fi / hotspot)
echo Starting LOCAL play (same Wi-Fi / hotspot)...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-play.ps1"
echo.
echo Press any key to close this window...
pause >nul
