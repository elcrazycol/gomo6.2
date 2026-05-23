#!/usr/bin/env bash
# =============================================================================
# Gomo6 — Ubuntu Deployment Script
# =============================================================================
# One-command deployment for Ubuntu (22.04+). Installs Docker if missing,
# configures domains, and starts the full gomo6 stack.
#
# Usage:
#   curl -fsSL https://git.example.com/gomo6/raw/main/deploy.sh | bash
#   # or locally:
#   ./deploy.sh
#
# Requirements: Ubuntu 22.04+, root or sudo access, ports 80/443 free.
# =============================================================================
set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

# ── Helpers ─────────────────────────────────────────────────────────────────
log()  { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
err()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }
info() { printf "${BLUE}ℹ${NC} %s\n" "$*"; }
header() { printf "\n${CYAN}══════════════════════════════════════════════════════${NC}\n"; }
step() { printf "\n${BOLD}[%s]${NC} %s\n" "$1" "$2"; }

# ── Pre-flight checks ────────────────────────────────────────────────────────
preflight_checks() {
    step "1/8" "Проверка системы"

    # OS check
    if [ ! -f /etc/os-release ]; then
        err "Этот скрипт предназначен для Ubuntu Linux."
    fi
    . /etc/os-release
    if [ "${ID:-}" != "ubuntu" ]; then
        warn "Скрипт оптимизирован для Ubuntu, но может работать на других дистрибутивах."
    fi
    info "ОС: $NAME $VERSION_ID"

    # Root/sudo check
    if [ "$(id -u)" -ne 0 ]; then
        if command -v sudo >/dev/null 2>&1; then
            warn "Некоторые шаги требуют sudo. Если будет запрошен пароль — введите его."
        else
            err "Запустите скрипт с sudo или от root."
        fi
    fi

    # Ports check
    info "Проверка портов 80 и 443..."
    for port in 80 443; do
        if ss -tlnp "sport = :$port" 2>/dev/null | grep -q ":$port "; then
            warn "Порт $port уже занят. Убедитесь, что он свободен и повторите попытку."
        else
            log "Порт $port свободен"
        fi
    done

    # Architecture
    ARCH=$(uname -m)
    info "Архитектура: $ARCH"
}

# ── Install Docker ──────────────────────────────────────────────────────────
install_docker() {
    step "2/8" "Установка Docker"

    if command -v docker >/dev/null 2>&1; then
        log "Docker уже установлен: $(docker --version)"
    else
        info "Docker не найден. Устанавливаю..."
        if ! command -v curl >/dev/null 2>&1; then
            apt-get update -qq && apt-get install -y -qq curl
        fi
        curl -fsSL https://get.docker.com | bash
        log "Docker установлен: $(docker --version)"
    fi

    # Check Docker Compose (v2 plugin) — обязателен
    if ! docker compose version >/dev/null 2>&1; then
        if docker-compose --version >/dev/null 2>&1; then
            err "Установите Docker Compose v2 (plugin). docker-compose v1 не поддерживается.\n  Выполните: sudo apt-get install docker-compose-v2"
        fi
        err "Docker Compose не найден. Установите Docker Compose v2.\n  Выполните: sudo apt-get install docker-compose-v2"
    fi
    log "Docker Compose: $(docker compose version)"
}

