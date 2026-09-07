# =============================================================================
# Gomo6 — Makefile
# =============================================================================

SHELL := /bin/bash
COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev install env infra backend web stop test lint typecheck

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1;36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## One-command dev environment: infra + backend + frontends on localhost
	@bash scripts/dev.sh

install: ## Install npm dependencies
	npm install --no-audit --no-fund

env: ## Create .env and fill required secrets (preserves existing values)
	@[ -f .env ] || cp .env.example .env
	bash scripts/generate-keys.sh --quiet .env
	bash scripts/generate-garage-config.sh .env

infra: ## Start Postgres + Redis + Garage (dev ports on localhost)
	$(COMPOSE) up -d postgres redis garage

backend: ## Run the Go backend (localhost:8080) — needs `make env` + `make infra` first
	@set -a; . ./.env; set +a; \
	export ENVIRONMENT=development DOMAIN=localhost SERVER_DOMAIN=localhost:8080 SERVER_PORT=8080 \
	  DATABASE_URL="postgres://gomo6:$${POSTGRES_PASSWORD}@127.0.0.1:5432/gomo6?sslmode=disable" \
	  REDIS_URL="redis://:$${REDIS_PASSWORD}@127.0.0.1:6379" \
	  ALLOWED_ORIGINS="http://localhost:8081,http://localhost:3001,http://localhost:3002" \
	  TURNSTILE_DISABLED=1; \
	cd apps/backend-go && go run cmd/server/main.go

web: ## Run frontend dev servers (web :8081, docs :3001, dev-dashboard :3002)
	npm run dev

stop: ## Stop dev infra containers (volumes kept)
	$(COMPOSE) down

test: ## Backend + web tests
	cd apps/backend-go && go test ./...
	npm run test --workspace=@gomo6/web

lint: ## Lint backend + frontend
	cd apps/backend-go && golangci-lint run --timeout=5m ./...
	npm run lint

typecheck: ## TypeScript typecheck (web, dev-dashboard, docs)
	npx tsc --noEmit -p apps/web/tsconfig.app.json
	npx tsc --noEmit -p apps/dev-dashboard/tsconfig.json
	npx tsc --noEmit -p apps/docs/tsconfig.json