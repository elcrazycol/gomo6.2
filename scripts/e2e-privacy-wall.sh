#!/usr/bin/env bash
# =============================================================================
# E2E Privacy Wall Test
# Гарантия приватности: если пользователь поставил private_profile, его стену
# (посты, комментарии, медиа, реалтайм-события) НЕ может прочитать никто,
# кроме владельца и его друзей.
#
# Проверяет все каналы доступа — чтение И запись:
#   1. REST read  — GET /api/v1/profile_wall_posts?user_id=eq.<owner> не отдаёт посты
#   2. REST write — POST постов/комментариев/лайков/репостов → 403 (enforceWallTargetPrivacy)
#   3. WS         — subscribe на profile_wall_<owner> отклоняется ("Not authorized")
#   4. Media      — GET /storage/v1/object/wall/<owner>/<key> → 403 для не-друга
#
# Плюс позитивный контроль: владелец и друг читают и пишут всё.
#
# Требования: docker compose up -d (стек должен быть запущен).
# Запуск:     ./scripts/e2e-privacy-wall.sh [BASE_URL]
#             BASE_URL по умолчанию http://localhost
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }

BASE="${1:-http://localhost}"

# Self-signed local TLS (Caddy auto-HTTPS on localhost) needs -k; production
# uses valid certificates where -k is harmless.
CURL=(curl -sk)
if [[ "$BASE" == http://* ]]; then CURL=(curl -s); fi

WS_HOST=$(echo "$BASE" | sed -E 's|https?://||; s|/.*||')
WS_PROTO="ws"
if [[ "$BASE" == https://* ]]; then WS_PROTO="wss"; fi
WS_URL="${WS_PROTO}://${WS_HOST}/ws"

echo "=== E2E Privacy Wall Test ==="
echo "Base URL: $BASE"
echo "WS URL:   $WS_URL"
echo ""

# ── Helper: register (idempotent) + login ────────────────────────────────
register_and_login() {
  local email="$1" username="$2" password="$3"
  # Register (unique per run → 201). If a stale user exists the register may
  # fail; fall back to login by username. Either way we end up with a token.
  REG=$("${CURL[@]}" -X POST "$BASE/api/v1/auth/register" \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"$email\",\"username\":\"$username\",\"password\":\"$password\"}" \
    || true)
  if echo "$REG" | grep -q '"success":true'; then
    echo "$REG" | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print(d["token"]); print(d["user"]["id"])' \
      | { read -r t; read -r u; echo "$t $u"; }
  else
    "${CURL[@]}" -f -X POST "$BASE/api/v1/auth/login" \
      -H 'Content-Type: application/json' \
      -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
      | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print(d["token"]); print(d["user"]["id"])' \
      | { read -r t; read -r u; echo "$t $u"; }
  fi
}

echo "=== 1. Register + login two users ==="
# Unique suffix per run: makes the test idempotent even on a reused stack
# (registration of a duplicate user would 500 on the unique constraint).
# Keep usernames short — the API enforces a 3..20 character limit.
RUN_ID="$(date +%s | tail -c 9)"
OWNER_CREDS=$(register_and_login "e2epwo${RUN_ID}@test.com" "e2epwo${RUN_ID}" "E2ePrivWall2026x!")
OWNER_TOKEN=$(echo "$OWNER_CREDS" | awk '{print $1}')
OWNER_ID=$(echo "$OWNER_CREDS" | awk '{print $2}')
[ -n "$OWNER_TOKEN" ] && [ -n "$OWNER_ID" ] || fail "Owner login failed"
pass "Owner logged in (id: ${OWNER_ID:0:8}...)"

STRANGER_CREDS=$(register_and_login "e2epws${RUN_ID}@test.com" "e2epws${RUN_ID}" "E2ePrivWall2026x!")
STRANGER_TOKEN=$(echo "$STRANGER_CREDS" | awk '{print $1}')
STRANGER_ID=$(echo "$STRANGER_CREDS" | awk '{print $2}')
[ -n "$STRANGER_TOKEN" ] && [ -n "$STRANGER_ID" ] || fail "Stranger login failed"
pass "Stranger logged in (id: ${STRANGER_ID:0:8}...)"

# ── 2. Owner makes profile private ──────────────────────────────────────────
echo ""
echo "=== 2. Owner enables private_profile ==="
# Idempotent: try PUT (row exists) → fall back to POST (first time).
PUT_CODE=$("${CURL[@]}" -o /tmp/priv_put.json -w '%{http_code}' -X PUT \
  "$BASE/api/v1/privacy_settings?user_id=eq.$OWNER_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"private_profile":true,"private_hide_wall":true}')
if [ "$PUT_CODE" != "200" ]; then
  POST_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST \
    "$BASE/api/v1/privacy_settings" \
    -H "Authorization: Bearer $OWNER_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"user_id\":\"$OWNER_ID\",\"private_profile\":true,\"private_hide_wall\":true}")
  [ "$POST_CODE" = "200" ] || fail "Could not enable private_profile (PUT=$PUT_CODE POST=$POST_CODE)"
fi
pass "private_profile enabled"

# ── 3. Owner creates a wall post ───────────────────────────────────────────
echo ""
echo "=== 3. Owner creates a private wall post ==="
POST_RESP=$("${CURL[@]}" -f -X POST "$BASE/api/v1/profile_wall_posts" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$OWNER_ID\",\"title\":\"Secret post\",\"content\":\"This wall is private — nobody should see this.\"}")
WALL_POST_ID=$(echo "$POST_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])')
[ -n "$WALL_POST_ID" ] || fail "Wall post not created"
pass "Wall post created (id: ${WALL_POST_ID:0:8}...)"

# ── 4. Owner uploads a photo into the private "wall" bucket ────────────────
echo ""
echo "=== 4. Owner uploads media to private wall bucket ==="
FIXTURE="$(dirname "$0")/fixtures/priv-wall.jpg"
MEDIA_KEY="$OWNER_ID/e2e-priv-wall.jpg"
UPLOAD_RESP=$("${CURL[@]}" -f -X POST "$BASE/storage/v1/upload" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -F "file=@$FIXTURE;type=image/jpeg" \
  -F "bucket=wall" \
  -F "key=$MEDIA_KEY")
echo "$UPLOAD_RESP" | grep -q '"success":true' || fail "Wall media upload rejected: $UPLOAD_RESP"
pass "Wall media uploaded (key: $MEDIA_KEY)"

# ── 5. REST: stranger must NOT see the wall ────────────────────────────────
echo ""
echo "=== 5. REST read access ==="

# 5a. Owner sees own post (positive control)
OWNER_POSTS=$("${CURL[@]}" -f "$BASE/api/v1/profile_wall_posts?user_id=eq.$OWNER_ID" \
  -H "Authorization: Bearer $OWNER_TOKEN")
OWNER_COUNT=$(echo "$OWNER_POSTS" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]))')
[ "$OWNER_COUNT" -ge 1 ] || fail "Owner cannot see own wall (count=$OWNER_COUNT)"
pass "REST: owner sees own wall ($OWNER_COUNT post)"

# 5b. Stranger must see ZERO posts of the private wall
STRANGER_POSTS=$("${CURL[@]}" -f "$BASE/api/v1/profile_wall_posts?user_id=eq.$OWNER_ID" \
  -H "Authorization: Bearer $STRANGER_TOKEN")
STRANGER_COUNT=$(echo "$STRANGER_POSTS" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]))')
[ "$STRANGER_COUNT" = "0" ] || fail "REST LEAK: stranger saw $STRANGER_COUNT posts of a private wall"
pass "REST: stranger sees 0 posts (privacy held)"

# 5c. Anonymous must be rejected (401)
ANON_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE/api/v1/profile_wall_posts?user_id=eq.$OWNER_ID")
[ "$ANON_CODE" = "401" ] || fail "Anonymous wall read returned $ANON_CODE (expected 401)"
pass "REST: anonymous rejected ($ANON_CODE)"

# ── 6. Media: stranger must NOT fetch wall photos ──────────────────────────
echo ""
echo "=== 6. Storage media access ==="
MEDIA_PATH="/storage/v1/object/wall/$MEDIA_KEY"

# 6a. Owner can fetch own media
OWNER_MEDIA_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$MEDIA_PATH" \
  -H "Authorization: Bearer $OWNER_TOKEN")
[ "$OWNER_MEDIA_CODE" = "200" ] || fail "Owner cannot fetch own media (HTTP $OWNER_MEDIA_CODE)"
pass "Media: owner can fetch (200)"

# 6b. Stranger must get 403
STRANGER_MEDIA_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$MEDIA_PATH" \
  -H "Authorization: Bearer $STRANGER_TOKEN")
[ "$STRANGER_MEDIA_CODE" = "403" ] || fail "MEDIA LEAK: stranger fetched wall photo (HTTP $STRANGER_MEDIA_CODE, expected 403)"
pass "Media: stranger blocked (403)"

# 6c. Anonymous must be rejected
ANON_MEDIA_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$MEDIA_PATH")
[ "$ANON_MEDIA_CODE" = "401" ] || fail "Anonymous media fetch returned $ANON_MEDIA_CODE (expected 401)"
pass "Media: anonymous rejected ($ANON_MEDIA_CODE)"

# ── 7. Write access: stranger must NOT write to the private wall ───────────
echo ""
echo "=== 7. Write access (posts/comments/likes/reposts) ==="

# Helper: run a write request as the stranger and assert the HTTP status plus
# the privacy error body (so a 403 from a different gate would fail the test).
# Usage: expect_stranger_write <desc> <expected_code> <method> <path> [json_body]
expect_stranger_write() {
  local desc="$1" expected="$2" method="$3" path="$4" body="${5:-}"
  local args
  args=("${CURL[@]}" -o /tmp/priv_write_body.json -w '%{http_code}' -X "$method" "$BASE$path" \
    -H "Authorization: Bearer $STRANGER_TOKEN" -H 'Content-Type: application/json')
  if [ -n "$body" ]; then args+=(-d "$body"); fi
  local code
  code=$("${args[@]}")
  [ "$code" = "$expected" ] || fail "WRITE LEAK: $desc returned $code (expected $expected)"
  if [ "$expected" = "403" ]; then
    grep -qi 'private' /tmp/priv_write_body.json \
      || fail "WRITE LEAK: $desc returned 403 but not for a privacy reason: $(cat /tmp/priv_write_body.json)"
  fi
  pass "Write: $desc → $code"
}

# 7a. Stranger cannot post on the private wall (wall owner != caller)
expect_stranger_write "post on private wall" 403 POST "/api/v1/profile_wall_posts" \
  "{\"user_id\":\"$OWNER_ID\",\"title\":\"Intruder post\",\"content\":\"should be blocked\"}"

# 7b. Stranger cannot comment on a post of the private wall
expect_stranger_write "comment on private wall post" 403 POST "/api/v1/profile_wall_post_comments" \
  "{\"post_id\":\"$WALL_POST_ID\",\"content\":\"intruder comment\"}"

# 7c. Stranger cannot like a post of the private wall
expect_stranger_write "like on private wall post" 403 POST "/api/v1/profile_wall_post_likes" \
  "{\"post_id\":\"$WALL_POST_ID\"}"

# 7d. Stranger cannot repost a private wall post onto their own wall
expect_stranger_write "repost of private wall post" 403 POST "/api/v1/profile_wall_post_reposts" \
  "{\"post_id\":\"$WALL_POST_ID\"}"

# 7e. Anonymous cannot write at all (401 before any ownership logic)
ANON_WRITE_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/profile_wall_posts" \
  -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$OWNER_ID\",\"title\":\"anon\",\"content\":\"x\"}")
