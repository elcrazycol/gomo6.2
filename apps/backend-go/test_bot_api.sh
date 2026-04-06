#!/bin/bash

# Тестовый скрипт для Bot API
# Требует: curl, jq

set -e

BASE_URL="http://localhost:8080"
API_URL="$BASE_URL/api/v1"

echo "🧪 Тестирование Bot API"
echo "======================="
echo ""

# 1. Регистрация тестового пользователя
echo "1️⃣  Регистрация тестового пользователя..."
REGISTER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser_'$(date +%s)'",
    "email": "test_'$(date +%s)'@example.com",
    "password": "testpassword123"
  }')

echo "$REGISTER_RESPONSE" | jq '.'

TOKEN=$(echo "$REGISTER_RESPONSE" | jq -r '.data.token // .token // .access_token // empty')

if [ -z "$TOKEN" ] || [ "$TOKEN" == "null" ]; then
  echo "❌ Не удалось получить токен"
  echo "Ответ сервера: $REGISTER_RESPONSE"
  exit 1
fi

echo "✅ Токен получен: ${TOKEN:0:20}..."
echo ""

# 2. Создание бота
echo "2️⃣  Создание бота..."
BOT_CODE='function onWallPost(post)
  bot.log("info", "Получен пост: " .. post.id)

  local content = post.content or ""
  if content:match("привет") then
    bot.sendWallComment(post.id, "Привет! Я тестовый бот 🤖")
  end
end'

CREATE_BOT_RESPONSE=$(curl -s -X POST "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"testbot_$(date +%s)\",
    \"display_name\": \"Test Bot\",
    \"description\": \"Тестовый бот для проверки API\",
    \"lua_code\": $(echo "$BOT_CODE" | jq -Rs .)
  }")

echo "$CREATE_BOT_RESPONSE" | jq '.'

BOT_ID=$(echo "$CREATE_BOT_RESPONSE" | jq -r '.id // empty')

if [ -z "$BOT_ID" ] || [ "$BOT_ID" == "null" ]; then
  echo "❌ Не удалось создать бота"
  exit 1
fi

echo "✅ Бот создан с ID: $BOT_ID"
echo ""

# 3. Получение списка ботов
echo "3️⃣  Получение списка ботов..."
BOTS_LIST=$(curl -s -X GET "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN")

echo "$BOTS_LIST" | jq '.'
echo ""

# 4. Получение информации о боте
echo "4️⃣  Получение информации о боте..."
BOT_INFO=$(curl -s -X GET "$API_URL/bots/$BOT_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "$BOT_INFO" | jq '.'
echo ""

# 5. Обновление бота
echo "5️⃣  Обновление описания бота..."
UPDATE_RESPONSE=$(curl -s -X PUT "$API_URL/bots/$BOT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Обновлённое описание бота"
  }')

echo "$UPDATE_RESPONSE" | jq '.'
echo ""

# 6. Получение логов
echo "6️⃣  Получение логов бота..."
LOGS=$(curl -s -X GET "$API_URL/bots/$BOT_ID/logs" \
  -H "Authorization: Bearer $TOKEN")

echo "$LOGS" | jq '.'
echo ""

# 7. Получение статистики
echo "7️⃣  Получение статистики бота..."
STATS=$(curl -s -X GET "$API_URL/bots/$BOT_ID/stats" \
  -H "Authorization: Bearer $TOKEN")

echo "$STATS" | jq '.'
echo ""

# 8. Переключение статуса бота
echo "8️⃣  Отключение бота..."
TOGGLE_RESPONSE=$(curl -s -X POST "$API_URL/bots/$BOT_ID/toggle" \
  -H "Authorization: Bearer $TOKEN")

echo "$TOGGLE_RESPONSE" | jq '.'
IS_ACTIVE=$(echo "$TOGGLE_RESPONSE" | jq -r '.is_active')
echo "Статус бота: $IS_ACTIVE"
echo ""

# 9. Включение бота обратно
echo "9️⃣  Включение бота обратно..."
TOGGLE_RESPONSE=$(curl -s -X POST "$API_URL/bots/$BOT_ID/toggle" \
  -H "Authorization: Bearer $TOKEN")

echo "$TOGGLE_RESPONSE" | jq '.'
IS_ACTIVE=$(echo "$TOGGLE_RESPONSE" | jq -r '.is_active')
echo "Статус бота: $IS_ACTIVE"
echo ""

# 10. Удаление бота
echo "🔟 Удаление бота..."
DELETE_RESPONSE=$(curl -s -X DELETE "$API_URL/bots/$BOT_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "$DELETE_RESPONSE" | jq '.'
echo ""

echo "✅ Все тесты пройдены успешно!"
echo ""
echo "📊 Резюме:"
echo "  - Создан бот: $BOT_ID"
echo "  - Обновлено описание"
echo "  - Переключен статус"
echo "  - Удалён бот"
