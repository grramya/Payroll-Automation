@echo off
setlocal EnableDelayedExpansion

set MODE=%1
if "%MODE%"=="" set MODE=dev

if /I "%MODE%"=="prod" goto :prod
if /I "%MODE%"=="dev"  goto :dev
if /I "%MODE%"=="stop" goto :stop
if /I "%MODE%"=="logs" goto :logs

echo.
echo  Usage:  start.bat [dev ^| prod ^| stop ^| logs]
echo.
echo    dev   Start backend + frontend in development mode (hot-reload)
echo    prod  Build and run via Docker Compose (production)
echo    stop  Stop Docker Compose services
echo    logs  Tail Docker Compose logs
echo.
exit /b 1

:: ── Development ────────────────────────────────────────────────────────────────
:dev
echo.
echo  [DEV] Starting Payroll JE Automation in development mode...
echo.

:: Start FastAPI backend with hot-reload
start "Payroll API (dev)" cmd /k "cd /d "%~dp0backend" && uvicorn app_api:app --reload --port 8000"

:: Small delay to let the backend initialise
timeout /t 2 /nobreak >nul

:: Start Vite dev server
cd /d "%~dp0frontend"
if not exist node_modules (
    echo  Installing frontend dependencies...
    npm install
)
npm run dev
goto :end

:: ── Production (Docker) ────────────────────────────────────────────────────────
:prod
echo.
echo  [PROD] Building and starting via Docker Compose...
echo.

:: Ensure .env exists
if not exist "%~dp0backend\.env" (
    echo  ERROR: backend\.env not found.
    echo  Copy backend\.env.example to backend\.env and fill in your values.
    exit /b 1
)

cd /d "%~dp0"
docker compose up --build -d

echo.
echo  Application is running at:  http://localhost
echo  To stop:                    start.bat stop
echo  To view logs:               start.bat logs
echo.
goto :end

:: ── Stop ───────────────────────────────────────────────────────────────────────
:stop
echo.
echo  [STOP] Stopping Docker Compose services...
cd /d "%~dp0"
docker compose down
echo  Done.
goto :end

:: ── Logs ───────────────────────────────────────────────────────────────────────
:logs
cd /d "%~dp0"
docker compose logs -f
goto :end

:end
endlocal
