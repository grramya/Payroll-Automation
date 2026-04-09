#!/usr/bin/env bash
# start.sh — Development and production launcher (Linux / macOS)
set -euo pipefail

MODE=${1:-dev}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

case "$MODE" in

  dev)
    echo ""
    echo " [DEV] Starting Payroll JE Automation in development mode..."
    echo ""
    # Backend with hot-reload (background)
    cd "$ROOT/backend"
    uvicorn app_api:app --reload --port 8000 &
    BACKEND_PID=$!
    echo " Backend PID: $BACKEND_PID"

    # Frontend dev server (foreground — Ctrl+C stops both)
    cd "$ROOT/frontend"
    [[ ! -d node_modules ]] && npm install
    npm run dev

    # Cleanup backend when frontend exits
    kill "$BACKEND_PID" 2>/dev/null || true
    ;;

  prod)
    echo ""
    echo " [PROD] Building and starting via Docker Compose..."
    echo ""
    if [[ ! -f "$ROOT/backend/.env" ]]; then
      echo " ERROR: backend/.env not found."
      echo " Copy backend/.env.example → backend/.env and fill in your values."
      exit 1
    fi
    cd "$ROOT"
    docker compose up --build -d
    echo ""
    echo " Application is running at:  http://localhost"
    echo " To stop:                    ./start.sh stop"
    echo " To view logs:               ./start.sh logs"
    echo ""
    ;;

  stop)
    echo " [STOP] Stopping Docker Compose services..."
    cd "$ROOT"
    docker compose down
    echo " Done."
    ;;

  logs)
    cd "$ROOT"
    docker compose logs -f
    ;;

  *)
    echo ""
    echo " Usage: ./start.sh [dev | prod | stop | logs]"
    echo ""
    echo "   dev   Start backend + frontend in development mode (hot-reload)"
    echo "   prod  Build and run via Docker Compose (production)"
    echo "   stop  Stop Docker Compose services"
    echo "   logs  Tail Docker Compose logs"
    echo ""
    exit 1
    ;;
esac
