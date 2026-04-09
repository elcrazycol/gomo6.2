#!/bin/bash

# Полный интеграционный тест ботов
set -e

BASE_URL="http://localhost:8080"
API_URL="$BASE_URL/api/v1"
REST_URL="$BASE_URL/rest/v1"

echo "🤖 Интеграционный тест ботов"
echo "============================="
echo ""

# 1. Создание пользователя
echo "1️⃣  Создание пользователя..."
USER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"testuser_$(date +%s)\",
    \"email\": \"testuser_$(date +%s)@example.com\",
    \"password\": \"testpassword123\"
  }")

TOKEN=$(echo "$USER_RESPONSE" | jq -r '.data.token')
USER_ID=$(echo "$USER_RESPONSE" | jq -r '.data.user.id')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Не удалось получить токен"
  exit 1
fi

echo "✅ Пользователь создан: $USER_ID"
echo ""

# 2. Создание бота с триггером на слово "привет"
echo "2️⃣  Создание бота..."
BOT_CODE='function onThreadPost(post)
  bot.log("info", "Получен пост в треде: " .. post.id)

  local content = post.content or ""
  if content:match("привет") or content:match("hello") then
    bot.log("info", "Найдено триггерное слово! Отвечаю...")
    bot.sendThreadPost(post.thread_id, "Привет! Я бот и я вижу твоё сообщение! 🤖")
  end
end'

CREATE_BOT=$(curl -s -X POST "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"testbot_$(date +%s)\",
    \"display_name\": \"Test Bot\",
    \"description\": \"Тестовый бот для проверки событий\",
    \"lua_code\": $(echo "$BOT_CODE" | jq -Rs .)
  }")

BOT_ID=$(echo "$CREATE_BOT" | jq -r '.id')

if [ -z "$BOT_ID" ] || [ "$BOT_ID" == "null" ]; then
  echo "❌ Не удалось создать бота"
  echo "$CREATE_BOT"
  exit 1
fi

echo "✅ Бот создан: $BOT_ID"
echo ""

# 3. Получение первого доступного борда
echo "3️⃣  Получение борда..."
BOARDS=$(curl -s -X GET "$REST_URL/boards?limit=1")
BOARD_ID=$(echo "$BOARDS" | jq -r '.data[0].id')

if [ -z "$BOARD_ID" ] || [ "$BOARD_ID" == "null" ]; then
  echo "❌ Не найдено ни одного борда"
  exit 1
fi

echo "✅ Используем борд: $BOARD_ID"
echo ""

# 4. Создание треда
echo "4️⃣  Создание треда..."
THREAD=$(curl -s -X POST "$REST_URL/threads" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "apikey: your-anon-key" \
  -d "{
    \"board_id\": \"$BOARD_ID\",
    \"title\": \"Тест ботов\",
    \"content\": \"Тестовый тред для проверки ботов\"
  }")

THREAD_ID=$(echo "$THREAD" | jq -r '.data.id')

if [ -z "$THREAD_ID" ] || [ "$THREAD_ID" == "null" ]; then
  echo "❌ Не удалось создать тред"
  echo "$THREAD"
  exit 1
fi

echo "✅ Тред создан: $THREAD_ID"
echo ""

# 5. Подождать немного для загрузки бота
echo "5️⃣  Ожидание загрузки бота (2 секунды)..."
sleep 2
echo ""

# 6. Создание поста с триггерным словом
echo "6️⃣  Создание поста с триггерным словом 'привет'..."
POST=$(curl -s -X POST "$REST_URL/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "apikey: your-anon-key" \
  -d "{
    \"thread_id\": \"$THREAD_ID\",
    \"content\": \"Привет всем! Это тестовое сообщение для бота.\"
  }")

POST_ID=$(echo "$POST" | jq -r '.data.id')

if [ -z "$POST_ID" ] || [ "$POST_ID" == "null" ]; then
  echo "❌ Не удалось создать пост"
  echo "$POST"
  exit 1
fi

echo "✅ Пост создан: $POST_ID"
echo ""

# 7. Подождать обработки события
echo "7️⃣  Ожидание обработки события ботом (3 секунды)..."
sleep 3
echo ""

# 8. Проверка постов в треде
echo "8️⃣  Проверка постов в треде..."
POSTS=$(curl -s -X GET "$REST_URL/posts?thread_id=eq.$THREAD_ID")
POST_COUNT=$(echo "$POSTS" | jq '.data | length')

echo "Всего постов в треде: $POST_COUNT"
echo ""

if [ "$POST_COUNT" -gt 1 ]; then
  echo "✅ Бот ответил! Посты в треде:"
  echo "$POSTS" | jq -r '.data[] | "  - [\(.id)] \(.content)"'
else
  echo "⚠️  Бот не ответил. Проверяем логи..."
fi
echo ""

# 9. Проверка логов бота
echo "9️⃣  Проверка логов бота..."
LOGS=$(curl -s -X GET "$API_URL/bots/$BOT_ID/logs" \
  -H "Authorization: Bearer $TOKEN")

LOG_COUNT=$(echo "$LOGS" | jq '. | length')
echo "Логов найдено: $LOG_COUNT"

if [ "$LOG_COUNT" -gt 0 ]; then
  echo "Последние логи:"
  echo "$LOGS" | jq -r '.[] | "  [\(.level)] \(.message)"'
else
  echo "⚠️  Логов нет"
fi
echo ""

# 10. Проверка логов Docker
echo "🔟 Проверка логов backend (события ботов)..."
docker logs backend-go-backend-1 2>&1 | grep -i "bot\|lua\|event" | tail -15
echo ""

echo "✅ Тест завершён"
echo ""
echo "📊 Резюме:"
echo "  - Пользователь: $USER_ID"
echo "  - Бот: $BOT_ID"
echo "  - Тред: $THREAD_ID"
echo "  - Пост: $POST_ID"
echo "  - Постов в треде: $POST_COUNT"
echo "  - Логов бота: $LOG_COUNT"
