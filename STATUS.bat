@echo off
chcp 65001 >nul
title Tela dos Guri - status
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1" status
echo.
pause