# ── Clone / update repo ─────────────────────────────────────────────────────
clone_repo() {
    step "3/8" "Загрузка проекта"

    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    # If we're inside the repo already, use current dir
    if [ -f "$SCRIPT_DIR/docker-compose.yml" ] && [ -f "$SCRIPT_DIR/Caddyfile" ]; then
        PROJECT_DIR="$SCRIPT_DIR"
        info "Проект уже загружен: $PROJECT_DIR"
        return
    fi

    # Prompt for repo URL or auto-detect
    REPO_URL="${REPO_URL:-}"
    if [ -z "$REPO_URL" ]; then
        # Try to detect from git remote if inside a git repo
        if git remote get-url origin 2>/dev/null | grep -q gomo6; then
            REPO_URL="$(git remote get-url origin)"
        fi
    fi
    if [ -z "$REPO_URL" ]; then
        printf "${CYAN}Ссылка на Git-репозиторий (Enter = git@gitlab.com:scramble22/gomo6.git):${NC} "
        read -r input_repo
        REPO_URL="${input_repo:-git@gitlab.com:scramble22/gomo6.git}"
    fi

    PROJECT_DIR="/opt/gomo6"
    if [ -d "$PROJECT_DIR" ]; then
        info "Проект уже загружен в $PROJECT_DIR. Обновляю..."
        cd "$PROJECT_DIR"
        git pull
    else
        info "Клонирую репозиторий в $PROJECT_DIR..."
        if [ ! -d /opt ]; then mkdir -p /opt; fi
        git clone "$REPO_URL" "$PROJECT_DIR"
        cd "$PROJECT_DIR"
    fi
    log "Проект готов: $PROJECT_DIR"
}

# ── Configure deployment ────────────────────────────────────────────────────
configure_deployment() {
    step "4/8" "Настройка конфигурации"

    # ── Domain ────────────────────────────────────────────────────────────
    printf "${CYAN}Домен для развёртывания (Enter = localhost для локальной разработки):${NC} "
    read -r input_domain
    DOMAIN="${input_domain:-localhost}"

    if [ "$DOMAIN" != "localhost" ]; then
        # Production mode
        MODE="production"
        printf "${CYAN}Email для Let's Encrypt (для HTTPS-сертификатов):${NC} "
        read -r input_email
        EMAIL="${input_email:-}"
        if [ -z "$EMAIL" ]; then
            warn "Email не указан. Caddy не сможет выпустить Let's Encrypt сертификат."
            warn "HTTPS можно будет настроить позже вручную в Caddyfile."
        else
            info "Caddy автоматически получит TLS-сертификаты для $DOMAIN"
        fi
    else
        MODE="development"
        info "Локальный режим. Сайты будут доступны на:"
        info "  http://localhost         — основной сайт"
        info "  http://docs.localhost    — документация"
        info "  http://dev.localhost     — Dev Dashboard"
    fi

    # ── JWT Secret ─────────────────────────────────────────────────────────
    printf "${CYAN}JWT_SECRET (Enter = сгенерировать случайный 64-символьный ключ):${NC} "
    read -r input_jwt
    if [ -z "$input_jwt" ]; then
        JWT_SECRET="$(openssl rand -hex 32 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(32))' 2>/dev/null || tr -dc 'a-f0-9' < /dev/urandom | head -c 64)"
        log "JWT_SECRET сгенерирован (сохраните его для восстановления!)"
    else
        JWT_SECRET="$input_jwt"
    fi

    # ── Federation Key ─────────────────────────────────────────────────────
    printf "${CYAN}FEDERATION_KEY (Enter = сгенерировать):${NC} "
    read -r input_fed
    if [ -z "$input_fed" ]; then
        FEDERATION_KEY="$(openssl rand -hex 16 2>/dev/null || python3 -c 'import secrets; print(secrets.token_hex(16))' 2>/dev/null || tr -dc 'a-f0-9' < /dev/urandom | head -c 32)"
        log "FEDERATION_KEY сгенерирован"
    else
        FEDERATION_KEY="$input_fed"
    fi

    # ── Garage keys (can use defaults) ──────────────────────────────────────
    info "Garage S3 использует встроенные ключи. При необходимости замените их в .env."
}

