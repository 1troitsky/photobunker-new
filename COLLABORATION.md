# PhotoBunker New — Independent Implementation & Final Integration

**Владелец утвердил новую схему 2026-10-29.** Полная процедура, наследование PR и UI contract: [14 — Independent Development Pipeline & Replaceable UI](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md). Roadmap [08](docs/08-ROADMAP.md) остаётся единственным списком Issues; правила продукта/безопасности остаются в [13](docs/13-PRODUCT-ACCEPTANCE-BASELINE.md), [03](docs/03-PHOTO-STORAGE.md), [11](docs/11-IDENTITY-AND-KEYS.md), [12](docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md).

## 1. Роли без взаимных блокировок

| Участник | Phase I — Implementation | Phase II — Integration & Assurance |
| --- | --- | --- |
| **Владелец** | Утверждает архитектурные/продуктовые инварианты, порядок и исключения; принимает решения OPEN | Принимает UX, реальные устройства и выпуск |
| **ChatGPT** | **Самостоятельно** готовит `Legacy evidence`, выполняет все согласованные Issues по зависимостям и создаёт по одному Draft PR; проверки при доступности, честный NOT RUN; **не меняет main** | Передаёт стек с SHAs/diff/контрактами/тестами; при адресном запросе помогает исправлениями |
| **Codex** | Не требуется для назначения следующей Issue или merge её зависимостей; может консультировать и готовить тестовую инфраструктуру параллельно | Самостоятельно тестирует **всю** реализацию, дорабатывает существующие PR, интегрирует по dependency order в `main`, собирает production HTTPS staging и полный release-gate |

Ни один AI не имеет власти менять решения владельца. Codex не «подчиняется» ChatGPT. Независимость разработки — не освобождение от проверки.

## 2. Последовательность

**Старт:** этот governance PR Codex проверяет и сливает в `main` по прямому указанию владельца. Это исключение для вступления процесса в силу; функциональные Draft PR остаются открыты до окончания Phase I.

**Phase I:**
1. ChatGPT сверяет свежий `main` и реальный upstream head, зависимости Issues и нормативные контракты; готовит `Implementation Ready` самостоятельно. Project `Backlog/Blocked` не блокирует разработку лишь по причине ожидания Codex, но существенное owner OPEN решение не выдумывается.
2. До написания кода читает все точные пути Legacy evidence в `1troitsky/photobunker` GitHub read-only. Если evidence отсутствует, составляет и записывает узкий список в ту же Issue. Старый проект/`_old` не изменять.
3. Создаёт branch от фактического head уже реализованных upstream модулей. При незалитых dependencies — **stacked Draft PR** с `base=upstream branch`, иначе `base=main`. **Один PR/Issue; `Closes #N`**. Нельзя менять `main`, force-push, merge/auto-merge без отдельного разрешения.
4. После локальных/доступных проверок и полного `base...HEAD` diff передаёт ссылку/результат и **продолжает следующую Issue без ожидания Codex**. Каждый PR остаётся `Implemented (Draft), NOT VERIFIED`, пока не доказано обратное.
5. Изменения upstream доносятся обычными merge-коммитами в downstream; ancestry и влияние фиксируются. Не параллелить конфликтующие источники истины и не дублировать функцию в другом Issue.

**Phase II:** по завершении всех Implementation Issues Codex получает граф PR, запускает реальный build/lint/typecheck/backend/crypto/ACL/offline/expiry/fault/mobile E2E, исправляет проблемы в исходных PR и объединяет **снизу вверх**. После каждого merge retarget dependent PR и повторный diff/CI. Финальная полная регрессия объединённого `main`, safety/backup/restore/rollback proof, владелец проверяет устройства. Codex не объявляет Accepted автоматически.

## 3. GitHub Project и состояния

Project: [PhotoBunker New — Development](https://github.com/users/1troitsky/projects/14). Обычные статусы: `Backlog / Ready / In Progress / Review / Integrated / Accepted / Blocked / Cancelled`. **Отдельные факты**, не подменяющие статусы Project:

- **Implementation Ready:** нормативные требования определены, upstream код доступен **хотя бы в открытых ветках**, нет блокирующего продуктового OPEN решения.
- **Implemented (Draft):** собственный scope закоммичен, один Draft PR/Issue и проверяемые сценарии. Тесты могут быть `NOT RUN`.
- **Verified:** Codex предоставил фактические команды, PASS, evidence и исправления для всех критических проверок.
- **Integrated:** проверенный код реально merged в `main`.
- **Accepted:** владелец прошёл согласованные UX/device scenarios.
- **Released:** полный security, backup/recovery/rollback и deployment gate.

Отсутствие Codex review, merge или владельческого UX-preview **не является причиной остановить Phase I implementation**; эти проверки остаются необходимы **для Phase II/Accepted/Released**. Critical security defect может ограничить affected task, но разрешённые независимые задачи продолжаются. Не менять статусы GitHub Project без подтверждённой операции.

## 4. Правила качества и UI

Обязательные `domain/application/infrastructure/ui` границы из [02](docs/02-ARCHITECTURE.md) усилены [14](docs/14-INDEPENDENT-DEVELOPMENT-PIPELINE.md): UI — заменяемая оболочка без бизнес-логики, SDK/DB/HTTP/crypto, typed public feature API, use-cases управляют локальным состоянием/optimistic/retry, а server остаётся источником ACL/TTL. Токены и небольшая общая библиотека primitives, mobile/desktop могут иметь разные композиции без дублирования функций. Редизайн не требует переписывать существующие domain/storage/crypto modules.

Реально выполнить максимально доступные проверки сразу; `NOT RUN` честно перечислить и перенести в Phase II. Security STOP: plaintext/EXIF/key leak, system gallery writes, fail-open ACL/TTL, утрата unsynced photo, ложный ACK, безвозвратная несанкционированная очистка и неудаляемые orphan assets. Нельзя обходить эти инварианты, чтобы считать Issue «готовой».

## 5. Передача стека в конце Phase I

Для каждого PR: Issue, branch, base SHA/head SHA/merge-base, upstream PR, краткий scope/diff, legacy evidence, миграции, security/ACL/TTL/keys impact, rollback, actual PASS/FAIL/NOT RUN, device/scenario gates. Codex проверяет и объединяет эту цепочку; ChatGPT никогда самостоятельно не сливает `main` и не выдаёт «production-ready» без независимых доказательств.
