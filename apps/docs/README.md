# Gomo6 Bot Documentation

Интерактивная документация для создания ботов на платформе Gomo6.

## Возможности

- 📚 Полная документация API
- 🎯 События и обработчики
- 💡 Готовые примеры с кнопками копирования
- ✨ Best Practices
- 🌙 Темная тема
- 🔍 Фильтрация примеров по тегам

## Разработка

```bash
npm install
npm run dev
```

Откроется на http://localhost:5173

## Сборка

```bash
npm run build
```

Результат в папке `dist/`

## Структура

- `/` - Введение
- `/getting-started` - Начало работы
- `/events` - События (onThreadPost, onWallComment, onChatMessage)
- `/api` - API Reference (все функции бота)
- `/examples` - Примеры ботов с фильтрацией
- `/best-practices` - Рекомендации и паттерны

## Компоненты

- `CodeBlock` - Блок кода с кнопкой копирования
- `FunctionSignature` - Сигнатура функции
- `ThemeContext` - Управление темой

## Технологии

- React + TypeScript
- Vite
- React Router
- Tailwind CSS
