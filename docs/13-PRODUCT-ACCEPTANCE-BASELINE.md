# 13. PhotoBunker New — самостоятельный функциональный baseline

**Статус: нормативные требования к новому продукту, 28.10.2026.** Этот документ и контракты `02–12` — **единственные обязательные источники реализации**. Legacy [AUDIT-20261028](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md) и [CHECKLIST](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md) — **исторические ссылки для конкретного исследования**, не дополнительное обязательное чтение каждого Issue и не источник расширения scope. Текущие требования ниже извлечены/адаптированы из legacy с исключением всего Messenger/Matrix/RTC.

## 1. Foundation, Identity и первый ручной UX gate

- Пять основных экранов: **Камера, Фото, Задания, Photo Browser, Профиль/Настройки**. Редактор, Photo Card и PIN — отдельные контекстные экраны. На R2-02 все маршруты и интерактивные действия работают в production frontend с **явно помеченными UI fixtures**; владелец проверяет на реальных телефоне и desktop, прежде чем вкладываться в сложные функции.
- **User/Account** — стабильная центральная идентификация, собственный Profile, Device, Session и Authorization. Будущие Billing и Messenger — автономные модули, не зависимость shell или фото, см. [11](11-IDENTITY-AND-KEYS.md). Messenger не разрабатывается в текущем релизе.
- **R2-03**: anonymous **Create account / Restore access** без email/password; один Recovery Key, signed challenge, первый trusted device без deadlock, восстановление ключом или pairing и смена аккаунта без утечек. Потеря ключа и всех devices необратима. **R2-21** лишь дополняет Welcome и визуальную полировку.
- **Welcome (R2-21)**: содержательный, аккуратный, mobile-first, минимум четыре реальные преимущества: приватная съёмка, защищённое краткосрочное хранение, задания/команды, управляемый доступ/передача фото (НЕ зашифрованные сообщения/звонки). Welcome не появляется при каждом открытии уже настроенного приложения.
- i18n RU+EN, English fallback, настройки языка сохраняются, даты/числа локализованы; структура позволяет добавить новые языки, но их не рекламировать как готовые. Светлая/тёмная тема, safe area, touch, keyboard, screen reader, reduced motion.

## 2. Camera, Gallery, metadata и IDs

- Первый настоящий снимок — **R2-06**: снять через camera API, применить assignment capture policy, encrypted local commit и отдельную encrypted PhotoMetadata запись, минимальный локальный просмотр и offline/reload. Не в системную Photos/DCIM, нет plaintext persist; в UI различать «на устройстве» и «синхронизировано».
- Режимы из [03](03-PHOTO-STORAGE.md): (1) camera bytes no additional compression — UI disabled; (2) compressed source отдельно от edit; (3) compressed replacement default; по заданию или mode 3 без задания.
- **TTL 24 часа — 45 дней** в задании (default 45 дней); при capture фиксируется `expires_at` и revision policy. По истечении немедленно закрыть доступ и очистить все связанные encrypted originals/edits/thumbs/share/export/cache/metadata/Photo DB records через Laravel Scheduler/queue и локально при запуске.
- **Thumbnail** — одна encrypted WebP до 320px по длинной стороне на фото, S3+ограниченный зашифрованный кэш, без отдельного persistent preview.
- **NAME-ID**: ровно 4 латинские A–Z + 4 цифры, например `ABCD0001`. По умолчанию название фото — NAME-ID, пользователь меняет название отдельно, а ID/UUID неизменны. В задании «Использовать ID задания для названий» по умолчанию включено; последовательность `0001`…`9999`; обработка offline concurrency/исчерпания без незаметного переименования опубликованных ID. UUID — внутренний primary key.
- **Geo**: если permission ранее дан, получать/обновлять координаты при открытии с ограничением батареи; хранить последнюю координату, accuracy и время; камера использует доступное сразу и не ждёт GPS, если политика задания допускает; no GPS — честный статус и сохранённое фото; opt-out, поздняя корректировка в разрешённом временном окне.
- **R2-22** P2: группировка по местоположению, сортировка по расстоянию, карта по opt-in, поиск области; без GPS фото остаются видимыми, location ACL не ослаблять.

## 3. Assignment, Team, Notes

