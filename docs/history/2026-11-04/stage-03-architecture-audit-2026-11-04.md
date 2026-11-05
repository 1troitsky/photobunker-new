# Этап 3 — архитектурная проверка

Дата проверки: 2026-11-04
Репозиторий: `1troitsky/photobunker-new`
Проверенный tip: `4491ee16478a0c3c6180f07379b790060a692e37` (`chatbot/pb2-g5-second-device-verification`)
Baseline `origin/main`: `d2b9f58b507fa5cd32f8461d5248c871ad1a816e`
Статус: независимый read-only architecture audit. Это не исправление, не merge-разрешение и не runtime acceptance.

## 1. Итог

Новая реализация содержит реальный security/storage foundation, но пока **не соблюдает утверждённую заменяемую архитектуру**. Основной сценарий Camera → encrypted local commit → durable outbox построен содержательно правильно, однако слои вокруг него сцеплены между собой и с Vue.

Итоговая классификация:

| Класс | Количество | Смысл |
| --- | ---: | --- |
| **P0 / STOP до интеграции затронутого сценария** | 3 | TTL-cleanup не соответствует baseline; recipient TTL использует недоверенные часы; массовый compat snapshot нельзя интегрировать автоматически. |
| **P1 / обязательное архитектурное исправление** | 10 | Циклы, UI → infrastructure, ложные public boundaries, смешанные слои, монолиты, server controllers, слабый guard. |
| **P2 / укрепление и упрощение** | 1 | Presentation preferences должны получить узкий storage adapter. |

Полностью зелёного архитектурного gate на tip нет. Прямой запуск штатного Node-check завершился ошибкой:

```text
features/account/ui/ProfileScreen.vue: cross-feature deep import ../../ui-preview/application/home-preference
```

`pnpm test:architecture` не запускался: на текущем компьютере `pnpm` и JS dependencies ещё не установлены. Сам `node tools/architecture/check.mjs apps/web/src` и negative fixture запускаются без dependencies; negative fixture успешно доказал только старое правило `domain → infrastructure`.

## 2. Что уже соответствует baseline

### 2.1 Identity

- Используется anonymous PB2 Recovery Key, а не email/phone/password.
- Device signing keys создаются non-extractable и проходят IDB structured-clone probe до `/prepare`.
- Recovery, pairing, rotation, signed challenges и device revocation реализованы отдельными сценариями.
- Account wrapping material оборачивает отдельные asset DEK; photo bytes шифруются per-asset.
- Account switch/logout/lock инвалидируют runtime capabilities и object URLs.

Это подтверждает наличие реализации, но не заменяет независимый crypto review и executable acceptance из `docs/11-IDENTITY-AND-KEYS.md`.

### 2.2 Local-first и encrypt-before-write

- Shell монтируется до фоновых HTTP workers.
- Camera получает bytes в памяти, сжимает и передаёт их в `LocalPhotoVault.commit`.
- Pixel bytes, metadata и thumbnail шифруются до записи в OPFS или encrypted IDB Blob fallback.
- Journal создаётся до staging; manifest/photo/outbox фиксируются одной Dexie transaction после ciphertext readback.
- UI различает local save и cloud ACK.
- Late ACK проверяется против tombstone/expiry; outbox имеет стабильный operation ID.
- Автоматической записи в Photos/DCIM нет. Экспорт выполняется только явным download action.

### 2.3 Основной TTL/ACL каркас

- Capture фиксирует mode, policy revision и TTL 1–45 дней.
- Main local photo vault использует encrypted trusted-time anchor и monotonic elapsed.
- Laravel reads проверяют owner/session/expiry; recipient read вынесен в отдельный policy path.
- Есть indexed scheduler, queue jobs, S3 delete verification, orphan reconciliation и fail-closed access до physical cleanup.
- Local Delete/Emergency не выдают ложного разрешения: `SafetyDecision.permitted` остаётся `false`.

Эти сильные части нужно сохранить при рефакторинге, а не переписывать вслепую.

## 3. Найденные архитектурные нарушения

### ARCH-01 — P1: штатный architecture guard недостаточен и уже красный

`tools/architecture/check.mjs`:

- анализирует только relative imports, которые резолвятся прямо в файл;
- не анализирует package aliases и фактические exports barrel-файлов;
- не ищет dependency cycles;
- не запрещает Vue в `application/infrastructure`;
- не запрещает raw browser/HTTP/DB/crypto APIs в неправильном слое;
- не анализирует Laravel;
- использует линейный порядок `domain=0, application=1, infrastructure=2, ui=3`.

