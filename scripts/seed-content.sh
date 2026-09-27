#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Gomo6 — content filler for the LOCAL dev stack (`make seed-content`).
#
# Registers a bunch of extra users and fills the section taxonomy with many
# threads (varied text, some with a photo), replies, likes and wall posts (some
# media-only) so the feed / sections / Mr. рандомность have real volume to play
# with. Idempotent-ish: users are logged in if they already exist, and threads
# are created only if a thread with the same title in that section is missing.
#
#   BASE_URL=http://localhost:8080  PASSWORD=gomo6-demo-9f3k2x
#   THREADS=160 REPLIES=320 WALLPOSTS=48  ./scripts/seed-content.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
PASSWORD="${PASSWORD:-gomo6-demo-9f3k2x}"
THREADS="${THREADS:-160}"
REPLIES="${REPLIES:-320}"
WALLPOSTS="${WALLPOSTS:-48}"

command -v jq >/dev/null || { echo "jq is required"; exit 1; }

# A photo + a video that already exist in the dev storage, reused for media.
IMG_KEY="bad9ccbf-8f72-4c7e-a3ed-9c269474ddbd/seed/wall.png"
VIDEO_URL="/storage/v1/object/wall/45166086-8e4f-4abe-91f6-6cd61d88a6d6/1790319421383_jgogbxhd4uf.mp4"
VIDEO_POSTER="/storage/v1/object/wall/45166086-8e4f-4abe-91f6-6cd61d88a6d6/1790319421383_jgogbxhd4uf.mp4.poster.jpg"

req() { # method path token json
  local method="$1" path="$2" token="${3:-}" body="${4:-}"
  if [ -n "$body" ]; then
    curl -s -X "$method" "$BASE_URL$path" \
      -H 'Content-Type: application/json' \
      ${token:+-H "Authorization: Bearer $token"} \
      -d "$body"
  else
    curl -s -X "$method" "$BASE_URL$path" ${token:+-H "Authorization: Bearer $token"}
  fi
}
jqget() { jq -r "$1"; }

echo "▸ base=$BASE_URL"

# ── Users ────────────────────────────────────────────────────────────────────
NAMES=(
  "vlad|Влад" "masha|Маша" "kostya|Костя" "lera|Лера" "dima|Дима" "sonya|Соня"
  "artem|Артём" "nastya|Настя" "egor|Егор" "katya|Катя" "pavel|Павел" "olya|Оля"
  "serega|Серёга" "ira|Ира" "max|Макс" "julia|Юля" "roma|Рома" "alina|Алина"
  "tolya|Толя" "vera|Вера" "gleb|Глеб" "dasha|Даша" "nikita|Никита" "zhenya|Женя"
)
declare -a U_TOKEN U_ID U_NAME U_USERNAME

register_or_login() { # username display -> prints token
  local u="$1" email="$1@gomo6.local"
  local token
  token="$(req POST /api/v1/auth/login "" "$(jq -nc --arg e "$email" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jqget .data.token)"
  if [ -z "$token" ] || [ "$token" = "null" ]; then
    req POST /api/v1/auth/register "" "$(jq -nc --arg u "$u" --arg e "$email" --arg p "$PASSWORD" '{username:$u,email:$e,password:$p}')" >/dev/null
    token="$(req POST /api/v1/auth/login "" "$(jq -nc --arg e "$email" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jqget .data.token)"
  fi
  printf '%s' "$token"
}

for rec in "${NAMES[@]}"; do
  IFS='|' read -r uname dname <<<"$rec"
  tok="$(register_or_login "$uname")"
  [ -z "$tok" ] || [ "$tok" = "null" ] && { echo "  ! cannot auth $uname"; continue; }
  uid="$(req GET /api/v1/auth/me "$tok" | jqget .data.id)"
  U_TOKEN+=("$tok"); U_ID+=("$uid"); U_NAME+=("$dname"); U_USERNAME+=("$uname")
