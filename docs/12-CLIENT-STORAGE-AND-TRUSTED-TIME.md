# 12. Browser storage, encrypted persistence и доверенное время

**Статус: технический baseline для R2-04/R2-06/R2-05 (28.10.2026).** Содержит принятое разделение ответственности; конкретные версии SDK и браузерные багфиксы подбирает и проверяет Codex. Не является утверждением о полной совместимости без hardware testing.

## 1. Единая схема хранения и fallback

| Область | Основное хранилище | Что там лежит |
| --- | --- | --- |
| IndexedDB через **Dexie** | Metadata/indexes | Photo/Assignment records (минимальный indexable header), **зашифрованные sensitive metadata**, journal, outbox, idempotency keys, scope, `expires_at`, sync/deletion states |
| **OPFS** (если доступен) | Большие assets | **Только encrypted bytes** original/master/edited rendition и зашифрованной thumbnail, пути owner/photoId/assetId |
| **IndexedDB Blob fallback** | Если OPFS нет/ломается/недоступен | **Только encrypted Blob** с теми же интерфейсами, lifecycle и quota checks, а не экспорт в user-visible filesystem |
| **Pinia** | Только оперативный UI | Route/page state, selection/progress, loading flags; не source-of-truth Photo, metadata, keys, expiry или outbox |
| Memory/WebCrypto | Транзит | Камера, дешифрование для просмотра/редактирования, защищённые CryptoKey handles; никаких plaintext disk/cache/temp |

**Data store interfaces:** `PhotoRepository`, `EncryptedBlobStore`, `PhotoSyncOutbox`, `TimeAuthority`; UI зависит только от application API. Backend Laravel/PostgreSQL хранит серверные minimal ACL/expiry/index fields и разрешённые encrypted metadata, Garage — ciphertext assets. S3/SQL не управляют локальной навигацией.

**Неодинаковые хранилища не дают общую ACID-транзакцию**: схема staging encrypted blobs → verify encrypted content/length/integrity → IndexedDB journal/atomic manifest pointer/outbox → compensating cleanup/reconcile. Для mode 3 заменяем master новой зашифрованной записью, только потом отмечаем старый asset для удаления. Для photos expired нужен idempotent delete marker, который старый pending upload не воскресит.

**IndexedDB searchable headers:** `accountId`, `photoId`, `expiresAt`, `state`, `assetId` допустимы при threat review как технические поля индексов, приватные GPS/notes/EXIF/user description — encrypted. Нельзя выдать эти данные в открытый remote/analytics/logging канал без отдельной модели прав.

## 2. Safari/iOS и устойчивость к вытеснению

До R2-04 — **настоящая capability probe** на iOS Safari/PWA + Chrome Android/desktop:
- `window.isSecureContext`, `indexedDB` open+transaction+read-back, `navigator.storage.getDirectory()` OPFS **write/read/delete test** (не только проверка наличия метода), blob fallback, multi-tab/concurrent open;
- `navigator.storage.estimate()`, `navigator.storage.persisted()`, **`navigator.storage.persist()`** запрос и обработка `false`/unsupported. **persist() — best effort, не гарантия**, браузер и пользователь могут удалять данные, private browsing имеет ограничения;
- ошибка transaction aborted, storage full, browser crash, quota/eviction/clear site data, PWA kill/restart, partial OPFS write, stale handles, OS low storage;
- при отсутствии рабочих secure storage APIs — fail closed с понятным UX, не хранить plaintext и не делать вид, что фото надёжно сохранено.

**No false durable promise:** метка «локально сохранено» только после encrypted write/verify + manifest/outbox commit; при отсутствии browser persistence уведомить пользователя о риске и не обещать, что единственное фото гарантированно переживёт очистку браузера. Sync в S3 и recovery key дают отдельный путь защиты, но upload/ACK не равен разрешению удалить единственную копию до проверки восстановимости.