# ── DNS check ───────────────────────────────────────────────────────────────
check_dns() {
    if [ "$DOMAIN" = "localhost" ]; then
        return
    fi

    step "5/9" "Проверка DNS-записей"

    info "Проверка DNS для домена: $DOMAIN"

    # Определяем IP сервера
    SERVER_IP=""
    for ip_service in "ifconfig.me" "api.ipify.org" "checkip.amazonaws.com"; do
        SERVER_IP=$(curl -fsS --max-time 5 "$ip_service" 2>/dev/null || true)
        if [ -n "$SERVER_IP" ] && echo "$SERVER_IP" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
            break
        fi
        SERVER_IP=""
    done

    if [ -z "$SERVER_IP" ]; then
        warn "Не удалось определить внешний IP сервера (проверьте интернет-соединение)"
        return
    fi
    log "Внешний IP сервера: $SERVER_IP"

    # DNS-резолвер на выбор
    RESOLVE_CMD=""
    for cmd in "dig" "host" "nslookup"; do
        if command -v "$cmd" >/dev/null 2>&1; then
            RESOLVE_CMD="$cmd"
            break
        fi
    done

    if [ -z "$RESOLVE_CMD" ]; then
        warn "Не найден DNS-резолвер (dig/host/nslookup). Установите dnsutils."
        info "Пропускаю проверку DNS."
        return
    fi

    # Функция резолва в зависимости от команды
    resolve_ip() {
        local hostname="$1"
        case "$RESOLVE_CMD" in
            dig)
                # Получаем все A-записи и проверяем, есть ли IP сервера среди них (round-robin DNS)
                local all_a_records
                all_a_records=$(dig +short "$hostname" A 2>/dev/null)
                if echo "$all_a_records" | grep -qF "$SERVER_IP"; then
                    echo "$SERVER_IP"
                else
                    echo "$all_a_records" | head -1
                fi
                ;;
            host)   host "$hostname" 2>/dev/null | grep "has address" | head -1 | awk '{print $NF}' ;;
            nslookup) nslookup "$hostname" 2>/dev/null | grep -E '^Address: ' | tail -1 | awk '{print $2}' ;;
        esac
    }

    # Проверяем три домена
    local all_ok=true
    for sub in "" "docs" "dev"; do
        if [ -z "$sub" ]; then
            fqdn="$DOMAIN"
            label="Основной домен"
        else
            fqdn="$sub.$DOMAIN"
            label="Поддомен $sub"
        fi

        local resolved
        resolved=$(resolve_ip "$fqdn")
        if [ -z "$resolved" ]; then
            warn "$label ($fqdn): DNS не найден"
            all_ok=false
        elif [ "$resolved" = "$SERVER_IP" ]; then
            log "$label ($fqdn) → ${SERVER_IP} ✅"
        elif echo "$resolved" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'; then
            warn "$label ($fqdn) → ${resolved} (ожидался ${SERVER_IP})"
            all_ok=false
        else
            warn "$label ($fqdn): неожиданный ответ — ${resolved}"
            all_ok=false
        fi
    done

    if [ "$all_ok" = false ]; then
        warn "Некоторые DNS-записи не настроены или указывают на другой IP."
        warn "Это не блокирует развёртывание, но сайты будут недоступны по домену,"
        warn "пока вы не создадите A-записи для: @ → $SERVER_IP, docs → $SERVER_IP, dev → $SERVER_IP"
        printf "${YELLOW}Продолжить развёртывание? (Y/n):${NC} "
        read -r continue_dns
        case "$continue_dns" in
            [nN]|[nN][oO]) err "Развёртывание отменено пользователем" ;;
            *) info "Продолжаем..." ;;
        esac
    else
        log "Все DNS-записи корректны"
    fi
}

# ── Create .env ──────────────────────────────────────────────────────────────
create_env() {
    step "6/9" "Создание .env файла"

    # Build ALLOWED_ORIGINS
    if [ "$DOMAIN" = "localhost" ]; then
        ALLOWED_ORIGINS="http://localhost,http://docs.localhost,http://dev.localhost"
    else
        ALLOWED_ORIGINS="https://${DOMAIN},http://${DOMAIN},https://docs.${DOMAIN},http://docs.${DOMAIN},https://dev.${DOMAIN},http://dev.${DOMAIN}"
    fi

    # Спрашиваем подтверждение, если .env уже существует
    if [ -f .env ]; then
        printf "${YELLOW}.env уже существует. Перезаписать? (y/N):${NC} "
        read -r overwrite
        case "$overwrite" in
            [yY]|[yY][eE][sS]) : ;;
            *) info ".env оставлен без изменений"; return ;;
        esac
    fi

    cat > .env << ENVEOF
