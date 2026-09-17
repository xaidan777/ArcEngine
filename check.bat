@echo off
rem ==========================================================================
rem  ArcEngine - code check: types (tsc via npx) and unit tests (node --test)
rem
rem    check.bat            -> types and tests
rem    check.bat --types    -> types only
rem    check.bat --tests    -> tests only
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

node tools\check.mjs %*
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
