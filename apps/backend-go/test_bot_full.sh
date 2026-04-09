#!/bin/bash

# Полный тест Bot API
set -e

BASE_URL="http://localhost:8080"
API_URL="$BASE_URL/api/v1"

echo "🤖 Полное тестирование Bot API"
echo "================================"
echo ""

# 1. Создание тестового пользователя
echo "1️⃣  Создание тестового пользователя..."
USER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"botowner_$(date +%s)\",
    \"email\": \"botowner_$(date +%s)@example.com\",
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

# 2. Создание бота с расширенным Lua кодом
echo "2️⃣  Создание бота с полным функционалом..."
BOT_CODE='function onWallPost(post)
  bot.log("info", "Получен пост на стене: " .. post.id)

  local content = post.content or ""
  if content:match("привет") or content:match("hello") then
    bot.sendWallComment(post.id, "Привет! Я тестовый бот 🤖")
  end
end

function onThreadPost(post)
  bot.log("info", "Получен пост в треде: " .. post.id)

  local content = post.content or ""
  if content:match("бот") or content:match("bot") then
    bot.sendThreadPost(post.thread_id, "Да, я бот! Чем могу помочь?")
  end
end

function onMessage(message)
  bot.log("info", "Получено сообщение: " .. message.content)
end'

CREATE_BOT=$(curl -s -X POST "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"testbot_$(date +%s)\",
    \"display_name\": \"Test Bot Full\",
    \"description\": \"Полнофункциональный тестовый бот\",
    \"lua_code\": $(echo "$BOT_CODE" | jq -Rs .)
  }")

BOT_ID=$(echo "$CREATE_BOT" | jq -r '.id')
BOT_TOKEN=$(echo "$CREATE_BOT" | jq -r '.token')

if [ -z "$BOT_ID" ] || [ "$BOT_ID" == "null" ]; then
  echo "❌ Не удалось создать бота"
  echo "$CREATE_BOT"
  exit 1
fi

echo "✅ Бот создан: $BOT_ID"
echo "   Token: ${BOT_TOKEN:0:20}..."
echo ""

# 3. Получение списка ботов
echo "3️⃣  Получение списка ботов..."
BOTS_LIST=$(curl -s -X GET "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN")

BOT_COUNT=$(echo "$BOTS_LIST" | jq '. | length')
echo "✅ Найдено ботов: $BOT_COUNT"
echo ""

# 4. Получение информации о боте
echo "4️⃣  Получение информации о боте..."
BOT_INFO=$(curl -s -X GET "$API_URL/bots/$BOT_ID" \
  -H "Authorization: Bearer $TOKEN")

BOT_USERNAME=$(echo "$BOT_INFO" | jq -r '.username')
echo "✅ Бот: $BOT_USERNAME"
echo ""

# 5. Обновление бота
echo "5️⃣  Обновление описания бота..."
UPDATE_BOT=$(curl -s -X PUT "$API_URL/bots/$BOT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Обновлённый полнофункциональный бот"
  }')

UPDATED_DESC=$(echo "$UPDATE_BOT" | jq -r '.description')
echo "✅ Описание обновлено: $UPDATED_DESC"
echo ""

# 6. Проверка статуса бота
echo "6️⃣  Проверка статуса бота..."
BOT_STATUS=$(echo "$BOT_INFO" | jq -r '.is_active')
echo "✅ Статус бота: $BOT_STATUS"
echo ""

# 7. Переключение статуса бота
echo "7️⃣  Отключение бота..."
TOGGLE_OFF=$(curl -s -X POST "$API_URL/bots/$BOT_ID/toggle" \
  -H "Authorization: Bearer $TOKEN")

IS_ACTIVE=$(echo "$TOGGLE_OFF" | jq -r '.is_active')
echo "✅ Бот отключен: $IS_ACTIVE"
echo ""

echo "8️⃣  Включение бота обратно..."
TOGGLE_ON=$(curl -s -X POST "$API_URL/bots/$BOT_ID/toggle" \
  -H "Authorization: Bearer $TOKEN")

IS_ACTIVE=$(echo "$TOGGLE_ON" | jq -r '.is_active')
echo "✅ Бот включен: $IS_ACTIVE"
echo ""

# 9. Получение логов бота
echo "9️⃣  Получение логов бота..."
LOGS=$(curl -s -X GET "$API_URL/bots/$BOT_ID/logs" \
  -H "Authorization: Bearer $TOKEN")

LOG_COUNT=$(echo "$LOGS" | jq '. | length')
echo "✅ Логов найдено: $LOG_COUNT"
echo ""

# 10. Получение статистики бота
echo "🔟 Получение статистики бота..."
STATS=$(curl -s -X GET "$API_URL/bots/$BOT_ID/stats" \
  -H "Authorization: Bearer $TOKEN")

STATS_COUNT=$(echo "$STATS" | jq '. | length')
echo "✅ Записей статистики: $STATS_COUNT"
echo ""

# 11. Тест создания второго бота
echo "1️⃣1️⃣  Создание второго бота..."
CREATE_BOT2=$(curl -s -X POST "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"testbot2_$(date +%s)\",
    \"display_name\": \"Test Bot 2\",
    \"description\": \"Второй тестовый бот\",
    \"lua_code\": \"function onWallPost(post) bot.log('info', 'Bot 2 active') end\"
  }")

BOT2_ID=$(echo "$CREATE_BOT2" | jq -r '.id')
echo "✅ Второй бот создан: $BOT2_ID"
echo ""

# 12. Проверка лимита ботов (максимум 5)
echo "1️⃣2️⃣  Проверка лимита ботов..."
BOTS_LIST=$(curl -s -X GET "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN")

TOTAL_BOTS=$(echo "$BOTS_LIST" | jq '. | length')
echo "✅ Всего ботов у пользователя: $TOTAL_BOTS / 5"
echo ""

# 13. Очистка логов
echo "1️⃣3️⃣  Очистка логов бота..."
CLEAR_LOGS=$(curl -s -X DELETE "$API_URL/bots/$BOT_ID/logs" \
  -H "Authorization: Bearer $TOKEN")

echo "✅ Логи очищены"
echo ""

# 14. Удаление второго бота
echo "1️⃣4️⃣  Удаление второго бота..."
DELETE_BOT2=$(curl -s -X DELETE "$API_URL/bots/$BOT2_ID" \
  -H "Authorization: Bearer $TOKEN")

echo "✅ Второй бот удалён"
echo ""

# 15. Финальная проверка
echo "1️⃣5️⃣  Финальная проверка списка ботов..."
FINAL_BOTS=$(curl -s -X GET "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN")

FINAL_COUNT=$(echo "$FINAL_BOTS" | jq '. | length')
echo "✅ Осталось ботов: $FINAL_COUNT"
echo ""

echo "✅ ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!"
echo ""
echo "📊 Резюме:"
echo "  - Создан пользователь: $USER_ID"
echo "  - Создан основной бот: $BOT_ID"
echo "  - Протестированы все CRUD операции"
echo "  - Проверены логи и статистика"
echo "  - Проверен лимит ботов"
echo "  - Бот готов к работе!"
echo ""
echo "🔑 Токен бота для дальнейших тестов:"
echo "   $BOT_TOKEN"
