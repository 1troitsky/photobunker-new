# 08. PhotoBunker New — единый Implementation Roadmap

**Версия:** 2026-10-28. **Статус: APPROVED; реализация начата с R2-01 по прямому решению владельца 28.10.2026.** Это единственный roadmap нового проекта. Операционный статус каждого Issue — в GitHub Project, не в таблице ниже.

## 0. Цель и критерий

Производственный PhotoBunker без Messenger/Matrix/Calls: защищённая локальная съёмка, метаданные отдельно в БД, гибрид локально → S3, три режима хранения (1 disabled), задания/Team, галерея, редактор, Photo Card, Photo Browser, 3 независимых PIN-сценария, RU/EN и мобильный/desktop PWA. Приложение не пишет фото в системную галерею; локально нет plaintext at rest.

**Success:** пользователь в реальной production-сборке на телефоне снимает фото, закрывает PWA, работает offline, редактирует/сохраняет по выбранному mode, синхронизирует с S3, назначает права участнику, открывает разрешённый Browser/Card, восстанавливается на разрешённом устройстве, запускает PIN, безопасно удаляет при явном выборе — без потерь, утечек, накопления orphan assets или зависания навигации.

## 1. Источники и правила исполнения

Прежде каждой задачи прочесть **только новые нормативные документы**: `AGENTS.md`, `CHATBOT-AGENTS.md`, `COLLABORATION.md`, этот roadmap, [Product Acceptance Baseline](13-PRODUCT-ACCEPTANCE-BASELINE.md), профильные contracts [Identity](11-IDENTITY-AND-KEYS.md), [Browser Storage/Time](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md) и Issue. [Legacy audit](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md) и [checklist](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md) — справочные, **только для конкретной связанной задачи**, не источник требований в обход нового baseline. Из старого проекта можно брать спецификации/тест-векторы, но нельзя слепо копировать монолитный frontend/схему вечного immutable original.

**Проект создаётся целиком заранее:** полный backlog Issues формируется сразу для всех фаз. `Ready` — только проверенная следующая работа без OPEN решений. Статусы, WIP и передача между тремя участниками — в `COLLABORATION.md`.

