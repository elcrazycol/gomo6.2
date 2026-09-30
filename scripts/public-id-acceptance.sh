#!/usr/bin/env bash
# =============================================================================
# public-id acceptance — docs/wiki/PUBLIC_IDS.md, фаза 4
#
# Проверяет на ЖИВОМ стеке, что публичные номера работают end-to-end:
#   * /api/v1/profiles/<номер> == /api/v1/profiles/<uuid> (то же тело);
#   * фильтры ?public_id=eq.<номер> для людей, тем и стены;
#   * OG-карточка по числовому пути /profile/<номер>;
#   * мусор в параметре — 404/400, а не 500;
#   * write-ручки принимают ТОЛЬКО UUID, и public_id нельзя задать телом запроса;
#   * sequence продолжается после backfill.
#
# Скрипт самодостаточен: поднимает бэкенд на отдельной БД (миграции применяет он
# сам) и на отдельном индексе Redis, поэтому не трогает dev-стек.
#
# Требования: Postgres на 127.0.0.1:5432 (dev infra), go, psql, curl, python3.
# Запуск:  ./scripts/public-id-acceptance.sh
# =============================================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

pass() { echo -e "${GREEN}✅ $1${NC}"; }
fail() { echo -e "${RED}❌ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}▸ $1${NC}"; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/apps/backend-go"

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-gomo6}"
PGPASSWORD="${PGPASSWORD:-test123}"
export PGPASSWORD

SCRATCH_DB="${SCRATCH_DB:-gomo6_publicid_accept}"
PORT="${PORT:-18080}"
BASE="http://127.0.0.1:$PORT"
# The script gets its own Redis database: responses are cached by path/query, and
# a key left over from a previous run (same scratch database name, same fixtures)
# makes the parity checks flaky. A random index keeps concurrent runs apart;
# redis-cli clears it up front when it is installed.
REDIS_DB="${REDIS_DB:-$((RANDOM % 15 + 1))}"
REDIS_URL="${REDIS_URL:-redis://:redispass123@127.0.0.1:6379/$REDIS_DB}"
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -u "$REDIS_URL" flushdb >/dev/null 2>&1 || true
fi
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
SERVER_BIN="$(mktemp -t gomo6-accept-server.XXXXXX)"
SERVER_LOG="$(mktemp -t gomo6-accept-server.XXXXXX.log)"
SERVER_PID=""

psql_scratch() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$SCRATCH_DB" -tAc "$1"; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  pkill -f "$SERVER_BIN" 2>/dev/null || true
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q \
    -c "DROP DATABASE IF EXISTS $SCRATCH_DB" >/dev/null 2>&1 || true
  rm -f "$SERVER_BIN" "$SERVER_LOG"
}
trap cleanup EXIT

echo "=== public-id acceptance ==="
echo "DB:  $SCRATCH_DB @ $PGHOST:$PGPORT   backend: $BASE"
echo ""

command -v psql >/dev/null || fail "psql not found"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -tAc "select 1" >/dev/null \
  || fail "Postgres is not reachable — start the dev infra (make dev)"

# ── 1. Fresh database; the backend applies the migrations itself ───────────
info "recreating $SCRATCH_DB"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$SCRATCH_DB'" >/dev/null 2>&1 || true
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $SCRATCH_DB" -c "CREATE DATABASE $SCRATCH_DB" \
  || fail "cannot recreate the scratch database"

info "building the server"
(cd "$BACKEND" && go build -o "$SERVER_BIN" ./cmd/server) || fail "go build failed"

info "starting the server (it applies all migrations on boot)"
(
  cd "$(mktemp -d)" # no .env in CWD, so godotenv cannot inject anything
  exec env DATABASE_URL="postgres://$PGUSER:$PGPASSWORD@$PGHOST:$PGPORT/$SCRATCH_DB?sslmode=disable" \
  REDIS_URL="$REDIS_URL" \
  SERVER_PORT="$PORT" \
  JWT_SECRET="$JWT_SECRET" \
  MIGRATIONS_DIR="$BACKEND/migrations" \
  ENVIRONMENT=development \
  TURNSTILE_DISABLED=1 \
  ALLOWED_ORIGINS="$BASE" \
  METRICS_TOKEN="" \
  "$SERVER_BIN" >"$SERVER_LOG" 2>&1
) &
SERVER_PID=$!

