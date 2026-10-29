# PhotoBunker — новая версия

> **Режим Assignment Release (решение владельца 2026-10-30).** Продолжение Issues R2-12+ остановлено; PR #36–40 сохранены без слияния. Единый [Draft PR #41](https://github.com/1troitsky/photobunker-new/pull/41) содержит compatibility-ядро старого PhotoBunker и код всех четырёх новых PR. PB2 остаётся главным репозиторием и архитектурной целью, старая Identity/E2EE временно работает изолированно через typed gateway; Matrix может требоваться для внутреннего bootstrap. **Тесты и релиз не выполнены.** [Передача Codex](docs/ASSIGNMENT-RELEASE-CONSOLIDATION-HANDOFF.md).


**Процесс обновлён решением владельца 2026-10-29:** ChatGPT последовательно реализует все оставшиеся согласованные Issues без ожидания Codex и merge; финальную проверку и интеграцию накопленного стека выполняет Codex. **Состояние baseline на 28.10.2026:** архитектурные инварианты **APPROVED**, **R2-01 интегрирована**: создан Vue/TypeScript PWA workspace, локальный production build/test harness и GitHub Project. **R2-02 Ready** после read-only legacy-check UI/assets и передана ChatGPT. Garage и PostgreSQL не входят в R2-01/R2-02.

PhotoBunker — защищённое фотоприложение: камера, локальная галерея, задания и команды, редактор, Photo Card, защищённый Photo Browser, три независимых PIN-сценария. Мобильное PWA и desktop. **Мессенджера/Matrix/чатов/звонков в этой версии нет.**

Новый проект **не копирует массово** старый `1troitsky/photobunker`: нормативные требования уже перенесены в [самостоятельный baseline](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md). ChatGPT перед каждой Issue самостоятельно читает нужные legacy-компоненты на GitHub read-only и фиксирует их классификацию; выполняет отдельные ограниченные Issues и собирает Draft PR в стек. Codex проверяет и допиливает стек после завершения Implementation Phase.

## Принятые продуктовые правила

1. **UI-first / production-first / local-first.** Ранний работающий интерфейс пяти экранов (**Камера, Фото, Задания, Photo Browser, Профиль**), production build и доступный тестовый HTTPS preview. Первая ручная UX-проверка владельца сразу после R2-02. Реальная локальная encrypted камера и минимальный просмотр — после R2-06, **до S3**; далее синхронизация и полная галерея.
2. **Локально → S3 (Garage как первый S3-compatible backend).** До локального durable commit снимок и чувствительные метаданные зашифрованы. Снимок не попадает в системные Photos/DCIM. Метаданные — отдельно в локальной БД, позднее синхронизация с серверной БД. S3 не блокирует навигацию или локальную работу.
3. **Режимы хранения по заданию:** (1) источник без дополнительного сжатия, **disabled в UI**; (2) сохранять сжатый исходник отдельно от редакторской версии; (3) сжатый master заменять при сохранении редакторской версии, **default**, также без задания.
4. **Миниатюра:** максимум одна зашифрованная **WebP до 320px** по длинной стороне на фото, отправляется в S3, на устройстве ограниченный зашифрованный кэш; отдельные постоянные previews не хранить.
5. **TTL всех фотографий: от 24 часов до 45 дней по заданию.** При создании фиксируется срок `expires_at`. По истечении закрывается доступ; очищаются originals, masters, edits, thumbnails, файлы/ссылки share/export, кэш и относящиеся к фото строки БД/metadata. Сервис Laravel Scheduler + cron + batch queue удаляет истёкшее с индексом `expires_at`; локальный клиент удаляет просроченное при следующем доступном запуске. Не оставлять данные бессрочно и не выдавать ошибочную мгновенную гарантию очистки отключённого офлайн-телефона.
6. **Anonymous key-only Identity:** никаких email, телефона и паролей. Приложение выдаёт один Account Recovery Key; trusted devices входят по подписанному challenge, новое устройство восстанавливается ключом или pairing. Потеря ключа и всех устройств означает окончательную потерю доступа. Account wrapping key оборачивает отдельные per-asset DEK. [11](docs/11-IDENTITY-AND-KEYS.md).
7. **Browser storage:** Dexie/IndexedDB — metadata/journal/outbox, OPFS — ciphertext photo assets с encrypted IndexedDB Blob fallback, Pinia только ephemeral UI state. Safari/iOS capability+persist проверяется в R2-04. [12](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md).
8. **Security и trusted time:** доступы Card, photo, original, download, Note и Browser независимы, ACL/TTL проверяются сервером и локальной криптографией; App lock PIN / local delete PIN / emergency PIN — разные механизмы. Серверное время авторитетно, клиент хранит last trusted time, подозрительный clock rollback блокирует офлайн-доступ до серверной сверки.

