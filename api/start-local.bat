@echo off
REM Local Backend Start Script for Windows
REM Run this to test the backend locally before deployment

echo.
echo 🚀 Starting Invexaretail Backend...
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js 22+ first.
    echo    Download from: https://nodejs.org/en/download
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo ✅ Node.js %NODE_VERSION% found
echo.

REM Check if dist exists, build if not
if not exist "dist" (
    echo 📦 Building backend...
    call npm install
    if %errorlevel% neq 0 exit /b 1
    call npm run build
    if %errorlevel% neq 0 exit /b 1
)

echo.
echo ✅ Starting server on http://localhost:4000
echo.
echo Test the server by visiting:
echo   - http://localhost:4000/health
echo.
echo To test registration from Hostinger, add this to frontend .env:
echo   VITE_API_BASE=http://localhost:4000
echo.
echo Press Ctrl+C to stop
echo.

REM Set environment variables and start
set NODE_ENV=development
set PORT=4000
set ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://invexaretail.com
set JWT_SECRET=dev-secret-change-in-production

node dist/index.js
pause
