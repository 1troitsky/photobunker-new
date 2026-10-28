# 09. Development & operations contracts

**Статус:** согласованные storage lifecycle invariants. **Начальный S3 backend — Garage** (S3-compatible adapter), фото живёт **24ч–45д**, миниатюра WebP ≤320px, отдельного постоянного preview нет. Домены/тарифы/развёртывание — инженерные детали Codex.

## 1. Предлагаемая инфраструктура

- Laravel 13 + PostgreSQL и очереди, хранение metadata/policy/access/revisions и серверных sync receipts.
- S3-compatible private object storage: **Garage — первоначальный backend** через заменяемый S3 adapter; **только encrypted** photo/thumbnail/derivative objects. Подмена внешним S3 не меняет domain API.
- PWA/web frontend с IndexedDB/OPFS (конкретный storage adapter определить до реализации); build output служит как production artifacts за Nginx/HTTPS, **никогда не dev server для release**.
- CI изолированным test stack, не подключается к реальным пользовательским данным, не имеет production secrets.
- Структурированные логи с correlation/operation ids без photo bytes, GPS, descriptions, keys/PIN и credentials.

## 2. Среды и конфигурация

`local / test / staging / production` с явным разделением DB, S3 buckets, ключей и доменов. Первичный `setup` idempotent; на каждой среде документированы команды build/migrate/seed-test/smoke/backup/restore/cleanup/downgrade. Secret material только env/secret manager и rotation, никогда Git.

Проверка конфигурации fail-closed; no unsecured plain-prototype production flag, no auto-merge bypass. Новые migrations — backward compatible и transactional где возможно, с backup и rehearsal, не destructive-only.

## 3. Asset inventory и storage budget

S3 object и локальный asset всегда имеют photoId, owner, purpose, revision, digest/length, `expires_at`, job state. **TTL задаётся заданием в пределах 24 часов — 45 дней и фиксируется для фото при capture**, не продлевается редакторским сохранением. Если снимок без задания — рабочее техническое значение 45 дней; отсчёт от capture time. Оригинал, master, отдельная edited copy, единственная WebP thumbnail ≤320px, shares, exports, metadata/Photo DB rows, caches и временные assets удаляются по expiry. Нет постоянного отдельного preview. Metrics privacy-preserving.

Storage quota: на устройстве и сервере отдельно; резервировать/check budget перед тяжёлой обработкой, не терять действующий неистёкший asset. Не удалять единственное **неистёкшее** несинхронизированное фото из-за нехватки места; **истёкшее** удаляется независимо от upload status. Досрочное eviction локальных ещё действительных synced copies — после утверждённого recovery contract ST-04; TTL ST-09 уже утверждён.

S3 versioning, object-lock, replication и backups **не должны незаметно продлевать доступный период хранения**. Codex проверяет настройки Garage, жизненный цикл snapshots/backup и документирует физические гарантии; объект в одном серверном volume не является backup. Не обещать физический secure erase в точную секунду, если провайдер/диск/офлайн-устройство этого не гарантирует.


## 3.1. Недорогое автоматическое удаление без полного сканирования

1. В PostgreSQL индексировать `photos(expires_at, id)` для активных снимков (вариант partial-index по статусу на усмотрение Codex). Не запускать отдельный таймер на каждый файл.
2. **Один системный cron / Laravel Scheduler с периодом 1 минута** запускает лёгкий query по `expires_at <= now()`, **limit/batch + стабильная пагинация**; большая нагрузка обрабатывается queue workers с ограниченной конкуренцией. Не сканировать всю таблицу и не делать дешифрование при sweep.
3. Истёкшая фотография **сразу перестаёт читаться** через серверную ACL/TTL, Card/Browser/download/Share. Идемпотентный delete job удаляет объекты Garage (включая thumb, original, edit, share, temporary), фиксирует подтверждения, удаляет связанные Photo/Metadata/Note/Card/индексы в БД и очищает технический tombstone после завершения безопасного retry window.
4. Worker ретраит 5xx/timeout/backoff и проводит reconciliation для orphan objects и jobs. Поздний upload/retry не может восстановить expired фото. Нет бессрочных orphan objects или приватных metadata в tombstones.
5. На клиенте expiry проверяется при каждом чтении, запуске/возобновлении, в ограниченном maintenance cycle: скрыть photo и очистить локальные ciphertext, metadata, thumbnail cache. **Закрытая offline PWA не может гарантированно исполнить фоновый cron**, поэтому cleanup выполнится при следующей активности. Принудительная серверная очистка не означает физического стирания у отключённого пользователя.
6. Codex тестирует 24h, 45d, boundary timestamps, редактирование перед expiry, lost ACK, S3 outage, expired unsynced photo, скачивание по старой signed link, повторный запуск и отсутствие оставшихся blobs/DB records. Наблюдать `expired_pending_deletion`, delete retry age, orphan bytes и lag, **не логировать чувствительные metadata**.

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
