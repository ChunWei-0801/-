@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Backup.ps1" %*
set "FAMBUDGET_BACKUP_EXIT=%ERRORLEVEL%"
echo.
pause
exit /b %FAMBUDGET_BACKUP_EXIT%
