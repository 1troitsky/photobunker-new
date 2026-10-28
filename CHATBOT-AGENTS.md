# PhotoBunker New — правила ChatGPT как исполнителя Issue

**Основание распределения ролей:** ChatGPT выполняет основную массу реализации из-за доступного объёма лимитов. Это **не означает технического старшинства или полномочий командовать Codex**. **Codex** обладает доступом к рабочему окружению, подготавливает зависимости, GitHub Project и средства тестирования, **сам выдаёт ChatGPT задания**, затем независимо проверяет, запускает тесты и **вправе самостоятельно исправлять и дорабатывать созданную реализацию**. Владелец определяет требования и принимает приложение.

Обязательно прочитать [AGENTS](AGENTS.md), [COLLABORATION](COLLABORATION.md), [Roadmap](docs/08-ROADMAP.md), релевантные контрактные документы и **полный** текст назначенной Codex Ready Issue. Не угадывать OPEN product decisions.

## Цикл исполнителя

1. Получить из GitHub актуальный `main` и указанную Codex Issue; проверить scope и новые нормативные документы [Identity](docs/11-IDENTITY-AND-KEYS.md), [Storage/Time](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md), [Product Baseline](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md). Legacy audit/checklist читать **только для явно связанного reuse или расследования**, не как автоматическое расширение задачи.
2. Реализовать scope в отдельной `chatbot/<task-id>-<slug>` ветке и открыть **один Draft PR** в `main`, `Closes #N`; не выполнять merge/auto-merge, не менять `main`. Не трогать старый репозиторий.
3. Сделать необходимые проверки **по доступным инструментам**, честно отметить `NOT RUN`. Тесты могут быть включены в Issue, но **полный тестовый цикл/окружение и доработка проверочного кода — зона Codex**; ChatGPT не тратит работу на повторение того, что Codex быстрее проверит локально.
4. До передачи перечитать весь итоговый diff `main...HEAD`, записать изменённые контракты, storage/TTL/ACL последствия, производственные риски и возможные ручные сценарии.
5. Передать PR **Codex**. Codex независимо проверяет, устанавливает/обновляет зависимости, пишет/прогоняет тесты и **сам дорабатывает тот же PR**, когда это нужно. Если Codex направит отдельные конкретные исправления ChatGPT — выполнить их в установленном scope. Не создавать второй PR для замечаний и не спорить о том, кто «обязан» исправлять.
6. Не начинать следующую Issue самостоятельно, дождаться назначения от Codex. Продуктовые вопросы — владельцу, техническую подготовку/эксплуатацию/доступы — Codex.

## Безопасность и архитектура

- Новый модульный клиент, а не полное копирование legacy; Matrix/RTC/чаты не нужны.
- Production-first/UI-first/local-first. **R2-01 без Garage/PostgreSQL интеграции**, R2-02 production UI review; **R2-03 включает Create account/Sign in/Recover и trusted-device recovery**, R2-04 Dexie/OPFS encrypted storage, затем camera и отдельно Garage/S3. Реальное шифрование фото/metadata до persistence, никаких Photos/DCIM.
- Режимы original 1 (disabled), 2 (compressed source preserved), 3 (compressed master replacement, default).
- Одна зашифрованная WebP thumbnail до 320px, нет отдельного постоянного preview, Garage как первый S3-compatible backend.
- Каждая фотография живёт **24ч–45д** по заданию, expiry при capture; все assets/metadata удаляются через scheduler/queue и local cleanup. **Server UTC authoritative; client time proof и rollback detection** из [12](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md).
- Отдельная область прав на Photo/Card/Browser/Note; fail-closed ACL/TTL, bounded retries без воскрешения удалённого, раздельные App/Local Delete/Emergency PIN.
- Весь новый UI production-grade mobile/desktop, RU/EN. Не выдавать фиктивные успешные операции, E2EE или тесты за доказанные.

## Формат Draft PR

`Closes #N`, задача/phase, base/head SHA, пользовательский результат, конкретные файлы, storage/data/API/ACL/TTL/crypto impact, запущенные проверки, `NOT RUN`, ограничение, rollback/recovery и инструкция Codex для воспроизведения. Итог **«Передано Codex на техническую проверку»**, не «готово/релиз».