# /health answers even BEFORE the heavy init (and therefore before the
# migrations finish), so readiness must be probed on a real API route — otherwise
# the seed below would run against a half-migrated schema.
READY=0
for _ in $(seq 1 240); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    tail -20 "$SERVER_LOG"
    fail "server exited during startup"
  fi
  if curl -sf -o /dev/null "$BASE/api/v1/boards"; then READY=1; break; fi
  sleep 0.5
done
[ "$READY" = "1" ] || { tail -20 "$SERVER_LOG"; fail "server did not finish initialising"; }
grep -q "RunMigrations: complete" "$SERVER_LOG" || { tail -20 "$SERVER_LOG"; fail "migrations did not complete"; }
pass "server is up and migrations were applied"

# ── 2. Fixtures (public_id comes from the sequence) ───────────────────────
USER_UUID="11111111-1111-1111-1111-111111111111"
THREAD_UUID="22222222-2222-2222-2222-222222222222"
WALL_UUID="33333333-3333-3333-3333-333333333333"

psql_scratch "
  INSERT INTO users (id, username, email, password_hash, wallet_address)
  VALUES ('$USER_UUID', 'accept_user', 'accept@test.local', 'x', '0xaccept');
  INSERT INTO threads (id, user_id, title, content)
  VALUES ('$THREAD_UUID', '$USER_UUID', 'Accept thread', 'accept thread body');
  INSERT INTO profile_wall_posts (id, user_id, author_id, content)
  VALUES ('$WALL_UUID', '$USER_UUID', '$USER_UUID', 'accept wall post');
" >/dev/null || fail "seeding failed"

USER_PID="$(psql_scratch "SELECT public_id FROM users WHERE id = '$USER_UUID'")"
THREAD_PID="$(psql_scratch "SELECT public_id FROM threads WHERE id = '$THREAD_UUID'")"
WALL_PID="$(psql_scratch "SELECT public_id FROM profile_wall_posts WHERE id = '$WALL_UUID'")"
echo "    assigned numbers: user=$USER_PID thread=$THREAD_PID wall_post=$WALL_PID"

[ "$USER_PID" = "10" ]   || fail "users base: expected 10, got $USER_PID"
[ "$THREAD_PID" = "100" ] || fail "threads base: expected 100, got $THREAD_PID"
[ "$WALL_PID" = "1" ]    || fail "wall posts base: expected 1, got $WALL_PID"
pass "bases are right on a fresh database (10 / 100 / 1)"

# ── helpers ───────────────────────────────────────────────────────────────
json_data() { python3 -c 'import sys,json; print(json.dumps(json.load(sys.stdin).get("data"), sort_keys=True, ensure_ascii=False))'; }
status_of() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# ── 3. Parity: number == UUID ─────────────────────────────────────────────
A="$(curl -sf "$BASE/api/v1/profiles/$USER_PID" | json_data)"
B="$(curl -sf "$BASE/api/v1/profiles/$USER_UUID" | json_data)"
[ "$A" = "$B" ] || { echo "number: $A"; echo "uuid:   $B"; fail "/profiles/<number> differs from /profiles/<uuid>"; }
pass "/api/v1/profiles/$USER_PID == /api/v1/profiles/<uuid>"
echo "$A" | python3 -c '
import sys, json
want = int(sys.argv[1])
data = json.load(sys.stdin)
assert data.get("public_id") == want, f"public_id={data.get("public_id")}"
' "$USER_PID" || fail "the profile payload does not carry public_id"
pass "the profile payload carries public_id"

A="$(curl -sf "$BASE/api/v1/threads/$THREAD_PID" | json_data)"
B="$(curl -sf "$BASE/api/v1/threads/$THREAD_UUID" | json_data)"
[ "$A" = "$B" ] || { echo "number: $A"; echo "uuid:   $B"; fail "/threads/<number> differs from /threads/<uuid>"; }
echo "$A" | python3 -c '
import sys, json
want = int(sys.argv[1])
data = json.load(sys.stdin)
assert data.get("public_id") is not None, "thread public_id missing"
assert data.get("user_public_id") == want, f"user_public_id={data.get("user_public_id")}"
' "$USER_PID" || fail "the thread payload does not carry the author's user_public_id"
pass "/api/v1/threads/$THREAD_PID == /api/v1/threads/<uuid>, author number present"

# ── 4. Filters ────────────────────────────────────────────────────────────
COUNT="$(curl -sf "$BASE/api/v1/profiles?public_id=eq.$USER_PID" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]))')"
[ "$COUNT" = "1" ] || fail "?public_id=eq.$USER_PID returned $COUNT rows"
pass "?public_id=eq.<number> resolves a profile"

