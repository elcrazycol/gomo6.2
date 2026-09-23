#!/usr/bin/env bash
# =============================================================================
# Gomo6 — local demo data seeder (`make seed`)
# =============================================================================
# Populates a LOCAL dev database over the real HTTP API (so it stays valid as
# the schema evolves — no raw SQL). Idempotent: re-running only creates what is
# missing. Requires the backend to be running with TURNSTILE_DISABLED=1
# (`make dev` does both).
#
# Creates:
#   - users demo / alice / bob, each with avatar, display name, bio and a
#     profile background + theme (profile_customization)
#   - friendships  demo<->alice, demo<->bob, alice<->bob
#   - a "Demo Lounge" board with a welcome thread and a handful of posts
#     (images + likes)
#   - wall posts on the demo profile (own + from friends)
#   - a demo<->alice direct conversation with a few messages
#
# Environment:
#   GOMO6_BASE_URL   backend base URL        (default http://localhost:8080)
#   SEED_PASSWORD    password for demo users  (default demo123456)
# =============================================================================

set -euo pipefail

BASE="${GOMO6_BASE_URL:-http://localhost:8080}"
PASSWORD="${SEED_PASSWORD:-gomo6-demo-9f3k2x}"

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
die()  { printf "${RED}✗${NC} %s\n" "$*" >&2; exit 1; }
note() { printf "${DIM}    %s${NC}\n" "$*"; }

TMPDIR_SEED="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SEED"' EXIT

# ── Helpers ─────────────────────────────────────────────────────────────────

# req METHOD PATH TOKEN [JSON_BODY] -> response body
req() {
    local method="$1" path="$2" token="${3:-}" body="${4:-}"
    local args=(-s -X "$method" "$BASE$path")
    [ -n "$body" ]  && args+=(-H 'Content-Type: application/json' -d "$body")
    [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
    curl "${args[@]}"
}

# req_get PATH [TOKEN] -> fresh GET for DEDICATED handlers (boards, threads,
# profiles/:id, messenger). The backend's viewer-keyed data cache keys on the
# full query string, and an empty list response is cached for ~30s — a
# re-query right after a create can return the stale empty result. Dedicated
# handlers ignore unknown params, so a unique `_seed` changes the cache key
# without changing the response.
req_get() {
    local path="$1" token="${2:-}" sep="?"
    case "$path" in *\?*) sep="&" ;; esac
    req GET "${path}${sep}_seed=$(uuid)&limit=100" "$token"
}

# req_get_sql PATH [TOKEN] -> fresh GET for GENERIC CRUD tables
# (profile_wall_posts, profile_customization). Their query builder treats every
# unknown query param as a column filter, so `_seed` would break them; instead
# a unique `id=neq.<uuid>` is a valid filter that excludes a non-existent row
# (i.e. returns everything) while changing the cache key.
req_get_sql() {
    local path="$1" token="${2:-}" sep="?"
    case "$path" in *\?*) sep="&" ;; esac
    req GET "${path}${sep}id=neq.$(uuid)&limit=100" "$token"
}

# jq_get <dotted.path>  (reads JSON on stdin, never fails)
jq_get() {
    python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    for k in sys.argv[1].split("."):
        d = d[int(k)] if isinstance(d, list) else d[k]
    print("" if d is None else (d if isinstance(d, str) else json.dumps(d, ensure_ascii=False)))
except Exception:
    print("")
' "$1"
}

# json_find <list-path> <field> <value>  (first row id)
json_find() {
    python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    for k in sys.argv[1].split("."):
        d = d[int(k)] if isinstance(d, list) else d[k]
    for row in d:
        if str(row.get(sys.argv[2], "")) == sys.argv[3]:
            print(row.get("id", "")); break
    else:
        print("")
except Exception:
    print("")
' "$1" "$2" "$3"
}

# mkjson key value key value ... -> flat JSON object of strings
mkjson() {
    python3 -c 'import json,sys; print(json.dumps(dict(zip(sys.argv[1::2], sys.argv[2::2])), ensure_ascii=False))' "$@"
}

uuid() { python3 -c 'import uuid; print(uuid.uuid4())'; }

make_png() { # path w h r g b
    python3 -c '
import sys, zlib, struct
path, w, h, r, g, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6])
def chunk(t, d):
    c = t + d
    return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xffffffff)
