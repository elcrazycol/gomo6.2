#!/bin/sh
# Generate self-signed TLS certificates for local development.
# In production, use Let's Encrypt or your CA-signed certificates.
#
# Usage: ./scripts/gen-certs.sh [domain]
#   domain: domain for the certificate (default: localhost)

set -eu

DOMAIN="${1:-localhost}"
CERTS_DIR="$(cd "$(dirname "$0")/.." && pwd)/certs"

mkdir -p "$CERTS_DIR"

CERT_FILE="$CERTS_DIR/server.crt"
KEY_FILE="$CERTS_DIR/server.key"

# Only generate if certs don't already exist
if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
  echo "Certificates already exist:"
  echo "  $CERT_FILE"
  echo "  $KEY_FILE"
  exit 0
fi

echo "Generating self-signed certificate for '$DOMAIN'..."

# Generate a self-signed certificate valid for 365 days
openssl req -x509 \
  -newkey rsa:2048 \
  -keyout "$KEY_FILE" \
  -out "$CERT_FILE" \
  -days 365 \
  -nodes \
  -subj "/CN=$DOMAIN/O=gomo6 Development" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

echo ""
echo "Certificates generated:"
echo "  Certificate: $CERT_FILE"
echo "  Private key: $KEY_FILE"
echo ""
echo "To enable TLS, set these environment variables:"
echo "  TLS_CERT_FILE=$CERT_FILE"
echo "  TLS_KEY_FILE=$KEY_FILE"
echo ""
echo "For docker-compose, mount the certs directory and set env vars."