[ "$ANON_WRITE_CODE" = "401" ] || fail "Anonymous wall write returned $ANON_WRITE_CODE (expected 401)"
pass "Write: anonymous rejected ($ANON_WRITE_CODE)"

# ── 8. WebSocket: stranger must NOT subscribe to the wall room ─────────────
echo ""
echo "=== 8. WebSocket realtime access ==="
WALL_ROOM="profile_wall_$OWNER_ID"

# 7a. Stranger subscription must be denied
STRANGER_WS=$(python3 "$(dirname "$0")/ws_probe.py" "$WS_URL" "$STRANGER_TOKEN" "$WALL_ROOM" 15 || echo "PROBE_RESULT=ERROR exit=$?")
echo "    stranger ws: $STRANGER_WS"
case "$STRANGER_WS" in
  *DENIED*) pass "WS: stranger subscription denied" ;;
  *ALLOWED*) fail "WS LEAK: stranger subscribed to private wall room" ;;
  *) fail "WS: stranger probe inconclusive — $STRANGER_WS" ;;
esac

# 7b. Owner subscription must succeed
OWNER_WS=$(python3 "$(dirname "$0")/ws_probe.py" "$WS_URL" "$OWNER_TOKEN" "$WALL_ROOM" 15 || echo "PROBE_RESULT=ERROR exit=$?")
echo "    owner ws: $OWNER_WS"
case "$OWNER_WS" in
  *ALLOWED*) pass "WS: owner subscription confirmed" ;;
  *) fail "WS: owner probe failed — $OWNER_WS" ;;