COUNT="$(curl -sf "$BASE/api/v1/threads?public_id=eq.$THREAD_PID" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["data"]))')"
[ "$COUNT" = "1" ] || fail "threads?public_id=eq.$THREAD_PID returned $COUNT rows"
pass "?public_id=eq.<number> resolves a thread"

WALL_ROW="$(curl -sf "$BASE/api/v1/profile_wall_posts?user_id=eq.$USER_UUID&public_id=eq.$WALL_PID")"
echo "$WALL_ROW" | python3 -c '
import sys, json
want_post, want_owner = int(sys.argv[1]), int(sys.argv[2])
rows = json.load(sys.stdin).get("data") or []
assert len(rows) == 1, f"expected 1 wall post, got {len(rows)}"
row = rows[0]
assert row.get("public_id") == want_post, f"post public_id={row.get("public_id")}"
assert row.get("user_public_id") == want_owner, f"owner user_public_id={row.get("user_public_id")}"
author = row.get("author") or {}
assert author.get("public_id") == want_owner, f"author public_id={author.get("public_id")}"
' "$WALL_PID" "$USER_PID" || fail "the wall payload is missing numbers"
pass "wall payload: post number, owner number and author number all present"

# ── 5. OG cards (crawler path) ────────────────────────────────────────────
OG="$(curl -s -H 'User-Agent: Twitterbot/1.0' "$BASE/profile/$USER_PID")"
echo "$OG" | grep -q 'og:title' || fail "numeric OG path did not render a card"
pass "OG card renders for /profile/$USER_PID (crawler UA)"
curl -sf -H 'User-Agent: Twitterbot/1.0' "$BASE/profile/$USER_UUID" | grep -q 'og:title' \
  || fail "the UUID OG path regressed"
pass "OG card still renders for the UUID path"

# ── 6. Malformed parameters are 404/400, never 500 ────────────────────────
check_status() { # <expected> <label> <curl args...>
  local expected="$1" label="$2"; shift 2
  local got; got="$(status_of "$@")"
  [ "$got" = "$expected" ] || fail "$label: expected $expected, got $got"
  pass "$label → $got"
}
check_status 404 "/profiles/<missing number>" "$BASE/api/v1/profiles/999999"
check_status 404 "/profiles/<garbage>" "$BASE/api/v1/profiles/not-a-uuid"
check_status 404 "/profiles?public_id=eq.<garbage>" "$BASE/api/v1/profiles?public_id=eq.abc"
check_status 400 "/threads/<garbage>" "$BASE/api/v1/threads/not-a-uuid"
check_status 400 "/threads?public_id=eq.<garbage>" "$BASE/api/v1/threads?public_id=eq.abc"

# ── 7. Writes take UUIDs only; public_id is not client-writable ───────────
# A strong password on purpose: the register path rejects known-breached ones.
WRITER_PASSWORD="A9cc-PublicId-accept-2026"
REGISTER_BODY="$(curl -s -X POST "$BASE/api/v1/auth/register" -H 'Content-Type: application/json' \
  -d "{\"email\":\"accept@test.local2\",\"username\":\"acceptwriter\",\"password\":\"$WRITER_PASSWORD\"}")"
echo "$REGISTER_BODY" | grep -q '"success":true' \
  || fail "register failed: $REGISTER_BODY"
TOKEN="$(curl -sf -X POST "$BASE/api/v1/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"accept@test.local2\",\"password\":\"$WRITER_PASSWORD\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')"
WRITER_UUID="$(psql_scratch "SELECT id FROM users WHERE username = 'acceptwriter'")"
WRITER_PID="$(psql_scratch "SELECT public_id FROM users WHERE username = 'acceptwriter'")"
[ -n "$WRITER_PID" ] || fail "the writer has no public_id"
pass "registered a writer (uuid=$WRITER_UUID number=$WRITER_PID)"

# public_id in the body must be ignored (mass-assignment guard).
curl -sf -X PUT "$BASE/api/v1/profiles/$WRITER_UUID" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bio":"acceptance bio","public_id":99999}' >/dev/null \
  || fail "the owner could not update their own profile"
AFTER="$(psql_scratch "SELECT public_id FROM users WHERE id = '$WRITER_UUID'")"
[ "$AFTER" = "$WRITER_PID" ] || fail "public_id was client-writable: $WRITER_PID -> $AFTER"
pass "public_id in the request body is ignored (still $AFTER)"

