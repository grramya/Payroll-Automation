@echo off
echo Starting Payroll JE Automation (React + FastAPI)
echo.

:: Start FastAPI backend in a new window
start "Payroll API" cmd /k "cd /d "%~dp0" && uvicorn app_api:app --reload --port 8000"

:: Give backend a moment to start
timeout /t 2 /nobreak >nul

:: Start React frontend
cd /d "%~dp0frontend"
if not exist node_modules (
    echo Installing frontend dependencies...
    npm install
)
npm run dev
