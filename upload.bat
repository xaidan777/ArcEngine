@echo off
rem ==========================================================================
rem  ArcEngine - upload the kit to GitHub
rem  Commits every change in this folder and pushes it to the connected
rem  repository (origin). What is not uploaded - see .gitignore.
rem  The first push opens a GitHub sign-in window; Git remembers it.
rem
rem    upload.bat                  -> asks what changed (Enter = date and time)
rem    upload.bat "what changed"   -> no question, no pause
rem ==========================================================================
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo.
    echo   [x] Git not found in PATH. Install it from https://git-scm.com/download/win
    echo.
    pause
    exit /b 1
)
if not exist ".git" (
    echo.
    echo   [x] This folder is not connected to a GitHub repository yet.
    echo       Ask Claude to connect it to your repository.
    echo.
    pause
    exit /b 1
)

set "MSG=%~1"
if "%~1"=="" set /p "MSG=  What changed (Enter = date and time): "
if not defined MSG set "MSG=Update %DATE% %TIME:~0,5%"

git add -A
git diff --cached --quiet
if errorlevel 1 (
    git status --short
    git commit -q -m "%MSG%"
)
git push -u origin HEAD
set "RC=%ERRORLEVEL%"

echo.
if %RC% neq 0 (
    echo   [x] Upload failed - see the message above.
) else (
    for /f "delims=" %%U in ('git remote get-url origin') do echo   Uploaded: %%U
)
if "%~1"=="" pause
exit /b %RC%
