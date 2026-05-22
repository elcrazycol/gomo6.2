#!/usr/bin/env bash
# =============================================================================
# E2E Smoke Test — локальный аналог CI smoke job из full-tests.yml
# Проверяет: health, register, login, presigned URL, upload, CORS
# Требования: docker compose up -d (стек должен быть запущен)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

BASE="${1:-http://localhost}"
GARAGE="${2:-http://localhost:3900}"

echo "=== E2E Smoke Test ==="
echo "Base URL: $BASE"
echo "Garage:   $GARAGE"
echo ""

# ── 1. Health ──────────────────────────────────────────────────────
echo "=== 1. Health check ==="
curl -sf "$BASE/health" && pass "Health OK" || fail "Health failed"

# ── 2. Register (idempotent — OK if user already exists) ──────────
echo "=== 2. Register test user ==="
curl -s -X POST "$BASE/api/v1/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"email":"e2eci@test.com","username":"e2eci","password":"test123456"}' > /dev/null \
  || echo "    (user may already exist, continuing)"
pass "Register OK (or already exists)"

# ── 3. Login ───────────────────────────────────────────────────────
echo "=== 3. Login ==="
TOKEN=$(curl -sf -X POST "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"e2eci@test.com","password":"test123456"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
pass "Login OK (token: ${TOKEN:0:20}...)"

# ── 4. Create test JPEG ────────────────────────────────────────────
echo "=== 4. Create test JPEG ==="
python3 -c "
import base64
jpeg = base64.b64decode('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYI4RVNGSSomJjc4NUVHdISlNUVVNXWFlJjZHV4Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==')
with open('/tmp/test.jpg', 'wb') as f:
    f.write(jpeg)
"
pass "Test JPEG created"

# ── 5. Presigned PUT — content ─────────────────────────────────────
echo "=== 5. Presigned PUT URL (content) ==="
CONTENT_URL=$(curl -sf -X POST "$BASE/storage/v1/presign-upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"bucket":"content","key":"e2eci/test-photo.jpg","content_type":"image/jpeg"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["upload_url"])')
HOST=$(echo "$CONTENT_URL" | python3 -c 'import sys; from urllib.parse import urlparse; print(urlparse(sys.stdin.read().strip()).netloc)')
pass "Presigned URL host: $HOST"
[ "$HOST" = "localhost:3900" ] || fail "Expected localhost:3900, got $HOST"

# ── 6. Upload to content ───────────────────────────────────────────
echo "=== 6. Upload to content bucket ==="
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H 'Content-Type: image/jpeg' --data-binary @/tmp/test.jpg "$CONTENT_URL")
[ "$HTTP_CODE" = "200" ] && pass "Content upload HTTP $HTTP_CODE" || fail "Content upload HTTP $HTTP_CODE"

# ── 7. Presigned PUT — post-images (avatar) ────────────────────────
echo "=== 7. Presigned PUT URL (post-images) ==="
AVATAR_URL=$(curl -sf -X POST "$BASE/storage/v1/presign-upload" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"bucket":"post-images","key":"e2eci/avatar.jpg","content_type":"image/jpeg"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["upload_url"])')
pass "Avatar presigned URL obtained"

# ── 8. Upload avatar ───────────────────────────────────────────────
echo "=== 8. Upload avatar ==="
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H 'Content-Type: image/jpeg' --data-binary @/tmp/test.jpg "$AVATAR_URL")
[ "$HTTP_CODE" = "200" ] && pass "Avatar upload HTTP $HTTP_CODE" || fail "Avatar upload HTTP $HTTP_CODE"

# ── 9. CORS preflight ──────────────────────────────────────────────
echo "=== 9. CORS preflight ==="
for bucket in content post-images; do
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS \
    -H 'Origin: http://localhost' \
    -H 'Access-Control-Request-Method: PUT' \
    "$GARAGE/$bucket/")
  [ "$HTTP_CODE" = "200" ] && pass "CORS $bucket HTTP $HTTP_CODE" || fail "CORS $bucket HTTP $HTTP_CODE"
done

# ── Done ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ All E2E smoke tests passed!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
