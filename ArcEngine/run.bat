@echo off
rem ==========================================================================
rem  ArcEngine - local launch
rem  Starts the no-cache dev server (tools/dev-server.mjs) and opens a browser.
rem  Needs Node.js only - the kit itself has zero dependencies.
rem
rem    run.bat              -> port 8080 (or the next free one), opens browser
rem    run.bat 9000         -> port 9000
rem    run.bat 9000 --no-open  -> do not open a browser
rem ==========================================================================
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [x] Node.js not found in PATH.
    echo       Install it from https://nodejs.org/ ^(LTS^) and run this file again.
    echo.
    pause
    exit /b 1
)

set "PORT_ARG="
set "OPEN_ARG="
for %%A in (%*) do (
    echo %%A | findstr /r "^[0-9][0-9]*$" >nul && set "PORT_ARG=--port=%%A"
    if /i "%%A"=="--no-open" set "OPEN_ARG=--no-open"
)

node tools\dev-server.mjs %PORT_ARG% %OPEN_ARG%

if errorlevel 1 (
    echo.
    echo   [x] The server exited with an error - see the message above.
    pause
)
endlocal
