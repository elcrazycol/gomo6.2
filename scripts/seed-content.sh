#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Gomo6 — dev content filler for the «Общение» section.
#
# Uses the EXISTING test accounts (demo / alice / bob) — no new users — and
# fills the «Общение» раздел with on-topic threads (болталка / знакомства /
# встречи / оффтоп), replies, likes and a few wall posts (some media-only).
#
#   BASE_URL=http://localhost:8080  PASSWORD=gomo6-demo-9f3k2x
#   THREADS=120 REPLIES=240 WALLPOSTS=20  ./scripts/seed-content.sh
#   ./scripts/seed-content.sh --clean     # delete the seeded threads in «Общение»
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
PASSWORD="${PASSWORD:-gomo6-demo-9f3k2x}"
THREADS="${THREADS:-120}"
REPLIES="${REPLIES:-240}"
WALLPOSTS="${WALLPOSTS:-20}"
SECTION_SLUG="${SECTION_SLUG:-general}"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

# Full storage paths (the bare key alone does not resolve in the frontend).
IMG_URL="/storage/v1/object/wall/45166086-8e4f-4abe-91f6-6cd61d88a6d6/1790287370617_4lu3peosxt3.webp"
VIDEO_URL="/storage/v1/object/wall/45166086-8e4f-4abe-91f6-6cd61d88a6d6/1790319421383_jgogbxhd4uf.mp4"
VIDEO_POSTER="/storage/v1/object/wall/45166086-8e4f-4abe-91f6-6cd61d88a6d6/1790319421383_jgogbxhd4uf.mp4.poster.jpg"

# username|email — the canonical test accounts created by `make seed`.
ACCOUNTS=("demo|demo@gomo6.local" "alice|alice@gomo6.local" "bob|bob@gomo6.local")

req() { # method path token json
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$BASE_URL$path" -H 'Content-Type: application/json' \
      ${token:+-H "Authorization: Bearer $token"} -d "$body"
  else
    curl -s -X "$method" "$BASE_URL$path" ${token:+-H "Authorization: Bearer $token"}
  fi
}
jqget() { jq -r "$1"; }

# ── --clean: drop the seeded threads in the target section ───────────────────
if [ "${1:-}" = "--clean" ]; then
  command -v docker >/dev/null || { echo "docker needed for --clean"; exit 1; }
  PG="$(docker ps --format '{{.Names}}' | grep -i postgres | head -1)"
  [ -n "$PG" ] || { echo "no postgres container"; exit 1; }
  docker exec -i "$PG" psql -U gomo6 -d gomo6 <<SQL
WITH ids AS (
  SELECT t.id FROM threads t
  JOIN thread_sections s ON s.id = t.section_id
  JOIN users u ON u.id = t.user_id
  WHERE s.slug = '$SECTION_SLUG' AND u.username IN ('demo','alice','bob')
)
, del_likes AS (DELETE FROM thread_likes WHERE thread_id IN (SELECT id FROM ids))
, del_posts AS (DELETE FROM posts WHERE thread_id IN (SELECT id FROM ids))
DELETE FROM threads WHERE id IN (SELECT id FROM ids);
SQL
  echo "✔ cleaned seeded threads in «$SECTION_SLUG»"
  exit 0
fi

echo "▸ base=$BASE_URL  section=$SECTION_SLUG"

# ── Accounts ─────────────────────────────────────────────────────────────────
U_TOKEN=(); U_ID=(); U_NAME=()
for rec in "${ACCOUNTS[@]}"; do
  IFS='|' read -r uname email <<<"$rec"
  tok="$(req POST /api/v1/auth/login "" "$(jq -nc --arg e "$email" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jqget .data.token)"
  if [ -z "$tok" ] || [ "$tok" = "null" ]; then echo "  ! cannot auth $uname"; continue; fi
  uid="$(req GET /api/v1/auth/me "$tok" | jqget .data.id)"
  U_TOKEN+=("$tok"); U_ID+=("$uid"); U_NAME+=("$uname")