# =============================================================================
# Gomo6 — Production Configuration
# =============================================================================
# Сгенерировано deploy.sh $(date '+%Y-%m-%d %H:%M:%S')
# =============================================================================

# ── Domain ──────────────────────────────────────────────────────────────────
DOMAIN=${DOMAIN}

# ── Security ────────────────────────────────────────────────────────────────
JWT_SECRET=${JWT_SECRET}
FEDERATION_KEY=${FEDERATION_KEY}

# ── Environment ─────────────────────────────────────────────────────────────
ENVIRONMENT=${MODE}

# ── Allowed CORS origins ────────────────────────────────────────────────────
ALLOWED_ORIGINS=${ALLOWED_ORIGINS}

# ── Database (PostgreSQL) ───────────────────────────────────────────────────
# Пароль для БД задаётся в docker-compose.yml. При необходимости переопределите:
# POSTGRES_PASSWORD=gomo6password

# ── S3 / Garage ─────────────────────────────────────────────────────────────
# Ключи для Garage S3 заданы в docker-compose.yml.
# При необходимости переопределите здесь:
# GARAGE_S3_ACCESS_KEY=
# GARAGE_S3_SECRET_KEY=
GARAGE_S3_PUBLIC_ENDPOINT=http://${DOMAIN}:3900
ENVEOF

    # Защищаем файл с секретами
    chmod 600 .env

    log ".env файл создан (chmod 600)"
    info "Важные секреты (сохраните их надёжно!):"
    info "  JWT_SECRET=${JWT_SECRET}"
    info "  FEDERATION_KEY=${FEDERATION_KEY}"
}

# ── Build and start ─────────────────────────────────────────────────────────
start_services() {
    step "7/9" "Запуск сервисов"

    # ── Configure Caddy for production TLS ────────────────────────────────
    if [ "$DOMAIN" != "localhost" ] && [ -n "${EMAIL:-}" ]; then
        info "Настройка Caddy для HTTPS (TLS)..."
        # Включаем auto_https и добавляем email для Let's Encrypt
        if grep -q 'auto_https off' Caddyfile; then
            sed -i 's/auto_https off/auto_https on/' Caddyfile
            log "Caddy: auto_https включён"
        fi
        # Добавляем email, если его ещё нет
        if ! grep -q "email " Caddyfile 2>/dev/null; then
            sed -i "/^{/a\\    email ${EMAIL}" Caddyfile
            log "Caddy: email $EMAIL добавлен для Let's Encrypt"
        fi
    fi

    # Pull images first for faster startup
    info "Загрузка Docker-образов (первый раз может занять время)..."
    docker compose pull 2>&1 | tail -5 || true

    # Build and start
    info "Сборка и запуск контейнеров..."
    docker compose up -d --build 2>&1 | tail -10

    log "Контейнеры запущены"
}

# ── Wait for health ─────────────────────────────────────────────────────────
wait_for_services() {
    step "8/9" "Ожидание готовности сервисов"

    info "Ожидание healthcheck'ов (до 120 секунд)..."

    # List all services we care about
    SERVICES=("backend" "web" "docs" "dev-dashboard" "postgres" "redis")
    ALL_HEALTHY=true

    for service in "${SERVICES[@]}"; do
        local elapsed=0
        local healthy=false
        while [ $elapsed -lt 120 ]; do
            status=$(docker compose ps --format '{{.Status}}' "$service" 2>/dev/null || true)
            case "$status" in
                *healthy*)  healthy=true; break ;;
                *unhealthy*) warn "$service: unhealthy"; break ;;
                *) ;;
            esac
            sleep 3
            elapsed=$((elapsed + 3))
        done

        if [ "$healthy" = true ]; then
            log "$service — здоров"
        else
            warn "$service — не прошёл healthcheck за 120 секунд"
            docker compose logs --tail=5 "$service" 2>/dev/null || true
            ALL_HEALTHY=false
        fi
    done

    # Brief extra wait for Caddy (depends on all frontends)
    info "Ожидание Caddy..."
    sleep 5

    if [ "$ALL_HEALTHY" = false ]; then
        warn "Некоторые сервисы не прошли healthcheck. Проверьте логи: docker compose logs <service>"
    else
        log "Все сервисы работают!"
    fi
}

