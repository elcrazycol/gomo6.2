#!/usr/bin/env bash
# =============================================================================
# Gomo6 — Generate all required keys for .env
# =============================================================================
# Usage:
#   ./scripts/generate-keys.sh              # generate and write to .env
#   ./scripts/generate-keys.sh --dry-run    # print without writing
#   ./scripts/generate-keys.sh --quiet      # write without printing secret summary
#   ./scripts/generate-keys.sh --force      # regenerate every key (dangerous)
#
# Existing non-empty keys in .env are preserved. Missing or empty required
# values are generated, including POSTGRES_PASSWORD required by Compose.
# =============================================================================

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Args ────────────────────────────────────────────────────────────────────
DRY_RUN=false
FORCE=false
QUIET=false
ENV_FILE=".env"

for arg in "$@"; do
    case "$arg" in
        --dry-run)  DRY_RUN=true ;;
        --force)    FORCE=true ;;
        --quiet)    QUIET=true ;;
        --help|-h)
            echo "Usage: $0 [--dry-run] [--quiet] [--force] [.env-file]"
            echo ""
            echo "Options:"
            echo "  --dry-run   Print the resulting file without writing"
            echo "  --quiet     Write without printing secret values or progress"
            echo "  --force     Regenerate ALL keys (invalidates existing sessions)"
            echo "  .env-file   Target file (default: .env)"
            exit 0
            ;;
        --*)        echo "Unknown option: $arg" >&2; exit 1 ;;
        *)          ENV_FILE="$arg" ;;
    esac
done

# ── Helpers ─────────────────────────────────────────────────────────────────
gen_hex() {
    local bytes=$1
    openssl rand -hex "$bytes" 2>/dev/null
}

say() {
    [ "$QUIET" = true ] || printf '%b\n' "$*"
}

# ── Generate candidates ─────────────────────────────────────────────────────
JWT_SECRET=$(gen_hex 32)
FEDERATION_KEY=$(gen_hex 16)
MESSENGER_ENCRYPTION_KEY=$(gen_hex 32)
REDIS_PASSWORD=$(gen_hex 16)

# If this is an existing Docker deployment and .env lost the database secret,
# preserve the password with which the running PostgreSQL container was
# initialized. Generating a new value would not change PostgreSQL's role
# password and would make the backend unable to connect. The value is never
# printed. A new random password is used only when no existing container can
# provide one (for example, on a fresh install).
POSTGRES_PASSWORD_FROM_CONTAINER=""
if command -v docker >/dev/null 2>&1; then
    env_dir=$(cd "$(dirname -- "$ENV_FILE")" && pwd)
    postgres_container=$(docker ps -aq \
        --filter label=com.docker.compose.service=postgres \
        --filter label=com.docker.compose.project.working_dir="$env_dir" \
        | head -n 1 || true)
    if [ -n "$postgres_container" ]; then
        POSTGRES_PASSWORD_FROM_CONTAINER=$(docker inspect \
            --format '{{range .Config.Env}}{{println .}}{{end}}' "$postgres_container" 2>/dev/null \
            | awk -F= '$1 == "POSTGRES_PASSWORD" {sub(/^[^=]*=/, ""); print; exit}' || true)
    fi
fi
if [ -n "$POSTGRES_PASSWORD_FROM_CONTAINER" ]; then
    POSTGRES_PASSWORD="$POSTGRES_PASSWORD_FROM_CONTAINER"
else
    # Never silently replace a database password when a persistent Compose
    # volume already exists. The caller must restore the known password (or
    # explicitly change it inside PostgreSQL) before starting the stack.
    postgres_volume=""
    if command -v docker >/dev/null 2>&1; then
        # Volume labels do not reliably include the Compose working directory.
        # Treat any persistent postgres_data volume as production data and fail
        # closed rather than risk generating an incompatible password.
        postgres_volume=$(docker volume ls -q \
            --filter label=com.docker.compose.volume=postgres_data \
            | head -n 1 || true)
    fi
    if [ -n "$postgres_volume" ]; then
        echo "ERROR: PostgreSQL volume exists but its password is not available in the existing .env/container." >&2
        echo "Restore the known POSTGRES_PASSWORD before starting the production stack." >&2
        exit 1
    fi
    POSTGRES_PASSWORD=$(gen_hex 32)
fi
unset POSTGRES_PASSWORD_FROM_CONTAINER

