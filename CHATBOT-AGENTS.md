> **Приоритет решения владельца от 2026-10-30:** дальнейшее выполнение R2 Issues приостановлено. Единственная текущая работа — [Draft PR #41](https://github.com/1troitsky/photobunker-new/pull/41) `chatbot/assignment-release-legacy-kernel` с сохранёнными PR #36–40 и изолированным старым photo kernel. Старые инструкции об автоматическом продолжении каждого Issue НЕ применяются до нового решения. В этом PR разрешён отдельный legacy compatibility-каталог, НЕ смешанный с PB2 Identity/DB; правила E2EE/безопасности и запрет изменения `main` действуют.

# PhotoBunker New — ChatGPT: независимое выполнение Issues

**Решение владельца 2026-10-29:** действуют [Independent Development Pipeline & Replaceable UI](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md) и [COLLABORATION](COLLABORATION.md). **ChatGPT выполняет оставшиеся согласованные Roadmap Issues по порядку без ожидания Codex-review, merge в main или назначения следующей задачи Codex.** Codex позднее проверяет **всю цепочку** и интегрирует её. Это не делает ChatGPT руководителем Codex и не разрешает выпускать непроверенный код.

## Перед каждым Issue

1. Заново получить фактический GitHub **main SHA**, upstream branches/PRs/head SHA и весь Issue; прочитать [AGENTS](AGENTS.md), [COLLABORATION](COLLABORATION.md), [Roadmap](docs/08-ROADMAP.md), [14 Process](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md), релевантные normative/security contracts ([11 Identity](docs/11-IDENTITY-AND-KEYS.md), [12 Storage/Time](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md), [13 Baseline](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md)).
2. Сверить кодовые зависимости **в main И в незалитых PR**. Логическая зависимость необходима, предварительный merge — **не** необходим. Упорядочивать Issue топологически. Если Issue в Backlog/Blocked лишь из-за отсутствия review/merge, выполнять при наличии собственных требований и upstream кода; **не заявлять, что GitHub Project реально переведён в Ready**.
3. До написания кода **обязательно читать каждый точный legacy путь** раздела `Legacy evidence` в read-only `1troitsky/photobunker` через GitHub. Если раздел отсутствует — самостоятельно найти узко относящиеся к scope пути, **записать в существующую Issue** классификацию `REUSE / ADAPT / REFERENCE / REJECT`, поведение/тесты/дефекты, затем открыть их на GitHub. Не читать `_old` как право его менять; не переносить PB1/Workspace/Matrix/plaintext код.
4. Не придумывать открытые продуктовые решения. Владелец сохраняет право на правила продукта и выпуск. Технические решения принимаются в пределах нормативных контрактов. Если критический owner decision действительно отсутствует, явно запросить его, но продолжать доступные безопасные независимые задачи.

## Implementation Pipeline: один Draft PR на Issue

1. Создать `chatbot/r2-XX-<slug>` **от конкретного upstream SHA**, который уже содержит все нужные модули. По умолчанию — предыдущая незалитая Issue-ветка (integration spine). Проверить, что ветка ещё не существует. Никакого force push / reset опубликованных refs / main write.
2. Создать **один Draft PR** с `Closes #N`: **base = предыдущая ветка**, если upstream не в `main`; **base = main** только если все нужные зависимости уже интегрированы. Считать scope через `base...HEAD`, а не `main...HEAD` для stacked PR. Назначение PR — предоставить изменения для будущей проверки, не просить Codex merge прямо сейчас.
3. Сохранять feature границы: domain → application ports ← infrastructure; UI только public typed use-cases / view-state, без raw DB/HTTP/crypto, без персистентной бизнес-логики в компонентах. Одна стабильная команда use-case должна работать как с нынешним, так и с будущим UI. Внешний вид/навигацию менять без изменения security/TTL/Identity. Правила: [02](docs/02-ARCHITECTURE.md), [06](docs/06-UX-UI.md), [14](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md).
4. Реализовать только scope Issue; не копировать legacy монолит и не создавать параллельную очередь фото/заданий без контрактного основания. Написать проверяемые happy/failure/offline/reload/ACL/expiry сценарии; запускать доступные проверки сейчас. **Невыполненное всегда обозначать NOT RUN**. Нельзя назвать непроверенную функцию production-ready.
5. Перед PR прочитать **весь** `base...HEAD` diff, записать `main/base/head/merge-base`, upstream PR, API/DB/crypto/ACL/TTL impact, migrations/rollback, наследованные и новые риски, реальные команды и результаты, отдельный NOT RUN и список задач для общей финальной проверки.
6. **Не останавливаться из-за ожидания review Codex.** После одного Draft PR остановить *эту* Issue и продолжить следующую Issue по согласованному Roadmap, если владелец поручил продолжение. Находка дефекта в upstream: исправить в upstream PR и перенести fix в downstream **обычными merge-коммитами** без force-push, зафиксировать SHA ancestry/impact.
7. В конце Phase I передать Codex **всю** цепочку и план проверки/merge; **только Codex** исправляет/проверяет и интегрирует в main после требуемых тестов. Codex может вносить corrections в соответствующие PR; не создавать второй PR для той же Issue.

## Security invariants и красные линии

- Анонимный единственный PB2 recovery key, без email/password/reset; E2EE, per-asset DEK, immutable encrypted local commit до sync; нет Photos/DCIM, raw sensitive logs, plaintext persistence.
- R2-04 Dexie/OPFS/fallback/time authority, R2-05 Garage ciphertext sync/outbox, TTL 24h–45d с server fail-closed expiry, проверка ACL/грантов на обоих концах.
- Mode 1 disabled, Mode 2 compressed original preserved, Mode 3 replace master default; ≤1 encrypted WebP thumbnail ≤320px; no Matrix/RTC/Messenger.
- No unsafe destructive PIN, unbounded Orphans, expired data resurrection, accidental deletion of only unsynced copy.
- Критический security/storage STOP документировать и безопасно исправлять; он не блокирует незатронутые Issues, но **блокирует Verified/Integrated/Accepted/Released** до устранения.
- Все основные экраны production-minded mobile/desktop, RU/EN, accessible, native-feeling PWA, stable design tokens и replaceable presentation; никогда не выдавать фикстуры за реальные backend действия.

## Формат PR и завершение

`Closes #N`; Issue/Scope/Legacy evidence; `main SHA`, `base branch + SHA`, `merge-base`, `head SHA`, upstream PRs; пользовательский результат; файлы; контракты и security/storage/TTL/ACL; реально выполненные проверки, **NOT RUN**, recovery/rollback и риски. Заключение: **«Implemented — Draft PR для финального review Codex; не Verified/Integrated».** Владелец принимает UX и итоговый релиз после фактических проверок.
