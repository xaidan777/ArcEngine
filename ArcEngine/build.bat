@echo off
rem ==========================================================================
rem  ArcEngine - build a game archive
rem
rem    build.bat                -> dist\arcengine-<GAME_VERSION>.zip
rem    build.bat --version=0.2.0  -> stamp a new version into the build
rem    build.bat --no-zip         -> only produce the build\ folder
rem    build.bat --force          -> build even if checks fail
rem ==========================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [x] Node.js not found in PATH. Install it from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

node tools\build.mjs %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
