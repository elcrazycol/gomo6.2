# Миграция на Inertia.js - инструкции для развертывания

## Что было сделано

Ваш сайт-форум успешно мигрирован на **Inertia.js React** для создания SPA опыта без перезагрузки страниц. Вот что реализовано:

### ✅ Выполненные изменения:

1. **Установлены зависимости Inertia.js:**
   - `@inertiajs/react` - React адаптер
   - `@inertiajs/progress` - progress bar

2. **Создан Layout компонент:**
   - Header и Footer остаются на месте при навигации
   - Состояние (модалки, скролл) сохраняется

3. **API Routes для Vercel:**
   - `api/index.ts` - главная страница
   - `api/[...slug].ts` - динамические маршруты (доски/треды)

4. **Обновлена конфигурация:**
   - `vite.config.ts` - стандартная Vite конфигурация для Inertia
   - `vercel.json` - правильные редиректы
   - `src/components/InertiaApp.tsx` - инициализация Inertia
   - `index.html` - initial page data для Inertia

## 🔧 Что нужно сделать в Vercel

### 1. Переменные окружения

В **Vercel Dashboard** → **Project Settings** → **Environment Variables** добавьте:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

**Важно:** Эти переменные должны быть доступны для **Server-side** (API Routes).

### 2. Functions Configuration

Vercel автоматически обнаружит API routes в папке `/api`. Никаких дополнительных настроек не требуется.

### 3. Build Settings

Убедитесь что в **Build & Development Settings**:
- **Framework Preset:** `Vite`
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

## 🚀 Как это работает

### SPA поведение:
- **Header/Footer сохраняются** при навигации
- **Состояние React** (модалки, формы) сохраняется
- **Realtime Supabase** продолжает работать через React Query

### Server-side rendering данных:
- API routes загружают данные из Supabase
- Данные передаются в React компоненты через props
- Inertia обрабатывает навигацию без перезагрузки

### Маршруты:
```
/ → api/index.ts (главная)
/:slug → api/[...slug].ts (доска)
/:slug/thread/:id → api/[...slug].ts (тред)
```

## 🔄 Следующие шаги (опционально)

### SSR для лучшей SEO:
```bash
npm install @inertiajs/react @inertiajs/server
```

### Production оптимизации:
- Настроить кэширование API responses
- Добавить CDN для статических файлов
- Оптимизировать бандлы

## 🐛 Возможные проблемы

### 1. API Routes не работают
- Проверьте переменные окружения в Vercel
- Убедитесь что они доступны server-side

### 2. Inertia не инициализируется
- Проверьте что `src/main.tsx` импортирует `InertiaApp`
- Проверьте консоль браузера на ошибки

### 3. Realtime не работает
- Supabase Realtime работает через React Query
- Убедитесь что subscriptions правильно настроены

## 📝 Тестирование

После развертывания:
1. Проверьте навигацию между страницами (без перезагрузки)
2. Проверьте работу Realtime (уведомления, чат)
3. Проверьте сохранение состояния при навигации
4. Проверьте мобильную версию

## 🎯 Результат

Теперь у вас:
- ⚡ Молниеносная навигация без перезагрузки
- 🎨 Сохранение состояния UI
- 📱 Работающий Realtime
- 🚀 Оптимизированная производительность
- 🔍 Лучшая SEO (с SSR опционально)