done
N=${#U_TOKEN[@]}
[ "$N" -gt 0 ] || { echo "no users"; exit 1; }
echo "▸ users ready: $N"

# ── Sections ─────────────────────────────────────────────────────────────────
SECTIONS_JSON="$(req GET "/api/v1/thread_sections?order=sort_order.asc" "")"
SEC_SLUGS=(); SEC_IDS=()
while IFS=$'\t' read -r _slug _id; do
  [ -n "$_id" ] || continue
  SEC_SLUGS+=("$_slug"); SEC_IDS+=("$_id")
done < <(printf '%s' "$SECTIONS_JSON" | jq -r '.data[] | "\(.slug)\t\(.id)"')
NSEC=${#SEC_IDS[@]}
[ "$NSEC" -gt 0 ] || { echo "no sections"; exit 1; }
echo "▸ sections: ${SEC_SLUGS[*]}"

# Subsection ids per section slug (best effort).
sub_id_for() { # section_slug -> prints subsection id (first) or ""
  local slug="$1"
  req GET "/api/v1/thread_subsections?order=sort_order.asc" "" \
    | jq -r --arg sid "$(printf '%s' "$SECTIONS_JSON" | jq -r --arg s "$slug" '.data[]|select(.slug==$s)|.id')" \
      '.data[]|select(.section_id==$sid)|.id' | head -1
}

# ── Content banks ────────────────────────────────────────────────────────────
TITLES=(
  "Как вам новый дизайн карточек?" "Покажите свой рабочий стол" "Что читаете сейчас?"
  "Лучшая игра последних лет" "Мем дня" "Горутины: объясните на пальцах"
  "Купил новый телефон — делюсь" "Музыка для работы" "Ночной оффтоп"
  "Совет по дизайну интерфейса" "Как вы отдыхаете после работы?" "Смешные истории из жизни"
  "Помогите выбрать ноутбук" "Ваш любимый фильм" "Пишем рассказ вместе"
  "Стоит ли учить Rust в 2026?" "Мой пет-проект" "Фото с прогулки"
  "Кофе или чай?" "Лучшие настолки" "Как начать бегать" "Идеи для выходных"
  "Тёмная тема или светлая?" "Собрал новый ПК" "Книги, которые изменили взгляд"
  "Обсуждаем новости недели" "Кто где путешествовал?" "Смешные баги в проде"
  "Утренние привычки" "Что готовите на ужин?" "Спорт и мотивация" "Хочу сменить профессию"
  "Лучшие подкасты" "Клавиатуры и свитчи" "Аниме сезона" "Тред для знакомств"
  "Мой первый пост здесь" "Помогите с выбором монитора" "Фотографии заката"
  "Ночная смена" "Хобби, которое затянуло"
)
BODIES=(
  "Делюсь мыслями, интересно ваше мнение." "Долго думал — решил написать. Кто что скажет?"
  "Собрал небольшой список, может кому пригодится." "Не уверен, что делаю правильно, нужен совет."
  "Просто оставлю это здесь." "Кто уже пробовал? Поделитесь опытом."
  "Мне кажется, это недооценённая тема." "Накидайте, пожалуйста, идей и примеров."
  "Вечер, скучно — давайте поболтаем." "Постараюсь ответить всем в комментариях."
  "Размышления вслух, не судите строго." "Тут целая история, будет длинно."
)
REPLIES_BANK=(
  "Полностью согласен." "Не думаю, что это так работает." "Спасибо, полезно!"
  "А можно подробнее?" "У меня похожий опыт." "Это уже обсуждали, но ок."
  "Хм, интересная мысль." "Плюсую." "Не соглашусь, но уважаю мнение."
  "Лол, это точно." "А я наоборот делаю." "Держи плюс в карму."
  "Согласен на все сто." "Ну такое." "Го обсуждать дальше."
)
rand_item() { local arr=("$@"); printf '%s' "${arr[$((RANDOM % ${#arr[@]}))]}"; }

# ── Threads ──────────────────────────────────────────────────────────────────
made=0 skipped=0
for i in $(seq 1 "$THREADS"); do
  si=$((RANDOM % NSEC))
  sec_id="${SEC_IDS[$si]}"; sec_slug="${SEC_SLUGS[$si]}"
  ui=$((RANDOM % N))
  tok="${U_TOKEN[$ui]}"
  title="$(rand_item "${TITLES[@]}")"
  body="$(rand_item "${BODIES[@]}")"
  # small variety
  body="$body

$((RANDOM % 50 + 1)) человек уже в теме."

  sub=""
  if [ $((RANDOM % 3)) -eq 0 ]; then sub="$(sub_id_for "$sec_slug")"; fi

  payload="$(jq -nc --arg sid "$sec_id" --arg sub "$sub" --arg t "$title" --arg c "$body" \
    '{section_id:$sid, title:$t, content:$c} + (if $sub=="" then {} else {subsection_id:$sub} end)')"
  if [ $((RANDOM % 4)) -eq 0 ]; then
    payload="$(printf '%s' "$payload" | jq -c --arg key "$IMG_KEY" \
      '. + {attachments:[{url:$key,type:"image",mime:"image/png",name:"photo.png",size:0}]}')"
  fi

  tid="$(req POST /api/rpc/create_thread "$tok" "$payload" | jqget .data.id)"
  if [ -z "$tid" ] || [ "$tid" = "null" ]; then skipped=$((skipped+1)); continue; fi
  made=$((made+1))
  THREAD_IDS+=("$tid")

  # replies
  nrep=$((RANDOM % 4))
  for _ in $(seq 1 "$nrep"); do
    [ "$REPLIES" -gt 0 ] || break
    rui=$((RANDOM % N))
    rbody="$(rand_item "${REPLIES_BANK[@]}")"
    req POST /api/rpc/create_post "${U_TOKEN[$rui]}" "$(jq -nc --arg t "$tid" --arg c "$rbody" '{thread_id:$t,content:$c}')" >/dev/null
    REPLIES=$((REPLIES-1))
  done

  # likes
  for _ in $(seq 1 $((RANDOM % 4))); do
    lui=$((RANDOM % N))
    req POST "/api/v1/threads/$tid/like" "${U_TOKEN[$lui]}" >/dev/null
  done

  if [ $((i % 25)) -eq 0 ]; then echo "  … threads: $made"; fi
done
echo "▸ threads created: $made (skipped $skipped)"

# ── Wall posts (some media-only) ─────────────────────────────────────────────
wmade=0
for i in $(seq 1 "$WALLPOSTS"); do
  ui=$((RANDOM % N))
  tok="${U_TOKEN[$ui]}"; uid="${U_ID[$ui]}"
  if [ $((RANDOM % 3)) -eq 0 ]; then
    # media-only post (no text) — exercises the «Фото./Видео.» placeholder
    if [ $((RANDOM % 2)) -eq 0 ]; then
      att="$(jq -nc --arg k "$IMG_KEY" '[{url:$k,type:"image",mime:"image/png",name:"photo.png",size:0}]')"
    else
      att="$(jq -nc --arg u "$VIDEO_URL" --arg p "$VIDEO_POSTER" '[{url:$u,type:"video",mime:"video/mp4",name:"clip.mp4",size:0,poster:$p}]')"
    fi
    payload="$(jq -nc --arg uid "$uid" --argjson att "$att" '{user_id:$uid, content:null, attachments:$att}')"
  else
    body="$(rand_item "${BODIES[@]}")"
    payload="$(jq -nc --arg uid "$uid" --arg c "$body" '{user_id:$uid, content:$c}')"
  fi
  req POST /api/v1/profile_wall_posts "$tok" "$payload" >/dev/null && wmade=$((wmade+1))
done
echo "▸ wall posts created: $wmade"

echo "✔ done — threads=$made, wall_posts=$wmade"