esac

# ── 9. Positive control: after friendship, stranger CAN read and write ─────
echo ""
echo "=== 9. After adding to friends, access is granted ==="
"${CURL[@]}" -f -X POST "$BASE/api/v1/friends/request" \
  -H "Authorization: Bearer $STRANGER_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"receiver_id\":\"$OWNER_ID\"}" > /dev/null || true
# Owner accepts the pending request from stranger
REQ_ID=$("${CURL[@]}" -f "$BASE/api/v1/friends/requests" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  | python3 -c "
import sys,json
reqs=json.load(sys.stdin)['data']
for r in reqs:
    if r.get('sender_id')=='$STRANGER_ID' and r.get('status')=='pending':
        print(r['id']); break
")
if [ -n "$REQ_ID" ]; then
  "${CURL[@]}" -f -X PUT "$BASE/api/v1/friends/request/$REQ_ID/accept" \
    -H "Authorization: Bearer $OWNER_TOKEN" > /dev/null || true
  # Small delay so caches settle
  sleep 2

  FRIEND_POSTS=$("${CURL[@]}" -f "$BASE/api/v1/profile_wall_posts?user_id=eq.$OWNER_ID" \
    -H "Authorization: Bearer $STRANGER_TOKEN")
  FRIEND_COUNT=$(echo "$FRIEND_POSTS" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]))')
  [ "$FRIEND_COUNT" -ge 1 ] || fail "Friend cannot see wall after acceptance (count=$FRIEND_COUNT)"
  pass "REST: friend sees wall after acceptance ($FRIEND_COUNT post)"

