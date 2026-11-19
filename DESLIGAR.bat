@echo off
chcp 65001 >nul
title Tela dos Guri - desligar
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\servidor.ps1" desligar
echo.
pause