Последний пункт ошибочно разрешает `ui → infrastructure`, потому что target rank ниже source rank. По нормативному контракту UI может вызывать public application use-cases, но infrastructure является отдельным adapter layer, а не разрешённой нижней зависимостью UI.

Даже в этих узких правилах tip падает на `ProfileScreen.vue:9`, который импортирует внутренний `ui-preview/application/home-preference` другого feature.

### ARCH-02 — P1: пять runtime dependency cycles

Read-only анализ статических runtime imports, с исключением чистых `import type`, нашёл пять strongly connected components:

1. `identity/index.ts ↔ identity/ui/IdentityPanel.vue`;
2. `local-storage/index.ts ↔ local-storage/ui/StorageDiagnostics.vue`;
3. `camera/index.ts ↔ camera/ui/CameraScreen.vue`;
4. `editor/index.ts ↔ editor/ui/EditorScreen.vue`;
5. `gallery/index.ts → gallery/ui/GalleryScreen.vue → photo-sync/index.ts → photo-sync/application/sync.ts → gallery/index.ts`.

Причина повторяется: один barrel одновременно экспортирует application/infrastructure capabilities и Vue components, а UI внутри feature импортирует этот же barrel.

### ARCH-03 — P1: UI напрямую знает infrastructure

Найдены прямые импорты внутренних adapters:

| UI | Прямой infrastructure dependency |
| --- | --- |
| `camera/ui/LocalPhotosScreen.vue:8` | `browser-camera` |
| `gallery/ui/GalleryScreen.vue:12` | GPS/location adapter |
| `photo-browser/ui/BrowserScreen.vue:9` | owner export/download adapter |
| `account/ui/DataSafetyScreen.vue:7` | device PIN storage/verifier |
| `account/ui/RecoveryVerificationScreen.vue:6` | second-device recovery infrastructure |
| `account/ui/RevokedDeviceStatusScreen.vue:5` | revocation outbox infrastructure type |

Кроме импортов, Vue screens исполняют application workflows:

- `CameraScreen.vue` загружает repository, отбирает server-confirmed assignments, резервирует NAME-ID, фиксирует policy и управляет capture transaction;
- `GalleryScreen.vue` объединяет local/cloud projections, получает и расшифровывает metadata, назначает NAME-ID, редактирует encrypted metadata и применяет GPS;
- `BrowserScreen.vue` сам управляет expiry display, selection/export cancellation и вызывает infrastructure downloads;
- `AssignmentsScreen.vue` смешивает form state, repository, sync, server conflict/progress и domain transitions;
- `RecipientGalleryScreen.vue` самостоятельно управляет reauthorization, TTL filtering и decrypted URL lifetime.

Это означает, что визуальный слой нельзя заменить без повторного переноса значительной части product workflow.

### ARCH-04 — P1: public API фактически экспортирует infrastructure

Комментарии `Public application boundary` не соответствуют exports:

- `identity/index.ts` экспортирует raw `identity.ts`, `api.ts`, `crypto.ts`, `storage.ts`, App Lock и signing helpers;
- `local-storage/index.ts` экспортирует `LocalPhotoVault`, cipher, database inspection, names, ownership и cleanup adapters;
- `assignments/index.ts` экспортирует repository/database/sync infrastructure;
- `collaboration/index.ts` экспортирует repository/sync/crypto/database infrastructure;
- `editor/index.ts` экспортирует implementation из `infrastructure/editor`;
- `gallery/index.ts` экспортирует thumbnail и GPS adapters;
- `photo-grants/index.ts` почти полностью состоит из infrastructure exports;
- `account/index.ts` экспортирует outbox и cleanup infrastructure.

В результате межмодульный импорт формально идёт через `index.ts`, но фактически получает DB/HTTP/crypto implementation. Это не public typed use-case boundary.

### ARCH-05 — P1: application и infrastructure смешаны

Примеры browser/framework concerns внутри `application`:

- `photo-sync/application/sync.ts` импортирует Vue `watch`, использует `navigator`, `document`, `window`, `Response`, raw HTTP response parsing и `crypto.subtle`;
- `gallery/application/library.ts` использует `navigator.onLine`, raw HTTP, SHA-256 WebCrypto, vault implementation и cloud import;
- `photo-review/application/review.ts` читает `navigator.onLine` и непосредственно запускает sync;
- `account/application/data-safety.ts` читает `navigator.onLine` и открывает concrete vault;
- `ui-preview/application/home-preference.ts` напрямую пишет `localStorage`.

