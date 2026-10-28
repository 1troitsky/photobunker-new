# 08. PhotoBunker New — единый Implementation Roadmap

**Версия:** проект плана для реализации, 2026-10-28. **Статус: подготовлено; начало разработки только после подтверждения владельцем и закрытия блокирующих OPEN решений.** Это **единственный roadmap** нового проекта. Операционный статус каждого Issue — в GitHub Project, не в таблице ниже.

## 0. Цель и критерий

Производственный PhotoBunker без Messenger/Matrix/Calls: защищённая локальная съёмка, метаданные отдельно в БД, гибрид локально → S3, три режима хранения (1 disabled), задания/Team, галерея, редактор, Photo Card, Photo Browser, 3 независимых PIN-сценария, RU/EN и мобильный/desktop PWA. Приложение не пишет фото в системную галерею; локально нет plaintext at rest.

**Success:** пользователь в реальной production-сборке на телефоне снимает фото, закрывает PWA, работает offline, редактирует/сохраняет по выбранному mode, синхронизирует с S3, назначает права участнику, открывает разрешённый Browser/Card, восстанавливается на разрешённом устройстве, запускает PIN, безопасно удаляет при явном выборе — без потерь, утечек, накопления orphan assets или зависания навигации.

## 1. Источники и правила исполнения

Прежде каждой задачи прочесть `AGENTS.md`, `CHATBOT-AGENTS.md`, `COLLABORATION.md`, этот roadmap, профильные docs, [аудит](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md) и [checklist](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md). Из старого проекта можно брать спецификации/тест-векторы, но нельзя слепо копировать монолитный frontend/схему вечного immutable original.

**Проект создаётся целиком заранее:** полный backlog Issues формируется сразу для всех фаз. `Ready` — только проверенная следующая работа без OPEN решений. Статусы, WIP и передача между тремя участниками — в `COLLABORATION.md`.

**Review gate:** отдельная ветка и Draft PR, production build/contract tests/target e2e, diff, security evidence. `Integrated` после review и merge Codex; `Accepted` только после проверки владельцем на устройстве.

## 2. Открытые продуктовые решения — обязательный gate перед реализации зависимой функции

В [03-PHOTO-STORAGE.md](03-PHOTO-STORAGE.md) ST-01/02/03/12/13 приняты. **OPEN:** ST-04 восстановление ключей/локальная очистка; ST-05/06 thumbs/previews; ST-07 editor history; ST-08 compression, формат/качество; ST-09 TTL/budgets; ST-10 scope share exports; ST-11 legacy migration; ST-14 S3 provider; ST-15 изменение retention задачи. Они **не блокируют** создание Issues, но блокируют `Ready` для зависящих операций. Никакой агент не должен закрывать их произвольно.

Для MVP/production цели режим 1 (no additional compression) показан **disabled**, не имитируется. Mode 2 хранит compressed source и отдельный edited current, mode 3 default заменяет compressed master безопасно. Версии/миниатюры и сроки хранятся по будущему утверждённому контракту, а не догадке.

## 3. Фазы и полный backlog

IDs стабильны; каждому соответствует **отдельный Issue**, критерии и зависимости. Не создавать дополнительную очередь в другом документе. P0 — продуктовый блокер, P1 — обязательное расширение основной функции, P2 — поздняя полировка/дополнения.

| ID | Фаза | Пункт | Priority | Зависит от / gate |
| --- | --- | --- | --- | --- |
| R2-00 | Foundation | Зафиксировать OPEN storage/security решения, требующие одобрения | P0 | Владелец |
| R2-01 | Foundation | Репозиторий/монорепо, Laravel 13, prod build, modular boundaries CI | P0 | выбран framework/storage adapter в R2-00 |
| R2-02 | Foundation | UI/design system, пять основных экранов, production navigation с fixture-only UI preview | P0 | R2-01, утверждение UX владельцем |
| R2-03 | Foundation | Account/Device identity, session/recovery, независимый от сети shell | P0 | R2-01, security decisions R2-00 |
| R2-04 | Storage | Encrypted local photo & metadata store, crash journal, outbox, account scopes | P0 | R2-03; ST-04/09 |
| R2-05 | Storage | Idempotent encrypted S3 sync, readback, quota, TTL, orphan GC | P0 | R2-04; ST-09/14 |
| R2-06 | Capture | Camera/capture/photo compression policies modes 2/3, mode 1 disabled, no system gallery | P0 | R2-02/04; ST-08 |
| R2-07 | Photos | Gallery, photo metadata, NAME-ID, preview/cache budget, GPS | P0 | R2-05/06; ST-05/06 |
| R2-08 | Assignments | Assignment CRUD, statuses, revision, retention mode selection | P0 | R2-03/04, contract design |
| R2-09 | Assignments | Teams, contacts, invitations, roles/grants, profile | P1 | R2-08 |
| R2-10 | Assignments | Assignment-bound capture, versioned policy, photo ACL, photo review | P0 | R2-07/08/09 |
| R2-11 | Editor | Editor tools and safe image replacement modes 2/3 | P0 | R2-07/10; ST-07/08 |
| R2-12 | Metadata | Independent Photo/Assignment Notes, permissions, offline lifecycle | P1 | R2-08/10 |
| R2-13 | Card | Photo Card independent identity/metadata/TTL/access scopes | P0 | R2-07/10/11 |
| R2-14 | Card | Encrypted share/export, privacy mask, revoke/download scope | P0 | R2-13; ST-10 |
| R2-15 | Browser | Protected multi-assignment Browser collection + ACL, TTL | P0 | R2-10/13 |
| R2-16 | Browser | Finder-like Grid/List/Tree, search, sort, selection | P1 | R2-15 |
| R2-17 | Browser | Scoped download and ZIP, quota/streaming, dynamic rights | P1 | R2-14/16; ST-10 |
| R2-18 | Security | App Lock PIN optional, configured attempts/cooldown, account/device scope | P0 | R2-03 |
| R2-19 | Security | Local Delete PIN, backup/recovery preflight, exact-device cleanup | P0 | R2-05/18; ST-04/09 |
| R2-20 | Security | Emergency PIN, immediate lock + signed durable server intent, crash/retry | P0 | R2-19; independent threat review |
| R2-21 | UX | Welcome, profiles/settings, theme, RU/EN, accessible production UI | P0 | R2-02/18 |
| R2-22 | Extensions | Geo-based gallery filters, map opt-in, non-blocking GPS | P2 | R2-07/10 |
| R2-23 | Assurance | Independent security, fault injection and release E2E hardening | P0 | P0 core modules R2-03–21 |
| R2-24 | Delivery | Staging/prod deployment, backup-restore, rollback, mobile PWA acceptance | P0 | R2-23 |
| R2-25 | Extensions | Recommendations/avatars/quality polish (no fake features) | P2 | R2-09/21 |

