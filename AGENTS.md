# PhotoBunker New — правила разработки

**Репозиторий:** `1troitsky/photobunker-new`. **Роли утверждены владельцем 2026-10-28:** владелец управляет продуктом; **Codex — технический координатор, располагающий доступом к окружению**, готовит инфраструктуру/зависимости, назначает задачи ChatGPT, проверяет, тестирует и **при необходимости дорабатывает код**; **ChatGPT — основной исполнитель GitHub Issues из-за доступного объёма работы/лимитов**, не руководитель Codex. Вопрос авторитета одного AI над другим не стоит. Все участники могут предлагать решения, а спорные продуктовые вопросы решает владелец.

## 1. Обязательное чтение

Заново получить актуальный `main` и прочитать:
- [README](README.md) — продукт, утверждённые принципы, последние legacy-ссылки;
- [COLLABORATION](COLLABORATION.md) — трёхсторонний процесс и права участников;
- [CHATBOT-AGENTS](CHATBOT-AGENTS.md) — правила исполнителя GitHub Issues;
- [единый Roadmap](docs/08-ROADMAP.md) и полный текущий Issue;
- [архитектуру](docs/02-ARCHITECTURE.md), [хранение](docs/03-PHOTO-STORAGE.md), [домен/API](docs/04-DOMAIN-AND-CONTRACTS.md), [безопасность](docs/05-SECURITY.md), [UX/UI](docs/06-UX-UI.md), [quality](docs/07-QUALITY-AND-RELEASE.md), [operations](docs/09-OPERATIONS.md), [checklist map](docs/10-CHECKLIST-MAP.md) — в релевантном объёме;
- исторические [AUDIT-20261028](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md) и [CHECKLIST](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md) для требований, но не как копируемую реализацию.

**Никакой старый сохранённый SHA, контекст предыдущего чата или неподтверждённый Project status не заменяет свежую проверку.**

## 2. Технические инварианты

- **Новый проект, не массовый перенос legacy.** Старый PhotoBunker — источник требований, test vectors и потенциально пригодных частей кода; Codex оценивает пригодность/проверяет риски переноса. Старые огромные Vue stores, plaintext prototype, Matrix/RTC/чаты в новом продукте не нужны.
- **UI-first + production-first:** R2-01 — фундамент/production build и проверяемый HTTPS preview, R2-02 — пять экранов для первой приёмки владельца; не ждать завершения всех 26 Issues. Выпускать и тестировать реальный `build`, не только dev.
- **Local-first:** shell/навигирование не ждут HTTP; camera → transient memory → compress if policy requires → encrypt → durable local photo + metadata DB commit → background ciphertext sync to S3 Garage; раздельные состояния local saved / cloud synced. Идемпотентность, crash/reload/retry/lost ACK и account switching.
- **Фото только зашифровано при постоянной локальной записи**, не попадает в системные Photos/DCIM, приватные metadata в DB защищены. Ключи, PIN, GPS, фото, EXIF и токены не протекают в logs, URLs, analytics, plaintext caches.
- **Режимы задания:** 1 — camera bytes без дополнительного сжатия, видимый disabled; 2 — compressed original + separate edit; 3 — compressed master replaced after edit, default. Выбранный режим фиксируется при capture, старые assets заменяются crash-safe.
- **Thumbnails:** максимум одна зашифрованная WebP миниатюра 320 px по длинной стороне на фото, S3 + ограниченный зашифрованный кэш; отдельный постоянный preview отсутствует.
- **Storage TTL:** срок снимка по заданию **24 часа — 45 дней**, после expiry закрыть доступ и удалить original, master, edits, thumbnail, share/export, кэш и записи БД. Эффективный TTL фиксируется при съёмке; Laravel Scheduler + очередь с indexed expiry и batch jobs; локальный клиент убирает просроченное при возобновлении работы. См. [03](docs/03-PHOTO-STORAGE.md).
- **Фото, Photo Card, Note, Assignment, Team и Photo Browser — разные сущности и scopes.** Сервер проверяет ACL/TTL; PIN блокировки, локального удаления и emergency — разные механизмы. Доступ/удаление нельзя подтверждать прежде фактического источника истины.
- **Модульные границы:** domain/application/infrastructure/ui с публичными контрактами; no cyclic feature imports, no UI raw crypto/S3/DB SDK, no giant shared store. CI должен ловить нарушения.
- **Production security/UX:** mobile + desktop, RU/EN, offline, restart, permission denied/storage full, same/different accounts, revoke/expiry. Не называть непроверенное production-ready. Избегать destructive legacy migration.

## 3. Распределение работы и право исправления

1. **Codex** имеет доступ к среде: ставит и настраивает зависимости, рабочие команды, инструменты тестирования и preview/staging, создаёт/обновляет Project и приоритеты через доступные инструменты, **выдаёт ChatGPT конкретную Ready Issue** с ограниченным scope.
2. **ChatGPT** реализует основной код назначенной Issue в отдельной ветке, создаёт один Draft PR с `Closes #N`. Не меняет `main` напрямую; не начинает другие задачи без передачи Codex. **Не требуется тратить лимиты ChatGPT на дублирование полноценного тестового окружения Codex или навязывать себе обязанность писать все тесты**.
3. **Codex** выполняет независимые проверки, **пишет/запускает тесты, настраивает CI, исправляет/допиливает код в том же PR**, если считает нужным; после изменений повторно прогоняет проверки. Не надо отсылать все правки обратно ChatGPT, если эффективнее выполнить их локально.
4. Codex представляет результат, логи тестов, реальные ограничения и подготовленную production-сборку; владелец лично принимает milestone на телефоне/desktop. **Merge и необратимые операции — по явно установленному владельцем правилу**, без самовольного изменения `main`.
5. Project содержит Backlog/Ready/In Progress/Review/Integrated/Accepted/Blocked. Один основной Issue в работе у ChatGPT; Codex организует очередь/тестирование по своим лимитам. Новые Issues не придумываются из scope без согласования.

## 4. Stop / escalation

Недоказанное шифрование, plaintext disk, автоэкспорт в системную галерею, поздние ACK воскрешают фото, файлы живут после разрешённого expiry, S3/DB orphan без cleanup, сломанный production camera, обход ACL, безвозвратная потеря неистёкшего unsynced снимка — STOP. Codex оформляет воспроизводимый defect/test и исправляет либо направляет ChatGPT узкую задачу. Только владелец утверждает изменение продуктовых правил.
