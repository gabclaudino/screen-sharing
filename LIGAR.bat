@echo off
chcp 65001 >nul
title Tela dos Guri - ligar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1" ligar
echo.
pause
