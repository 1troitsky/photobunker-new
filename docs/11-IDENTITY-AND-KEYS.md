# 11. Identity, доверенные устройства и восстановление ключей

**Статус: технический baseline для R2-03/R2-04, 28.10.2026.** Это **нормативный контракт первого релиза**, не утверждение, что реализация уже существует или прошла security audit. Codex проверяет криптопротокол и UX на реальных устройствах перед переводом зависимых задач в Ready. Изменение пользовательских обещаний требует решения владельца; выбор библиотек/DTO внутри требований ведёт Codex.

## 1. Пользователь — главная сущность идентификации, НЕ монолит всего продукта

**User / Account** — стабильная глобальная идентичность (`user_id` UUID/ULID; окончательное имя таблицы определяется серверным контрактом). Не зависит от email, username, тарифа, мобильного устройства и подписок. `Profile` — публичное представление личности; `Device` — отдельное доверенное устройство; `Session` — конкретная аутентификация. Смена email/профиля не должна менять `user_id` и связи с Photo/Team/Assignment.

Модули **Photo, Assignment, Team, Card, Browser** ссылаются на `user_id` и ограниченные способности (`capabilities`) через Identity/Authorization API, но **не используют** прямые внутренние модели/таблицы другого модуля. Нет циклических зависимостей и гигантской `User`-модели со всеми настройками системы.

### Расширяемость без преждевременных интеграций

- **Billing/Subscription** в будущем — отдельный модуль: subscription owner может быть User или Team, тариф/платёж/срок не хранить в Photo/Camera; сервис `EntitlementPort` сообщает права на платные возможности по account/team scope. Никаких обязательных SDK/платежей в первом релизе.
- **Messenger** в будущем — отдельный подключаемый модуль с собственными данными, privacy/keys и жизненным циклом; использует `user_id`/Device/ACL, но Identity shell и PhotoBunker **никогда** не ждут подключения Messenger. В текущем scope никаких Matrix/RTC/чата и hidden messaging initializers.
- Добавление Gallery/Notes/новых продуктов не меняет регистрацию и ключи существующих пользователей и не требует изменения схемы других модулей. Domain contracts версионируются, тестируются на совместимость.

## 2. Вход в первом релизе: конкретный пользовательский сценарий

**Технический baseline v1:** email + пароль для создания аккаунта/входа, подтверждение email по одноразовой короткоживущей ссылке; reset пароля через email. Пароль аутентифицирует **сервисную учётную запись**, **не** является самостоятельным ключом расшифрования фото. Серверная авторизация, rate limits, secure session cookies/CSRF и защита от enumeration обязательны. Смена пароля сама по себе **не** теряет фото и **не** предоставляет ключи новому устройству.

**Passkeys/SSO** можно добавить позже как отдельный вход через Identity provider adapter; не требуется включать WebAuthn в первую UI/crypto реализацию. Клиент хранит только ограниченные session references, не секреты в localStorage. Не смешивать `email verified` и `trusted device`.

## 3. Первый доверенный device без ошибки «устройство не подтверждено»

Состояния регистрации: `pending_account` → `email_verified` → `keys_created` → `first_device_enrolled` → `ready`; отдельные `needs_recovery`, `revoked`, `failed_retryable`. Переходы идут по idempotency key, server-owned account/device proof и CAS; никакое частичное состояние не трактуется как `ready`.

1. Пользователь создаёт учётную запись; сервер возвращает только ограниченный регистрационный сеанс. Возможны retry/resend подтверждения и cancel без дублей.
2. После подтверждения email браузер генерирует **криптографически случайный** root content key в WebCrypto. Приватный ключевой материал **не отправляется открытым на сервер**. Контракты wrapping и криптопримитивы утверждает Codex после threat review; не писать самодельную криптографию.
3. Создаётся **первое** устройство и локальный защищённый envelope, позволяющий этому браузеру открыть root key. Бэкенд **атомарно идемпотентно** связывает verified account, первый device proof и bootstrap status — **не требует одобрения ещё не существующего trusted device**.
4. Создаётся независимый **recovery secret** с высокой энтропией (минимум 256 бит из CSPRNG), предлагается пользователю как recovery phrase/key с подтверждением хранения. Root key шифруется отдельным ключом, полученным из recovery secret, и только **зашифрованный recovery envelope** сохраняется на сервере.
5. Статус `ready` возможен лишь после доказанной возможности расшифровать локальный и recovery envelopes тестовым unlock. При отказе сервера/reload клиент **продолжает** ту же регистрацию по idempotency key, без генерации второго несовместимого root. При утрате ключа до завершения bootstrap виден честный recovery/restart flow с явным предупреждением; нельзя молча создавать новый identity и терять фото.
6. Только после готовности trust chain разрешены создание encrypted фото и вход на другие устройства. Shell/Sign in/Recover должны показываться без ожидания сетевых запросов; серверный вход требует сеть, offline access к уже разрешённым данным — локальный gate.

