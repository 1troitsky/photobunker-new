# 05. Security, конфиденциальность, PIN и threat model

**Статус:** обязательные security invariants + вопросы для отдельного security review. Не является независимой криптографической экспертизой.

## 1. Threat model

Защита от: компрометации S3/серверных объектов, утечки баз данных/логов/URL, потери/кражи устройства, другого аккаунта в том же браузере, отзыва доступа, повторной отправки операций, partial wipe, злонамеренного получателя ссылок, подмены/повтора ciphertext и browser storage eviction.

**Нельзя обещать** абсолютную защиту от ОС/браузера с root/admin, захвата экрана, уже скачанных получателем копий и физического восстановления удалённых блоков. PIN приложения сам по себе **не заменяет** E2EE и защиту ключей.

## 2. Cryptography boundary

- **До локального persistent commit**: photo bytes и приватные metadata зашифрованы стандартными проверенными библиотеками / browser WebCrypto; Dexie/IndexedDB хранит encrypted sensitive fields + minimal index headers, OPFS хранит ciphertext blobs с encrypted IDB fallback; всё persistent storage допускает только ciphertext для чувствительных данных. [12](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md). In-memory plaintext краткоживущий; не сериализовать его в DevTools persistence/localStorage/logs.
- **Перед S3**: только ciphertext objects с проверяемым протоколом, integrity, scoped encryption envelopes, account/device separation и поддержкой смены полномочий. Сервер не получает ключей для массового расшифрования. Режим compression **до** encryption, а при редактировании формируется новое корректно аутентифицированное содержимое.
- **Серверные metadata**: разрешённые policy/ACL/expiry/size/ids fields минимально открыты; GPS, пользовательское описание и закрытые поля — encrypted. Схема данных проходит review на side-channel exposures.
- Identity/recovery не получает `CONFIRMED` без review из [11](11-IDENTITY-AND-KEYS.md): нет email/password/reset; один Account Recovery Key, account signing challenge, first-device bootstrap и pairing. AKEK только оборачивает отдельные per-asset DEK и не шифрует весь архив напрямую. Агент реализует и независимо проверяет protocol/envelope vectors; владелец принимает UX. **Никакого самописного AEAD.** Нельзя выдавать E2EE до успешных тестов.
- Коррумпированный ciphertext не показывать как корректную фотографию. Recovery не должен означать «создать новый ключ и потерять старые фото» без явного выбора.

## 3. Camera and system gallery

PhotoBunker не вызывает системный save-to-Photos, DCIM или Photos Library. Browser getUserMedia и canvas/ImageBitmap могут содержать байты в памяти; наш код **никогда** не создаёт plaintext disk/cache/temp экспорт. Platform OS/browser internal buffers невозможно абсолютно гарантировать и необходимо честно описать пределы после тестирования iOS/Android.

Никакие decrypted thumbs/previews в service-worker caches. После lock/account switch revoke blob URLs, clear memory surfaces и reject stale callbacks. Не делать обход через input capture, который автоматически пишет системный файл, если такой режим не проверен.

## 4. PIN — актуальные два зависимых механизма (2026-11-08/09)

Новые требования: [SECURITY-PIN-DEVICE-CONTRACT.md](product/SECURITY-PIN-DEVICE-CONTRACT.md), принятый UX: [Security & Privacy 1.3](ux/security-privacy/README.md). Прежние три независимых PIN и Emergency PIN 2×N **отменены**.

| Механизм | Значение | Ограничения |
| --- | --- | --- |
| App lock PIN | Необязательные **4–8 цифр**; re-lock 0–5 мин | Не является Recovery Key или самостоятельной криптозащитой |
| Emergency PIN | Только при App PIN, **строго той же длины**, другое значение | Немедленно блокирует локальный доступ; облачное удаление только после server ACK |

- Смена длины App PIN инвалидирует Emergency PIN; отключение App PIN отключает и Emergency PIN с предупреждением. Никакой биометрии.
- Не хранить PIN и verifier/recovery materials в логах/plaintext/localStorage. Salted approved KDF, bounded retries, безопасные error states; E2EE не строится только на PIN.
- Emergency flow fail-closed: локальная блокировка до ожидания сети, durable server revoke/delete intent, при offline remote outcome **pending**, retry и server ACK.
- Ошибка ввода обычного PIN не вызывает аварийного удаления автоматически.
- **P0 OPEN:** тарифная политика предполагает сохранение подтверждённого платного backup, а новый UX описывает полное облачное удаление; не реализовывать удаление backup без отдельного решения и threat review.

## 5. ACL / TTL / Share / Browser

- Photo/Card/Note/Assignment/Team/Browser/Share independent sources of authority; membership ≠ photo ACL. Public Card URL does not reveal full original/download/GPS by default.
- Every server photo object read, export, version, metadata fetch, browser projection validates current role/grant/**expires_at (24h–45d per assignment)**/device session. Signed URL scope/expiry cannot exceed photo expiry; no permanent unscoped Garage URLs. **Immediately fail-closed on expiry**, even if physical deletion is pending. Indexed Laravel scheduled sweep + batched deletion jobs then remove every encrypted original/edit/thumbnail/share and per-photo DB/metadata; retry until verified. Offline client cleans expired data upon resumption; do not promise instant remote wiping of a powered-off device.
- Browser URL — location, not bearer capability; all listed assignments and each photo independently checked. No partial leakage when one assignment revoked.
- Shares/exports can require isolated encrypted flattened object; privacy mask baked into delivered pixels and version restrictions respected; no raw layers/EXIF unless explicitly permitted.
- Revoke и **expiry** закрывают access до физической очистки, tombstones предотвращают resurrection. Сервер reject expired uploads. Для локального expiry требуется [last trusted server time + clock rollback detection](12-CLIENT-STORAGE-AND-TRUSTED-TIME.md) и **fail closed при подозрении на подмену времени**. Нельзя гарантировать абсолютное TTL на полностью скомпрометированном offline-устройстве; часы ОС и локальный storage доступны владельцу устройства. Не обещать forensic physical erase.

## 6. Mandatory adversarial checks

Test multi-account/browser tabs/device switch, replay, stale ACK, withheld ACK, forged role/assignment ID, denied metadata, expired URL, removed participant, changed assignment policy, concurrent edit/revoke, corrupt IDB, storage full, crash mid-write/wipe, key loss/recovery, public Card without photo rights, browser with one denied assignment.

Failing security tests -> **No-Go**. Security review should be independent of the authoring agent when possible. No release claim «unbreakable», «totally secure deletion» or «fully E2EE audited» without third-party evidence.
