# 09. Development & operations contracts

**Статус:** проектные требования; выбор провайдера S3, домена, платёжного тарифного плана и окружения пока OPEN.

## 1. Предлагаемая инфраструктура

- Laravel 13 + PostgreSQL и очереди, хранение metadata/policy/access/revisions и серверных sync receipts.
- S3-compatible private object storage (self-hosted Garage или managed provider — **не утверждено**); encrypted photo assets only.
- PWA/web frontend с IndexedDB/OPFS (конкретный storage adapter определить до реализации); build output служит как production artifacts за Nginx/HTTPS, **никогда не dev server для release**.
- CI изолированным test stack, не подключается к реальным пользовательским данным, не имеет production secrets.
- Структурированные логи с correlation/operation ids без photo bytes, GPS, descriptions, keys/PIN и credentials.

## 2. Среды и конфигурация

`local / test / staging / production` с явным разделением DB, S3 buckets, ключей и доменов. Первичный `setup` idempotent; на каждой среде документированы команды build/migrate/seed-test/smoke/backup/restore/cleanup/downgrade. Secret material только env/secret manager и rotation, никогда Git.

Проверка конфигурации fail-closed; no unsecured plain-prototype production flag, no auto-merge bypass. Новые migrations — backward compatible и transactional где возможно, с backup и rehearsal, не destructive-only.

## 3. Asset inventory и storage budget

S3 object и локальный asset всегда имеют photoId, owner, purpose, revision, digest/length, TTL, job state. Уменьшать число долгоживущих копий. Managed cleanup jobs идемпотентны, наблюдаемы по количеству orphan objects, failed deletes, bytes pending, queue lag; все metrics privacy-preserving.

Storage quota: на устройстве и сервере separately; before compression/upload reserve/check available budget; report full/low-storage without losing old correct asset. Never delete sole unsynced photo automatically. Local-cache eviction for confirmed synchronized assets **только после утверждения ST-04/ST-09** и принятого key/device restore pathway.

S3 backups/replication/legal deletion semantics — отдельное решение. Сами объекты на одном серверном диске **не** backup; claims of physical secure deletion must be qualified.

## 4. Delivery and rollback

Build one immutable production artifact, run dedicated production E2E, use staging with real API/storage protocol, upgrade via versioned migration, run smoke, observe failure metrics, rollback app/DB if safe. If schema no longer backward compatible, disable release until migration protocol tested. No hotfix direct main without explicit owner's override and evidence.

## 5. Operations runbooks (to author when implementation exists)

- Camera permission denied / camera hardware busy / no key.
- Browser storage unavailable or evicted / quota reached / retry encryption.
- S3 outage/503/timeout/lost ACK; queue repair/reconciliation/duplication.
- Partial file replacement and TTL sweep; stuck orphan deletion.
- Revoke, assignment change, access expiry; stale device/cache.
- App lock vs local delete vs emergency, especially offline/partial wipe.
- Device lost/new device restoration and key recovery.
- Disaster recovery and backups proving restored encrypted objects are *decryptable by authorized user*.

Acceptance records include real-device PWA behavior; no assumption that browser storage survives OS eviction.
