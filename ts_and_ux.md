# Technical Specification and Quick Tasks

**Статус:** главный документ владельца по функциям, поведению и направлению UI/UX. Агент обязан использовать его одновременно как Technical Specification и как источник quick tasks. Этот файл описывает желаемый результат, а не доказывает, что функция уже реализована.

Фактический статус кода находится в `docs/15-CURRENT-IMPLEMENTATION-STATUS.md`, а подтверждённые дефекты и очередь исправлений — в `docs/16-OPEN-PROBLEMS-AND-QUICK-TASKS.md`. Последнее прямое решение владельца имеет приоритет над более старой формулировкой в этом файле. Нельзя отмечать требование выполненным только по наличию компонента или теста: UI принимает владелец на реальном устройстве.

## Common sample
```
-----------------------------------------------------
| logo | title [status]        :button1:  :button2: |
|---------------------------------------------------|
| :submenu#1:  :submenu#2:  :submenu#3:             |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                   :Content:                       |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|                                                   |
|---------------------------------------------------|
| Assignments  Browser  Camera  Contacts  Settings  |
|---------------------------------------------------|
```
[status] - статус/состояние страницы/объекта, например загрузка, обновление, подключение к сети и тд. Если статус положительный "done", значит он не должен показыватся. Так же сюда можно положить все очерди и тп. то есть этот маленький прунктик может вести на отдельную страницу где список задач и тп - особенно это полезно при отладке и тд.


### Dock
```
-------------------------------
|  A  |  B  |  C  |  U  |  S  |
-------------------------------
A - Assignments
B - Browser
C - Camera
U - Teams/Contacts
S - Profile/Settings
```


## Funtions

### Assignments
- button1: Add assignment
- button2: Search
- button3: Settings
- Submenu1: Active
- Submenu2: Archive
- Submenu3: All
- Content (Assignments list (click/touch assignment -> view assignment details))
    - Title
    - Status
    - Start date
    - Description
    - Progress bar / End Date
    - Take assignment (move to camera with the assignment options)
    - View photos (if allowed -> photo bowser)
    - Edit button
        - View assignment details
        - Edit assignment (if allowed)
        - Change status (if allowed)
        - Add dublicate assignment

#### Settings
- Show first: Active; All; Archive.
- Sort: Create date; Edit date; Add photo date.

#### Add/Edit/Dublicate
- Common
    - Name
    - Description
    - Start date (NowTime by default and minimal value)
    - Finish date (Tomorrow by minimal value, no finish date by default)
- Camera
    - Camera preset
        - Add preset (common to everyone involved in the task)
    - Needed photos (count 1–9999 — optional; this is only for the progress bar and does not affect the task itself.)
    - Camera instructions
- Participants
    - Me (owner)
    - Choose Тeam
    - Add Participant (from contacts or search UserID/UserSlug)
- Rules
    - PhotoAssignmentID as Name (Example NAME0001) (Yes by default)
    - Tag is required (No by default)
        - Paticular tags?
            - Tags list
    - Description is required (No by default)
        - Min leingh (10 simbols)
    - Chaneging is allowed
        - Ceep original?
    - Removing is allowed (Deleting)? (Yes by default) - not attempt on private gallery, participant can delete any photo from hisown gallery anyway.
    - Browsing is allowed?
        - Only thumbneils (80x80px) (by default)
    - Sharing photos is allowed?
        - Only between the participants
        - Only owner can do that
        - Only curators and owner can do that (by default)


### Browser
- button1: Search
- button2: Settings
- Submenu1: All
- Submenu2: My photos
- Submenu3: Assignments
- Submenu4: Archive (my photos)
- Tags
- Content (Photos)
    - Miniature / thumbnail (click/touch -> view photo)
    - Title
    - Dates (shot date / edit date)
    - End date (deleting time)
    - Tags
    - Edit button
        - Add/edit tag
        - View photo
        - View photo-card
        - View original
        - Edit photo
        - Delete photo
        - Share photo (share photo-card link)
- Content (folders)
    - Miniatures / thumbnails (4 images if gallery view)
    - Title
    - Dates (start date / last-added-to-folder date)

#### View photo
- Image info
    - ID
    - Name
    - Assignment
    - Description
    - Coordinates
    - Created at
    - Edited at (if edited)
    - Deleting at (special color)
- Edit
    - Edit visual (if permitted)
    - Edit data (if permitted)
- View card
- Show original (if exist)
- Delete (if it has permissions)

#### Edit photo
- Edit info
    - Name
    - Description
    - GPS
    - Tags
        - Tags list
        - Add tag
        - Select tags
        - Delete/Edit tag
- Edit photo
    - Crop/Rotate
    - Brightness/contrast/saturation
    - Brush/Pensil/Eraser
    - Text
        - Size
        - Color
    - Figures
        - Color
        - Shape (arrows, circle, square, star)
        - Filling