if [ "$QUIET" = false ]; then
    say "${CYAN}🔑 Generating secure keys...${NC}"
    say "  ${GREEN}✓${NC} JWT_SECRET              (64 hex chars)"
    say "  ${GREEN}✓${NC} FEDERATION_KEY          (32 hex chars)"
    say "  ${GREEN}✓${NC} MESSENGER_ENCRYPTION_KEY (64 hex chars)"
    say "  ${GREEN}✓${NC} REDIS_PASSWORD           (32 hex chars)"
    say "  ${GREEN}✓${NC} POSTGRES_PASSWORD        (64 hex chars)"
    say ""
fi

# ── Build .env content ──────────────────────────────────────────────────────
if [ -f "$ENV_FILE" ] && [ "$FORCE" = false ]; then
    say "${CYAN}📝 Merging with existing $ENV_FILE...${NC}"
    CONTENT=$(cat "$ENV_FILE")
else
    CONTENT="# =============================================================================
# Gomo6 — Environment Configuration
# Generated by scripts/generate-keys.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)
# =============================================================================
# DO NOT commit this file to git. It contains production secrets.
# =============================================================================

# ── Domain ──────────────────────────────────────────────────────────────────
DOMAIN=localhost

# ── Security ────────────────────────────────────────────────────────────────
# JWT signing secret (HS256, 32 bytes)
JWT_SECRET=${JWT_SECRET}

# Federation key for ActivityPub interop (16 bytes)
FEDERATION_KEY=${FEDERATION_KEY}

# ── Environment ─────────────────────────────────────────────────────────────
ENVIRONMENT=production

# ── Messenger Encryption ────────────────────────────────────────────────────
# AES-256-GCM key for message encryption at rest (32 bytes)
MESSENGER_ENCRYPTION_KEY=${MESSENGER_ENCRYPTION_KEY}

# ── Redis ───────────────────────────────────────────────────────────────────
REDIS_PASSWORD=${REDIS_PASSWORD}

# ── PostgreSQL ──────────────────────────────────────────────────────────────
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
"
fi

# Set a key when it is missing or present with an empty value. Values generated
# here are hex-only, so replacing a simple KEY=value line is unambiguous.
set_or_add() {
    local key=$1
    local value=$2
    local existing
    existing=$(printf '%s\n' "$CONTENT" | awk -F= -v key="$key" '$0 ~ "^" key "=" {sub(/^[^=]*=/, ""); print; exit}')

    if [ "$FORCE" = true ] || [ -z "$existing" ]; then
        if printf '%s\n' "$CONTENT" | grep -q "^${key}="; then
            CONTENT=$(printf '%s\n' "$CONTENT" | awk -v key="$key" -v value="$value" '
                $0 ~ ("^" key "=") { if (!replaced) { print key "=" value; replaced=1 }; next }
                { print }
                END { if (!replaced) print key "=" value }
            ')
            say "  ${GREEN}↻${NC} Set ${key}"
        else
            CONTENT="${CONTENT}
${key}=${value}"
            say "  ${GREEN}+${NC} Added ${key}"
        fi
    else
        say "  ${YELLOW}=${NC} Kept existing ${key}"
    fi
}

set_or_add "JWT_SECRET" "$JWT_SECRET"
set_or_add "FEDERATION_KEY" "$FEDERATION_KEY"
set_or_add "MESSENGER_ENCRYPTION_KEY" "$MESSENGER_ENCRYPTION_KEY"
set_or_add "REDIS_PASSWORD" "$REDIS_PASSWORD"
set_or_add "POSTGRES_PASSWORD" "$POSTGRES_PASSWORD"
set_or_add "DOMAIN" "localhost"
set_or_add "ENVIRONMENT" "production"

# ── Output ──────────────────────────────────────────────────────────────────
if [ "$DRY_RUN" = true ]; then
    if [ "$QUIET" = false ]; then
        say "${CYAN}DRY RUN — would write to $ENV_FILE:${NC}"
        printf '%s\n' "$CONTENT"
    fi
else
    # Write beside the destination and then replace it, so an interrupted run
    # cannot leave a partially-written .env. The file remains mode 600.
    env_dir=$(dirname -- "$ENV_FILE")
    env_base=$(basename -- "$ENV_FILE")
    tmp_file=$(mktemp "${env_dir}/.${env_base}.tmp.XXXXXX")
    trap 'rm -f "$tmp_file"' EXIT
    umask 077
    printf '%s\n' "$CONTENT" > "$tmp_file"
    chmod 600 "$tmp_file"
    mv -f "$tmp_file" "$ENV_FILE"
    trap - EXIT
    say "${GREEN}✅ Keys written to $ENV_FILE (mode 600)${NC}"
fi

if [ "$QUIET" = false ]; then
    say ""
    say "${CYAN}📋 Required variables are present. Existing non-empty values were preserved.${NC}"
    say "${YELLOW}⚠  Do not use --force in production unless you intend to rotate JWT or messenger keys.${NC}"
fi
