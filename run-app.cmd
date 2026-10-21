@echo off
chcp 65001 >nul
rem ==========================================================================
rem  RiFF-LiNE launcher (Windows). Double-click this file in Explorer.
rem  THE only entry point for launching the PC app (web-core-foundation.md 5.3).
rem
rem  This file only finds Node.js and calls apps\desktop\scripts\run-app.mjs.
rem  Every launch step lives in run-app.mjs:
rem     run-app.cmd           -> menu (1 dev / 2 debug / 3 prod / 4 logs), 1 after 3 seconds
rem     run-app.cmd dev|debug|prod|logs
rem  The window closes on a normal exit and stays open only when something failed.
rem ==========================================================================
setlocal
REM <!-- req webcorefoundation:53401c92.9ef4 --> <!-- req webcorefoundation:d06d6ff3.4abb --> <!-- req webcorefoundation:d06d6ff3.1bf2 --> <!-- req webcorefoundation:d06d6ff3.1a87 --> <!-- req webcorefoundation:e1397463.4004 --> <!-- req webcorefoundation:e1397463.26c0 -->
cd /d "%~dp0"
title RiFF-LiNE

where node >nul 2>nul
if errorlevel 1 goto :no_node

node "%~dp0apps\desktop\scripts\run-app.mjs" %*
set "RC=%errorlevel%"
if not "%RC%"=="0" pause
exit /b %RC%

:no_node
echo [run-app] Node.js was not found. Install Node.js 24 (see .nvmrc) and retry.
pause
exit /b 1
