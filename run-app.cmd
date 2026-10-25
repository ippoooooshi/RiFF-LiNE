@echo off
chcp 65001 >nul
rem ==========================================================================
rem  RiFF-LiNE launcher (Windows). Double-click this file in Explorer.
rem  THE only entry point for launching the PC app (web-core-foundation.md 5.3).
rem
rem  This file only finds Node.js and calls apps\desktop\scripts\run-app.mjs.
rem  Every launch step lives in run-app.mjs:
rem     run-app.cmd           -> menu (1 dev / 2 debug / 3 prod / 4 logs / 5 dist), 1 after 3 seconds
rem     run-app.cmd dev|debug|prod|logs|dist
rem     run-app.cmd logs dev|dist   (4 logs: dev = RiFF-LiNE-dev, dist = RiFF-LiNE; menu, dev after 3 seconds)
rem  The window closes on a normal exit and stays open only when something failed.
rem ==========================================================================
setlocal
REM <!-- req webcorefoundation:53401c92.9ef4 --> <!-- req webcorefoundation:86e581d3.4abb --> <!-- req webcorefoundation:86e581d3.1bf2 --> <!-- req webcorefoundation:86e581d3.1a87 --> <!-- req webcorefoundation:e1397463.4004 --> <!-- req webcorefoundation:e1397463.26c0 -->
cd /d "%~dp0"
title RiFF-LiNE

where node >nul 2>nul
if errorlevel 1 goto :no_node

node "%~dp0apps\desktop\scripts\run-app.mjs" %*
set "RC=%errorlevel%"
if not "%RC%"=="0" pause
exit /b %RC%

:no_node
rem Japanese message (web-core-foundation.md 5.3): passed to PowerShell as -EncodedCommand so this file stays ASCII.
powershell.exe -NoProfile -EncodedCommand VwByAGkAdABlAC0ASABvAHMAdAAgACcAWwByAHUAbgAtAGEAcABwAF0AIABOAG8AZABlAC4AagBzACAATDCLiWQwSzCKMH4wWzCTMAIwLgBuAHYAbQByAGMAIABuMEhyCP8yADQAIAD7fAn/bjAgAE4AbwBkAGUALgBqAHMAIACSMGVRjDBmMEswiTABMIIwRjAATqZeIAByAHUAbgAtAGEAcABwAC4AYwBtAGQAIACSMIuVRDBmME8wYDBVMEQwAjAnAA== 2>nul
rem English fallback only when PowerShell could not show the Japanese message above.
if errorlevel 1 echo [run-app] Node.js was not found. Install Node.js 24 (see .nvmrc) and retry.
pause
exit /b 1
