@echo off
chcp 65001 >nul
title Mathmyth - Android emulator
setlocal
cd /d "%~dp0"
set "PS=%~dp0scripts\android-emulator.ps1"
if not exist "%PS%" (
  echo [ERROR] scripts\android-emulator.ps1 not found next to this file.
  pause
  exit /b 1
)

rem Drag an .apk onto this file to install exactly that one.
if /i "%~x1"==".apk" (
  call :run -Apk "%~1"
  goto :end
)
if not "%~1"=="" (
  call :run %*
  goto :end
)

:menu
echo.
echo   Mathmyth - Android emulator
echo   ------------------------------------------
echo   1  Start emulator + install a debug APK  (default, 15s)
echo   2  Start emulator + install the release APK
echo   3  Start emulator only (no install)
echo   4  Start emulator + wipe app data, install a debug APK
echo   0  Exit
echo   ------------------------------------------
echo   Tip: drop an .apk file onto this .bat to install that file.
echo.
choice /c 12340 /n /m "Choose [1]: " /t 15 /d 1
if errorlevel 5 goto :end
if errorlevel 4 (
  call :run -Wipe
  goto :end
)
if errorlevel 3 (
  call :run -NoInstall
  goto :end
)
if errorlevel 2 (
  call :run -Release
  goto :end
)
call :run
goto :end

:run
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS%" %*
exit /b %ERRORLEVEL%

:end
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" (echo   [OK] done.) else (echo   [FAILED] exit code %CODE%)
echo.
pause
exit /b %CODE%
