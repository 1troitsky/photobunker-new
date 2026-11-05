# Proposal

## Why

Текущий mobile dock формально стабилен, но визуально отклонён владельцем: одновременно выделяются Camera и текущий раздел, активный пункт выглядит отдельным тяжёлым блоком, подписи и неактивные состояния слишком слабы, а результат прошлой правки почти неотличим на телефоне. Q1 нельзя считать выполненным, пока dock не станет визуально ясным, цельным и подтверждённым на production-like viewport и реальном устройстве.

## What Changes

- Перестроить визуальную иерархию пяти пунктов dock так, чтобы активным выглядел только текущий раздел.
- Убрать постоянное отдельное выделение Camera и использовать один согласованный outline-icon стиль.
- Сделать подписи, inactive/active/pressed/focus состояния читаемыми и стабильными без изменения геометрии.
- Сохранить цельную поверхность dock до физического нижнего края safe-area и точный нижний inset рабочей области.
- Проверить portrait, landscape, 320/375/390 px, desktop, light/dark, reduced motion и увеличенный текст.
- Добавить Playwright Test для геометрии, accessibility state и переходов Assignments ↔ Contacts; выполнить визуальную проверку через Playwright MCP.
- Выполнить сопоставимый Lighthouse CI до/после на одном и том же production-like маршруте и явно отделить lab metrics от mobile owner acceptance.
- Для каждого production upload собрать новый `PHOTOBUNKER_RELEASE_ID`, подтвердить public marker/assets и выдать владельцу полный отчёт.

## Capabilities

### New Capabilities

- `mobile-app-navigation`: Визуальное, адаптивное и доступное поведение нижней навигации приложения, включая safe-area, состояния пунктов и стабильность между маршрутами.

### Modified Capabilities

Нет существующих OpenSpec capabilities: OpenSpec инициализирован для этой задачи впервые.

## Impact

- Runtime: только `compat/assignment-release/`.
- Frontend: `apps/web/src/app.css`, при необходимости узкая семантическая правка `App.vue`/`AppIcon.vue`, а также затронутые dock offsets в `native.css`.
- Quality: новый Playwright Test, существующие Vitest/PWA tests, Playwright MCP screenshots, Lighthouse CI artifacts.
- Release: новый versioned static bundle и deploy в `/var/www/photobunker` без очистки пользовательских данных.
- API, БД, crypto, IndexedDB/OPFS и backend contracts не меняются.