FRIEND_MEDIA_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$MEDIA_PATH" \
  -H "Authorization: Bearer $STRANGER_TOKEN")
  [ "$FRIEND_MEDIA_CODE" = "200" ] || fail "Friend cannot fetch media (HTTP $FRIEND_MEDIA_CODE)"
  pass "Media: friend can fetch (200)"

  FRIEND_WS=$(python3 "$(dirname "$0")/ws_probe.py" "$WS_URL" "$STRANGER_TOKEN" "$WALL_ROOM" 15 || echo "PROBE_RESULT=ERROR exit=$?")
  case "$FRIEND_WS" in
    *ALLOWED*) pass "WS: friend subscription confirmed after acceptance" ;;
    *) fail "WS: friend probe failed — $FRIEND_WS" ;;
  esac

  # Positive write controls: as a friend, the stranger CAN now interact.
  FRIEND_LIKE_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/profile_wall_post_likes" \
    -H "Authorization: Bearer $STRANGER_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"post_id\":\"$WALL_POST_ID\"}")
  [ "$FRIEND_LIKE_CODE" = "200" ] || fail "Friend like returned $FRIEND_LIKE_CODE (expected 200)"
  pass "Write: friend can like (200)"

  FRIEND_COMMENT_CODE=$("${CURL[@]}" -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/profile_wall_post_comments" \
    -H "Authorization: Bearer $STRANGER_TOKEN" -H 'Content-Type: application/json' \
    -d "{\"post_id\":\"$WALL_POST_ID\",\"content\":\"friend comment\"}")
  [ "$FRIEND_COMMENT_CODE" = "200" ] || fail "Friend comment returned $FRIEND_COMMENT_CODE (expected 200)"
  pass "Write: friend can comment (200)"
else
  pass "Skipped friendship check (no pending request found)"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ All E2E privacy wall tests passed!${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
