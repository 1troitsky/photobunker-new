# 04. Domain model, данные и API-контракты

**Статус:** обязательные границы и согласованные инварианты + отдельные OPEN технические решения. Не утверждённые поля ниже — **предлагаемые** контракты, а не готовая схема БД.

## 1. Разные сущности, разные права

| Сущность | Принцип |
| --- | --- |
| User / Account / Profile / Device / Session | **Стабильный user_id** — центральная identity, но не монолит. Публичный Profile, отдельные sessions/first trusted device/recovery и scopes. Ни User, ни Account не хранят фото, подписки или сообщения внутри одной гигантской модели. [11](11-IDENTITY-AND-KEYS.md). |
| Team / Participant / Invitation | Команда — устойчивый набор участников и ролей; приглашение не даёт прав до принятия. Связь с заданием не равна праву на все снимки команды. |
| Assignment | Отдельная задача со статусом, участниками/ролями, условиями, retention capture policy и ревизией. |
| Photo | Канонический identity (UUID), свой assignmentId (nullable), снимок capture policy, lifecycle, связи с assets/metadata. |
| PhotoMetadata | Отдельная запись с авторизацией по полям; не файл изображения, не публичная карточка, не Note. |
| PhotoAsset | Зашифрованный физический объект c владельцем, purpose, revision, bytes/hash, storage tier и lifecycle. |
| PhotoCard | Отдельный набор разрешённых metadata/visibility + защищённая страница/ссылка; сам по себе не является правом читать image/original/download. |
| PhotoBrowser | Перечень разрешённых заданий, не коллекция скопированных файлов и не bearer grant. |
| PhotoNote / AssignmentNote | Самостоятельные приватные записи, не поле описания Card и не чат. |
| PinVerifier / DeletionIntent | Отдельные security state machines, не photo encryption key. |

## 2. Неизменяемые свойства Photo

- UUID фото создаётся один раз локально, сохраняется после sync; публичный NAME-ID (формат из checklist §2: четыре A–Z + четыре цифры) **не** primary key. Алгоритм офлайн-выдачи коллизий и истощения диапазона — отдельный контракт и тесты.
- Snapshot `capturePolicy`: `mode: "camera-source" | "compressed-preserve-source" | "compressed-replace"`; режим `camera-source` **UI disabled** в первой версии, API не должен допускать неавторизованного обхода. Third = default и без assignment.
- При capture метаданные логически создаются вместе с фото; возможные поля `capturedAt`, source, GPS status/accuracy, author, photo name, assignment snapshot, capture context, user annotations. **Схема и privacy scopes ещё OPEN**.
- Инварианты: mode 2 — compressed source + current edit только после фактической правки; mode 3 — один долгоживущий master; mode 1 — исходные camera bytes без дополнительного re-encode, UI disabled; старую версию mode 3 удалять только после safe replace.
- Режим существующего фото не меняется ретроспективно при изменении задания. Assignment policy включает revision.
- Обязательны timestamps/lifecycle: `localCommitted`, `syncPending`, `syncConfirmed`, `superseded`, `revoked`, `expired`, `deletePending`, `deletedVerified` — **предлагаемые** domain states, уточнить модель, не смешивать разных источников истины.

## 3. Сохранение/синхронизация через ports

`CaptureService` зависит от `CameraPort`, `CapturePolicyPort`, `PhotoCommitPort` и `PhotoMetadataPort`; не знает Laravel/S3/IndexedDB.

`PhotoCommitPort.commit`: шифрует фото/чувствительные metadata до постоянной записи, фиксирует запись/байты/outbox crash-recoverable; подтверждает **local committed**, не S3. БД и файлы разных API — journal/reconciliation вместо ложного обещания единой транзакции.

`PhotoSyncPort`: stable operation UUID/idempotency key, digests, storage quota/TTL, CAS/etag/revision, revalidation of assignment ACL. Upload only ciphertext via constrained server-authorized scope. Retry/reconnect retains same operation ID and never resurrects tombstones.

