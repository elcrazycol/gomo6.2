#!/bin/bash
# Gomo6 Secrets Generator
# Generates all required cryptographic secrets for production deployment

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║          🔐 Gomo6 Secrets Generator                            ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "Generating secure random secrets..."
echo ""
echo "Copy these values to your .env file:"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# JWT Secret (32 bytes base64)
JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET=$JWT_SECRET"
echo ""

# Federation Key (32 bytes base64)
FEDERATION_KEY=$(openssl rand -base64 32)
echo "FEDERATION_KEY=$FEDERATION_KEY"
echo ""

# Garage S3 Secret Key (32 bytes hex = 64 chars)
GARAGE_SECRET=$(openssl rand -hex 32)
echo "GARAGE_S3_SECRET_KEY=$GARAGE_SECRET"
echo ""

# Messenger Shared Session Secret (32 bytes base64)
MESSENGER_SECRET=$(openssl rand -base64 32)
echo "MESSENGER_SHARED_SESSION_SECRET=$MESSENGER_SECRET"
echo ""

# PostgreSQL Password (24 bytes base64)
POSTGRES_PASSWORD=$(openssl rand -base64 24)
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  IMPORTANT:"
echo "   1. Copy these values to your .env file"
echo "   2. Replace all CHANGE_ME_* placeholders"
echo "   3. NEVER commit .env to git"
echo "   4. Store these secrets securely"
echo ""
echo "📖 See SECURITY.md for detailed setup instructions"
echo ""
