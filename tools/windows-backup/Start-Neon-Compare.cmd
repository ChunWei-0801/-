@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Neon-Compare.ps1" %*
set "FAMBUDGET_COMPARE_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %FAMBUDGET_COMPARE_EXIT%
