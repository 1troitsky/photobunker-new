# План восстановления PB2, основанный на сценариях

**Цель:** не ещё один rewrite, а перенос прежнего результата PB1 на единый PB2 runtime. Главный критерий — выполняемый пользовательский сценарий из [документа владельца](visual-ux-owner-2026-10-30.md), а не число классов/PR. Данный план **не** отменяет [PB2 product baseline](../13-PRODUCT-ACCEPTANCE-BASELINE.md), [storage](../03-PHOTO-STORAGE.md), [security](../05-SECURITY.md) или [roadmap](../08-ROADMAP.md). Расхождения только через решение владельца.

**Статус gate G0:** подтверждён SUCCESS [#41124216234](https://github.com/1troitsky/photobunker-new/actions/runs/41124216234) на `9a596b15f1f492a980af849e1f727ee9840b928f`; это **не** приёмка полноценной камеры или межаккаунтных фото. Следующий gate G1 требует отдельного реального HTTPS backend+PostgreSQL+Garage — [условия](06-G1-STAGING-READINESS.md).

## Нулевая граница: только один runtime

- **Runtime:** **PB2 Vue 3 + Vue Router + TypeScript + Laravel API**, единая PB2 key-only Identity и scoped encrypted vault. Сохранённый каталог compat/ — read-only evidence, не компонент runtime и не отдельный origin.
- **No silent migration:** PB1 keys/database/Matrix encryption не совместимы автоматически. Любая переносимость исторических данных — отдельная миграция с доказательствами.
- **Production:** local-first, optimistic, no plaintext persistent media, crash-safe retry, TTL, E2EE grants and revocation проверяются на сквозном пути.
- **UI boundaries:** экран зависит от публичного application use-case, не от legacy store или SDK. Повторное изменение дизайна не затрагивает фото-протокол.

## Порядок работ и критерии перехода

| Gate | Что сделать на одном PB2 runtime | Функции/строки матрицы | Готово, когда... |
| --- | --- | --- | --- |
| **G0 — CI и baseline** | Получить первичную GitHub Actions ошибку до запуска runner; воспроизвести locked install, types, lint, PHP тесты; зафиксировать lockfiles, production build | X05, SH04, все строки в части CI | jobs получают runner, фактические steps доступны, обязательные checks PASS; без изменения runtime contract |
| **G1 — одна личная фотография** | Регистрация/вход/восстановление → Camera → encrypted local save → Photos/Browser → Card → mode2/3 edit → offline/reload → S3 ACK и TTL | WE01/03, CA01/10/11/14, BR06/09/10/17, X03/04 | Один реальный аккаунт проходит happy+fault paths на mobile и desktop, ни одного потерянного уникального ciphertext |
| **G2 — полные задания/пресеты** | Восстановить PB1 fields с validation/версией: даты, required count/progress, camera instructions, пресеты, ratio/resolution, tags/description policy, archive, NAME-ID | AS02–AS22, CA02–CA08, CA12/13 | Создать задачу с правилами, выбрать в камере, снять, видеть проверенный прогресс; каждая политика серверно контролируется |
| **G3 — две учётные записи и grants** | Team/contact invite → assignment participation → owner/curator privileges → signed key delivery → recipient thumbnail only, grant revoke/expiry, role changes | AS07/12/13/19/20, BR05, PR22, X02 | 2 реальных аккаунта + 2 браузера, положительные и отрицательные ACL тесты; только после security review разрешить чтение |
| **G4 — Browser и Photo Card** | Shared protected multi-assignment collections, tags, folder tiles/tree, author/GPS metadata views, owner + recipient export, separate safe/original/download card scopes and TTL share | BR01–BR21 | Every list/read/export checks current ACL; forbidden original/metadata and revoked accesses cannot leak |
| **G5 — security / lifecycle** | Отдельные App PIN, local-delete PIN, emergency PIN; device/account erase, backup preflight, trusted recovery and data UI | PR09–PR19, X03/X04 | Threat model tests, offline intent replay, no false deletion completion, iOS/Android tested |
| **G6 — polish / settings** | UI dock/header, launch section, profile settings, localization, Photo Browser preferences | SH01–SH07, PR02–PR08, PR21 | Owner visually accepts replacement UI on phone + desktop, accessibility/localization regressions absent |
| **G7 — billing/future options** | Утвердить самостоятельные тарифы/квоты и storage TTL boundary. Messenger/Matrix — отдельный app после явного решения | BI01–BI05, X01 | Owner decision + isolated module; не блокирует G1–G5 |

## Приоритетные незавершённые вертикальные потоки

1. **V1 Local owner (P0):** Account -> Camera -> encrypted IDB/OPFS -> Gallery -> Editor -> offline reload -> sync -> delete/TTL. В нынешнем Draft #42 код отдельных модулей есть, **нет подтверждённого end-to-end**.
2. **V2 Assignment capture (P0):** Assignment (full fields) -> role/status -> preset and required GPS/tags -> camera policy snapshot -> photo review -> verified progress. Сейчас модель `AssignmentFields` содержит лишь title/instructions/mode/retentionDays.
3. **V3 Cross-account (P0):** Contact/Team -> invitation -> grant acceptance -> signed recipient DEK envelope -> authorized thumbnail -> revoke. Сейчас recipient read flag=false, и отключение необходимо сохранять до assurance.
4. **V4 Photo dissemination (P0):** Card-only content, privacy-mask, external share scopes; protected multi-assignment Browser, downloadable limited rendition. PB1 реализация есть, PB2 private card/owner ZIP — частичные.
5. **V5 Safety (P0):** App lock -> local delete -> emergency -> restore/recovery; shared identity, offline crash handling. PB1 UI/logic есть, PB2 отсутствует.

## Как выполнять один следующий slice

- Найти строки ID в [матрице](01-FUNCTIONAL-INVENTORY.md). Прочесть все прямые ссылки на PB1/PB2 исходники, нормативные Docs, UI и API.
- Классификация: **REUSE** только чистые алгоритмы без старых зависимостей; **ADAPT** domain/use cases; **REFERENCE** UI/тест-векторы; **REJECT** PB1 Identity, Matrix bootstrap, old DB and broad stores.
- Сделать минимум обратимо, с отдельным typed use-case, no overengineering, no giant PR new copy.
- Тестировать позитивный и adversarial пути до следующего slice. Зафиксировать SHA, logs, fixtures; не маркировать Verified без проверки.
- При красном CI отмечать точную ошибку и STOP. Docs-only PR не интегрировать в main прежде base PR #42.

## Зависимости и запреты

- G0 предшествует любым «PASS». Работа над документацией, чистыми unit/domain контрактами и независимыми безопасными модулями возможна параллельно, но **не увеличивать неподтверждённый release surface**.
- G3 и G4 зависят от реальные двух аккаунтов, подписи pinned root, server ACL, revoke, TTL; никакого оптимистического «сервер подтвердил» до фактического ACK.
- G5 — destructive surface: отдельный threat review, никогда без preflight. Нельзя автоматически копировать PB1 emergency шифрование.
- G7 требует решения по конфликтам визуальной спецификации и новых storage/Identity обязательств; не менять 24h–45d и 320px в обход владельца.
- Итог: один непрерывный PB2, **никаких внешних compatibility-origin redirects**, `main` не менять, не merge/force-push.
