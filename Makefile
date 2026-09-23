# =============================================================================
# Gomo6 — Makefile
# =============================================================================

SHELL := /bin/bash
COMPOSE := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.PHONY: help dev attach dev-stop install env infra backend web stop tools \
        seed reset-db psql redis-cli logs test lint typecheck doctor

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[1;36m%-12s\033[0m %s\n", $$1, $$2}'

dev: ## One-command dev environment: infra + backend + frontends (tmux/overmind)
	@bash scripts/dev.sh

attach: ## Attach to the `make dev` tmux session
	@tmux attach -t gomo6-dev 2>/dev/null || echo "No dev session — run 'make dev' first."

dev-stop: ## Stop the `make dev` processes (kills the tmux session; infra keeps running)
	@tmux kill-session -t gomo6-dev 2>/dev/null && echo "✓ dev processes stopped" || echo "No dev session running."

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

seed: ## Populate the local DB with demo data (idempotent; backend must be running)
	@bash scripts/seed.sh

reset-db: ## DESTRUCTIVE: delete dev Postgres/Redis/Garage volumes and stop infra
	@printf '\033[1;33m⚠  This deletes ALL local dev data (Postgres/Redis/Garage). Continue? [y/N] \033[0m'; \
	read -r ans; \
	case "$$ans" in y|Y) ;; *) echo "  aborted."; exit 1 ;; esac; \
	$(COMPOSE) down -v && echo "✓ dev volumes removed — next 'make dev' re-initialises from scratch"

psql: ## Open psql on the dev database
	@set -a; . ./.env; set +a; $(COMPOSE) exec postgres psql -U gomo6 -d gomo6

redis-cli: ## Open redis-cli on the dev Redis
	@set -a; . ./.env; set +a; $(COMPOSE) exec redis redis-cli -a "$$REDIS_PASSWORD"

logs: ## Tail infra logs (Postgres/Redis/Garage)
	$(COMPOSE) logs -f --tail=100 postgres redis garage

stop: ## Stop dev infra containers (volumes kept)
	$(COMPOSE) down

tools: ## Install optional dev tooling (overmind process manager)
	brew install overmind

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

doctor: ## Check local dev prerequisites and report what is missing
	@bash scripts/doctor.sh