#### Browser Settings
- Show first: All; My photos; Assignments; Archive.
- View: tree; list; gallery.
- Tags: add/edit tags.


### Photo-card
- Image
- Title
- Description
- GPS Coordinates + Widget map!!!
- Deleting date (How many days left)
- Show in Browser (if its yours)
- Share (if it has permissions)
- Additional information (if allowed)
    - Tags
    - Original ID
    - Contributor/Team + link to profile card
    - Assignment info + link
    - Shot date + Edit date
    - Original? Show original
    - Show all metadata

### Camera
- Assignment
- Camera preset
    - Presets list
        - Dublicate preset
        - Delete/Edit preset

#### Camera preset
- name (auto: prodfile number)
- description (not nessesary)
- resolution
    - Max
    - High
    - Medium
    - Low
    - Custom
- Ratio
    - 1:1
    - 4:3
    - 3:2
    - 16:9
    - Custom
- Metadata
    - Date
    - Time
    - Camera information
    - Geo
- auto-delete photos after
    - No delete
    - 1 hour
    - 3 hours
    - 12 hours
    - 24 hours
    - 5 days
    - 7 days
    - 14 days
    - 21 days
    - 30 days
    - custom


### Profile/Settings (S)
- My Profile
    - Profile card
    - Edit profile card
        - InAppID (not technical ID, can not be edited)
        - Username (slug like @blablabla, min 3 letters, max 15)
        - Name (not necessary + privacy settings)
        - Email (not necessary + privacy settings)
        - Phone number (not necessary + privacy settings)
        - About (not necessary + privacy settings)
- Appearance
    - Theme
        - Auto (device theme)
        - Dark
        - Light
    - language
        - English
        - Russian
        - Ukrain
        - Polski
        - Turkiy
        - Georgian
    - Open on launch
        - Camera
        - Assignments
        - Browser
- Privacy and Security
    - Who can see...
    - Pin codes
        - Launch pin
        - Emergency-data-removing pin

**Утверждённая PIN-модель (2026-11-06):** обычный PIN 4–6 цифр, аварийный — строго 2× длины обычного (8/10/12 цифр), вводится как две последовательные N-значные части. Первая совпавшая половина скрыто переводит в ожидание второй; обе части могут совпадать друг с другом, но не с обычным PIN. Поле очищается автоматически после каждых N цифр, без auto-submit таймеров. После 5 ошибок обычный вход заблокирован на 20 минут, аварийный остаётся доступен. Забытый PIN восстанавливается через Recovery Key. Аварийный PIN — только уничтожение данных, не запасной вход: локальное удаление раньше облачной команды; при отсутствии бэкапа потеря безвозвратна. Если подтверждённый независимый облачный бэкап существует, его нужно сохранять для восстановления по ключу. Текущий сервер этот последний пункт пока не обеспечивает — до исправления нет production acceptance.
            - keep data in cloud?
- Data and Storage
    - Storage info
        - Cache size
        - Photos in the cloud
        - Waiting to upload
        - Available space in device
        - Backups
    - Clear cache
    - Delete all photos and queues on device
    - Delete all photos in cloud
    - Matrix/Signal server (future function)
    - S3/IPFS Server
- Contact/Report
- About


## SaaS Tariffs — UPDATED CONTRACT (2026-11-08)

**Единственный актуальный источник тарифных правил и целевых API-контрактов:** [docs/product/BILLING-TARIFF-CONTRACT.md](docs/product/BILLING-TARIFF-CONTRACT.md). Более ранняя версия тарифов ниже отменена решением владельца. Значения из старого `payments/catalog.ts` не использовать при разработке новых контрактов.

**Free:** 3 задания/месяц; 50 файлов; 1 ГБ; до 14 дней; нет бэкапа.
**Go:** $20/мес.; 20 заданий/месяц; 250 файлов; 30 ГБ; до 30 дней; 1 ручное + 1 автоматическое обновление *одного* бэкапа в неделю.
**Pro:** $30/мес.; 50 заданий/месяц; 2000 файлов; 200 ГБ; до 90 дней; 5 ручных + 2 автоматических обновления в неделю.
**Unlimited:** $50/мес.; без ограничения количества заданий и файлов; до 1 ТБ; сроки хранения пока действует соответствующее право; одна копия обновляется ежедневно, ручные обновления без лимита.

Шифрование и Emergency PIN есть **во всех** планах; облачное восстановление по копии — только если зашифрованный backup существует и доступен recovery key. Отдельных пунктов «свой S3» и «свой сервер Matrix/Signal» в тарифах нет.

