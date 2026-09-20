@echo off
rem ============================================================================
rem  upload.bat - publish the kit to GitHub. Double-click it, or: upload.bat "message"
rem
rem  Local only: it is in .gitignore and is not mentioned in the shipped docs -
rem  kit users do not need it.
rem
rem  It pulls with --rebase BEFORE pushing: the repository is also edited on the
rem  GitHub site, and without that a push is refused as non-fast-forward. A rebase
rem  conflict stops the script - nothing is pushed, ask Claude.
rem
rem  KEEP THIS FILE CRLF AND ASCII. With LF endings cmd.exe mangles the commands,
rem  and it has no goto/if blocks in brackets for the same reason.
rem ============================================================================
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "MSG=%~1"
if "%MSG%"=="" set "MSG=update"

echo.
echo   ArcEngine - upload to GitHub
echo   ----------------------------------------------

echo [dry] git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 goto :notrepo

echo   [1/4] staging
echo [dry] git add -A
if errorlevel 1 goto :fail

echo [dry] git diff --cached --quiet
if errorlevel 1 goto :docommit
echo   [2/4] nothing new to commit
goto :pull

:docommit
echo   [2/4] commit: %MSG%
echo [dry] git commit -m "%MSG%"
if errorlevel 1 goto :fail

:pull
echo   [3/4] pull --rebase
echo [dry] git pull --rebase
if errorlevel 1 goto :conflict

echo   [4/4] push
echo [dry] git push
if errorlevel 1 goto :fail

echo.
echo   Done. https://github.com/xaidan777/ArcEngine
goto :done

:notrepo
echo   ERROR: this folder is not a git repository.
goto :done

:conflict
echo.
echo   STOPPED: the rebase hit a conflict. Nothing was pushed.
echo   Do not resolve it by hand - ask Claude.
goto :done

:fail
echo.
echo   FAILED - see the message above.

:done
echo.
rem pause
endlocal
