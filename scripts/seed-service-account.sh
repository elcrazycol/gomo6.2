#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# seed-service-account.sh — create ONLY the official @gomo6 service account.
# No demo users, no content. Idempotent: safe to re-run.
#
# The account is notification-only: interactive login is refused by the
# backend, its messenger is cut off, everything it publishes goes through
# the admin panel (dev-dashboard → «Официалка»). It is created with an
# unusable password hash ('!') — there is deliberately no secret to steal.
#
# Usage:  bash scripts/seed-service-account.sh
# Requires: dev infra running (postgres reachable directly or via compose).
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

GREEN='\033[32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*" >&2; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }

SEED_DB_URL="${DATABASE_URL:-}"
if [ -z "$SEED_DB_URL" ] && [ -f .dev.env ]; then
    # shellcheck disable=SC1091
    SEED_DB_URL="$( (set -a; . ./.dev.env 2>/dev/null; printf '%s' "${DATABASE_URL:-}") || true )"
fi
[ -n "$SEED_DB_URL" ] || die "DATABASE_URL not found (run with .dev.env present)"

# seed_psql runs SQL against dev Postgres without requiring a local psql:
# direct connection first, otherwise via `docker compose exec postgres`.
seed_psql() { # SQL -> status
    local sql="$1"
    if command -v psql >/dev/null 2>&1; then
        psql "$SEED_DB_URL" -q -v ON_ERROR_STOP=1 -c "$sql" >/dev/null
        return $?
    fi
    if command -v docker >/dev/null 2>&1; then
        local pgpw
        pgpw="$(printf '%s' "$SEED_DB_URL" | sed -n 's|.*://[^:]*:\([^@]*\)@.*|\1|p')"
        if [ -n "$pgpw" ] && docker compose exec -T postgres true >/dev/null 2>&1; then
            docker compose exec -T -e PGPASSWORD="$pgpw" postgres \
                psql -U gomo6 -d gomo6 -q -v ON_ERROR_STOP=1 -c "$sql" >/dev/null
            return $?
        fi
    fi
    return 127
}

# NOTE: `... | head -c 4` dies with SIGPIPE (141) once head exits, which is
# fatal under `set -o pipefail` — `|| true` absorbs it (output is complete).
rand4() { LC_ALL=C tr -dc 'A-Z0-9' </dev/urandom | head -c 4 || true; }
SVC_WALLET="GM6-$(rand4)-$(rand4)"

if SVC_SEED_OUT="$(seed_psql "INSERT INTO users (username, display_name, email, password_hash, domain, wallet_address, is_service)
VALUES ('gomo6', 'gomo6 • уведомления', 'service@gomo6.local', '!', 'localhost:8080', '${SVC_WALLET}', true)
ON CONFLICT (username) DO NOTHING;
UPDATE users SET is_service = true, display_name = COALESCE(NULLIF(display_name, ''), 'gomo6 • уведомления') WHERE username = 'gomo6';" 2>&1)"; then
    ok "service account @gomo6 ready (notifications, login disabled)"
else
    rc=$?
    if [ "$rc" -eq 127 ]; then
        die "no psql and no postgres container — start infra: make infra"
    else
        die "could not seed @gomo6: $SVC_SEED_OUT"
    fi
fi
