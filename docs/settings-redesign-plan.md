# План: редизайн страницы настроек

Статус: **готово** — новый каркас стоит на боевом `/settings` (6 разделов), старая
страница удалена, тесты добавлены.

Цель: заменить огрызок `/settings` на удобную, красивую и интуитивную страницу —
в стиле самого сайта, с навигацией, поиском и живым превью.

## Зафиксированные решения

- База дизайна — **гибрид D**: сайдбар слева + живое превью на «Внешнем виде» +
  мобильный drill-down.
- **Deep-link** `/settings/<section>`.
- **Поиск** — видимая строка без хоткея.
- Разделы: **Профиль · Внешний вид · Уведомления · Приватность · Безопасность · Интеграции**.
- Сохранение — **смешанное**: внешний вид мгновенно, приватность — по кнопке.
- Сброс — **по разделу** (внешний вид и приватность; остальные разделы — не
  «настройки значений», а переходы/действия, сбрасывать нечего).
- Все строки через `t()`.
- Клавиатура: стрелки + Home/End + Enter/Space.
- Паритет по всем 12 темам × light/dark.
- Новые разделы (e-mail, username, удаление аккаунта) — **позже**; e-mail и username
  не нужны (почты нет, username меняется в профиле).

## Структура

- `pages/Settings.tsx` — оболочка: сайдбар + поиск + 3 колонки, мобильный хаб → drill-down.
- `components/settings/SettingRow.tsx` — `SettingGroup`, `SettingBlock`, `SettingRow`, `Segmented`, `OptionCard`.
- `components/settings/SettingsSaveBar.tsx` — липкая панель «Сохранить/Сбросить» + счётчик изменений.
- `components/settings/SettingsNav.tsx` — модель разделов + `SettingsSearch` (+ индекс поиска).
- `components/settings/navKeyboard.ts` — навигация стрелками.
- `components/settings/useAppearanceSettings.ts` / `usePrivacySettings.ts` — состояние разделов.
- `components/settings/{Appearance,Privacy,Security,Profile,Integrations}Section.tsx` — разделы.
- `components/settings/LivePreview.tsx` — превью из настоящих компонентов карточки поста.
- `components/NotificationsSettings.tsx` — push-уведомления в общем языке строк.
- `components/TransitionPreview.tsx` — авто-луп + рельса «страница 1 — анимация — страница 2».

## Фазы

### Фаза 1 — каркас + «Внешний вид» ✅
- [x] Новый шелл (сайдбар/хаб, drill-down, поиск).
- [x] Примитивы `SettingRow/Group/Block/Segmented/OptionCard`.
- [x] Раздел «Внешний вид» + живое превью.
- [x] Клавиатурная навигация, i18n, сброс раздела.

### Фаза 2 — перенос остальных разделов на новый каркас ✅
- [x] **Профиль**: `ProfileSection` (в профиль + студия + плейсхолдеры).
- [x] **Уведомления**: `NotificationsSettings` переписан на `SettingGroup/Row`; починен вечный спиннер.
- [x] **Приватность**: `PrivacySection` + `usePrivacySettings` (draft/save, кнопка Сохранить + индикатор).
- [x] **Безопасность**: `SecuritySection` (пароль + 2FA + passkeys + сессии + правовая информация).
- [x] **Интеграции**: `IntegrationsSection` (Spotify connect/disconnect + блок «Другие сервисы»).
- [x] Расширить `SETTINGS_SEARCH_INDEX` (все разделы) + якоря; убраны бейджи «скоро».

### Фаза 3 — баги и данные ✅
- [x] `/settings/posts` — мёртвая карточка удалена вместе со старой страницей.
- [x] `stats_visibility` не сохраняется — починен (payload строится из одного списка ключей).
- [x] Приватность: убран localStorage как источник правды + поллинг раз в 30с, единый PUT/POST.
- [x] Уведомления: спиннер навсегда, когда нет зарегистрированного service worker.
- [ ] Хардкод русского в `lib/headerBehavior`, `lib/viewTransitions`, `lib/publishButtonStyle`,
      `PublishButton`, `TransitionPreview`, `ActionButton`, `TwoFASection`
      (внутренности редактора 2FA — отдельная задача; строки вокруг него уже через `t()`).

### Фаза 4 — полировка ✅
- [x] Все разделы отрисованы в теме `graphite` (dark + light); цвета только из
      токенов темы — хардкод остался лишь там, где он намеренный (бренд-зелёный Spotify).
- [x] Мобильный drill-down: хаб с описаниями → раздел с кнопкой «Назад».
- [x] Focus-ring на всех интерактивах, `data-nav-item` для стрелок, `aria-label`
      на переключателях, `role="status"` + `aria-live` на панели изменений.
- [x] Пустые состояния (нет passkeys / сессий / типов уведомлений) — на месте.
- [x] Сброс по разделу там, где он осмыслен (внешний вид, приватность).

### Фаза 5 — замена боевой страницы ✅
- [x] `/settings` и `/settings/:section` рендерят новый каркас.
- [x] Редиректы: `/settings/account` → `security`, `/settings/posts` → `profile`,
      `/settings/custom` → `/settings/prof-studio`, неизвестные `:section` → `appearance`.
- [x] `/settings-v2[/:section]` → редирект на `/settings[/:section]` (со сохранением query).
- [x] Старый `pages/Settings.tsx` удалён; ссылки-входы (`AppLayout`, `Legal`,
      `ProfileEditPanel`, `ProfileStudio`) ведут на актуальные пути.

### Фаза 6 — тесты ✅
- [x] `navKeyboard.test.tsx` — стрелки/Home/End, пропуск disabled.
- [x] `SettingsNav.test.tsx` — фильтр поиска, переход к anchor, ключевые слова, очистка.
- [x] `Settings.test.tsx` — шелл: сайдбар/хаб, выбор раздела, редиректы, превью на wide.
- [x] `usePrivacySettings` / `PrivacySection.test.tsx` — загрузка, dirty-счётчик,
      payload со `stats_visibility`, сброс без записи.
- [x] `SecuritySection.test.tsx` — валидация и смена пароля.
- [x] `ProfileSection.test.tsx`, `IntegrationsSection.test.tsx`,
      `NotificationsSettings.test.tsx`, `SettingsSaveBar.test.tsx`.

## Что осталось (не входит в этот редизайн)

- Внутренние строки `TwoFASection` (и мелочи в `lib/*`) — всё ещё хардкод.
- `/settings/posts` как фича: страницы настройки вида постов не существует;
  если понадобится — делать с нуля.
- E-mail/username/удаление аккаунта — сознательно не добавляли.

## Критерии готовности

- [x] `/settings` — новый каркас, старые URL редиректят.
- [x] Баги Фазы 3 закрыты.
- [x] `tsc` и `eslint` без ошибок, тесты зелёные (2410 passed / 223 files).