- У задания ровно пять статусов: **Waiting → In progress → Submitted → Needs changes → Completed**. Возврат из Needs changes в In progress; каждый переход авторизован и версионирован, есть история, конфликт CAS; статус проверки отдельного фото — не статус задания.
- Team profile содержит имя, description, avatar, creator, participants/roles, related assignments, управление разрешениями/приглашениями; контакты управляются через Settings. Ни чаты, ни presence, ни RTC не создаются.
- Заметки к Photo/Assignment — **отдельные приватные сущности**, CRUD, author, timestamps, ACL, offline sync. Не показывать Notes как публичное описание Photo Card/Assignment, не добавлять пункт «отправить в чат» в v1.

## 4. Editor

- Добавление Text немедленно фокусирует поле, на touch насколько позволяет браузер открывается клавиатура, обновление preview не теряет текст.
- Brush/Pencil/Eraser — различимые инструменты: Brush широкая мягкая линия, Pencil тонкая и чёткая; отдельные size/color/opacity; touch/mouse/stylus. Shapes имеют switch Fill/Outline, сохраняемый после выхода/экспорта.
- Сохранение respects mode 2/3, не оставляет непрошенную постоянную историю; editor не продлевает TTL, expired photo нельзя редактировать.

## 5. Photo Card — отдельные права

- В полноценном viewer есть отдельная кнопка «Карточка», переход **не** подменяет перелистывание галереи. Card — отдельный маршрут/URL с безопасной авторизацией.
- Заголовок: пользовательское имя либо NAME-ID (до назначения — честный pending); описание — только если разрешено/существует, не Notes. Видимый `expires_at`. «Показать в галерее» только когда пользователь имеет доступ.
- Дата съёмки, автор с профилем и metadata раскрываются **только по ACL**. GPS: координаты/copy/map только после разрешённого metadata read, внешнему map-provider точное место отправляется лишь по opt-in.
- Независимые capabilities `card/image/original/download/metadata`; shared Card не открывает original автоматически, public route не делает private photo публичным. Revoke/TTL закрывают ссылку.

## 6. Photo Browser / export

- Авторизованные коллекции **1–20 и более заданий** с проверкой ACL каждого задания и фото; URL — locator, не bearer-access.
- Finder-style иерархия «Задания → Фотографии», режимы Grid/List/Tree, поиск/сортировка/multiselect, открытие Photo Card; lists не тянут все fullres assets.
- Ограниченные recipient/expiry/visibility/download scopes; разрешённый single download и ZIP только на разрешённые файлы/версии и metadata, bounded memory, revalidate rights on each item; не дублировать оригиналы только ради Browser.

## 7. PIN и Settings

- **App lock PIN** (optional, independently enabled): настраиваемые attempts, delay/cooldown и relock; loss-of-access recovery; никакой автоматической аварийной очистки без явно включённой отдельной опции.
- **Local-delete PIN** отдельно (optional): cloud/key recovery preflight, точное удаление data только текущего устройства, информирование об unsynced data; никакого ложного «backup complete».
- **Emergency PIN** отдельно (optional): мгновенно закрывает локальный доступ, разрушает локальные key grants, надёжно отправляет server revoke/delete intent; offline → pending, без ложного server ACK; клиент показывает ограниченную fail-closed ошибку, не раскрывая скрытый сценарий. Destructive flows — отдельный threat-review/test.
- Settings: contacts, Teams, camera default preset (переживает reload и gracefully handles missing preset), security/PIN, devices, privacy, geolocation, language; один источник истины.
- Аватары людей и Team: единый стиль, placeholder/initials, возможность загрузки/замены; не передавать закрытые изображения third-party avatar service.
- Контекстные tips только с реальным действием, dismissible, выполненные не повторять; без messenger promotion.

## 8. Каждый Issue — измеримые доказательства

Happy/error path; offline/reconnect/reload; account switch; permissions и E2EE; expiry/revoke; mobile PWA keyboard/touch/safe area; RU/EN; **production build**; негативные сценарии и реальные логи **Codex**. Показать owner milestone builds R2-02, R2-06, R2-05/R2-07 и последующие, не требовать у владельца технической проверки каждого PR.

**Исключено из первого релиза:** messenger/attachments/group chats, Matrix/LiveKit/RTC/voice/video, presence/online statuses, chat shares и обязанности синхронизации participants с chat-room. Если пользователь позже добавит Messenger — отдельный модуль и новый roadmap, без backdoor deps.

## 9. Контроль ссылок

Legacy docs доступны только как historical background/traceability. **При противоречии нормативны этот baseline, README, storage/security/identity contracts, roadmap и текущий Issue.** Внешняя legacy ссылка **не требует** читать другой repo на каждой задаче и **не расширяет scope автоматически**. Новые требования из legacy переносятся только после решения владельца.
