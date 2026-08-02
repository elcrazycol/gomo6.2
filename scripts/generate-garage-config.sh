#!/usr/bin/env bash
# Render the Garage runtime configuration without committing credentials.
# Usage: ./scripts/generate-garage-config.sh [.env-file]

set -euo pipefail

ENV_FILE="${1:-.env}"
TEMPLATE_FILE="$(cd "$(dirname "$0")/.." && pwd)/apps/backend-go/garage.toml"
OUTPUT_FILE="$(cd "$(dirname "$0")/.." && pwd)/.garage.toml"

if [ ! -f "$ENV_FILE" ]; then
    echo "ERROR: environment file not found: $ENV_FILE" >&2
    exit 1
fi
if [ ! -f "$TEMPLATE_FILE" ]; then
    echo "ERROR: Garage template not found: $TEMPLATE_FILE" >&2
    exit 1
fi

read_env_value() {
    local key="$1"
    awk -F= -v key="$key" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"
}

GARAGE_RPC_SECRET="$(read_env_value GARAGE_RPC_SECRET)"
GARAGE_ADMIN_TOKEN="$(read_env_value GARAGE_ADMIN_TOKEN)"

if [ -z "$GARAGE_RPC_SECRET" ] || [ -z "$GARAGE_ADMIN_TOKEN" ]; then
    echo "ERROR: GARAGE_RPC_SECRET and GARAGE_ADMIN_TOKEN must be present in $ENV_FILE" >&2
    exit 1
fi

# Values are generated as hex, but reject anything outside a conservative
# credential character set before placing them into a TOML string.
case "$GARAGE_RPC_SECRET" in
    (*[!A-Za-z0-9._-]*) echo "ERROR: invalid GARAGE_RPC_SECRET characters" >&2; exit 1 ;;
esac
case "$GARAGE_ADMIN_TOKEN" in
    (*[!A-Za-z0-9._-]*) echo "ERROR: invalid GARAGE_ADMIN_TOKEN characters" >&2; exit 1 ;;
esac

output_dir="$(dirname "$OUTPUT_FILE")"
tmp_file="$(mktemp "$output_dir/.garage.toml.tmp.XXXXXX")"
trap 'rm -f "$tmp_file"' EXIT
umask 077
sed \
    -e "s/__REMOVED_GARAGE_SECRET__/$GARAGE_RPC_SECRET/g" \
    -e "s/__REMOVED_GARAGE_SECRET__/$GARAGE_ADMIN_TOKEN/g" \
    "$TEMPLATE_FILE" > "$tmp_file"
chmod 600 "$tmp_file"
# Write through cat (not mv) so the destination inode is preserved. The
# Compose bind mount tracks the original inode; replacing the file would hide
# a rotated secret from a running Garage container until a full recreate.
cat "$tmp_file" > "$OUTPUT_FILE"
chmod 600 "$OUTPUT_FILE"
trap - EXIT
