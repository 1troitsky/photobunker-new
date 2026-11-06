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

## Решение владельца и реализация

Владелец подтвердил аудит командой «отлично — теперь запиши это где нибудь если еще не сделал и приступай к исправлению». Согласованный объём — перечисленные девять проблем в действующем compat runtime. PR #55 остаётся отменённым; SVAR и новые зависимости не используются. Публикация на сервер с новым release ID разрешена предыдущими прямыми командами владельца. Приёмка UI остаётся за владельцем.

План выполненной реализации: единая scoped-проекция папок/фото → существующие Vue-компоненты и действия → целевая проверка сохранности organizer и интерфейса → публикация. Критерии: фото остаются в своём scope, неизвестный location не записывается, локальные папки доступны при HTTP-ошибке, разделы/дерево/история/expiry/теги видны и действуют из одной модели.

Статус: `READY FOR OWNER REVIEW`. Код `56d91ad` в `main`/`origin/main`, опубликован на `https://photobunker.duckdns.org/browser` как `browser-native-20261106-1`. [Сверка production](evidence/browser-native-20261106/deploy.json) — exit 0. Владельцем не принято.

| Пункт аудита | Изменение и наблюдение |
| --- | --- |
| 1 | Единая проверка scope при отображении и переносе. Move из A предлагает только A; перенос в Folder A убрал старую ошибочную ссылку в B, не меняя Photo/assignment/TTL. |
| 2 | Неизвестная папка показывает ошибку, создание отключено. Старые orphan-папки доступны через восстанавливаемую проекцию без миграции данных. |
| 3 | Organizer читается независимо от HTTP. При ошибке refresh сохранённые папки остаются видимыми, рядом доступен Retry. Ошибка самого local storage блокирует запись. |
| 4 | Четыре раздела, стартовый раздел, сортировка, выбор видимых элементов, rename, меню существующих Photo/Photo Card/edit/original/share с проверкой capability, редактирование тегов. Archive — локальный список личных фото на этом устройстве: не удаление и не продление TTL; restore возвращает прежнее размещение. |
| 5 | Tree раскрывает настоящих потомков, ARIA-level/expanded меняются. В проверке число строк выросло с 3 до 4. |
| 6 | Переходы используют history push; предыдущая папка сохраняется в Back. |
| 7 | Expiry виден при 320 и 390 px. |
| 8 | В задании A теги только его поддерева; tag B отсутствует. |
| 9 | Пустая desktop-колонка удалена. UI просмотрен при 1440×900, горизонтального переполнения нет. |

Переиспользованы ScreenHeader, AppSheet, AppIcon, PhotoThumbnail, encrypted organizer, существующие photo/card/edit/share services. Добавлен adapter organizer и чистая scoped-модель; новая БД и миграция не создаются. Обновление organizer выполняется под существующим account lock. Синтетический roundtrip показал ciphertext, non-extractable key и отсутствие названий/архива в plaintext record. Удаление папки сохраняет фото и вложенные папки; удаление фото остаётся существующим отдельным подтверждаемым действием. PIN #54 и выключенный emergency deletion не менялись.

Дополнительно устранён фактический TDZ в PhotoView: immediate watcher обращался к route до его инициализации. Переход к синтетическому фото больше не вызывает setup exception. Это не доказательство чтения image bytes. Share intent передаётся через router history state и открывает существующую форму только при canShare; публичный query не активирует его.

### Проверки и артефакты

- `docker compose -f compat/assignment-release/compose.yaml exec -T -e PHOTOBUNKER_RELEASE_ID=browser-native-20261106-1 web npm run build` — exit 0, TypeScript + production Vite build; существующие chunk warnings остаются.
- `docker compose -f compat/assignment-release/compose.yaml exec -T web npm test -- tests/browser-explorer.test.ts tests/photo-browser.test.ts` — exit 0, 12 сценариев. Изоляция scopes, неизвестный parent, создание/rename/cycle, tree, archive/restore, expiry/denied/redaction, сохранность дочерних объектов при удалении папки; существующие Browser collection проверки.
- Playwright MCP, действующее приложение `127.0.0.1:8081`, прежняя синтетическая identity аудита: [наблюдения](evidence/browser-native-20261106/observations.json), [390 px RU](evidence/browser-native-20261106/browser-native-ru-390.png), [320 px tree](evidence/browser-native-20261106/browser-native-tree-320.png), [desktop](evidence/browser-native-20261106/browser-native-desktop.png). Создание в папке, Cancel без записи и rename проверены через формы. Сетевой notice на снимках относится к локальному API 500; у fixture нет image bytes.
- Реальные image bytes, original/edit/share с приватным фото, серверные права, destructive delete, hardware iOS/Android и установленная PWA — `NOT RUN`. Синтетический archive roundtrip не заменяет их. Lighthouse/performance и большой CI не запускались; эстетическая приёмка владельцем — `NOT VERIFIED`.

