# Проблемы для исправления

## Критические проблемы

### 1. Storage/Avatar загрузка
```
GET http://localhost:8080/storage/v1/object/post-images/.../avatar_1775262164552.jpg
NS_BINDING_ABORTED
A resource is blocked by OpaqueResponseBlocking
```
**Причина**: Проблема с CORS или неправильная конфигурация storage
**Приоритет**: Высокий

### 2. Неожиданные всплески CPU до 100%
**Симптомы**: Резкие скачки CPU без видимой причины
**Возможные причины**:
- Garbage Collection в Go
- Компиляция Lua кода при загрузке ботов
- Deadlock или race condition
- Неэффективные запросы к БД

**Действия для диагностики**:
- Добавить профилирование (pprof)
- Логировать длительные операции
- Проверить горутины на утечки

## Предупреждения

### 3. Docker compose переменные окружения
```
The "G" variable is not set. Defaulting to a blank string.
The "i" variable is not set. Defaulting to a blank string.
The "NODE_ID" variable is not set. Defaulting to a blank string.
```
**Приоритет**: Средний
**Решение**: Добавить эти переменные в .env или удалить из docker-compose.yml

### 4. React DOM nesting warning
```
Warning: validateDOMNesting(...): <div> cannot appear as a descendant of <p>
```
**Место**: MentionLink component
**Приоритет**: Низкий
**Решение**: Изменить структуру компонента, использовать span вместо div

### 5. React DevTools
```
Download the React DevTools for a better development experience
```
**Приоритет**: Низкий (только для разработки)

## Проблемы производительности

### 6. Множественные запросы к одним и тем же эндпоинтам
Видно много дублирующихся запросов к:
- `/rest/v1/user_achievements`
- `/rest/v1/user_roles`
- `/rpc/v1/has_user_liked_post`

**Решение**: Добавить кэширование на frontend или batch запросы

## Следующие шаги

1. ✅ Исправлена проблема с отображением бота как "Аноним"
2. ⏳ Добавить профилирование для диагностики CPU
3. ⏳ Исправить CORS для storage
4. ⏳ Исправить React DOM nesting warning
5. ⏳ Оптимизировать запросы к API