Полная спецификация — [03 — Photo Storage](docs/03-PHOTO-STORAGE.md), [11 — Identity/Keys](docs/11-IDENTITY-AND-KEYS.md), [12 — Browser Storage/Time](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md). **ST-04 recovery baseline больше не OPEN:** его проверяет Codex перед R2-03/R2-04. Остальные поздние детали (конкретные профили fullres compression, editor undo/export и legacy migration) не блокируют R2-01/R2-02.

## Новая схема работы: Implementation → Verification/Integration

**Владелец:** продуктовые решения, приоритеты, UX/device acceptance и разрешение выпуска.

**ChatGPT:** самостоятельно подготавливает Legacy evidence и выполняет **все оставшиеся Issues** по зависимостям без ожидания Codex review/merge; на каждый Issue одна ветка и один Draft PR. Все `NOT RUN` и риски честно документируются. Никакого изменения `main`.

**Codex:** по завершении всей реализации проверяет, тестирует, исправляет и последовательно сливает **весь стек**; проверяет общий production build, безопасность, device/PWA UX, backup/recovery/rollback. **Только этот PR с утверждёнными правилами** Codex должен сначала проверить и слить в `main`.

**Stacked PRs:** незалитая upstream ветка является `base` следующего Draft PR; один Issue = один PR, свой `base...HEAD` diff. Логические зависимости сохраняются, но необходимость предварительного merge и выдачи следующего Ready от Codex отменена. Финальная интеграция Codex — снизу вверх.

**UI/UX — сменяемая оболочка:** `ui` + design tokens + composable shell; функции/локальная надёжность/криптография/ACL/TTL живут в domain/application/infrastructure и не переписываются при изменении дизайна. Нормативный документ: **[14 — Independent Development Pipeline & Replaceable UI](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md)**. Правила ролей: [COLLABORATION](COLLABORATION.md), [AGENTS](AGENTS.md), [CHATBOT-AGENTS](CHATBOT-AGENTS.md).

## Старый PhotoBunker — обязательная read-only сверка для каждой задачи

Старый `1troitsky/photobunker` не изменяется и не переносится целиком, но **не игнорируется**. Перед каждой Issue ChatGPT читает точные legacy-пути из её evidence через GitHub. Если evidence отсутствует, ChatGPT самостоятельно проводит узкую сверку старой реализации и фиксирует в существующей Issue `REUSE / ADAPT / REFERENCE / REJECT` до написания кода. Так повторно используются проверенные assets, UX, алгоритмы и тесты, а новый baseline остаётся нормативным источником требований.

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
- **[14 — Независимая реализация/stacked PR и заменяемый UI](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md)** — утверждённые правила процесса с 2026-10-29.

## Текущее состояние GitHub и следующий шаг

[Issues #1–#26](https://github.com/1troitsky/photobunker-new/issues) добавлены в **[PhotoBunker New — Development](https://github.com/users/1troitsky/projects/14)** со стадиями Backlog/Ready/In Progress/Review/Integrated/Accepted/Blocked/Cancelled. ChatGPT независимо реализует Issues в stacked Draft PR без слияния функциональных PR до завершения всей разработки. Затем Codex проводит проверку/исправления/последовательную интеграцию, обновляет Project и передаёт владельцу подтверждённый build. ChatGPT сам merge не выполняет.

## Локальная разработка

Требуются Node 22 и зафиксированный Corepack/pnpm 10.20.0. Из корня репозитория:

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm check
pnpm exec playwright install chromium
pnpm test:browser
```

`pnpm check` запускает lint, typecheck, архитектурный positive/negative gate, unit tests и проверку production PWA bundle. `pnpm test:browser` запускает собранный bundle через `vite preview`, не dev server.
