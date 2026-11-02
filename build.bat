@echo off
setlocal
cd /d "%~dp0"

echo.
echo ===============================================
echo   Quode Palette ICO Build
echo ===============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found.
    echo Install Node.js LTS from https://nodejs.org/ and try again.
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do set "NODE_VERSION=%%v"
echo Node.js: %NODE_VERSION%
echo.

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm was not found. Reinstall Node.js LTS and try again.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing build dependencies...
    call npm ci
    if errorlevel 1 (
        echo.
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
) else (
    echo Using installed dependencies.
)

if exist "dist\" (
    echo Cleaning previous build output...
    rd /s /q "dist"
    if exist "dist\" (
        echo [ERROR] Could not remove the previous dist folder.
        pause
        exit /b 1
    )
)

echo.
echo Building the portable EXE and Windows installer...
echo.
call npm run build
if errorlevel 1 (
    echo.
    echo [ERROR] Build failed. Review the messages above.
    pause
    exit /b 1
)

del /q "dist\*.blockmap" >nul 2>nul
del /q "dist\builder-debug.yml" >nul 2>nul
del /q "dist\builder-effective-config.yaml" >nul 2>nul
if exist "dist\win-unpacked\" rd /s /q "dist\win-unpacked"

if not exist "dist\QuodePaletteICO-portable.exe" (
    echo.
    echo [ERROR] The portable EXE was not created.
    pause
    exit /b 1
)

echo.
echo ===============================================
echo   BUILD COMPLETE
echo ===============================================
echo.
echo Output folder: dist\
echo   QuodePaletteICO-portable.exe
echo   Quode Palette ICO Setup <version>.exe
echo.
echo Upload QuodePaletteICO-portable.exe to your GitHub Release
echo for users who want one portable file with no installation.
echo.
start "" explorer "dist"
pause