`PhotoEditPort`: editor выдаёт новый encrypted candidate, storage owner заменяет/создаёт asset согласно mode; no cross-module direct write.

`PhotoReadPort`: access-check read-model; отдельно permissions `readCard/readThumbnail/readImage/readOriginal/download/readMetadata/edit/shareExternal/delete`. У PhotoBrowser и Card нет обхода этих прав.

## 4. API boundary

**Предлагается:** Laravel 13 -> typed REST JSON / binary streaming, schema validation both sides, account/device proof + replay resistance, server-owned ACL/TTL, envelope encrypted photo bytes/metadata. Никаких прямых браузерных S3 credentials и публичных unscoped URLs.

Нельзя автоматически переносить старые controllers/DB migrations: исходные contracts:
- [workspace API](https://github.com/1troitsky/photobunker/blob/main/contracts/account-workspace-api.md)
- [identity API](https://github.com/1troitsky/photobunker/blob/main/contracts/identity-api.md)
- [photo E2EE ADR](https://github.com/1troitsky/photobunker/blob/main/docs/adr/0009-photo-e2ee-and-strong-unlock.md)
- [editor/shares ADR](https://github.com/1troitsky/photobunker/blob/main/docs/adr/0011-encrypted-versions-and-private-links.md)

**Reuse gate:** audit old format and threat model; record kept/rejected; compare against *three new storage modes*. Migrations and compatibility require explicit decision; no silent destruction or API reuse without contract tests.

## 5. Assignment statuses and rules

Checklist §8: Waiting → In progress → Submitted → Needs changes → Completed, with **explicit allowed transitions**, server-validated actor role, history and CAS/conflict. Photo review state is **separate**, not assignment state.

Assignment required capture parameters are versioned and frozen at capture; roles for owner/curator/contributor/viewer must map to capability matrix, not ad hoc UI checks. Accepted participation not equivalent to all-photo rights. Assignment deletion/revoke never silently reassigns assets or exceeds photo TTL.

## 6. Public NAME-ID / metadata / location

- NAME-ID `ABCD0001` default display name; user title can change without changing identifier. Offline collisions reconciled without duplicating photo or invalidating published public link. Sequence exhaustion explicitly handled.
- GPS: permission and accuracy/time, last-known only if privacy settings allow; camera does not wait on permission/network. Late GPS correction bounded by policy and privilege. Map provider receives exact coordinates **only upon explicit opt-in**.
- Separate PhotoMetadata record includes encrypted sensitive fields and minimal server-accessible envelope fields needed for ACL/TTL/quota; explicit contract and tests for each exposed field.

## 7. OPEN decisions before contract freeze

- exact compression profiles/format and browser support (ST-08), **не путать с уже выбранным WebP ≤320px для thumbnail**;
- **Thumbnail уже определён:** один encrypted WebP ≤320px, S3 + bounded encrypted local cache, без постоянного preview. Детальная capability matrix thumbnail-only permission — в составе ACL review;
- **Identity/recovery специфицированы** в [11](11-IDENTITY-AND-KEYS.md): anonymous key-only Account, signed challenges, first device, one Recovery Key, pairing, per-asset DEKs и partial bootstrap; Codex crypto review обязателен до R2-03;
- **S3/TTL уже выбраны:** Garage через адаптер, фото 24ч–45д по заданию с expiry и полным cleanup. OPEN только числовые бюджеты инфраструктуры, recovery/backup и provider deployment;
- whether version history beyond one current edit exists (ST-07);
- share export semantics/recipients (ST-10); **любой share/derivative истекает не позже фото и подлежит физическому cleanup**;
- data migration from old Photobunker (ST-11).

**Не реализовать чужую догадку об этих решениях под видом задачи из backlog.** Новые данные ссылаются на стабильный User ID через Identity capability ports; будущий Billing (owner User/Team) и Messenger — отдельные необязательные модули, не хранить их как поля Photo/User core. Browser storage и trusted time baseline — [12](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md). Полный самостоятельный acceptance — [13](13-PRODUCT-ACCEPTANCE-BASELINE.md).