row = bytes((r, g, b)) * w
raw = b"".join(b"\x00" + row for _ in range(h))
png  = b"\x89PNG\r\n\x1a\n"
png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
png += chunk(b"IDAT", zlib.compress(raw, 9))
png += chunk(b"IEND", b"")
open(path, "wb").write(png)
' "$@"
}

upload() { # token bucket key filepath -> storage key
    curl -s -X POST "$BASE/storage/v1/upload" \
        -H "Authorization: Bearer $1" \
        -F "file=@$4" -F "bucket=$2" -F "key=$3" | jq_get data.key
}

# ── Preflight ───────────────────────────────────────────────────────────────
printf "Gomo6 seed → %s\n" "$BASE"
curl -sf "$BASE/health" >/dev/null 2>&1 || die "backend is not reachable at $BASE — start it with 'make dev' first"
ok "backend is up"

# ── Auth ────────────────────────────────────────────────────────────────────
login_or_register() { # username email -> token
    local username="$1" email="$2" token
    token="$(req POST /api/v1/auth/login "" "$(mkjson email "$email" password "$PASSWORD")" | jq_get data.token)"
    if [ -z "$token" ]; then
        req POST /api/v1/auth/register "" \
            "$(mkjson username "$username" email "$email" password "$PASSWORD")" >/dev/null
        token="$(req POST /api/v1/auth/login "" "$(mkjson email "$email" password "$PASSWORD")" | jq_get data.token)"
    fi
    printf '%s' "$token"
}

user_id_of() { # username -> uuid
    req GET "/api/v1/profiles?username=$1" "" | jq_get data.0.id
}

ok "users"
declare -a U_NAME=() U_EMAIL=() U_TOKEN=() U_ID=() U_DISPLAY=() U_BIO=() U_RGB=()
# username|email|display name|bio|r|g|b
USERS=(
    "demo|demo@gomo6.local|Демо Аккаунт|Люблю профили, стены и аккуратный UI.|120 86 255"
    "alice|alice@gomo6.local|Alice|Frontend-энтузиаст. Дизайн, анимации, тёмные темы.|232 90 150"
    "bob|bob@gomo6.local|Bob|Backend: Go, Postgres, Redis. Пишу и тесты.|70 130 220"
)
for rec in "${USERS[@]}"; do
    IFS='|' read -r name email display bio r g b <<<"$rec"
    token="$(login_or_register "$name" "$email")"
    [ -n "$token" ] || die "cannot authenticate '$name' — is TURNSTILE_DISABLED=1 set on the backend?"
    uid="$(user_id_of "$name")"
    [ -n "$uid" ] || die "cannot resolve id of '$name'"
    U_NAME+=("$name"); U_EMAIL+=("$email"); U_TOKEN+=("$token"); U_ID+=("$uid")
    U_DISPLAY+=("$display"); U_BIO+=("$bio"); U_RGB+=("$r $g $b")
    note "$name → $uid"
done

# ── Profiles: avatar, display name, bio, background + theme ─────────────────
ok "profiles (avatar, bio, background, theme)"
THEME_JSON='{"--background":"240 12% 8%","--foreground":"0 0% 98%","--primary":"265 85% 62%","--accent":"330 80% 60%","--card":"240 10% 12%"}'
for i in "${!U_NAME[@]}"; do
    name="${U_NAME[$i]}"; token="${U_TOKEN[$i]}"; uid="${U_ID[$i]}"
    read -r r g b <<<"${U_RGB[$i]}"

    avatar_key="$(req_get "/api/v1/profiles/$uid" | jq_get data.avatar_url)"
    if [ -z "$avatar_key" ]; then
        make_png "$TMPDIR_SEED/avatar_$name.png" 512 512 "$r" "$g" "$b"
        avatar_key="$(upload "$token" post-images "$uid/seed/avatar.png" "$TMPDIR_SEED/avatar_$name.png")"
    fi

    req PUT "/api/v1/profiles/$uid" "$token" \
        "$(mkjson display_name "${U_DISPLAY[$i]}" bio "${U_BIO[$i]}" avatar_url "$avatar_key")" >/dev/null

    bg_key="$(req_get_sql "/api/v1/profile_customization?user_id=eq.$uid" "$token" | jq_get data.0.background_url)"
    if [ -z "$bg_key" ]; then
        make_png "$TMPDIR_SEED/banner_$name.png" 1600 400 "$r" "$g" "$b"
        bg_key="$(upload "$token" post-images "$uid/seed/background.png" "$TMPDIR_SEED/banner_$name.png")"
    fi
    body="$(python3 -c 'import json,sys; print(json.dumps({"user_id":sys.argv[1],"background_url":sys.argv[2],"background_variant":"banner","theme_enabled":True,"theme_tokens":json.loads(sys.argv[3]),"language":"ru"}, ensure_ascii=False))' "$uid" "$bg_key" "$THEME_JSON")"
    req POST /api/v1/profile_customization "$token" "$body" >/dev/null
    note "$name: avatar + banner + theme"