**Правило:** P0 задачи допускают параллельное проектирование, но не должны интегрироваться в обход своих зависимостей. Релиз **не** обязан включать P2; продуктовый владелец решает, необходим ли P1 browser ZIP и Notes в первой поставке. Нельзя считать P1/P2 «готовыми» до acceptance.

## 4. Фазы по результату

### R2-0 Foundation: R2-00–03
Исполняемый production app shell, изолированная архитектура, дизайн-система и identity. UI preview без серверного поведения допускается **только явно отмеченный** и не выдаётся за готовую функцию. Начальные gates проверяют production camera capability независимо от dev flags и import-boundary негативными примерами.

### R2-1 Storage and capture: R2-04–07
Реальная камера, encrypted local files + metadata DB, durable background S3 sync, ограниченные derived assets, галерея, GPS/NAME-ID. **Конечный результат:** offline photo survives reload and safe sync, no system gallery, no plaintext at rest.

### R2-2 Collaboration: R2-08–10
Assignments statuses, retention modes, team roles, grants, invitations and photo bindings. **Реальные два аккаунта**, независимая серверная авторизация, concurrency/CAS.

### R2-3 Editor/Metadata: R2-11–12
Touch/mobile editor, text/brush/pencil/shapes, safe replace/preserve mode, notes distinct from metadata. No invisible archived full-size duplicates.

### R2-4 Sharing: R2-13–17
Photo Card (card-only policy), encrypted share with isolated rendition, Browser collections, Finder-like UI, scoped download/ZIP. Не создаёт сверхправ по одной ссылке.

### R2-5 Security: R2-18–20
Три PIN механизма, recovery preflight, error paths, offline emergency. No false promises on secure erase.

### R2-6 Product UI: R2-21–22, R2-25
Welcome, Settings, profile, localization, geo UI, performance/a11y, unobtrusive tips. Hardware/browser acceptance never replaced by a screenshot.

### R2-7 Release: R2-23–24
Cross-module failure tests, independent security review, production build E2E, real iOS/Android checks, backup/restore and deployment. Stop/release decision based on evidence.

## 5. Stage gates: нельзя двигаться дальше без

- **Gate A**: frameworks/stack and OPEN policies approved; CI guards block invalid imports/dev-only release paths.
- **Gate B**: camera -> encrypted commit -> gallery -> offline/reload -> sync -> readback on **production** PWA; byte accounting/recovery proven.
- **Gate C**: assignment capture/ACL + editor modes + multi-user authorized access, zero unauthorized paths.
- **Gate D**: Card/Browser scopes/TTL/revoke independent, no data leaks/false public grants.
- **Gate E**: PIN destructive flows and backup/restore/recovery tested, release checklist and owner acceptance.

В каждой Issue должна быть: конкретная выгода пользователю, dependencies, decision gates, happy/error/offline/reload/retry/ACL scope, API/data/storage impact, observable acceptance and NOT RUN; пустая ссылка на roadmap недостаточна.

## 6. Вне scope

Messages/Matrix, LiveKit, voice/video calls, chat attachment, Presence, group chat, messenger encryption/history. Старые checklist §3/4/6/10 исключены; профиль, камера, задание и Photo Card не зависят от них. Включение этих функций позже — **новое решение владельца и отдельный roadmap change**, не «подготовка на всякий случай».

## 7. Актуализация

Переходы статусов ведутся **только в Project/Issues**. Roadmap меняется исключительно при scope/архитектурном решении владельца; Codex фиксирует cross-cutting acceptance evidence в Issue/PR. При новом чате агенту достаточно README + AGENTS + этот roadmap + назначенный Issue: вся информация доступна в самом репозитории.
