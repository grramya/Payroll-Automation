# Payroll JE Automation — cross-platform task runner
# Requires: make (Linux/macOS built-in; Windows: choco install make or scoop install make)
#
# Usage:
#   make dev       Start backend + frontend in development mode
#   make prod      Build and start production Docker Compose stack
#   make staging   Build and start staging Docker Compose stack
#   make stop      Stop all running Docker Compose services
#   make logs      Tail all Docker Compose service logs
#   make build     Build all Docker images without starting
#   make test      Run backend tests + frontend type-check
#   make audit     Run pip-audit + npm audit security scans

.PHONY: dev prod staging stop logs build test audit clean help

COMPOSE     = docker compose
COMPOSE_STG = docker compose -f docker-compose.yml -f docker-compose.staging.yml
ROOT        = $(shell pwd)

## dev: Start backend (uvicorn --reload) and frontend (vite) for development
dev:
	@echo "\n [DEV] Starting Payroll JE Automation...\n"
	@cd backend && uvicorn app_api:app --reload --port 8000 &
	@sleep 2
	@cd frontend && npm run dev

## prod: Build images and start production stack via Docker Compose
prod:
	@test -f backend/.env || (echo "ERROR: backend/.env not found. Copy .env.example and fill in values." && exit 1)
	$(COMPOSE) up --build -d
	@echo "\n Application running at http://localhost\n Grafana at http://localhost:3000\n"

## staging: Build images and start staging stack
staging:
	@test -f backend/.env.staging || (echo "ERROR: backend/.env.staging not found." && exit 1)
	$(COMPOSE_STG) up --build -d
	@echo "\n Staging running at http://localhost:8080\n"

## stop: Stop all Docker Compose services (prod + staging)
stop:
	$(COMPOSE_STG) down 2>/dev/null || $(COMPOSE) down

## logs: Tail all service logs
logs:
	$(COMPOSE) logs -f

## build: Build Docker images without starting
build:
	$(COMPOSE) build

## test: Run backend pytest + frontend TypeScript type-check + vite build
test:
	@echo "\n [TEST] Backend...\n"
	cd backend && python -m pytest -q
	@echo "\n [TEST] Frontend TypeScript...\n"
	cd frontend && npx tsc --noEmit
	@echo "\n [TEST] Frontend build...\n"
	cd frontend && npm run build

## audit: Run security audits on Python and Node dependencies
audit:
	@echo "\n [AUDIT] Python dependencies...\n"
	pip-audit -r backend/requirements.txt
	@echo "\n [AUDIT] Node dependencies...\n"
	cd frontend && npm audit --audit-level=high

## clean: Remove build artefacts and node_modules
clean:
	rm -rf frontend/dist frontend/node_modules
	find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

## help: Show this help
help:
	@grep -E '^## ' Makefile | sed 's/## /  make /'
