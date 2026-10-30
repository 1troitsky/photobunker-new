# PhotoBunker PB1 → PB2: восстановление функциональности

**Статус:** Documentation-only Draft / NOT VERIFIED / NOT INTEGRATED, 2026-10-30. Без изменений main, PB1 и PR #40–42. Эта ветка основана на PB2 PR #42, но не включает новых runtime-функций.

## Обновление G0 после аудита — реальный зелёный CI

**Факт:** [GitHub Actions #41119814724](https://github.com/1troitsky/photobunker-new/actions/runs/41119814724) завершился **SUCCESS** для PB2 PR #42 (commit `1e0dc0694cb17f0d20c1c5831637feed99b67f20`).
- Получены настоящие GitHub runners: issue pre-run больше не блокирует тесты. Причина пяти исходных transient failures так и не установлена.
- `pnpm test:architecture` (включая negative fixtures), `pnpm lint` (0 errors, 1161 warnings), `pnpm typecheck`, `pnpm test:unit` (101/101), `pnpm build` — **PASS**.
- PHP syntax, PHPUnit (35/35) — **PASS**.
- Исправлены конфликт private `TestCase::be`, 401-vs-422 contract test, типы AES/receipt, вызовы `window` в тестовом Node и правила границ модулей. **Проверено по CI**, а не только из исходников.
- Поверх этого G0 добавлена отдельная ступень `browser` на Playwright Chromium. Первый [run #41120153684](https://github.com/1troitsky/photobunker-new/actions/runs/41120153684) выявил несовместимость locked Playwright 1.56.1 и выбранной GitHub Ubuntu 26.04; job закреплён на `ubuntu-24.04` в commit `e280d399`. Реальная browser E2E проверка **не стала автоматически VERIFIED**.
- **P0 STOP:** `recipient_thumbnail_reads_enabled=false`; полная фото-миграция PB1→PB2 и живые двухаккаунтные E2E не завершены. Build success означает только исходный G0, не готовность продукта.

## Точка истины

- [Точный файл владельца visual-ux.md (390 строк)](visual-ux-owner-2026-10-30.md) — зафиксирован напрямую из вложения; не подменять одноимённым PB1 файлом (277 строк, другая редакция).
- [01-FUNCTIONAL-INVENTORY.md](01-FUNCTIONAL-INVENTORY.md) — 101 требование, конкретные ссылки на PB1/PB2 и критерии проверки. [CSV](01-FUNCTIONAL-INVENTORY.csv) — таблица для фильтрации; исходные [data/part-*.json](data/) — для повторной генерации без ручных дописок.
- [02-RESTORATION-PLAN.md](02-RESTORATION-PLAN.md) — приоритетный путь от неисправной CI к проверяемому приложению.
- [03-SCENARIO-ACCEPTANCE.md](03-SCENARIO-ACCEPTANCE.md) — реальные пользовательские пути, позитивные/отказные сценарии и требуемые доказательства.
- [04-OWNER-DECISIONS.md](04-OWNER-DECISIONS.md) — несовпадения новой спецификации и принятых PB2 решений; не решать их автоматически.
- [05-GITHUB-ACTIONS-TRIAGE.md](05-GITHUB-ACTIONS-TRIAGE.md) — фактические данные о неуспешном CI и порядок расследования.

## Зафиксированные SHA / scope

| Срез | SHA | Что он доказывает |
| --- | --- | --- |
| PB1 main | `0c5062dde25fffbbb81447e42ace7fa6f412f8a1` | legacy исходники, не проходящие в PB2 runtime |
| PB2 main | `d2b9f58b507fa5cd32f8461d5248c871ad1a816e` | устаревший по отношению к Draft; не изменять |
| PB2 integration PR #42 | `13fdfbd7a74346a585a301f039259e4f56b348c8` | текущее сопоставляемое дерево, пока НЕ VERIFIED |
| Owner spec | приложенный `visual-ux.md` от 2026-10-30 | функциональные ожидания, не доказательства реализованности |

**Важно:** даже строка `PB2: C` в матрице — только наличие кода; FAIL CI и отсутствие E2E означают, что приёмки нет. Ничего не сливать по этой таблице.

## Правила продолжения

1. Перед любыми новыми реализациями получить свежие main и PR #42 SHA, реальный CI output и сверить нужную строку матрицы с PB1 файлами.
2. Поддерживать **один PB2 runtime**: PB1 Identity/Matrix, старые фото-ключи и DB не вставлять внутрь нового ядра. Legacy paths — справочные.
3. Реализовать **вертикальный пользовательский сценарий** целиком, затем проверить: экран → use case → local encrypted store/outbox → API auth/ACL → обновление UI → рестарт/ошибка. UI остаётся заменяемым.
4. Сохранность уникального локального ciphertext, TTL и полная авторизация — P0. Не включать отключённый recipient-read флаг до независимого adversarial review.
5. Обновлять CSV и markdown при появлении проверяемого результата: сохранить SHA, тест, реальное PASS/FAIL, owner UX acceptance, а не субъективный «готово 90%».
6. Сначала CI и один аккаунт; после — реальные два аккаунта, права и security gates. Codex делает независимую проверку/поправки, а не восстанавливает контекст из сотен коммитов.

## Доказательства из этой сессии

- Repo trees/конкретные файлы PB1 и PB2 просмотрены через GitHub. Точность ссылок на файлы проверена автоматически.
- **Изначально не запускались** ни кодовые, ни браузерные тесты; после завершения аудита воспроизводимый G0 CI прошёл. Реальные устройства, HTTPS backend, Garage/S3 и двухаккаунтное E2EE по-прежнему **NOT RUN**.
- CI run #40979416867: оба jobs FAILURE, но не выделен runner и нет шагов. См. 05. Исходные причины не определены.