done
N=${#U_TOKEN[@]}
[ "$N" -gt 0 ] || { echo "no accounts"; exit 1; }
echo "▸ accounts: ${U_NAME[*]}"

SECTION_ID="$(req GET "/api/v1/thread_sections?slug=eq.$SECTION_SLUG" "" | jqget '.data[0].id')"
[ -n "$SECTION_ID" ] && [ "$SECTION_ID" != "null" ] || { echo "section '$SECTION_SLUG' not found"; exit 1; }

# ── Content banks (on-topic for «Общение») ───────────────────────────────────
TITLES=(
  "Оффтоп-тред" "Просто поболтать" "Как прошли выходные?" "Ищу компанию на вечер"
  "Кто откуда родом?" "Что вас радует сегодня?" "Планы на неделю" "Уютные вечера"
  "Давайте знакомиться" "Кто чем занят?" "Скучно, расскажите что-нибудь"
  "Пятничный тред" "Ночная болталка" "Делимся планами на отпуск" "Кофе или чай?"
  "Ваш день в трёх словах" "Мини-знакомства" "Встречи в городе" "Просто дневник"
  "Как вы познакомились с друзьями?" "Любимое место в городе" "Что посмотреть вечером?"
)
BODIES=(
  "Делюсь мыслями, интересно ваше мнение." "Долго думал — решил написать. Кто что скажет?"
  "Кто уже пробовал? Поделитесь опытом." "Накидайте, пожалуйста, идей и примеров."
  "Размышления вслух, не судите строго." "Тут целая история, будет длинно."
  "Просто оставлю это здесь." "Вечер, скучно — давайте поболтаем."
  "Постараюсь ответить всем в комментариях." "Мне кажется, это недооценённая тема."
)
REPLIES_BANK=(
  "Полностью согласен." "Не думаю, что это так работает." "Спасибо, полезно!"
  "А можно подробнее?" "У меня похожий опыт." "Хм, интересная мысль." "Плюсую."
  "Не соглашусь, но уважаю мнение." "Лол, это точно." "А я наоборот делаю."
  "Держи плюс в карму." "Согласен на все сто." "Ну такое." "Го обсуждать дальше."
  "О, это по мне." "Классная тема!"
)
pick() { local arr=("$@"); printf '%s' "${arr[$((RANDOM % ${#arr[@]}))]}"; }

# ── Threads ──────────────────────────────────────────────────────────────────
made=0
for i in $(seq 1 "$THREADS"); do
  tok="${U_TOKEN[$((RANDOM % N))]}"
  tid="$(req POST /api/rpc/create_thread "$tok" \
    "$(jq -nc --arg sid "$SECTION_ID" --arg t "$(pick "${TITLES[@]}")" --arg c "$(pick "${BODIES[@]}")" \
      '{section_id:$sid,title:$t,content:$c}')" | jqget .data.id)"
  if [ -z "$tid" ] || [ "$tid" = "null" ]; then continue; fi
  made=$((made+1))

  for _ in $(seq 1 $((RANDOM % 4))); do
    [ "$REPLIES" -gt 0 ] || break
    req POST /api/rpc/create_post "${U_TOKEN[$((RANDOM % N))]}" \
      "$(jq -nc --arg t "$tid" --arg c "$(pick "${REPLIES_BANK[@]}")" '{thread_id:$t,content:$c}')" >/dev/null
    REPLIES=$((REPLIES-1))
  done
  for _ in $(seq 1 $((RANDOM % 4))); do
    req POST "/api/v1/threads/$tid/like" "${U_TOKEN[$((RANDOM % N))]}" >/dev/null
  done
  [ $((i % 25)) -eq 0 ] && echo "  … threads: $made"
done
echo "▸ threads created: $made"

# ── Wall posts (some media-only) ─────────────────────────────────────────────
wmade=0
for _ in $(seq 1 "$WALLPOSTS"); do
  ui=$((RANDOM % N)); tok="${U_TOKEN[$ui]}"; uid="${U_ID[$ui]}"
  if [ $((RANDOM % 3)) -eq 0 ]; then
    if [ $((RANDOM % 2)) -eq 0 ]; then
      att="$(jq -nc --arg k "$IMG_URL" '[{url:$k,type:"image",mime:"image/webp",name:"photo.webp",size:0}]')"
    else
      att="$(jq -nc --arg u "$VIDEO_URL" --arg p "$VIDEO_POSTER" '[{url:$u,type:"video",mime:"video/mp4",name:"clip.mp4",size:0,poster:$p}]')"
    fi
    payload="$(jq -nc --arg uid "$uid" --argjson att "$att" '{user_id:$uid, content:null, attachments:$att}')"
  else
    payload="$(jq -nc --arg uid "$uid" --arg c "$(pick "${BODIES[@]}")" '{user_id:$uid, content:$c}')"
  fi
  req POST /api/v1/profile_wall_posts "$tok" "$payload" >/dev/null && wmade=$((wmade+1))
done
echo "▸ wall posts created: $wmade"
echo "✔ done — threads=$made, wall_posts=$wmade  (clean: $0 --clean)"
