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
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["upload_url"])')
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
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["upload_url"])')
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

# ── 10. Create board ──────────────────────────────────────────────────
echo "=== 10. Create test board ==="
BOARD_RESP=$(curl -sf -X POST "$BASE/rest/v1/boards" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"slug":"e2e-smoke-board","name":"E2E Smoke Board","description":"Test board for smoke tests"}')
BOARD_ID=$(echo "$BOARD_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])')
pass "Board created (id: ${BOARD_ID:0:8}...)"

# ── 11. Create thread ─────────────────────────────────────────────────
echo "=== 11. Create test thread ==="
THREAD_RESP=$(curl -sf -X POST "$BASE/rest/v1/threads" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"board_id\":\"$BOARD_ID\",\"title\":\"E2E Smoke Thread\",\"content\":\"Thread for smoke test post\"}")
THREAD_ID=$(echo "$THREAD_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])')
pass "Thread created (id: ${THREAD_ID:0:8}...)"

# ── 12. Create post with attachment ───────────────────────────────────
echo "=== 12. Create post with attachment ==="
POST_RESP=$(curl -sf -X POST "$BASE/rest/v1/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"thread_id\":\"$THREAD_ID\",\"content\":\"Smoke test post with photo\",\"attachments\":[{\"url\":\"e2eci/test-photo.jpg\",\"type\":\"image\",\"mime\":\"image/jpeg\",\"name\":\"test-photo.jpg\",\"size\":631}]}")
POST_ID=$(echo "$POST_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])')
POST_CONTENT=$(echo "$POST_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["content"])')
[ "$POST_CONTENT" = "Smoke test post with photo" ] || fail "Post content mismatch: $POST_CONTENT"
# Verify attachment is present
ATTACHMENT_COUNT=$(echo "$POST_RESP" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]["attachments"]))')
[ "$ATTACHMENT_COUNT" = "1" ] || fail "Expected 1 attachment, got $ATTACHMENT_COUNT"
pass "Post created with attachment (id: ${POST_ID:0:8}...)"

# ── Done ────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ All E2E smoke tests passed!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
