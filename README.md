# PhotoBunker — новая версия

**Состояние на 28.10.2026:** архитектурные инварианты **APPROVED**, 26 Issues подготовлены; **реализация ещё не начата**. Следующее действие — Codex выполняет **узкий R2-01 (workspace/production build/CI/Project/preview, без Garage и PostgreSQL интеграции)** и выдаёт ChatGPT первую Ready Issue.

PhotoBunker — защищённое фотоприложение: камера, локальная галерея, задания и команды, редактор, Photo Card, защищённый Photo Browser, три независимых PIN-сценария. Мобильное PWA и desktop. **Мессенджера/Matrix/чатов/звонков в этой версии нет.**

Новый проект **не копирует массово** старый `1troitsky/photobunker`: нормативные требования уже перенесены в [самостоятельный baseline](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md). Codex проверяет конкретные legacy компоненты только при обоснованном reuse; ChatGPT реализует отдельные ограниченные Issues, Codex проверяет и допиливает.

## Принятые продуктовые правила

1. **UI-first / production-first / local-first.** Ранний работающий интерфейс пяти экранов (**Камера, Фото, Задания, Photo Browser, Профиль**), production build и доступный тестовый HTTPS preview. Первая ручная UX-проверка владельца сразу после R2-02. Реальная локальная encrypted камера и минимальный просмотр — после R2-06, **до S3**; далее синхронизация и полная галерея.
2. **Локально → S3 (Garage как первый S3-compatible backend).** До локального durable commit снимок и чувствительные метаданные зашифрованы. Снимок не попадает в системные Photos/DCIM. Метаданные — отдельно в локальной БД, позднее синхронизация с серверной БД. S3 не блокирует навигацию или локальную работу.
3. **Режимы хранения по заданию:** (1) источник без дополнительного сжатия, **disabled в UI**; (2) сохранять сжатый исходник отдельно от редакторской версии; (3) сжатый master заменять при сохранении редакторской версии, **default**, также без задания.
4. **Миниатюра:** максимум одна зашифрованная **WebP до 320px** по длинной стороне на фото, отправляется в S3, на устройстве ограниченный зашифрованный кэш; отдельные постоянные previews не хранить.
5. **TTL всех фотографий: от 24 часов до 45 дней по заданию.** При создании фиксируется срок `expires_at`. По истечении закрывается доступ; очищаются originals, masters, edits, thumbnails, файлы/ссылки share/export, кэш и относящиеся к фото строки БД/metadata. Сервис Laravel Scheduler + cron + batch queue удаляет истёкшее с индексом `expires_at`; локальный клиент удаляет просроченное при следующем доступном запуске. Не оставлять данные бессрочно и не выдавать ошибочную мгновенную гарантию очистки отключённого офлайн-телефона.
6. **Identity и расширяемость:** стабильный User/Account ID, самостоятельные Device/Session/Profile и Authorization; будущие подписки (User/Team billing owner) и Messenger подключаются отдельными модулями через Identity API. **Мессенджер не включён** в текущий продукт и не участвует в старте приложения. Email/password+email verification; first trusted device bootstrap, pairing/recovery phrase и account switching определены в [11](docs/11-IDENTITY-AND-KEYS.md).
7. **Browser storage:** Dexie/IndexedDB — metadata/journal/outbox, OPFS — ciphertext photo assets с encrypted IndexedDB Blob fallback, Pinia только ephemeral UI state. Safari/iOS capability+persist проверяется в R2-04. [12](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md).
8. **Security и trusted time:** доступы Card, photo, original, download, Note и Browser независимы, ACL/TTL проверяются сервером и локальной криптографией; App lock PIN / local delete PIN / emergency PIN — разные механизмы. Серверное время авторитетно, клиент хранит last trusted time, подозрительный clock rollback блокирует офлайн-доступ до серверной сверки.

