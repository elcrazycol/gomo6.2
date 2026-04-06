#!/bin/bash

# Тест событий ботов
set -e

BASE_URL="http://localhost:8080"
API_URL="$BASE_URL/api/v1"
REST_URL="$BASE_URL/rest/v1"

echo "🤖 Тестирование событий ботов"
echo "=============================="
echo ""

# 1. Создание пользователя
echo "1️⃣  Создание пользователя..."
USER_RESPONSE=$(curl -s -X POST "$API_URL/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"eventuser_$(date +%s)\",
    \"email\": \"eventuser_$(date +%s)@example.com\",
    \"password\": \"testpassword123\"
  }")

TOKEN=$(echo "$USER_RESPONSE" | jq -r '.data.token')
USER_ID=$(echo "$USER_RESPONSE" | jq -r '.data.user.id')

echo "✅ Пользователь создан: $USER_ID"
echo ""

# 2. Получение списка ботов для проверки
echo "2️⃣  Проверка активных ботов..."
BOTS=$(curl -s -X GET "$API_URL/bots" \
  -H "Authorization: Bearer $TOKEN")

echo "Боты в системе:"
echo "$BOTS" | jq -r '.[] | "  - \(.username) (active: \(.is_active))"' || echo "  Нет ботов"
echo ""

# 3. Создание поста на стене с триггерным словом
echo "3️⃣  Создание поста на стене с 'привет'..."
WALL_POST=$(curl -s -X POST "$REST_URL/profile_wall_posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "apikey: your-anon-key" \
  -d "{
    \"profile_id\": \"$USER_ID\",
    \"content\": \"Привет всем! Это тестовый пост для бота.\"
  }")

WALL_POST_ID=$(echo "$WALL_POST" | jq -r '.data.id // .id // empty')

if [ -z "$WALL_POST_ID" ] || [ "$WALL_POST_ID" == "null" ]; then
  echo "⚠️  Не удалось создать пост на стене"
  echo "Ответ: $WALL_POST"
else
  echo "✅ Пост на стене создан: $WALL_POST_ID"
fi
echo ""

# 4. Подождать немного для обработки события
echo "4️⃣  Ожидание обработки события (3 секунды)..."
sleep 3
echo ""

# 5. Проверка логов бота
echo "5️⃣  Проверка логов ботов..."

# Получаем ID первого активного бота
BOT_ID=$(docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -t -c "SELECT id FROM bots WHERE is_active = true LIMIT 1;" | tr -d ' ')

if [ ! -z "$BOT_ID" ]; then
  echo "Проверка логов бота: $BOT_ID"

  # Нужен токен владельца бота для получения логов
  # Получим владельца бота
  BOT_OWNER=$(docker exec backend-go-postgres-1 psql -U gomo6 -d gomo6 -t -c "SELECT owner_id FROM bots WHERE id = '$BOT_ID';" | tr -d ' ')

  echo "Владелец бота: $BOT_OWNER"
  echo ""

  # Проверим логи в Docker
  echo "Логи backend (последние 20 строк с 'bot'):"
  docker logs backend-go-backend-1 2>&1 | grep -i "bot\|lua" | tail -20
else
  echo "⚠️  Активные боты не найдены"
fi

echo ""
echo "✅ Тест завершён"
echo ""
echo "📝 Примечание:"
echo "   Если бот не отреагировал, проверьте:"
echo "   1. Публикуются ли события в Redis канал 'bot:events'"
echo "   2. Подписан ли BotManager на этот канал"
echo "   3. Вызываются ли Lua функции ботов"