Обратная проблема — Vue внутри infrastructure:

- `identity/infrastructure/identity.ts` и `app-lock.ts` используют Vue refs/computed;
- `assignments/infrastructure/sync.ts`, `collaboration/infrastructure/sync.ts` и `photo-grants/infrastructure/sync.ts` используют Vue `watch`;
- repository classes содержат business decisions, permission checks, transitions, retry policy и conflict resolution вместо реализации объявленных ports.

### ARCH-06 — P1: структура feature-модулей неполна

Из 16 feature-каталогов только `account`, `camera`, `gallery`, `photo-browser` и `photo-grants` физически имеют все четыре каталога. Наличие каталогов само по себе не доказывает правильные зависимости, но отсутствие показывает незавершённую декомпозицию.

| Feature | Отсутствующие слои |
| --- | --- |
| `assignments` | `application` |
| `collaboration` | `application` |
| `editor` | `application` |
| `identity` | `domain`, `application` |
| `local-storage` | `application` |
| `photo-card` | `infrastructure` |
| `photo-review` | `domain`, `infrastructure` |
| `photo-sync` | `domain`, `infrastructure`, `ui` |
| `ui-preview` | `domain`, `infrastructure` |
| `foundation` | `application`, `infrastructure` |
| `assignment-release` | `infrastructure`, `ui`; это compatibility gateway, а не целевой native module |

Для feature без внешнего adapter пустой `infrastructure` не нужен ради формы. Но public ports, use-cases и presentation composition должны быть явно разделены; сейчас функциональность лежит в неправильных слоях.

### ARCH-07 — P1: stateful monoliths и слишком крупные presentation components

Крупнейшие файлы:

- `local-storage/infrastructure/vault.ts` — 1131 строк и более 40 методов;
- `identity/infrastructure/identity.ts` — 582 строки и около 40 exported operations;
- `camera/ui/CameraScreen.vue` — 504 строки;
- `assignments/ui/AssignmentsScreen.vue` — 466 строк;
- `collaboration/ui/CollaborationScreen.vue` — 384 строки;
- `gallery/ui/GalleryScreen.vue` — 366 строк;
- `photo-browser/ui/BrowserScreen.vue` — 357 строк.

`LocalPhotoVault` одновременно отвечает за capture commit, metadata revisions, editor replace, review envelopes, outbox, cloud import, thumbnail cache, recovery verification, expiry и tombstones. `identity.ts` одновременно содержит session state, bootstrap, recovery, pairing, rotation, signing capabilities, recipient key helpers и server time.

Это не legacy-scale god store, но уже тот же тип риска: изменение одного lifecycle может затронуть несвязанные сценарии.

### ARCH-08 — P1: Laravel не имеет отделённого application/domain слоя

Сервер организован как controllers + DB facades + несколько service classes:

- `IdentityController.php` — 338 строк, содержит HTTP validation, session management, protocol orchestration и DB transactions;
- `CollaborationController.php` — 253 строки, содержит ACL, query projections и mutation rules;
- `PhotoRecipientController.php` — 230 строк;
- `PhotoEditController.php` — 207 строк;
- `routes/web.php:69–75` содержит owner delete use-case прямо в route closure;
- controllers и `Photo/*` services напрямую используют `DB`/`Storage`, typed repository ports отсутствуют.

ACL/TTL проверки в основном присутствуют, но их повторное использование зависит от concrete Laravel code, а contract tests не защищают чистый domain отдельно от DB/HTTP.

### ARCH-09 — P1: generic transport и широкие barrels размывают contracts

`identity/index.ts` публично отдаёт generic `photoRequest`, `assignmentRequest`, `collaborationRequest`. Feature use-cases сами собирают URLs, разбирают `Response` и валидируют DTO. Внешний transport не локализован в feature adapters.

`gallery/domain/metadata.ts` получает type через общий `camera/index.ts`, который одновременно экспортирует infrastructure и Vue screens. Даже когда runtime import стирается TypeScript, domain contract зависит от широкого и циклического barrel.

Нужны узкие public contracts: отдельные types/use-cases без UI и adapter exports.

### ARCH-10 — P0: expiry cleanup оставляет бессрочные photo-related DB rows

Нормативный baseline требует после retry window удалить Photo/Metadata/Note/Card/index rows и технический tombstone.

Фактическое поведение:

