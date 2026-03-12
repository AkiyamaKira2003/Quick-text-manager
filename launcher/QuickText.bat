@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%QuickText.ps1"

if not exist "%PS_SCRIPT%" (
  echo [QuickTextLauncher] Missing script: "%PS_SCRIPT%"
  exit /b 1
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" %*
exit /b %ERRORLEVEL%
