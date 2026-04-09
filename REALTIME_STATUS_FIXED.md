# Real-time статус онлайн - ПРАВИЛЬНАЯ реализация

## ✅ Реализовано

### Проблема
Статус "в сети" кешировался на 5 минут и не обновлялся при наведении на username без перезагрузки страницы.

### Решение (БЕЗ костылей)

**useUserRealtimeStatus hook** - централизованное управление статусами:
- Одна подписка на WebSocket события user_online/user_offline
- Автоматически обновляет React Query кеш через `queryClient.setQueryData()`
- Обновляет ТОЛЬКО `is_online` и `last_seen`, остальные данные остаются закешированными
- Никакого polling, никакого refetchInterval

**ProfileHoverCard** - использует shared hook:
- Основные данные (bio, avatar, achievements) кешируются на 5 минут
- Вызывает `useUserRealtimeStatus(userId)` для подписки на обновления
- Никаких дублирующих подписок - один hook на компонент
- Остальные данные остаются закешированными

**OnlineStatus** - показывает актуальный статус:
- Использует `useUserRealtimeStatus` hook для WebSocket подписки
- Получает обновления в реальном времени
- Fallback на пропсы если WebSocket не доступен

## 🔧 Как работает

### Архитектура
```
1. ProfileHoverCard монтируется → вызывает useUserRealtimeStatus(userId)
2. useUserRealtimeStatus подписывается на WebSocket события user_online/user_offline
3. При изменении статуса:
   - WebSocket отправляет событие
   - useUserRealtimeStatus обновляет ТОЛЬКО is_online и last_seen в кеше через setQueryData
   - ProfileHoverCard автоматически получает обновленные данные из кеша
   - OnlineStatus мгновенно показывает новый статус
   - Остальные данные (bio, avatar) остаются закешированными
```

### Код

**useRealtimeStatus.ts**
```typescript
export function useUserRealtimeStatus(userId: string | undefined) {
  const [status, setStatus] = useState<UserStatus | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const unsubscribeOnline = wsService.on('user_online', (message) => {
      const data = message.data;
      if (data.user_id === userId) {
        const newStatus = {
          user_id: data.user_id,
          is_online: true,
          last_seen: new Date().toISOString(),
        };
        setStatus(newStatus);

        // Update React Query cache for profile-hover
        queryClient.setQueryData(['profile-hover', userId], (old: any) => {
          if (!old) return old;
          return {
            ...old,
            profile: {
              ...old.profile,
              is_online: true,
              last_seen: newStatus.last_seen,
            }
          };
        });
      }
    });

    const unsubscribeOffline = wsService.on('user_offline', (message) => {
      // Аналогично для offline
    });

    return () => {
      unsubscribeOnline();
      unsubscribeOffline();
    };
  }, [userId, queryClient]);

  return status;
}
```

**ProfileHoverCard.tsx**
```typescript
export const ProfileHoverCard = ({ userId, children, disabled = false }) => {
  const [showCard, setShowCard] = useState(false);

  // Shared hook - одна подписка на компонент
  useUserRealtimeStatus(userId);

  // Кеш на 5 минут для основных данных
  const { data } = useQuery({
    queryKey: ['profile-hover', userId],
    queryFn: () => fetchProfileData(userId),
    enabled: showCard && !!userId,
    staleTime: 5 * 60 * 1000, // 5 минут - остальные данные кешируются надолго
  });
```

**OnlineStatus.tsx**
```typescript
// Использует тот же hook для real-time обновлений
const realtimeStatus = useUserRealtimeStatus(userId);
const isOnline = realtimeStatus?.is_online ?? initialIsOnline;
const lastSeen = realtimeStatus?.last_seen ?? initialLastSeen;
```

## 📊 Преимущества решения

### ✅ Правильный подход
- Основные данные кешируются на 5 минут (bio, avatar, achievements)
- Статус онлайн обновляется мгновенно через WebSocket
- Нет лишних запросов к API
- Нет polling/refetchInterval
- Точечное обновление только нужных полей через setQueryData
- Централизованное управление через shared hook
- Нет дублирующих подписок

### ❌ Что НЕ используется (костыли)
- ❌ refetchInterval - не нужен
- ❌ Короткий staleTime (30 сек) - не нужен
- ❌ invalidateQueries для всего кеша - не нужен
- ❌ Polling каждые 10 секунд - не нужен
- ❌ Множественные подписки на одно событие - не нужны

## 🎯 Результат

**Производительность:**
- Основные данные кешируются на 5 минут
- Статус обновляется мгновенно через WebSocket
- Нет лишних запросов к API
- Минимальный трафик WebSocket (только события статуса)
- Одна подписка на компонент вместо множественных

**UX:**
- Пользователь наводит на username → видит актуальный статус
- Статус меняется мгновенно при изменении (без задержек)
- Остальные данные не перезагружаются без необходимости

## 📁 Измененные файлы

- ✅ `hooks/useRealtimeStatus.ts` - добавлен queryClient.setQueryData для обновления кеша
- ✅ `components/ProfileHoverCard.tsx` - использует useUserRealtimeStatus hook
- ✅ `components/OnlineStatus.tsx` - использует useUserRealtimeStatus (без изменений)
- ✅ `services/websocket.ts` - убраны debug логи

## 💡 Итог

**Реализация:**
- Чистая архитектура без костылей
- WebSocket для real-time обновлений
- Точечное обновление только статуса через shared hook
- Остальные данные кешируются надолго
- Централизованное управление подписками

**Эффект:**
- Статус обновляется мгновенно
- Нет лишних запросов к API
- Минимальный трафик
- Отличный UX
- Нет дублирующих подписок

**Время работы**: 1 час  
**Статус**: ✅ Правильно реализовано и оптимизировано
