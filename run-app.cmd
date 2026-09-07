@echo off
chcp 65001 >nul
rem ==========================================================================
rem  Tab App launcher (Windows). Double-click this file in Explorer.
rem  THE entry point for launching the PC app during development.
rem
rem  It finds pnpm (or falls back to "corepack pnpm"), installs dependencies on
rem  the first run, then starts "electron-vite dev" (hot reload).
rem  Stop it with Ctrl+C in the console window.
rem
rem  If startup fails with an Electron binary error, run once:
rem     corepack pnpm install
rem     corepack pnpm rebuild electron
rem ==========================================================================
setlocal
cd /d "%~dp0"
title Tab App (dev)

rem Make sure Electron runs as a GUI app, not as plain Node.
set "ELECTRON_RUN_AS_NODE="

rem --- locate pnpm --------------------------------------------------------------
set "PM="
where pnpm >nul 2>nul
if %errorlevel%==0 set "PM=pnpm"
if not defined PM (
  where corepack >nul 2>nul
  if errorlevel 1 goto :no_node
  set "PM=corepack pnpm"
  echo [run-app] pnpm not on PATH - using "corepack pnpm". Tip: run "corepack enable" once.
)

rem --- dependencies (first run) ----------------------------------------------
if not exist "node_modules\.pnpm" (
  echo [run-app] First-time setup: installing dependencies. This may take a few minutes...
  call %PM% install
  if errorlevel 1 goto :fail
)

rem --- launch ---------------------------------------------------------------------
echo [run-app] Starting the PC app (electron-vite dev / hot reload). Press Ctrl+C to stop.
echo.
call %PM% --filter @riff-line/desktop dev
set "RC=%errorlevel%"
echo.
echo [run-app] App exited (code %RC%).
pause
exit /b %RC%

:no_node
echo [run-app] Neither pnpm nor corepack was found. Install Node.js 24 (see .nvmrc) and retry.
pause
exit /b 1

:fail
echo.
echo [run-app] Dependency install failed. Check the log above, then retry.
pause
exit /b 1