# ── Print summary ───────────────────────────────────────────────────────────
print_summary() {
    step "9/9" "Развёртывание завершено!"

    header
    if [ "$DOMAIN" = "localhost" ]; then
        printf "${BOLD}${GREEN}  🌐 Локальный доступ:${NC}\n"
        printf "  ${BOLD}Основной сайт:${NC}      http://localhost\n"
        printf "  ${BOLD}Документация:${NC}       http://docs.localhost\n"
        printf "  ${BOLD}Dev Dashboard:${NC}      http://dev.localhost\n"
        printf "\n"
        info "Для .localhost доменов: браузер сам направляет их на 127.0.0.1."
        info "На Windows может потребоваться настройка /etc/hosts."
    else
        if [ -n "${EMAIL:-}" ]; then
            SCHEME="https"
            info "HTTPS настроен через Let's Encrypt (auto_https on)"
        else
            SCHEME="http"
            warn "HTTPS не настроен. Сайты работают через HTTP."
            warn "Для HTTPS настройте Caddyfile вручную или укажите email при повторном запуске."
        fi
        printf "${BOLD}${GREEN}  🌐 Продакшн доступ:${NC}\n"
        printf "  ${BOLD}Основной сайт:${NC}      ${SCHEME}://${DOMAIN}\n"
        printf "  ${BOLD}Документация:${NC}       ${SCHEME}://docs.${DOMAIN}\n"
        printf "  ${BOLD}Dev Dashboard:${NC}      ${SCHEME}://dev.${DOMAIN}\n"
        printf "\n"
        if [ -n "${EMAIL:-}" ]; then
            info "Let's Encrypt сертификаты будут выпущены автоматически при первом запросе."
        fi
    fi
    header
    printf "\n"
    printf "${BOLD}Полезные команды:${NC}\n"
    printf "  ${CYAN}docker compose ps${NC}          — статус всех сервисов\n"
    printf "  ${CYAN}docker compose logs -f${NC}      — логи всех сервисов\n"
    printf "  ${CYAN}docker compose logs backend${NC} — логи бэкенда\n"
    printf "  ${CYAN}docker compose down${NC}         — остановить все сервисы\n"
    printf "  ${CYAN}docker compose up -d --build${NC} — пересобрать и запустить\n"
    printf "\n"
    printf "${YELLOW}⚠  Важно:${NC}\n"
    printf "  • JWT_SECRET и FEDERATION_KEY сохранены в .env файле.\n"
    printf "  • ${BOLD}Сделайте резервную копию .env!${NC} Без неё все JWT-токены станут невалидны.\n"
    printf "  • Для обновления: git pull && docker compose up -d --build\n"
    printf "\n"
}

# ── Main ─────────────────────────────────────────────────────────────────────
main() {
    printf "\n"
    printf "${CYAN}  ╔══════════════════════════════════════════════╗${NC}\n"
    printf "${CYAN}  ║        ${BOLD}Gomo6 Deployment Script${NC}${CYAN}            ║${NC}\n"
    printf "${CYAN}  ║        Ubuntu + Docker                      ║${NC}\n"
    printf "${CYAN}  ╚══════════════════════════════════════════════╝${NC}\n"
    printf "\n"

    preflight_checks
    install_docker
    clone_repo
    configure_deployment
    check_dns
    create_env
    start_services
    wait_for_services
    print_summary
}

main "$@"