done

# ── Friendships ─────────────────────────────────────────────────────────────
ok "friendships"
friend() { # a_token a_uid b_token b_uid — second (reverse) request auto-accepts
    req POST /api/v1/friends/request "$1" "$(mkjson receiver_id "$4")" >/dev/null || true
    req POST /api/v1/friends/request "$3" "$(mkjson receiver_id "$2")" >/dev/null || true
}
friend "${U_TOKEN[0]}" "${U_ID[0]}" "${U_TOKEN[1]}" "${U_ID[1]}"
friend "${U_TOKEN[0]}" "${U_ID[0]}" "${U_TOKEN[2]}" "${U_ID[2]}"
friend "${U_TOKEN[1]}" "${U_ID[1]}" "${U_TOKEN[2]}" "${U_ID[2]}"
note "demo↔alice, demo↔bob, alice↔bob"

# ── Board, thread and posts ─────────────────────────────────────────────────
ok "board + thread + posts"
DEMO_TOKEN="${U_TOKEN[0]}"; DEMO_ID="${U_ID[0]}"

board_id="$(req_get "/api/v1/boards?slug=eq.demo-lounge" | jq_get data.0.id)"
if [ -z "$board_id" ]; then
    board_id="$(req POST /api/v1/boards "$DEMO_TOKEN" \
        "$(mkjson slug "demo-lounge" name "Demo Lounge" description "Demo data — заходи, тут всё для UI." visibility "public")" | jq_get data.id)"
    note "board Demo Lounge created"
else
    note "board Demo Lounge already exists"
fi
[ -n "$board_id" ] || die "cannot create/find the demo board"

THREAD_TITLE="Welcome to the Demo Lounge"
thread_id="$(req_get "/api/v1/threads?board_id=eq.$board_id" | json_find data title "$THREAD_TITLE")"
if [ -z "$thread_id" ]; then
    thread_id="$(req POST /api/rpc/create_thread "$DEMO_TOKEN" \
        "$(mkjson board_id "$board_id" title "$THREAD_TITLE" content "Здесь живут демо-данные для разработки UI. Посты, картинки, лайки — всё как в жизни, только фейковое.")" \
        | jq_get data.id)"
    note "thread created"

    make_png "$TMPDIR_SEED/post_1.png" 800 600 120 86 255
    make_png "$TMPDIR_SEED/post_2.png" 800 600 232 90 150
    img1="$(upload "$DEMO_TOKEN" content "$DEMO_ID/seed/post_1.png" "$TMPDIR_SEED/post_1.png")"
    img2="$(upload "${U_TOKEN[1]}" content "${U_ID[1]}/seed/post_2.png" "$TMPDIR_SEED/post_2.png")"

    create_post() { # token author_uid content image_key(optional) -> id
        local token="$1" uid="$2" content="$3" key="${4:-}" body
        if [ -n "$key" ]; then
            body="$(python3 -c 'import json,sys
uid, content, key = sys.argv[1:4]
print(json.dumps({"thread_id":sys.argv[4],"content":content,"image_urls":[key],
  "attachments":[{"url":key,"type":"image","mime":"image/png","name":"seed.png","size":0}]}, ensure_ascii=False))' "$uid" "$content" "$key" "$thread_id")"
        else
            body="$(mkjson thread_id "$thread_id" content "$content")"
        fi
        req POST /api/rpc/create_post "$token" "$body" | jq_get data.id
    }

    p1=$(create_post "$DEMO_TOKEN" "$DEMO_ID" "Первый пост в демо-треде. Так выглядит обычный текст." "$img1")
    p2=$(create_post "${U_TOKEN[1]}" "${U_ID[1]}" "Алиса тут: запостила картинку, чтобы проверить ленту и вложения." "$img2")
    p3=$(create_post "${U_TOKEN[2]}" "${U_ID[2]}" "Bob на связи. Если видишь этот пост — API и лента работают.")
    for pid in "$p1" "$p2" "$p3"; do
        [ -n "$pid" ] && req POST "/api/v1/posts/$pid/like" "$DEMO_TOKEN" >/dev/null || true
    done
    note "3 posts + likes"