BIO="$(psql_scratch "SELECT bio FROM users WHERE id = '$WRITER_UUID'")"
[ "$BIO" = "acceptance bio" ] || fail "the legitimate field was not updated (bio=$BIO)"
pass "the legitimate field still updates"

# A numeric path parameter must NOT authorize a write: the owner check compares
# UUIDs, so /profiles/<number> is a 403 for the owner themself.
check_status 403 "PUT /profiles/<number> (writes are UUID-only)" -X PUT \
  "$BASE/api/v1/profiles/$WRITER_PID" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"bio":"nope"}'

# ── 8. Admin assignment / transfer (phase 5) ──────────────────────────────
# A non-admin must not be able to hand out numbers.
check_status 403 "POST /admin/public-id/assign as a non-admin" -X POST \
  "$BASE/api/v1/admin/public-id/assign" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"user_id\":\"$USER_UUID\",\"public_id\":5}"

psql_scratch "INSERT INTO user_roles (user_id, role) VALUES ('$WRITER_UUID', 'admin')
               ON CONFLICT (user_id, role) DO NOTHING" >/dev/null || fail "could not promote the writer to admin"

# Hand out a reserved number (inside the band the sequence can never reach).
ASSIGN="$(curl -s -X POST "$BASE/api/v1/admin/public-id/assign" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$WRITER_UUID\",\"public_id\":5,\"note\":\"acceptance\"}")"
echo "$ASSIGN" | grep -q '"success":true' || fail "assign failed: $ASSIGN"
check_status 200 "/api/v1/profiles/5 now resolves" "$BASE/api/v1/profiles/5"
OWNER="$(curl -sf "$BASE/api/v1/profiles/5" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])')"
[ "$OWNER" = "$WRITER_UUID" ] || fail "/profile/5 belongs to $OWNER, expected the writer"
pass "the reserved number 5 was handed to the writer"

# A real transfer: take the first user's number. The displaced owner must be
# re-numbered in the same transaction — here they receive the writer's old
# number (a clean exchange that burns no sequence value).
ASSIGN="$(curl -s -X POST "$BASE/api/v1/admin/public-id/assign" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"user_id\":\"$WRITER_UUID\",\"public_id\":$USER_PID,\"note\":\"acceptance swap\"}")"
echo "$ASSIGN" | grep -q '"success":true' || fail "transfer failed: $ASSIGN"
DB_OWNER="$(psql_scratch "SELECT id FROM users WHERE public_id = $USER_PID")"
[ "$DB_OWNER" = "$WRITER_UUID" ] || fail "the database still maps $USER_PID to $DB_OWNER"
pass "the database moved $USER_PID to the new owner"

OWNER="$(curl -sf "$BASE/api/v1/profiles/$USER_PID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["id"])')"
[ "$OWNER" = "$WRITER_UUID" ] || fail "/profile/$USER_PID serves $OWNER after the transfer (stale cache?)"
pass "/profile/$USER_PID now points at the new owner"

DISPLACED="$(psql_scratch "SELECT public_id FROM users WHERE id = '$USER_UUID'")"
[ "$DISPLACED" = "5" ] || fail "the displaced owner got $DISPLACED, expected the exchanged number 5"
pass "the displaced owner was re-numbered to $DISPLACED (clean exchange)"

LEDGER="$(psql_scratch "SELECT count(*) FROM public_id_transfers")"
[ "$LEDGER" -ge 3 ] || fail "expected at least 3 ledger rows, got $LEDGER"
pass "the ledger recorded every movement ($LEDGER rows)"

# ── 9. The sequence continues after the backfill ──────────────────────────
# psql prints the command tag after RETURNING, so keep the first line only.
NEXT_PID="$(psql_scratch "
  INSERT INTO users (id, username, email, password_hash, wallet_address)
  VALUES (gen_random_uuid(), 'accept_next', 'accept-next@test.local', 'x', '0xacceptnext')
  RETURNING public_id" | head -1)"
# After the transfer the highest number handed out is still USER_PID (the swap
# exchanged existing numbers, it did not allocate a new one).
EXPECTED=$((USER_PID + 1))
[ "$NEXT_PID" -ge "$EXPECTED" ] \
  || fail "the sequence did not continue (got $NEXT_PID, expected at least $EXPECTED)"
pass "new rows continue from the sequence (next number: $NEXT_PID)"

echo ""
echo -e "${GREEN}=== public-id acceptance passed ===${NC}"