**Защита ключей**: фраза/секрет восстановления не хранится сервером, в логах, IndexedDB, localStorage, analytics или URL. Браузерный storage не эквивалент аппаратному Secure Enclave; невозможность гарантировать защиту от OS/root/browser compromise — часть threat model. Локальный ключ должен быть защищён механизмом, доступным в PWA, и независим от обычного UI PIN. Не обещать, что произвольный PIN делает root key криптографически безопасным.

## 4. Второе устройство и recovery

**Новый device по умолчанию UNTRUSTED**, даже при правильном email/password. Для доступа к существующим encrypted фото нужно одно из:
- **Pairing с действующим trusted device:** короткоживущий однократный challenge + out-of-band проверка/подтверждение; root/decryption capability передаётся **только в зашифрованном envelope на публичный ключ нового устройства**, с проверкой владельца, привязкой к device identity и replay resistance.
- **Recovery phrase:** пользователь аутентифицируется в аккаунте, вводит phrase локально на новом устройстве, клиент получает server-stored **encrypted** recovery envelope, проверяет integrity, расшифровывает root и создаёт новый device envelope. Сервер не получает phrase/выведенный recovery key/открытый root.

Подтверждение нового устройства **не** должно ждать авторизации тем же новым устройством — это повторяет прежний deadlock. Ошибка pairing/интернета возвращает recoverable state без потери действующего устройства. Восстановление password через email восстанавливает **вход**, но **не расшифрование данных**. Если все trusted devices и recovery phrase утрачены, старые E2EE-фото криптографически невосстановимы; интерфейс предупреждает об этом до начала съёмки.

При удалении/отзыве устройства сессии и новые server-read grants закрываются; криптографическая ротация ключей/старые offline copies имеют ограничения, которые нужно тестировать, а не обещать удалённое стирание выключенного устройства.

## 5. Переключение аккаунтов

Каждая browser profile может содержать несколько accounts, но разделы OPFS и IndexedDB индексируются по **неизменному accountId и deviceId**. При switch/logout немедленно уничтожить runtime references на расшифрованные bytes/ключи и object URLs, отменить или игнорировать stale tasks/responses, reset Pinia UI, scoped sync workers/outbox/policy. **Не уничтожать автоматически** ciphertext другого аккаунта. Вновь выбранный аккаунт требует своего unlock и rights verification, данные чужого аккаунта не появляются даже на один frame.

## 6. Обязательная acceptance R2-03

- Create / verify / sign in / sign out / recover / change password, **частичная регистрация на каждом шаге** и повтор после reload/network failure.
- Первый device bootstrap без «unconfirmed device» deadlock; correct account/session binding.
- Второй device через **pairing** и через **recovery phrase**, negative wrong/replayed/expired/revoked proof, lost-device flow.
- Two accounts in one browser, stale async callbacks, reboot, offline unlock, encrypted photo readback; нет plaintext root/phrase в IndexedDB/OPFS/logs.
- Недоступный сервер не блокирует public shell и логин-экран; не обещать полноценный новый Sign in offline.
- Из независимых тестов Codex: orphan bootstrap/duplicates, corrupt recovery envelope, lost ack/resend, cryptographic vectors and version migrations.

**Приоритет:** сделать эти контракты до начала R2-03 и особенно R2-04. Не откладывать recovery «на потом» и не строить доступ к фото без пути восстановления.