1. Migration `2026_10_28_000003_create_gallery_v1.php` создаёт `photo_name_codes` без foreign key и прямо заявляет: `Codes deliberately survive parent expiry; never recycled`.
2. `Photo\Lifecycle::cleanup` удаляет edit/review/binding/object/photo rows, но не удаляет `photo_name_codes`.
3. `Photo\Lifecycle::sweepTombstones` очищает `object_keys`, но не удаляет строку `photo_tombstones`; `account_id`, `operation_id`, `photo_id` остаются бессрочно.
4. Client `LocalPhotoVault.cleanupTombstone` удаляет ciphertext/assets/cache/outbox/photo, но не удаляет local tombstone; `reconcile` повторно обходит его всегда.

Нельзя просто удалить tombstones немедленно: они защищают от late-write resurrection. Исправление должно сохранить bounded anti-replay ledger на утверждённый retry window, после чего удалить photo linkage/private metadata либо заменить его минимальным неперсональным digest по явно утверждённому контракту. Текущее бессрочное хранение противоречит `docs/03`, `docs/09` и Product Acceptance Baseline.

### ARCH-11 — P0 до включения production recipient reads: TTL-critical paths используют `Date.now()`

Основной local vault правильно использует `TimeAuthority`, но sharing/recovery path обходит его:

- `photo-grants/infrastructure/recipient-thumbnail.ts` многократно принимает решение о decrypt по `Date.now()`;
- `photo-grants/ui/RecipientGalleryScreen.vue` фильтрует и оставляет object URLs по `Date.now()`;
- `photo-grants/infrastructure/grants.ts` разрешает публикацию envelope на основе `Date.now()`;
- `identity/infrastructure/identity.ts:550` выдаёт transient owner DEK после проверки `expiry <= Date.now()`;
- `account/infrastructure/second-device-recovery.ts` принимает cloud manifest по wall clock.

Сервер повторно проверяет ACL/expiry и production recipient flag сейчас выключен, поэтому дефект не следует «исправлять» включением функции. До production enable нужен единый trusted-time/authorization port и тесты clock rollback, expiry-during-decrypt, hidden tab и object URL revocation.

### ARCH-12 — P1: Assignment permissions пока только data/UI contract

`allowEditing`, `allowDeletion`, `allowBrowsing`, `keepOriginal` и связанные options существуют в encrypted Assignment model и UI. Backend capture binding валидирует assignment/mode/retention/revisions, но общего server capability policy, применяемого к edit/delete/browser reads, ещё нет.

UI честно показывает предупреждение, поэтому это не скрытый доступ. Архитектурно нельзя подключать participant Browser/Edit/Delete до появления server-authoritative capability matrix и отдельных application ports.

### ARCH-13 — P2: presentation preferences обходят adapter boundary

`ui-preview/ui/copy.ts` напрямую читает/пишет `localStorage` для языка и темы; `gallery/infrastructure/location.ts` хранит GPS preference в `localStorage`; home preference также использует concrete storage.

Эти значения не являются photo secrets, но прямой storage делает UI менее заменяемым и затрудняет SSR/test/native shell. Нужен маленький `PreferencesPort`, не новая глобальная store-модель.

### ARCH-14 — P0 integration blocker: `compat/assignment-release` не является модулем новой архитектуры

Каталог содержит массовый legacy snapshot и находится вне `apps/web/src`, поэтому architecture guard его не анализирует. Runtime его сейчас не импортирует — это хорошо. Но включение snapshot в целевой integration diff нарушит запрет массового переноса legacy и создаст второй неподконтрольный application tree.

До этапа интеграции нужен отдельный owner/Codex decision: исключить snapshot из merge либо оставить только минимальный typed gateway и проверяемые test vectors.

## 4. Почему UI пока не является заменяемым

Текущая связь выглядит так:

```text
Vue screen
  ├─ concrete repository/vault
  ├─ sync worker
  ├─ generic HTTP request
  ├─ crypto/signing capability
  ├─ browser permission/storage/export adapter
  └─ domain validation and workflow decisions
```

Целевая связь должна быть:

```text
Vue/mobile/desktop presentation
  -> typed presenter/view-model
  -> application use-case
  -> declared ports
  -> infrastructure adapters (IDB/OPFS/WebCrypto/HTTP/Camera/Download)
```

UI должен получать readonly view-state и команды уровня `capture`, `retrySave`, `loadGallery`, `exportSelection`, `revokeDevice`, а не `vault`, `photoRequest`, `BrowserCamera`, `crypto` или database inspection functions.

## 5. Порядок исправления

