@echo off
setlocal
cd /d "%~dp0"

echo Starting Quode Palette ICO in development mode...
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Install Node.js LTS from https://nodejs.org/ first.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing dependencies...
    call npm ci
    if errorlevel 1 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
)

call npm start