**GitHub Project:** **[PhotoBunker New — Development](https://github.com/users/1troitsky/projects/14)** создан 28.10.2026, Issues #1–#26 добавлены, Status настроен как Backlog/Ready/In Progress/Review/Integrated/Accepted/Blocked/Cancelled. R2-01 — In Progress; остальные задачи начинают в Backlog до прохождения Ready gate.

**Рабочий цикл:** **Codex** подготавливает зависимости, GitHub Project/CI/production preview и **выдаёт ChatGPT Ready Issue**. **ChatGPT** делает объёмную реализацию и Draft PR; **Codex** проверяет diff, запускает/дописывает тесты и **при необходимости дорабатывает тот же PR**, затем согласованно интегрирует после разрешения владельца. `Accepted` — только после ручной проверки владельцем. Благодаря лимитам ChatGPT исполняет большую часть Issues, но техническим координатором остаётся Codex.

## 1.1. Codex организует и проверяет, ChatGPT реализует по Issues, владелец принимает

**Ни одного большого переноса из старого репозитория. User/Account — стабильная центральная Identity (без монолитной модели). Будущие Billing/Subscription и Messenger — независимые подключаемые contexts; сейчас только их стабильные contracts, никаких SDK/реализации.** `photobunker` — источник проверяемых contracts, test vectors, user journeys и ограниченно пригодных компонентов, **не** исходный код, который копируется целиком. Для каждого reuse Codex оценивает допустимость переноса, ChatGPT по его задаче документирует «переиспользовать / адаптировать / заменить» и последствия; старые `apps/web` mega-stores, Matrix, RTC, plaintext prototype не импортируются. Сохранение Laravel 13 как технологии не равно копированию старого API или БД.

**Принцип — UI first, production first, local-first, owner feedback early.** Владелец проверяет **вехи**, а не каждую мелкую Issue. До демонстрации следующего модуля не нужно завершать весь roadmap.

| Момент | Issue / deliverable | В каком виде владелец проверяет | Что ещё не обещаем |
| --- | --- | --- | --- |
| **Проверка 1 — UI/UX** | [R2-01](https://github.com/1troitsky/photobunker-new/issues/2) + [R2-02](https://github.com/1troitsky/photobunker-new/issues/3) | **Сразу после R2-02**: HTTPS preview собранного production frontend, открыть на собственном телефоне/desktop, пройти пять разделов, переходы Editor/Card/PIN, посмотреть скорость, навигацию, адаптивность и язык. Владелец даёт UX acceptance/rework до развития сложных функций. | Fixture-only UI чётко подписан: это пока **не** работающая камера/фото/логин/S3. |
| **Проверка 2 — первое настоящее фото** | R2-03 + R2-04 + [R2-06](https://github.com/1troitsky/photobunker-new/issues/7) | **Сразу после R2-06**, не после S3: на телефоне снять фото, зашифровать и сохранить, увидеть его в **минимальной защищённой внутренней галерее**, закрыть/reload, открыть offline, убедиться, что в системной галерее снимка нет. Ошибка quota/permissions видна человеку. | Полная gallery с GPS/NAME-ID/filters, серверная sync, sharing пока не реализованы. |
| **Проверка 3 — синхронизация и полный просмотр** | [R2-05](https://github.com/1troitsky/photobunker-new/issues/6) + [R2-07](https://github.com/1troitsky/photobunker-new/issues/8) | Реальные локальная очередь → S3 → загрузка на разрешённом устройстве, thumbnail budget/metadata, корректное восстановление после reload/offline, без дубликатов и постоянного мусора. | Задания, multi-user sharing ещё нет. |
| **Проверка 4 — задания** | R2-08 + R2-09 + R2-10 | Два аккаунта, задание с режимами 1 disabled / 2 / 3 default; съёмка в задании, доступы, проверка, отзыв. | Полный редактор/публичные shares ещё нет. |
| **Проверка 5 — редактор и Photo Card** | R2-11 + R2-13 + R2-14 | В режиме 2 исходник остаётся, правка отдельно; в режиме 3 старый файл действительно заменён; карта/metadata и внешняя Card link без лишних прав. | Browser, ZIP и PIN ещё не все доступны. |
| **Проверка 6 — Photo Browser, PIN** | R2-15–17 + R2-18–20 | Коллекции заданий, доступные фото/экспорт, отдельно app lock/local delete/emergency; security test confirmation нужен **до** destructive manual testing. | Финишная независимая security/release matrix остаётся. |
| **Финальная приёмка** | R2-21/23/24 и обязательные prerequisites | Полная production PWA + staging/prod release gates, mobile iOS/Android, backup/restore, owner acceptance. | Не заменяет ранние проверки 1–6. |

**Обязательное правило для каждого раннего review:** **Codex подготавливает** зависимости, воспроизводимый **production frontend и HTTPS staging/preview deployment**, тестирует именно эту сборку и передаёт владельцу **отдельный HTTPS staging/preview URL** (или localhost desktop, но проверка на личном телефоне требует HTTPS и доступности). Сервис и данные строго test/staging: никогда не направлять тестовые клиенты в production старого PhotoBunker. Нельзя считать `npm run dev`, скриншот, mock-backend или unit tests достаточными. R2-01 должен включить минимальный повторяемый preview deployment, не ждать R2-24; R2-24 посвящён **финальной** инфраструктуре/релизу.

**Очередность исполнения внутри R2-1: сначала R2-04 → R2-06 (минимальная локальная галерея в scope R2-06) → R2-05 → R2-07.** R2-06 не должен зависеть от S3 и remote API; R2-07 может включать полный cloud-backed gallery после R2-05. Ранний encrypted local capture зависит от утверждённого security/key contract, но **не** от выбора конкретного S3-провайдера.

**Приёмка:** Codex **проверяет, тестирует, исправляет или дополняет код** в том же PR, самостоятельно решая, что рациональнее сделать локально, а что выдать ChatGPT как адресную задачу. **Merge только в рамках разрешения владельца**; на пользовательских вехах владелец лично проверяет UX и может вернуть блок с замечаниями. Нет требования заставлять ChatGPT заново выполнять всю тестовую работу Codex. Не требовать у владельца ручную проверку после каждой мелкой Issue. Результаты пишутся в GitHub Project/Issue/PR, а не теряются в чате.

## 2. Открытые продуктовые решения — обязательный gate перед реализации зависимой функции

В [03-PHOTO-STORAGE.md](03-PHOTO-STORAGE.md) утверждены ST-01/02/03/05/06/09/12/13, первый S3 backend Garage. **ST-04 recovery технический baseline уже зафиксирован** в [11](11-IDENTITY-AND-KEYS.md); **ST-16 browser storage** и **ST-17 trusted-time** — в [12](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md). Перед R2-03/R2-04 Codex делает crypto/device security review и реальные Safari probes, но **не возвращает вопросы хранения в общий дизайн-блокер**. Поздние OPEN — редакторская история (ST-07), fullres compression (ST-08), shares (ST-10), legacy migration (ST-11), изменение уже существующего TTL (ST-15).

Для первой версии режим 1 (no additional compression) показан **disabled**, не имитируется. Mode 2 хранит compressed source и отдельный edited current, mode 3 default безопасно заменяет compressed master. **Миниатюры и 24ч–45д TTL уже закреплены, см. ST-05/06/09**; каждая редакторская версия, derivative и связанная metadata удаляются по expiry.

## 3. Фазы и полный backlog

IDs стабильны; каждому соответствует **отдельный Issue**, ссылки в первой колонке, критерии и зависимости. Не создавать дополнительную очередь в другом документе. P0 — продуктовый блокер, P1 — обязательное расширение основной функции, P2 — поздняя полировка/дополнения.

| ID | Фаза | Пункт | Priority | Зависит от / gate |
| --- | --- | --- | --- | --- |
| [R2-00](https://github.com/1troitsky/photobunker-new/issues/1) | Foundation | Проверить инварианты, выбрать недостающие **только для ближайшей Issue** технические решения | P0 | Codex + владелец лишь по существенным вопросам |
| [R2-01](https://github.com/1troitsky/photobunker-new/issues/2) | Foundation | **Codex setup:** workspace, Vue/TS, production build, CI/import boundaries, test harness, `.gitignore`, Project, HTTPS preview; **никакой интеграции PostgreSQL/Garage** | P0 | Архитектура APPROVED; R2-00 не gate для UI |
| [R2-02](https://github.com/1troitsky/photobunker-new/issues/3) | Foundation | UI/design system, пять основных экранов, production navigation с fixture-only UI preview | P0 | R2-01, утверждение UX владельцем |
| [R2-03](https://github.com/1troitsky/photobunker-new/issues/4) | Foundation | **Anonymous key-only Create/Restore, trusted first device, signed challenges, one Recovery Key, new-device pairing, session isolation** | P0 | R2-01/02; [11 Identity/Keys](11-IDENTITY-AND-KEYS.md) + Codex crypto/security review, не ждать R2-21 |
| [R2-04](https://github.com/1troitsky/photobunker-new/issues/5) | Storage | **Dexie/IndexedDB metadata/outbox**, OPFS encrypted blobs + encrypted IDB Blob fallback, trusted-time rollback policy, crash journal | P0 | R2-03; [11](11-IDENTITY-AND-KEYS.md) + [12](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md); Safari real-device capability gates |
| [R2-05](https://github.com/1troitsky/photobunker-new/issues/6) | Storage | Idempotent encrypted S3 sync, readback, TTL, orphan GC; **scheduled batch deletion** | P0 | R2-04; Garage/24ч–45д TTL/thumb policy утверждены |
| [R2-06](https://github.com/1troitsky/photobunker-new/issues/7) | Capture | Camera/capture/photo compression policies modes 2/3, mode 1 disabled, no system gallery; **minimal local photo list/view for first real manual test** | P0 | R2-02/03/04; ST-08; **not R2-05** |
| [R2-07](https://github.com/1troitsky/photobunker-new/issues/8) | Photos | Gallery, metadata, NAME-ID, **one WebP ≤320px per photo**, bounded encrypted cache, GPS | P0 | R2-05/06; ST-05/06 утверждены |
| [R2-08](https://github.com/1troitsky/photobunker-new/issues/9) | Assignments | Assignment CRUD, statuses, revision, retention mode selection | P0 | R2-03/04, contract design |
| [R2-09](https://github.com/1troitsky/photobunker-new/issues/10) | Assignments | Teams, contacts, invitations, roles/grants, profile | P1 | R2-08 |
| [R2-10](https://github.com/1troitsky/photobunker-new/issues/11) | Assignments | Assignment-bound capture, versioned policy, photo ACL, photo review | P0 | R2-07/08/09 |
| [R2-11](https://github.com/1troitsky/photobunker-new/issues/12) | Editor | Editor tools and safe image replacement modes 2/3 | P0 | R2-07/10; ST-07/08 |
| [R2-12](https://github.com/1troitsky/photobunker-new/issues/13) | Metadata | Independent Photo/Assignment Notes, permissions, offline lifecycle | P1 | R2-08/10 |
| [R2-13](https://github.com/1troitsky/photobunker-new/issues/14) | Card | Photo Card independent identity/metadata/TTL/access scopes | P0 | R2-07/10/11 |
| [R2-14](https://github.com/1troitsky/photobunker-new/issues/15) | Card | Encrypted share/export, privacy mask, revoke/download scope | P0 | R2-13; ST-10 |
| [R2-15](https://github.com/1troitsky/photobunker-new/issues/16) | Browser | Protected multi-assignment Browser collection + ACL, TTL | P0 | R2-10/13 |
| [R2-16](https://github.com/1troitsky/photobunker-new/issues/17) | Browser | Finder-like Grid/List/Tree, search, sort, selection | P1 | R2-15 |
| [R2-17](https://github.com/1troitsky/photobunker-new/issues/18) | Browser | Scoped download and ZIP, quota/streaming, dynamic rights | P1 | R2-14/16; ST-10 |
| [R2-18](https://github.com/1troitsky/photobunker-new/issues/19) | Security | App Lock PIN optional, configured attempts/cooldown, account/device scope | P0 | R2-03 |
| [R2-19](https://github.com/1troitsky/photobunker-new/issues/20) | Security | Local Delete PIN, backup/recovery preflight, exact-device cleanup | P0 | R2-05/18; ST-04 recovery, TTL утверждён |
| [R2-20](https://github.com/1troitsky/photobunker-new/issues/21) | Security | Emergency PIN, immediate lock + signed durable server intent, crash/retry | P0 | R2-19; independent threat review |
| [R2-21](https://github.com/1troitsky/photobunker-new/issues/22) | UX | **Full Welcome visual/copy polish**, profile/settings, themes, RU/EN, accessibility; **не реализация key-only Create/Restore** | P0 | R2-02/03/18; базовые identity screens уже в R2-03 |
| [R2-22](https://github.com/1troitsky/photobunker-new/issues/23) | Extensions | Geo-based gallery filters, map opt-in, non-blocking GPS | P2 | R2-07/10 |
| [R2-23](https://github.com/1troitsky/photobunker-new/issues/24) | Assurance | Independent security, fault injection and release E2E hardening | P0 | P0 core modules R2-03–21 |
| [R2-24](https://github.com/1troitsky/photobunker-new/issues/25) | Delivery | Staging/prod deployment, backup-restore, rollback, mobile PWA acceptance | P0 | R2-23 |
| [R2-25](https://github.com/1troitsky/photobunker-new/issues/26) | Extensions | Recommendations/avatars/quality polish (no fake features) | P2 | R2-09/21 |

**Правило:** P0 задачи допускают параллельное проектирование, но не должны интегрироваться в обход своих зависимостей. Релиз **не** обязан включать P2; продуктовый владелец решает, необходим ли P1 browser ZIP и Notes в первой поставке. Нельзя считать P1/P2 «готовыми» до acceptance.

## 4. Фазы по результату

### R2-0 Foundation: R2-00–03
**R2-01 только минимальный frontend/CI/Project/HTTPS preview**, не Garage/PostgreSQL. **R2-02** — пять экранов и первая ручная UX-проверка. **R2-03** — anonymous key-only Create/Restore + first device/pairing по [11](11-IDENTITY-AND-KEYS.md), без email/password/reset; shell не блокирует HTTP. Codex подготавливает, выдаёт ChatGPT задачи, тестирует и допиливает. UI preview без server behavior допускается только явно отмеченный. Начальные gates проверяют production camera capability независимо от dev flags и import-boundary негативными примерами.

### R2-1 Storage and capture: R2-04–07
**Execution: R2-04 → R2-06 → R2-05 → R2-07.** Ранний просмотр локального фото входит в R2-06; ждать полного S3 и галереи для первого теста камеры запрещено. Реальная камера, encrypted local files + metadata DB, durable background S3 sync, ограниченные derived assets, галерея, GPS/NAME-ID. **Конечный результат:** offline photo survives reload and safe sync, no system gallery, no plaintext at rest.

### R2-2 Collaboration: R2-08–10
Assignments statuses, retention modes, team roles, grants, invitations and photo bindings. **Реальные два аккаунта**, независимая серверная авторизация, concurrency/CAS.

### R2-3 Editor/Metadata: R2-11–12
Touch/mobile editor, text/brush/pencil/shapes, safe replace/preserve mode, notes distinct from metadata. No invisible archived full-size duplicates.

### R2-4 Sharing: R2-13–17
Photo Card (card-only policy), encrypted share with isolated rendition, Browser collections, Finder-like UI, scoped download/ZIP. Не создаёт сверхправ по одной ссылке.

### R2-5 Security: R2-18–20
Три PIN механизма, recovery preflight, error paths, offline emergency. No false promises on secure erase.

### R2-6 Product UI: R2-21–22, R2-25
**Только расширенный Welcome/дизайн/copy polish и Settings/profile**, локализация, геофильтры, performance/a11y, tips. **Минимальные auth/recovery screens должны существовать уже в R2-03**. Hardware/browser acceptance never replaced by a screenshot.

### R2-7 Release: R2-23–24
Cross-module failure tests, independent security review, production build E2E, real iOS/Android checks, backup/restore and deployment. Stop/release decision based on evidence.

## 5. Stage gates: нельзя двигаться дальше без

- **Gate A (после R2-02):** архитектура APPROVED; CI и import-boundaries реально проверены, production HTTPS preview работает; владелец проверил UI на телефоне/desktop **без Garage/PostgreSQL**.
- **Gate Identity/Keys (после R2-03):** key-only bootstrap, Recovery Key confirm/restore, signed challenge, pairing, two accounts and partial retry — тесты Codex PASS, без device-unconfirmed deadlock и global content key.
- **Gate Browser Storage/Time (после R2-04):** Safari OPFS/fallback/persist, encrypted IndexedDB + blobs, rollback detection, crash recovery — тесты Codex PASS.
- **Gate B1 (после R2-06):** реальная камера -> encrypted commit -> минимальный локальный просмотр -> offline/reload в **production** PWA, без S3, без записи в системную галерею, владелец проверил.
- **Gate B2 (после R2-05/R2-07):** sync -> S3 readback -> полная галерея, бюджет assets и cleanup доказаны, владелец проверил.
- **Gate C**: assignment capture/ACL + editor modes + multi-user authorized access, zero unauthorized paths.
- **Gate D**: Card/Browser scopes/TTL/revoke independent, no data leaks/false public grants.
- **Gate E**: PIN destructive flows and backup/restore/recovery tested, release checklist and owner acceptance.

В каждой Issue должны быть: цель, scope, dependencies, acceptance и failure paths; детали установки, CI и тестовой проверки определяет Codex. **ChatGPT реализует основную массу задач; Codex ставит зависимости, выдаёт Issues, проверяет и может исправлять/допиливать код в том же PR.**

## 6. Вне scope

Messages/Matrix, LiveKit, voice/video calls, chat attachment, Presence, group chat, messenger encryption/history. Старые checklist §3/4/6/10 исключены; профиль, камера, задание и Photo Card не зависят от них. Включение этих функций позже — **новое решение владельца и отдельный roadmap change**, не «подготовка на всякий случай».

## 7. Актуализация

Переходы статусов ведутся **только в Project/Issues**. Roadmap меняется при утверждённых scope/архитектурных решениях владельца. **Codex** ведёт техническую очередь Issues/Project, окружение и результаты проверки; **ChatGPT** выполняет выданные задачи через Draft PR. Оба читают README + AGENTS + этот roadmap. Роли не переводить в выдуманную иерархию «ChatGPT — начальник Codex».