### Шаг 0 — сохранить safety-блокировки

До исправлений:

- не включать production recipient reads;
- не включать destructive Local Delete/Emergency;
- не интегрировать `compat/assignment-release`;
- не считать current tip Verified/Integrated.

### Шаг 1 — исправить TTL cleanup

1. Определить bounded anti-replay/tombstone retention без бессрочной photo linkage.
2. Добавить cleanup `photo_name_codes` и всех per-photo projections.
3. После подтверждённого S3 cleanup и retry window удалять server tombstone.
4. Удалять local tombstone после отсутствия journal/outbox/live pointers и безопасного reconciliation window.
5. Добавить tests: expiry, late PUT/ACK, crashed cleanup, S3 failure, retry-window completion и отсутствие DB rows.

### Шаг 2 — сначала усилить architecture gates

До большого refactor guard должен ловить новые нарушения:

- `domain` — только pure domain/shared contract imports;
- `application` — domain + declared ports, без concrete infrastructure/Vue/browser globals;
- `ui` — application/public presentation API, без infrastructure;
- `infrastructure` — реализует ports и не экспортируется напрямую UI;
- запрет Vue вне `ui`/composition root;
- runtime и type dependency cycle detection;
- запрет cross-feature deep imports и mixed UI/infrastructure barrels;
- отдельный PHP rule/test для thin controllers и запрета business logic в routes.

Negative fixtures нужны для каждого правила, а не только `domain → infrastructure`.

### Шаг 3 — разделить public API и composition exports

Для каждого feature создать узкий framework-neutral public surface:

- public types/value objects;
- application commands/queries;
- readonly view-state/presenter interface;
- ports без concrete adapter types.

Vue components экспортировать отдельным composition barrel, который никогда не импортируется domain/application code.

### Шаг 4 — разорвать пять runtime cycles

Сначала убрать self-imports UI через собственный `index.ts`, затем разорвать `gallery ↔ photo-sync`:

- Gallery вызывает `PhotoSyncPort`/command через composition injection;
- Photo Sync получает NAME allocation port, а не импортирует весь Gallery barrel;
- Camera/Editor/Identity/Storage UI импортируют application facade напрямую либо через presentation-only facade.

### Шаг 5 — вынести workflows из Vue

Приоритет: Camera → Gallery → Assignments → Recipient Gallery → Browser. Для каждого экрана:

- Vue оставляет render, input events и ephemeral visual state;
- async generation/account-switch guards, offline/retry, TTL/ACL, merge/conflict и export orchestration переходят в application presenter/use-case;
- browser APIs реализуются adapter-ами.

### Шаг 6 — разделить монолиты без изменения security semantics

`LocalPhotoVault` разделить на ports/services минимум для:

- capture commit and asset storage;
- metadata/edit revisions;
- outbox delivery state;
- cloud import/readback;
- expiry/tombstone maintenance;
- thumbnail cache;
- review envelopes.

`identity.ts` разделить на session capability, bootstrap/recovery, pairing, rotation, signing/key grants и trusted server time. При этом единый synchronous lock/account-generation gate должен остаться центральным и fail-closed.

### Шаг 7 — сделать Laravel controllers тонкими

- HTTP validation/response остаются в presentation/controller;
- use-cases управляют transactions и authorization decisions;
- repositories/storage adapters скрывают `DB`/`Storage`;
- domain policies тестируются без HTTP и реальной БД;
- owner/recipient ACL и TTL применяются через один authoritative policy service.

### Шаг 8 — только после refactor выполнить acceptance

- полный architecture/type/lint/unit/build pipeline на final tip;
- PostgreSQL 18 + Garage + queue/scheduler tests;
- two-account recipient tests с trusted time;
- offline/reload/account switch/clock rollback/storage full;
- production HTTPS Camera и реальные iOS/Android PWA проверки;
- повторная owner UI acceptance.

## 6. Контрольный вывод

Архитектуру не нужно выбрасывать. Crypto/storage lifecycle содержит полезную и в ряде мест аккуратную реализацию. Исправлять следует связи и ownership обязанностей:

1. сначала закрыть TTL/retention P0;
2. затем сделать architecture guard честным;
3. выделить application ports/public contracts;
4. разорвать циклы и вынести workflows из Vue;
5. разделить stateful monoliths и Laravel controllers;
6. после этого собирать интеграционную ветку и запускать общее окружение.

Этап 3 выполнен без изменения application code, Git history, GitHub, `_old`, Docker, Colima, OrbStack, containers, images, volumes или данных.