Sources to revisit for API capability, **not requirements or repo dependencies**:
- https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- https://dexie.org/docs/IndexedDB-on-Safari

## 3. Trusted time / `expires_at` 24ч–45д

**Серверное время UTC — авторитет** для expiry. Сервер вычисляет/проверяет `expires_at` от `captured_at` и snapshot assignment policy при sync; все серверные reads/downloads/shares/Photo Card/Browser проверяют **server `now >= expires_at` и отказывают немедленно** независимо от фона queue. Рабочий договорённый TTL 24 часа — 45 дней; edits не продлевают.

Локальная PWA офлайн без защищённых системных часов не может доказать абсолютное физическое время при злонамеренной смене системных часов. Поэтому нужен следующий **fail-closed rollback policy** вместо наивного `Date.now() < expires_at`:

1. После каждого аутентифицированного HTTPS ответа сервера записывать `lastTrustedServerUtc`, `lastObservedWallUtc`, `timeProofIssuedAt` и monotonic session anchor, привязанные к конкретному account/device (в локальном журнале, защищённом от случайной порчи). **Никогда не уменьшать trusted floor** при более старом/повторном ответе.
2. Пока текущая JS session жива, `performance.now()` даёт **монотонный относительный** elapsed anchor: `effectiveNow = max(lastTrustedServerUtc + elapsedSinceAnchor, Date.now(), trustedFloor)`. Учитывать sleep/suspend и проверять границы `performance.now`; отсутствие надёжного elapsed не трактовать как доказательство непросрочки.
3. После reload/PWA resume сравнивать wall clock с сохранённым lastObservedWallUtc и lastTrustedServerUtc. Если системное время повернули назад заметнее допустимого технического clock skew (рекомендуемый начальный threshold **5 минут**, зафиксировать тестом), либо состояние времени повреждено/нельзя доверять — **заблокировать показ photo (locked_due_to_untrusted_time)** до нового trusted server time; **не продлевать TTL** на основании новых локальных часов.
4. При `effectiveNow >= expires_at` локально **немедленно блокировать чтение и начинать зашифрованную очистку**, даже offline; повторная синхронизация/старый ACK не возрождают photo.
5. При долгой полной offline работе, когда время нельзя достоверно подтвердить, приложение не обещает абсолютного enforcement против намеренной подделки часов. Нужна проверка Codex на реальных устройствах. **Нельзя без отдельного решения владельца искусственно ограничить всё offline-чтение кратким универсальным временем**, если часы просто недоступны; подозрение на rollback/недостоверность времени всё же fail-closed. Любые новые UX-ограничения offline доступа согласовать с владельцем.

**Безопасность/ограничение:** local IndexedDB/OPFS и wall clock можно изменить при полном контроле устройства; одно лишь хранение `lastTrustedServerUtc` не даёт криптографической защиты от rollback атакующего с filesystem access. Поддерживать root E2EE и key access restrictions; не обещать невзламываемый offline TTL. Сервер всегда enforcement authority и удаляет ciphertext/metadata по cron независимо от клиента. На выключенном offline устройстве cleanup только при запуске/возобновлении.

## 4. Что тестирует Codex

- Safari PWA fresh install, IndexedDB/OPFS capability and fallback, `persist()` true/false/unsupported, quota pressure and browser crash, account switch and tab concurrency.
- Запись encrypted capture, consistency after partial write, orphan reconciliation, outbox retries, ciphertext-only inspection via browser development tools.
- По времени: 24h и 45d boundary, изменение часов назад/вперёд, browser suspend/restart, old server response, offline expiry, damaged timestamp, deleted/expired photo sync retry, local UI must not flash old photo.
- Соотношение `metadata + encrypted blob + thumbnail + expiresAt`, все ссылки удаляются по lifetime, server DB/photo access denied when expired.

**R2-04 blocked only by security/key contract review and actual capability probes, not by choice of S3 provider; R2-01/02 UI shell not blocked by storage.**
