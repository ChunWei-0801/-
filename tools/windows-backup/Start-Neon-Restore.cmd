@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Neon-Restore.ps1" %*
set "FAMBUDGET_RESTORE_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %FAMBUDGET_RESTORE_EXIT%
