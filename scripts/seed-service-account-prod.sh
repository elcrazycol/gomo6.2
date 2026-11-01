#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# seed-service-account-prod.sh — создать @gomo6 НА ПРОДЕ без редеплоя.
#
# Запуск ТОЛЬКО на VPS, в каталоге репозитория:
#   scp scripts/seed-service-account-prod.sh you@VPS:/tmp/
#   ssh you@VPS
#   cd /root/gomo6.2   # или /home/*/gomo6.2 — скрипт найдёт сам
#   bash /tmp/seed-service-account-prod.sh
#
# Что делает: применяет DDL миграции 154 (ADD COLUMN IF NOT EXISTS — старое
# API его не замечает) и создаёт пользователя с is_service=true и
# невалидным хешем пароля ('!' — bcrypt такое никогда не подтвердит).
#
# Почему это безопасно БЕЗ нового кода: пользователь с хешем '!' не может
# залогиниться ни на какой версии бэкенда (bcrypt такое никогда не подтвердит),
# сессий у него нет и быть не может, а без сессий месседжер недоступен в
# принципе. Энфорсмент (403 на логин,
# вырубленный месседжер, админка) включится сам после мержа PR и деплоя —
# backend при старте сам применит (уже применённый вручную) 154 и запишет его
# в schema_migrations. Идемпотентно: можно гонять повторно.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

GREEN='\033[32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*" >&2; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

# --- repo + prod env (как в restart-service.sh) ---
for d in /root/gomo6.2 /home/*/gomo6.2; do
    [ -d "$d" ] && [ -f "$d/docker-compose.yml" ] && { cd "$d"; break; }
done
[ -f docker-compose.yml ] || die "gomo6.2 repo not found (need /root/gomo6.2 with docker-compose.yml)"

[ -f .env ] || die ".env not found in $(pwd) — prod secrets live there"
set -a
# shellcheck disable=SC1091
. ./.env
set +a
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD missing in .env}"

command -v docker >/dev/null 2>&1 || die "docker not found"
docker compose exec -T postgres true >/dev/null 2>&1 || die "postgres container is not running (docker compose exec failed)"

# --- DDL миграции 154 (буквально её содержимое) + пользователь ---
read -r -d '' SQL <<'EOSQL' || true
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;
EOSQL
# NOTE: tr|head умирает по SIGPIPE (141) под set -o pipefail — `|| true` гасит.
rand4() { LC_ALL=C tr -dc 'A-Z0-9' </dev/urandom | head -c 4 || true; }
SVC_WALLET="GM6-$(rand4)-$(rand4)"
SQL="${SQL}
INSERT INTO users (username, display_name, email, password_hash, domain, wallet_address, is_service)
VALUES ('gomo6', 'gomo6 • уведомления', 'service@gomo6.local', '!', 'localhost:8080', '${SVC_WALLET}', true)
ON CONFLICT (username) DO NOTHING;
UPDATE users SET is_service = true, display_name = COALESCE(NULLIF(display_name, ''), 'gomo6 • уведомления') WHERE username = 'gomo6';"

if docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
    psql -U gomo6 -d gomo6 -q -v ON_ERROR_STOP=1 -c "$SQL"; then
    ok "service account @gomo6 ready on PROD (inert until deploy, enforcement after PR merge)"
else
    die "psql failed — postgres up? password from .env correct?"
fi
