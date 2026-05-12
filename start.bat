@echo off
setlocal EnableDelayedExpansion

set MODE=%1
if "%MODE%"=="" set MODE=dev

if /I "%MODE%"=="prod"    goto :prod
if /I "%MODE%"=="dev"     goto :dev
if /I "%MODE%"=="stop"    goto :stop
if /I "%MODE%"=="logs"    goto :logs
if /I "%MODE%"=="staging" goto :staging

echo.
echo  Usage:  start.bat [dev ^| prod ^| staging ^| stop ^| logs]
echo.
echo    dev      Start backend + frontend in development mode (hot-reload)
echo    prod     Build and run via Docker Compose (production)
echo    staging  Build and run via Docker Compose (staging)
echo    stop     Stop all Docker Compose services
echo    logs     Tail Docker Compose logs
echo.
echo  Tip: Use the Makefile with 'make dev', 'make prod', etc. if you have make installed.
echo.
exit /b 1

:: ── Development ───────────────────────────────────────────────────────────────
:dev
echo.
echo  [DEV] Starting Payroll JE Automation in development mode...
echo.

:: Install frontend deps if missing
if not exist "%~dp0frontend\node_modules" (
    echo  Installing frontend dependencies...
    cd /d "%~dp0frontend"
    npm install
)

:: Launch backend via PowerShell in a background job (no new window needed)
echo  Starting FastAPI backend on http://localhost:8000 ...
start /B powershell -NoLogo -NonInteractive -Command ^
    "Set-Location '%~dp0backend'; uvicorn app_api:app --reload --port 8000"

:: Small delay then launch Vite in this window (Ctrl+C stops both)
timeout /t 2 /nobreak >nul
echo  Starting Vite dev server on http://localhost:5173 ...
cd /d "%~dp0frontend"
npm run dev
goto :end

:: ── Production (Docker) ───────────────────────────────────────────────────────
:prod
echo.
echo  [PROD] Building and starting via Docker Compose...
echo.
if not exist "%~dp0backend\.env" (
    echo  ERROR: backend\.env not found.
    echo  Copy .env.example to backend\.env and fill in your values.
    exit /b 1
)
cd /d "%~dp0"
docker compose up --build -d
echo.
echo  Application running at:  http://localhost
echo  Grafana at:              http://localhost:3000
echo  To stop:  start.bat stop
echo  Logs:     start.bat logs
echo.
goto :end

:: ── Staging (Docker) ──────────────────────────────────────────────────────────
:staging
echo.
echo  [STAGING] Building and starting staging environment...
echo.
if not exist "%~dp0backend\.env.staging" (
    echo  ERROR: backend\.env.staging not found.
    echo  Copy .env.example to backend\.env.staging and configure staging values.
    exit /b 1
)
cd /d "%~dp0"
docker compose -f docker-compose.yml -f docker-compose.staging.yml up --build -d
echo.
echo  Staging running at:  http://localhost:8080
echo  To stop:  start.bat stop
echo.
goto :end

:: ── Stop ──────────────────────────────────────────────────────────────────────
:stop
echo.
echo  [STOP] Stopping Docker Compose services...
cd /d "%~dp0"
docker compose -f docker-compose.yml -f docker-compose.staging.yml down 2>nul || docker compose down
echo  Done.
goto :end

:: ── Logs ──────────────────────────────────────────────────────────────────────
:logs
cd /d "%~dp0"
docker compose logs -f
goto :end

:end
endlocal