Для приёмки: открыть Browser на сервере, проверить своё задание → папку → Back, раскрытие Tree, видимый срок хранения, меню фото и локальный Archive → Restore для личного фото. Итоговый статус и SHA публикации — в `15-CURRENT-IMPLEMENTATION-STATUS.md`.

## Повторный аудит по замечаниям владельца

Владелец сообщил, что фотографии теперь открываются, но размещение кнопок, breadcrumbs, вид/сортировка, дерево внутри папок и перекрывающая панель фото не приняты. Release `browser-native-20261106-1` в этой части — `OWNER FAILED`. Ниже — ограниченный аудит Browser и связанного PhotoView, затем исправления по прямой команде владельца. Это не утверждение об отсутствии всех дефектов приложения.

| Подтверждённая причина | Изменение |
| --- | --- |
| Browser: создание/выделение и сортировка/вид занимают отдельные 96 px, хотя уже есть ScreenHeader actions. | Четыре действия в одной шапке: создать, выделить, поиск, настройки. Вид, сортировка и tag filter находятся в настройках; чипы тегов появляются при поиске. Действия выделения открываются в sheet, не занимая несколько постоянных строк. |
| Breadcrumb дублирует активный корневой раздел; все предки постоянно участвуют в горизонтальном списке. | В корневых разделах строка убрана; внутри папок одна строка 44 px с родителем/текущим узлом. Полная цепочка доступна через многоточие. Сохранены Up и history. |
| Tree внутри папки показывает только детей на уровне 1: текущий узел исчезает, контекст отличается от корня. | Текущая папка/задание отображается раскрытым корнем, дети — уровнем 2; текущий узел не попадает в select-visible. Сворачивание оставляет корень видимым, ArrowRight переводит фокус к ребёнку. |
| PhotoView: `.photo-action-bar` — sticky с bottom=dock height, пять flex-кнопок со слипающимися подписями. | Панель в обычном потоке под фото; адаптивная сетка переносит кнопки. На 320 px при прокрутке конец панели находится выше dock, все действия достижимы. |
| Дополнительно: `sibling()` выбирает assignment query вместо folder query, теряя один фильтр. | Сохраняются одновременно assignment, folder и personal при переходе к соседнему фото. |
| Дополнительно: стрелки от дочерних controls всплывают в PhotoView и могут менять фото. | Навигационные keydown принимаются только при фокусе самого viewer. |
| Дополнительно: известное фото с недоступными bytes даёт пустой stage после ошибки чтения. | В stage показано сообщение и Retry через существующий read flow. |

Доказательства: [наблюдения до/после](evidence/browser-layout-20261106/observations.json), [до: вложенная папка](evidence/browser-layout-20261106/browser-review-before-nested.png), [до: PhotoView](evidence/browser-layout-20261106/browser-review-before-photo.png), [после: корень](evidence/browser-layout-20261106/browser-review-after-root.png), [после: папка](evidence/browser-layout-20261106/browser-review-after-nested.png), [светлая тема/папка задания](evidence/browser-layout-20261106/browser-review-after-assignment-light.png), [панель фото 320 px, после прокрутки](evidence/browser-layout-20261106/browser-review-after-photo-320.png). В одинаковом локальном состоянии с network notice первая строка Browser переместилась с y=359 на y=191 при 390×844. Это измерение layout, не performance metric.

Playwright MCP использовал действующее локальное приложение и прежнюю синтетическую identity аудита, без приватных фото/image bytes. Проверены 320×700, 390×844 и landscape 844×390: нет горизонтального переполнения; header actions 44 px; settings Grid/List/Tree применяются и сохраняются; create открывается в текущей папке, Cancel не меняет organizer; select-visible не включает текущий узел; раскрытие/сворачивание и клавиатурный переход к ребёнку; полный путь через sheet; ArrowRight в viewer сохраняет assignment+folder, ArrowRight на кнопке не меняет маршрут. На screenshot PhotoView показан реальный error state отсутствующих bytes fixture, не настоящее фото.

`docker compose -f compat/assignment-release/compose.yaml exec -T -e PHOTOBUNKER_RELEASE_ID=browser-layout-20261106-1 web npm run build` — exit 0 (TypeScript + Vite). Автотесты/большой CI/Lighthouse не запускались: scoped-модель, права, TTL, crypto и destructive business flow не менялись. Новые зависимости не добавлялись. Реальные iOS/Android, installed-PWA upgrade, реальные фото/share/edit в этой итерации — `NOT RUN`; предыдущая успешная проверка открытия фото принадлежит владельцу. Новая визуальная приёмка остаётся за ним.