Скидки за 6/12 месяцев: Go −10%/−15%, Pro −15%/−20%, Unlimited −20%/−30%. Суммы за 6/12 месяцев: Go $108/$204; Pro $153/$288; Unlimited $240/$420.

**Internal grace:** Free 15, Go 15, Pro 30, Unlimited 60 дней; отдельные 15 дней на безопасный downgrade. Рекламная формулировка 15–60 дней, точная дата удаления/потери доступа сообщается владельцу до действия. Free не имеет заканчивающейся подписки: 15 дней — защита при изменении прав/квот, **не продление собственного TTL 14 дней для каждого бесплатного файла**.

**Пока не реализовано:** source of truth для тарифов и дат, backend квоты, backup pipeline, безопасный TTL/GC, ledger и оплата; точные способы оплаты всё ещё требуют отдельного решения.


## UI

Общий подход: нативность и мгновенный отклик без ожидания сети (local first); анимации при переходе; полное соблюдение истории перехода - если пользователь жмет кнопку назад, значит попадает в предыдущее меню, а не в какю-то непонятное место (как происходит на момент написания текста 04.11.2026 23:35); защата от двойных нажатий и отправки форм; ожидание загрузки интерфейса через wrapper.

### Assignments
```
--------------------------------
| pb | Assignments      [+][s] |
|                              |
|  -------------------------   |
|  | assignment #1       : |   |
|  | :info:                |   |
|  | --------------- :bar: |   |
|  -------------------------   |
|  -------------------------   |
|  | assignment #2       : |   |
|  | :info:                |   |
|  | --------------- :bar: |   |
|  -------------------------   |
|  -------------------------   |
|  | assignment #3       : |   |
|  | :info:                |   |
|  | --------------- :bar: |   |
|  -------------------------   |
|-------------------------------
|            dock              |
--------------------------------
s - search
+ - add assignment
: - options
```

### Browser
```
---------------------------------
| pb | Browser           [F][S] |
|                               |
|   -----------   -----------   |
|  | MyPhotos  | | Assignm.1 |  |
|  | 23 photos | | 23 photos |  |
|   -----------   -----------   |
|   -----------   -----------   |
|  | Assignm.2 | | Photo 1   |  |
|  | 23 photos | | 24/10/26  |  |
|   -----------   -----------   |
|   -----------   -----------   |
|  | Photo 2   | | Photo 3   |  |
|  | 22/10/26  | | 14/09/26  |  |
|   -----------   -----------   |
|                               |
|--------------------------------
|             dock              |
---------------------------------
F - Find/Search
S - Settings
```

### Welcome page
```
--------------------------------
|         photobunker          |
|                              |
|  -------------------------   |
|  |   Create New Account  |   |
|  |     *anonymously*     |   |
|  -------------------------   |
|  -------------------------   |
|  |    Recover Account    |   |
|  |   *if you have key*   |   |
|  -------------------------   |
|  -------------------------   |
|  |    Why photobunker?   |   |
|  |                       |   |
|  |  < bla bla bla bla  > |   |
|  |                       |   |
|  |         . . .         |   |
|  -------------------------   |
|                              |
--------------------------------
Why photobunker: autoscrolling + manualscrolling.
```

### Header example
```
----------------------------------------------------------
|       |                            |        | |        |
| logo. |                            | :edit: | | :plus: |
|-------|                            |--------| |--------|
|                                                        |
Шапка прозрачная (точнее пустая) - логотип кружочком и кнопки кружочком сверху как отдельные элементы.
```

## Conclutions

Я должен получить работающее приложение - главной функцией которого является организация работы фотографий с исполнителями и защита. плюс автоматическое удаление данных по пинкоду. поэтому страница заданий, браузинга фотографий и просмотр карточки изображения должно работать идеально, как в телефоне так и на компьюетере, что бы было удобно работать с фотографиями. плюс мы делаем отдельный месенджер для пользователей через протокол matrix (в данный момент отложен на некоторое время).

В целом долно получится следующие страницы:

Assignments - создание и просмотр заданий
Browser - основная рабочая среда
Photocard - просмотр фотографии с виджетом карты где сделан снимок
Camera - для создания фотографий
Contacts - для работы с контактами и командой
Profile/Settings - Просмотр карточки профиля (как свой, так и других участников) и Настойки приложения
Payment - платежи и настройка тарифного плана
Status - статус страницы/объекта со списком очереди, таймером, временем и выполненых процессов для отладки приложения (страница с мониторингом только для админов - через привязку id), само состояние (загрузка/подключение и тп.) нужно показывать всем.

Историческое предложение по провайдерам: DePay/NOWPayments. **Не утверждённое решение; провайдер, налоги, контракт checkout и способы оплаты открыты.** См. [контракт тарифов](docs/product/BILLING-TARIFF-CONTRACT.md).
