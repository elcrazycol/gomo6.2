#!/usr/bin/env bash
# Print the LAN URL for opening the running dev site on a phone.
#
# The Vite dev server binds to all interfaces (`server.host: "::"` in
# apps/web/vite.config.ts) and proxies /api, /ws, /storage … to the backend, so
# a phone on the same Wi-Fi can use the app end-to-end without any extra setup.
set -euo pipefail

PORT="${WEB_PORT:-8081}"

# ── Find the LAN IP ─────────────────────────────────────────────────────────
ip=""
if command -v ipconfig >/dev/null 2>&1; then
  # macOS: the first active interface with an IPv4 address.
  for iface in en0 en1 en2 bridge0; do
    ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    [ -n "$ip" ] && break
  done
fi
if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
  # Linux: `hostname -I` lists all addresses; take the first non-loopback one.
  ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -Ev '^$|^127\.' | head -1 || true)"
fi
if [ -z "$ip" ]; then
  echo "✗ Не удалось определить LAN-IP. Телефон должен быть в той же Wi-Fi сети." >&2
  exit 1
fi

url="http://${ip}:${PORT}"

echo "Открой на телефоне (та же Wi-Fi сеть):"
echo
echo "    ${url}"
echo

# ── Reachability probe ──────────────────────────────────────────────────────
probe() {
  local path="$1" label="$2"
  if command -v curl >/dev/null 2>&1; then
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "${url}${path}" || echo 000)"
    if [ "$code" = "200" ]; then
      printf '  \033[0;32m✔\033[0m %-10s %s\n' "$label" "$code"
    else
      printf '  \033[1;33m⚠\033[0m %-10s %s\n' "$label" "$code"
    fi
  fi
}

echo "Проверка доступности:"
probe "/" "web"
probe "/api/v1/feed?limit=1" "api"

echo
echo "Подсказки:"
echo "  • Если не открывается — проверь, что Mac и телефон в одной Wi-Fi сети,"
echo "    и что 'make dev' запущен (web на :${PORT})."
echo "  • macOS может спросить про входящие соединения для node — разреши."
echo "  • Демо-логин: demo@gomo6.local / gomo6-demo-9f3k2x"
