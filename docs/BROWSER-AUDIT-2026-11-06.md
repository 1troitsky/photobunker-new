# Browser: аудит перед новой реализацией — 2026-11-06

PR #55 и его исправления отменены коммитом `da33e7c`. На сервере — `browser-rollback-20261106-1`. Исходники web-приложения побайтно соответствуют дереву до #55 (`f81c2da`); PIN из #54 сохранён. Новая реализация ожидает проверки владельцем этого аудита.

Основания требований: [Browser в TS](../ts_and_ux.md#browser), [очередь BR-01–BR-11](16-OPEN-PROBLEMS-AND-QUICK-TASKS.md#5-browser--требуется-архитектурная-замена).

## Как получены доказательства

Открыт действующий восстановленный Vue-компонент через Playwright MCP на `http://127.0.0.1:8081/browser`, 390×844 и 1440×900. Использованы отдельная синтетическая identity `browser-audit-20261106`, тестовые задания A/B, метаданные трёх тестовых фото и локальный encrypted organizer. Приватные фото и реальные аккаунты не использовались. Макеты не рисовались; screenshots сняты с этого приложения.

Локальный API отвечает 500, поэтому identity/метаданные заданы в памяти тестового браузера. У тестовых фото нет image bytes: отсутствие миниатюр на снимках не считается дефектом загрузки фото. Ошибка библиотеки ниже проверена явным состоянием `libraryError=true`; это не заявление о сбое production API.

Измерения DOM, history и сохранённые результаты действий находятся в [observations.json](evidence/browser-audit-20261106/observations.json). Серверные HTML, SW, release и основные JS/CSS сверены с rollback build; совпадение подтверждено `cmp`-эквивалентом, exit 0. Сборка: `docker compose -f compat/assignment-release/compose.yaml exec -T -e PHOTOBUNKER_RELEASE_ID=browser-rollback-20261106-1 web npm run build`, exit 0.

## Подтверждённые проблемы

1. **P1 — перенос смешивает задания и Personal.** Из задания A через обычные Select → Move доступна папка задания B и личная папка. После переноса фото A видно под breadcrumb задания B, хотя `workspaceAssignmentId` остаётся A. Это воспроизведено через интерфейс; некорректные `photoIds` вручную не записывались. Причина: [move targets/canMoveTo](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L157) проверяют циклы, а [фильтр пользовательской папки](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L114) проверяет только наличие ID. [Назначения переноса](evidence/browser-audit-20261106/move-targets.png), [фото A в папке B](evidence/browser-audit-20261106/cross-scope.png). Это подтверждение ошибки организации/отображения; обход серверного ACL не проверялся.

2. **P1 — неизвестная папка маскируется под Root и создаёт скрытые папки.** При `?folder=audit-missing-folder` breadcrumb и форма создания показывают Root. Созданная через форму папка получает `parentId=audit-missing-folder`, которого нет в organizer, и после возврата в Root не видна. Факты: `invalidLocation` в JSON. Причина: [разбор location](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L56), [breadcrumb](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L123), [сохранение parentId без проверки](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L260).

3. **P1 — ошибка фото-библиотеки скрывает сохранённые папки.** При `libraryError=true` остаётся только Retry; шесть сохранённых в organizer папок исчезают из интерфейса. [Снимок состояния ошибки](evidence/browser-audit-20261106/library-error.png). В [template](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L412) весь список находится в `v-else` после ошибки. Кроме того, [initial load](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L350) ждёт studio/photo refresh перед чтением organizer. Задержка в миллисекундах не измерялась.

4. **P1 — обещанные разделы и действия не реализованы в Browser.** В TS указаны All / My photos / Assignments / Archive, выбор стартового раздела и работа с тегами. В текущем UI нет этих переключателей; Settings содержит только Grid/List/Tree и New collection. У строк нет меню для Photo Card, edit/original/share по capability; отсутствуют rename и select-all-visible. New collection создаёт коллекцию заданий, а не share выбранного фото. Это видно в [текущем UI](evidence/browser-audit-20261106/root-390.png), `settings` в JSON и [template/settings](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L433). Сортировка фото фиксирована по `createdAt` descending, выбора сортировки нет.

5. **P2 — Tree является оформлением того же плоского списка.** List и Tree вернули одинаковые четыре записи. Имеющаяся вложенная папка не отображается, контролов раскрытия нет. Меняется CSS: [те же v-for](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L417) и [отступ/полоса для Tree](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/native.css#L771). [Снимок Tree](evidence/browser-audit-20261106/tree-desktop.png), `tree` в JSON.

6. **P2 — переходы между папками не сохраняются в истории.** При клике Root → A длина history осталась 16, `history.state.back` остался `null`. [navigate использует router.replace](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L176); предыдущая папка не становится отдельной записью для Back. Нажатие физической кнопки телефона не проверялось.

7. **P1 — срок удаления скрыт в мобильном списке.** Для тестового фото DOM содержит дату создания 6 ноября и expiry 8 ноября; вторая дата имеет `display:none` при ширине 390. Это прямое правило [mobile CSS](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/native.css#L800), хотя expiry требуется в TS. Факты: `mobileExpiry` в JSON. Обход TTL этим не доказан; подтверждена скрытая информация интерфейса.

8. **P2 — теги берутся из всей библиотеки, а не текущей папки.** В задании A показан `#audit-tag-B`, хотя в нём первоначально только фото A. [tags собирается из всех photos](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/views/PhotoBrowserIndexView.vue#L67). Состояние до переноса сохранено в `assignmentBeforeMove`; оба тега также видны на [снимке](evidence/browser-audit-20261106/cross-scope.png).

9. **P2 — desktop теряет 190 px под отсутствующую панель.** У `.browser-home` две колонки `190px 990px`, но `.browser-home-tabs` в DOM отсутствует. Header начинается на x=130, body на x=320. Причина: [desktop CSS](https://github.com/1troitsky/photobunker-new/blob/da33e7c/compat/assignment-release/apps/web/src/native.css#L787), [снимок](evidence/browser-audit-20261106/tree-desktop.png).

## Что в этом срезе работает

- Создание внутри существующей пользовательской папки сохраняет правильный parentId. Старую жалобу «всегда создаёт в Root» здесь повторить не удалось.
- Закрытие формы создания с введённым названием не сохраняет папку.
- До ошибочного cross-scope move прямой корень задания A показывал только фото A; утверждать «любое задание всегда показывает все фото» на этом срезе нельзя.

## Пределы аудита и следующий шаг

Реальный iPhone/Android, установленная PWA, настоящие thumbnails/photo opening, серверные права и destructive delete не проверялись. Их нельзя считать подтверждёнными этим документом. Новая библиотека, дизайн или архитектура не выбраны.

На согласование владельцу: исправлять единый Browser по требованиям TS — с явными разделами, реальной иерархией и историей, запретом смешения scopes, корректным location, доступными по правам действиями и видимым expiry на телефоне. После проверки владельцем составляется ограниченный план реализации. До его команды изменения нового Browser не начинаются.