Полная спецификация — [03 — Photo Storage](docs/03-PHOTO-STORAGE.md), [11 — Identity/Keys](docs/11-IDENTITY-AND-KEYS.md), [12 — Browser Storage/Time](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md). **ST-04 recovery baseline больше не OPEN:** его проверяет Codex перед R2-03/R2-04. Остальные поздние детали (конкретные профили fullres compression, editor undo/export и legacy migration) не блокируют R2-01/R2-02.

## Трёхсторонняя работа — фиксированные роли

| Участник | Обязанности |
| --- | --- |
| **Владелец** | Продуктовые решения, приоритеты, ручные проверки на телефоне/desktop, разрешения merge/release |
| **Codex** | Технический координатор **с доступом к окружению**: установка зависимостей, Project/CI/production preview, выдача ChatGPT Ready Issues, code review, тесты **и самостоятельная доработка того же PR** при необходимости |
| **ChatGPT** | **Основная масса реализации по Issue** благодаря доступным лимитам: код, ветка, один Draft PR, передача Codex; проверки по доступным инструментам, без обязанности дублировать тестовое окружение Codex |

**Codex не подчинён ChatGPT и не ограничен ролью пассивного рецензента.** Он вправе настраивать инфраструктуру, писать тесты и исправлять код. ChatGPT не назначает Codex задачи и не навязывает ему лишние процедуры. Правила подробнее — [COLLABORATION.md](COLLABORATION.md), [AGENTS.md](AGENTS.md), [CHATBOT-AGENTS.md](CHATBOT-AGENTS.md).

## Исторические источники — справочные, не обязательные для каждой задачи

- **[Аудит 28.10.2026 — AUDIT-20261028.md](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md)** — исторический диагноз; требования «не повторять» уже внесены в [07 Quality](docs/07-QUALITY-AND-RELEASE.md).
- **[Legacy CHECKLIST.md](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md)** — исторический источник; актуальные обязательные требования **полностью выделены** в [13 — Product Acceptance Baseline](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md).
- [Карта переноса старого checklist в новый проект](docs/10-CHECKLIST-MAP.md).

## Документы и roadmap

- [01 — Причины пересборки и legacy дефекты](docs/01-CURRENT-PROBLEMS.md)
- [02 — Модульная архитектура и запрещённые зависимости](docs/02-ARCHITECTURE.md)
- **[03 — Правила хранения, thumbnails, TTL и очистка](docs/03-PHOTO-STORAGE.md)**
- [04 — Domain и API contracts](docs/04-DOMAIN-AND-CONTRACTS.md)
- [05 — Security, PIN и threat model](docs/05-SECURITY.md)
- [06 — UI/UX и ранняя ручная проверка](docs/06-UX-UI.md)
- [07 — Тестирование, production readiness и release gates](docs/07-QUALITY-AND-RELEASE.md)
- **[08 — Единый Implementation Roadmap R2-00…R2-25](docs/08-ROADMAP.md)** с прямыми ссылками на Issues
- [09 — Operations / S3 / scheduled cleanup](docs/09-OPERATIONS.md)
- [10 — Сопоставление с прежним CHECKLIST](docs/10-CHECKLIST-MAP.md)
- **[11 — Identity / User / Device / Recovery](docs/11-IDENTITY-AND-KEYS.md)** — новые устройства и будущие независимые подписки/модули.
- **[12 — Local storage / Trusted Time](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md)** — Dexie, OPFS/fallback, Safari и clock rollback.
- **[13 — Самостоятельный baseline требований](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md)** — всё, что агент должен реализовать, без обязательного чтения legacy.

## Текущее состояние GitHub и следующий шаг

[Issues #1–#26](https://github.com/1troitsky/photobunker-new/issues) уже созданы; **их наличие не означает, что они готовы к реализации**. Создание/привязка доски GitHub Projects v2 ещё **не подтверждены** в этом репозитории. **Codex** через доступные ему инструменты создаёт/настраивает `PhotoBunker New — Development`, готовит инфраструктуру, затем **выдаёт ChatGPT первую конкретную Ready Issue**. ChatGPT работает в отдельной ветке и передаёт Draft PR; Codex проверяет, тестирует и допиливает. Никаких самостоятельных merge в `main` без согласованного разрешения владельца.