else
    note "thread already exists"
fi

# ── Wall posts on the demo profile ──────────────────────────────────────────
ok "wall posts on the demo profile"
wall_post() { # token wall_uid title content image_key(optional)
    local token="$1" wall_uid="$2" title="$3" content="$4" key="${5:-}" body
    if [ -n "$key" ]; then
        body="$(python3 -c 'import json,sys
print(json.dumps({"user_id":sys.argv[1],"title":sys.argv[2],"content":sys.argv[3],"image_url":sys.argv[4],
  "attachments":[{"url":sys.argv[4],"type":"image","mime":"image/png","name":"wall.png","size":0}]}, ensure_ascii=False))' "$wall_uid" "$title" "$content" "$key")"
    else
        body="$(mkjson user_id "$wall_uid" title "$title" content "$content")"
    fi
    req POST /api/v1/profile_wall_posts "$token" "$body" >/dev/null || true
}

existing_wall="$(req_get_sql "/api/v1/profile_wall_posts?user_id=eq.$DEMO_ID" "$DEMO_TOKEN" | json_find data title "Seed: welcome")"
if [ -z "$existing_wall" ]; then
    make_png "$TMPDIR_SEED/wall_1.png" 900 600 140 90 200
    wall_img="$(upload "$DEMO_TOKEN" wall "$DEMO_ID/seed/wall.png" "$TMPDIR_SEED/wall_1.png")"
    wall_post "$DEMO_TOKEN" "$DEMO_ID" "Seed: welcome" "Это демо-стена. Тут можно крутить UI профиля: посты, картинки, лайки, комментарии." "$wall_img"
    wall_post "$DEMO_TOKEN" "$DEMO_ID" "Seed: заметка" "Вторая запись на стене — обычный текст без вложений."
    wall_post "${U_TOKEN[1]}" "$DEMO_ID" "Seed: от Alice" "Привет! Пишу на твоей стене, проверяю гостевые посты."
    wall_post "${U_TOKEN[2]}" "$DEMO_ID" "Seed: от Bob" "И я тут. Гостевая стена работает."
    note "4 wall posts (1 with image)"
else
    note "wall posts already seeded"
fi

# ── Direct conversation ─────────────────────────────────────────────────────
ok "direct conversation (demo ↔ alice)"
conv_id="$(req POST /api/v1/messenger/conversations "$DEMO_TOKEN" "$(mkjson user_id "${U_ID[1]}")" | jq_get data.conversation_id)"
if [ -n "$conv_id" ]; then
    have="$(req_get "/api/v1/messenger/conversations/$conv_id/messages" "$DEMO_TOKEN" | jq_get data.0.id)"
    if [ -z "$have" ]; then
        send_msg() { # token conversation_id content
            req POST "/api/v1/messenger/conversations/$2/messages" "$1" \
                "$(mkjson content "$3" client_id "$(uuid)")" >/dev/null || true
        }
        send_msg "$DEMO_TOKEN" "$conv_id" "Привет, Алиса! Это демо-переписка для UI мессенджера."
        send_msg "${U_TOKEN[1]}" "$conv_id" "Привет! Отлично, тут проверим бабблы, аватары и время."
        send_msg "$DEMO_TOKEN" "$conv_id" "Ага. И ещё длинное сообщение, чтобы проверить перенос строк и ширину пузыря на узких экранах."
        note "3 messages"
    else
        note "conversation already has messages"
    fi
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
ok "seed complete"
echo ""
note "demo login:  demo@gomo6.local / $PASSWORD"
note "alice login: alice@gomo6.local / $PASSWORD"
note "bob login:   bob@gomo6.local / $PASSWORD"
echo ""
note "Open http://localhost:8081 and sign in as demo."
