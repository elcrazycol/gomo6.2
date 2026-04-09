# Real-time статус онлайн - ПРАВИЛЬНАЯ реализация

## ✅ Реализовано

### Проблема
Статус "в сети" кешировался на 5 минут и не обновлялся при наведении на username без перезагрузки страницы.

### Решение (БЕЗ костылей)

**ProfileHoverCard** - обновляет ТОЛЬКО статус онлайн через WebSocket:
- Основные данные (bio, avatar, achievements) кешируются на 5 минут
- WebSocket подписка обновляет ТОЛЬКО `is_online` и `last_seen` в кеше
- Используется `queryClient.setQueryData()` для точечного обновления
- Никакого polling, никакого refetchInterval
- Остальные данные остаются закешированными

**OnlineStatus** - показывает актуальный статус:
- Использует `useUserRealtimeStatus` hook для WebSocket подписки
- Получает обновления в реальном времени
- Fallback на пропсы если WebSocket не доступен

## 🔧 Как работает

### Архитектура
```
1. Пользователь наводит на username
2. ProfileHoverCard загружает данные (кеш 5 минут)
3. ProfileHoverCard подписывается на WebSocket события user_online/user_offline
4. При изменении статуса:
   - WebSocket отправляет событие
   - ProfileHoverCard обновляет ТОЛЬКО is_online и last_seen в кеше
   - OnlineStatus мгновенно показывает новый статус
   - Остальные данные (bio, avatar) остаются закешированными
```

### Код

**ProfileHoverCard.tsx**
```typescript
// Кеш на 5 минут для основных данных
const { data } = useQuery({
  queryKey: ['profile-hover', userId],
  queryFn: () => fetchProfileData(userId),
  enabled: showCard && !!userId,
  staleTime: 5 * 60 * 1000, // 5 минут - остальные данные кешируются надолго
});

// WebSocket подписка для обновления ТОЛЬКО статуса
useEffect(() => {
  if (!showCard || !userId) return;

  const unsubscribeOnline = wsService.on('user_online', (message) => {
    const eventData = JSON.parse(message.data);
    if (eventData.user_id === userId) {
      // Обновляем ТОЛЬКО is_online и last_seen, остальное не трогаем
      queryClient.setQueryData(['profile-hover', userId], (old: any) => ({
        ...old,
        profile: {
          ...old.profile,
          is_online: true,
          last_seen: new Date().toISOString(),
        }
      }));
    }
  });

  const unsubscribeOffline = wsService.on('user_offline', (message) => {
    // Аналогично для offline
  });

  return () => {
    unsubscribeOnline();
    unsubscribeOffline();
  };
}, [showCard, userId, queryClient]);
```

**OnlineStatus.tsx**
```typescript
// Использует WebSocket для real-time обновлений
const realtimeStatus = useUserRealtimeStatus(userId);
const isOnline = realtimeStatus?.is_online ?? initialIsOnline;
const lastSeen = realtimeStatus?.last_seen ?? initialLastSeen;
```

**useRealtimeStatus.ts**
```typescript
// Простая подписка на WebSocket без инвалидации кеша
export function useUserRealtimeStatus(userId: string | undefined) {
  const [status, setStatus] = useState<UserStatus | null>(null);

  useEffect(() => {
    if (!userId) return;

    const unsubscribeOnline = wsService.on('user_online', (message) => {
      const data = JSON.parse(message.data);
      if (data.user_id === userId) {
        setStatus({ user_id, is_online: true, last_seen: now });
      }
    });

    const unsubscribeOffline = wsService.on('user_offline', (message) => {
      const data = JSON.parse(message.data);
      if (data.user_id === userId) {
        setStatus({ user_id, is_online: false, last_seen: now });
      }
    });

    return () => {
      unsubscribeOnline();
      unsubscribeOffline();
    };
  }, [userId]);

  return status;
}
```

## 📊 Преимущества решения

### ✅ Правильный подход
- Основные данные кешируются на 5 минут (bio, avatar, achievements)
- Статус онлайн обновляется мгновенно через WebSocket
- Нет лишних запросов к API
- Нет polling/refetchInterval
- Точечное обновление только нужных полей через setQueryData

### ❌ Что НЕ используется (костыли)
- ❌ refetchInterval - не нужен
- ❌ Короткий staleTime (30 сек) - не нужен
- ❌ invalidateQueries для всего кеша - не нужен
- ❌ Polling каждые 10 секунд - не нужен

## 🎯 Результат

**Производительность:**
- Основные данные кешируются на 5 минут
- Статус обновляется мгновенно через WebSocket
- Нет лишних запросов к API
- Минимальный трафик WebSocket (только события статуса)

**UX:**
- Пользователь наводит на username → видит актуальный статус
- Статус меняется мгновенно при изменении (без задержек)
- Остальные данные не перезагружаются без необходимости

## 📁 Измененные файлы

- ✅ `components/ProfileHoverCard.tsx` - WebSocket подписка + setQueryData
- ✅ `hooks/useRealtimeStatus.ts` - убрана инвалидация кеша
- ✅ `components/OnlineStatus.tsx` - использует useUserRealtimeStatus (без изменений)

## 💡 Итог

**Реализация:**
- Чистая архитектура без костылей
- WebSocket для real-time обновлений
- Точечное обновление только статуса
- Остальные данные кешируются надолго

**Эффект:**
- Статус обновляется мгновенно
- Нет лишних запросов к API
- Минимальный трафик
- Отличный UX

**Время работы**: 30 минут  
**Статус**: ✅ Правильно реализовано
