# 16. Открытые проблемы и quick-task очередь

Дата среза: 2026-11-06. Источник: `ts_and_ux.md`, отчёты 2026-11-04, production mobile acceptance владельца 2026-11-05 и фактический diff `f060dd4..53f7d69`.

Этот документ фиксирует **не обещания, а незакрытые критерии**. Если код для пункта уже существует, но владелец воспроизвёл дефект, статус остаётся `OWNER FAILED` до новой проверки владельцем.

## 1. Обязательный порядок ближайших шагов

Работать по одному шагу. Не объединять эти пункты в один большой редизайн.

| Шаг | Scope | Готово только когда |
| --- | --- | --- |
| Q1 | Dock + shell + PWA update | Док физически прижат к нижней safe-area без пустой полосы и скачков на Assignments/Contacts; установленная PWA получает новый release без удаления данных; владелец подтвердил на телефоне. |
| Q2 | Единый быстрый PIN input | Одна системная клавиатура, обработка без таймеров. Normal 4–6; emergency в две последовательные половины по N цифр, автоматическая очистка после каждой. Принятие владельцем на телефоне обязательно. |
| Q3 | Browser replacement | Единая классическая модель files+folders, корректный current folder/breadcrumb/create/move/delete/select; assignment и personal scopes не смешаны. |
| Q4 | Camera + assignment + post-capture navigation | Любое задание снимает в свой scope; permissions можно повторить без restart; кадр durable сохраняется локально и UI мгновенно переходит к ожидаемому состоянию. |
| Q5 | Photo → Card → Editor | Любую разрешённую фотографию можно открыть; Card отделена от private gallery; editor работает local-first без сетевого лага. |

После каждого шага: targeted production check → запись результата здесь → commit/push → deploy при необходимости → owner mobile acceptance. Не переходить дальше молча.

## 2. Shell, навигация, PWA и глобальный UI

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| UI-01 | `OWNER FAILED` | Владелец отклонил и `q1-dock-20261106-2`, и `q1-dock-20261106-3`: док всё ещё слишком высоко. Обнуление `--dock-safe-bottom` не устранило дефект на его устройстве. Дальнейшая правка Q1 не входит в текущую публикацию PR #54. |
| UI-02 | `IMPLEMENTED` | На `595be25` release marker имеет deterministic test; `q1-dock-20261106-2` подтверждён на production по marker, hash, headers и health. Upgrade установленной PWA ещё `NOT RUN`; до проверки владельцем не ставить `ACCEPTED`. |
| UI-03 | `OWNER FAILED` | На локальном Playwright Assignments ↔ Contacts после загрузки: 4.4–15.7 ms и стабильный dock. Production/RUM и owner mobile recheck ещё `NOT RUN`; прежний owner defect не закрыт. |
| UI-04 | `OPEN` | После capture навигация не мгновенная. Durable local commit и визуальный результат должны предшествовать фоновой доставке. |
| UI-05 | `OWNER FAILED` | Глобальные spacing, paddings, высота строк, font-size и блоки непоследовательны; встречались нулевые отступы, огромные gaps и очень мелкий текст. Нужны единые tokens/primitives. |
| UI-06 | `OWNER FAILED` | На узком экране текст и controls сжимались в столбик по одной букве. Все layouts проверять минимум 320/390 px и desktop 1440 px без horizontal overflow. |
| UI-07 | `OPEN` | Loading должен показываться через единый wrapper/skeleton; голая надпись «Загрузка» не принимается. |
| UI-08 | `OPEN` | Header status показывает только problem/pending/sync; положительный `done` скрыт. Status открывает подробную страницу процессов. |
| UI-09 | `PARTIAL` | Основной язык должен быть English для нового профиля; RU выбирается пользователем. Все user-facing strings имеют EN/RU без `Translation unavailable` и смешения языков. |
| UI-10 | `OPEN` | Все изменения настроек/профиля/правил сохраняются сразу там, где это безопасно; никаких глобальных «Changes are not saved» dialogs. Ошибка должна указывать конкретное поле/операцию. |
| UI-11 | `OWNER FAILED` | `×`, Back или Cancel в формах Contact/Team/других сущностей иногда создают или сохраняют объект. Cancel всегда discard; create только явной командой. |
| UI-12 | `PARTIAL` | PWA update не должен очищать IndexedDB/OPFS/keys. `release.json`/SW/versioned shell и release-marker test реализованы; upgrade старой установленной PWA между двумя реальными releases ещё `NOT RUN`. |

Q1 implementation evidence: commit `595be251ae092ae40cd2354bc910afa31ecc76e5`,
runtime `compat/assignment-release/`; Vitest 63/63 files and 320/320 tests PASS,
targeted PWA/SW 7/7 PASS, production build PASS. Playwright artifacts:
`test-results/playwright-mcp/q1-after-contacts-320x700.png` и
`test-results/playwright-mcp/test-results/playwright-mcp/q1-after-profile-390x844.png`
(ignored local evidence). Production deploy `q1-dock-20261106-1`: public marker,
bundle hashes, cache headers и API health `CONFIRMED`; owner acceptance пока `NOT RUN`.

Новый Q1 candidate на `595ec85`: [baseline](evidence/q1-dock-20261106/before-assignments-320x700.png) → [после](evidence/q1-dock-20261106/after-assignments-320x700.png), [light](evidence/q1-dock-20261106/after-camera-light-390x844.png). Playwright CLI 1/1 PASS, targeted Vitest 13/13 PASS, build `q1-dock-20261106-2` PASS. Production deploy `CONFIRMED`: public marker, bundle hashes, cache headers, API health/ready и гостевой `/welcome`. Реальный phone recheck и installed-PWA upgrade `NOT RUN`; Lighthouse CI `NOT RUN` без сопоставимого приватного baseline. Владелец: закрыть/открыть PWA без удаления данных, пройти Assignments → Contacts → Camera и проверить нижнюю safe-area, подписи, один active state и отсутствие скачка dock.

## 3. Camera, GPS, presets и assignments capture

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| CAM-01 | `OWNER FAILED` | Camera/геолокация запрашивались повторно или после Deny больше не запрашивались до restart. При входе в Camera показывать состояние permission и действие Retry/Open Settings без перезапуска. |
| CAM-02 | `OWNER FAILED` | GPS «ещё уточняется» не объясняет состояние. При валидном fix показывать координаты, accuracy и freshness; при отсутствии — конкретную причину/действие. |
| CAM-03 | `OPEN` | После входа в аккаунт разрешённый location warm-up должен начинаться заранее, чтобы shutter не ждал холодный GPS. Ограничения iOS/PWA background location показывать честно; не обещать невозможное постоянное слежение. |
| CAM-04 | `OWNER FAILED` | Capture работал для Assignment 1, но фото из Assignment 2/3 не появлялись. Любой assignment обязан фиксировать собственный ID/policy и открыть свой результат. |
| CAM-05 | `OWNER FAILED` | В папке assignment листались фотографии всей галереи. Assignment Browser показывает только этот assignment и разрешённые shared assets. |
| CAM-06 | `OWNER FAILED` | Личные фото смешивались с assignment photos. Personal и Assignment — разные scopes/folders/projections. |
| CAM-07 | `OWNER FAILED` | Camera viewport стал меньше/хуже. Видоискатель и shutter должны быть основным экраном, без служебных блоков, уменьшающих рабочую область. |
| CAM-08 | `OPEN` | Удалить под shutter служебные фразы вида «снимок сохраняется…». Состояние показывать компактно через status/queue. |
| CAM-09 | `PARTIAL` | Default preset: качество 70%; срок хранения по умолчанию без ручного сокращения в пределах тарифа. Effective TTL фиксируется при capture. |
| CAM-10 | `OWNER FAILED` | Standard preset нельзя было нормально посмотреть/изменить. Выбор preset открывает его параметры; duplicate/edit/delete подчинены правам. |
| CAM-11 | `OPEN` | В Add/Edit Assignment должен быть `Create preset`, общий для участников задания и versioned/frozen для capture. |
| CAM-12 | `OPEN` | «Watermark» убрать из текущего UI. Будущая функция называется `Logo`: image asset, привязанный ко всему assignment, применяется автоматически по policy. |
| CAM-13 | `CONFIRMED PRODUCT RULE` | Start date автоматически = current time и является минимальным значением. Finish date по умолчанию отсутствует; не показывать ложное «через час/день». |
| CAM-14 | `CONFIRMED PRODUCT RULE` | Needed photos 1–9999 — только progress indicator, не блокировка assignment. |

Status / entry loader: прежний overlay при каждом переходе — `OWNER FAILED`. В `main@a206f19`, release `entry-status-20261106-1`, overlay ограничен входом/разблокировкой. Меню использует общий cache/store, фоновые операции и ошибки показываются компактным зелёным/жёлтым/красным Status с подробностями и Retry. [Наблюдения и ограничения](WORKSPACE-VIEWER-2026-11-06.md), [deploy](evidence/entry-status-20261106/deploy.json). `READY FOR OWNER REVIEW`: PIN → один loader → Browser/Assignments/Camera без fullscreen пауз. Hardware и private production entry — `NOT RUN`.

## 4. Photo view, Photo Card и Editor

Кандидат wrapper/viewer `365095d`, release `workspace-viewer-20261106-1`: общий loader минимум 1.5 s/fade и регистрация initial page work, стабильный image stage/footer, natural image-only mode с vertical swipe. [Evidence и ограничения](WORKSPACE-VIEWER-2026-11-06.md). `READY FOR OWNER REVIEW`, hardware acceptance не выполнена. Public card/policy остаются отдельным следующим этапом; task policy должна сниматься при capture только новых фото, без ретроактивного изменения existing photos.

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| PH-01 | `OWNER FAILED` | Фото нельзя было открыть ни в viewer, ни в Card, ни в Editor. Сначала восстановить один локальный owner path end-to-end, затем assignment/recipient scopes. |
| PH-02 | `OWNER FAILED` | Photo Card выглядела частью private gallery. Card — отдельная shareable/public-by-grant сущность; открытие Card не даёт доступ к личной галерее. |
| PH-03 | `OWNER FAILED` | Description выглядело как заголовок и располагалось неверно. Image → естественное описание под изображением → structured metadata/actions. |
| PH-04 | `OPEN` | Координаты должны иметь встроенный приватный map widget/snapshot; не раскрывать GPS третьей стороне без opt-in. |
| PH-05 | `CONFIRMED PRODUCT RULE` | Одна команда `Edit`, внутри которой visual/data editing по разрешениям. Не дублировать «Данные» и «Изменить». |
| PH-06 | `OWNER FAILED` | Brightness/other editor actions давали 500–2000 ms lag/сетевое ощущение. Editing и preview выполняются локально; сеть только для background sync после durable save. |
| PH-07 | `OWNER FAILED` | Text tool автофокусировался до выбора области. Keyboard/focus появляется после явного tap по text target. |
| PH-08 | `OPEN` | Figures должны включать arrow, circle, square, star, color и filling. |
| PH-09 | `PARTIAL` | Photo title/NAME-ID, description, captured/edited/deletion dates, assignment, tags, author/team, original scope и permissions показываются гармонично и без технических ID. |
| PH-10 | `OPEN` | Thumbnail/cache должен быть bounded, encrypted и быстрым; list/grid не загружает full-resolution. Не хранить отдельные plaintext preview. |

## 5. Browser — требуется архитектурная замена

Повторная проверка владельца: фотографии открываются, но layout и вложенное дерево не приняты. По [повторному аудиту](BROWSER-AUDIT-2026-11-06.md#повторный-аудит-по-замечаниям-владельца) опубликован `d5acff3`, release `browser-layout-20261106-1`: controls перенесены в header/settings, путь сокращён, Tree сохраняет текущий узел, PhotoView actions больше не sticky; перелистывание сохраняет folder+assignment. `READY FOR OWNER REVIEW`. Предыдущие `OWNER FAILED` не закрыты тестами, нужна проверка владельца на телефоне.

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| BR-01 | `READY FOR OWNER REVIEW` | PR #55/SVAR остаётся отклонённым (`OWNER FAILED`) и отменённым. После согласования [аудита](BROWSER-AUDIT-2026-11-06.md) опубликован native Browser `56d91ad`, release `browser-native-20261106-1`. Изоляция scopes, location, offline folders, разделы/actions, Tree/history/expiry/tags и desktop проверены на синтетическом сценарии. Прежние жалобы не закрыты: нужна проверка владельца с реальными фото; hardware/приватный production flow — `NOT RUN`. |
| BR-02 | `OPEN` | Один ordered content list/tree содержит folders и photos; folder открывает новый current location. |
| BR-03 | `OWNER FAILED` | Неясно, где root/current folder. Обязательны root label, breadcrumb/back history и устойчивый route/location ID. |
| BR-04 | `OWNER FAILED` | Create folder создавал только в root. `+` создаёт folder в текущем writable location. |
| BR-05 | `OPEN` | Selection: single/multi/select-all-visible; actions rename/move/delete/share/export только по capability. |
| BR-06 | `OPEN` | Move dialog/tree не допускает циклы и показывает фактическое destination; local optimistic update с rollback. |
| BR-07 | `PARTIAL` | Grid/List/Tree, search, sort и filters существуют кусочно; должны работать над одной projection/model. |
| BR-08 | `OWNER FAILED` | Assignment folder не фильтровал фото; personal/assignment/archive/shared collections имеют разные scopes и не смешиваются. |
| BR-09 | `OPEN` | Каждая tile/row имеет predictable click → viewer; context menu содержит только разрешённые команды. |
| BR-10 | `OPEN` | Virtualization/pagination, encrypted thumbnail cache и cancellation обязательны для больших collections. |
| BR-11 | `OPEN` | До выбора стороннего file-manager компонента провести отдельное сравнение лицензии, mobile support, accessibility, virtualization и возможности подключить typed application API. Не вставлять библиотеку, владеющую crypto/DB/ACL. |

## 6. Assignments, Contacts и Teams

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| AS-01 | `CONFIRMED PRODUCT RULE` | Обычные функции работают без искусственных «проверить/подтвердить участников». ACL/keys проверяются автоматически fail-closed. Ограничения продукта — тарифы и реальные права. |
| AS-02 | `CONFIRMED PRODUCT RULE` | Photo sharing по умолчанию не ограничено участниками assignment; пользователь может выбрать разрешённого получателя. Assignment policy может сузить права явно. |
| AS-03 | `PARTIAL` | Active/Archive/All, search/sort, duplicate/status/progress существуют, но owner UI acceptance отсутствует. |
| AS-04 | `OWNER FAILED` | Team creation из Assignment не работал. Создание завершается один раз, возвращает team ID и сразу связывает его с assignment либо честно сообщает ошибку. |
| AS-05 | `CONFIRMED PRODUCT RULE` | Добавить пользователя в Team можно только через Contacts: сначала contact, затем team membership. |
| AS-06 | `OWNER FAILED` | Contacts search не находил пользователей; Contact Card нельзя было проверить. Поиск точного 8-digit ID/slug, privacy-aware result и явное Add contact. |
| AS-07 | `OWNER FAILED` | Team UI, карточка creator/participants/related assignments и технические IDs отклонены. Использовать нормальные profile cards/avatars/roles. |
| AS-08 | `OPEN` | Membership/permission изменения сохраняются мгновенно и показывают per-operation status, без общей ложной фразы «changes remained in form». |
| AS-09 | `OPEN` | Required tags/description/edit/delete/browse rules должны исполняться server-authoritatively, а не только показываться toggle в UI. |

## 7. Profile, Settings, Status и идентификаторы

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| PR-01 | `IMPLEMENTED` | Пользовательский ID должен быть порядковым 8-значным числом. Migration/display code добавлен, но production migration и existing-account behavior нужно проверить. |
| PR-02 | `CONFIRMED PRODUCT RULE` | Email и phone — необязательные поля профиля с privacy settings, никогда не registration credentials. Username/slug также профильный публичный идентификатор. |
| PR-03 | `OWNER FAILED` | Profile edit не объяснял invalid fields и не сохранял ожидаемо. Inline validation, field-specific error, immediate save/debounce и visible saved/failed state. |
| PR-04 | `PARTIAL` | Avatar upload/edit/compression code добавлялся, но owner acceptance отсутствует. Нужны crop/orientation/compression/size limits и encrypted/private storage policy. |
| PR-05 | `OWNER FAILED` | Settings дублировались и были распределены нелогично. Appearance и Open on launch находятся в Application Settings; Security/Data/Plan имеют один понятный entry каждый. |
| PR-06 | `OWNER FAILED` | Security/GPS/settings cards ломались на mobile. Использовать единый row/card primitive, нормальную ширину текста и 44px controls. |
| PR-07 | `OWNER FAILED` | Status обновлялся с задержкой около 30 секунд и фактически был точкой в header. Нужны realtime/local events, queue items, operation duration, retry/error details и completed history. |
| PR-08 | `CONFIRMED PRODUCT RULE` | Полный diagnostic monitoring доступен только admin allowlist по user ID; безопасное агрегированное состояние sync/offline/error видно всем. Не показывать keys/PIN/GPS/private metadata. |
| PR-09 | `OPEN` | Сообщение «Не удалось сохранить. Изменения остались в форме» должно быть привязано к конкретной операции или удалено. Global stale error не допускается. |

## 8. PIN и emergency data removal

Текущий кандидат `d753076` / `pin-flow-20261106-1` опубликован: [разбор и evidence](PIN-FLOW-2026-11-06.md). Стабильный lock form, полная N-я точка, recovery link, skeleton вместо промежуточного Welcome, единый deadline и trusted local key grace, четыре emergency setup шага. `READY FOR OWNER REVIEW`; hardware screen-off/keyboard/PWA и приватная production-проверка — `NOT RUN`. PIN-10/AR-03 остаются `BLOCKED`, emergency activation выключена. Предыдущие `OWNER FAILED` не закрыты автоматически.

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| PIN-01 | `OWNER FAILED` | PIN выглядел как обычный text input и keypad не открывался автоматически. Нужен современный passcode screen с dots и numeric keyboard сразу при открытии. |
| PIN-02 | `OWNER FAILED` | Быстрый набор терял цифры. PR #54 с очередью полных частей без таймеров и дублирующей keypad опубликован как `pr54-pin-20261106-1`; обычный PIN — `READY FOR OWNER REVIEW` на `/profile/security`. Приёмки на реальном телефоне ещё нет. Аварийное удаление остаётся `BLOCKED` из-за backup-контракта. |
| PIN-03 | `CONFIRMED PRODUCT RULE` | Normal PIN: 4–6 цифр. Emergency PIN: ровно 2N цифр, состоящий из двух последовательных половин по N. Нельзя включить emergency без normal; половины могут совпадать друг с другом, но ни одна не равна normal. Старые PIN разрешены для миграции без потери доступа. |
| PIN-04 | `CONFIRMED PRODUCT RULE` | Один и тот же визуальный экран вводит normal и emergency PIN; наблюдатель не видит, какой тип вводит пользователь. Никакого mode switch. |
| PIN-05 | `CONFIRMED PRODUCT RULE` | После каждых N цифр поле очищается сразу без таймера. Correct normal открывает приложение. Correct emergency half 1 скрыто ждёт half 2. Correct half 2 активирует подписанный emergency intent. Wrong half — неверная попытка; экран не раскрывает режим. Для старых несовместимых записей допустима ручная миграционная проверка. |
| PIN-06 | `OPEN` | При запуске focus/keypad открываются автоматически. Нет служебного текста про PB1/reset; только passcode и действие recover/switch account by Recovery Key. |
| PIN-07 | `OPEN` | Настройка require PIN: immediately, 10s, 30s, 1m, 5m (точный набор подтвердить в UI). Background/lock timing должен быть monotonic и тестироваться. |
| PIN-08 | `CONFIRMED PRODUCT RULE` | После 5 неверных попыток обычный вход блокируется на 20 минут; после истечения времени начинается новое окно попыток. Экран остаётся, аварийный PIN продолжает приниматься. Забытый normal PIN можно сбросить через подтверждённый Recovery Key. |
| PIN-09 | `CONFIRMED PRODUCT RULE` | Отдельный Local Delete PIN удалить. Остаются App PIN и один Emergency PIN удаления данных с телефона. |
| PIN-10 | `BLOCKED` | Аварийный PIN — PIN УНИЧТОЖЕНИЯ ДАННЫХ, не запасной вход. После двух правильных половин сначала локальная очистка, затем удаление live cloud data; независимый подтверждённый backup (если есть) должен сохраниться для Recovery Key. При отсутствии backup удаление безвозвратно — это явно подтверждается при настройке. На текущем backend AccountLifecycle удаляет аккаунт, recovery bundles и всю облачную фотоподсистему: backup-aware deletion/recovery пока НЕ реализованы, production acceptance заблокирована. |
| PIN-11 | `OPEN` | После установки PIN UI ясно показывает enabled/changed/disabled; не оставляет обрезанные cards и непонятный status. |

## 9. Тарифы, backups и Web3 payments

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| PAY-01 | `PARTIAL` | UI/catalog/provider abstraction существует, но payment checkout, invoice confirmation, webhook, entitlement и expiry отсутствуют. |
| PAY-02 | `CONFIRMED PRODUCT RULE` | Планы и функции берутся из раздела SaaS Tariffs в `ts_and_ux.md`; формулировки должны быть человеческими и полными, не «срок фото». |
| PAY-03 | `OPEN` | Матрица периодов: 1 month / 6 months / 1 year с явно показанной скидкой и effective monthly price. |
| PAY-04 | `CONFIRMED PRODUCT RULE` | Payment provider сменяемый; минимум DePay и NOWPayments через adapter, без привязки domain к одному оператору. Только Web3 flow. |
| PAY-05 | `OPEN` | TTL задаётся пользователем, но ограничивается тарифом. Если выбран срок 24h — применяется 24h; если «до конца плана/максимум» — действует доступный тарифный предел. Effective TTL фиксируется при capture. |
| PAY-06 | `OPEN` | Backup frequency/retention/restore и cloud preservation для emergency обязаны быть реальными entitlements, а не текстом на карточке. |
| PAY-07 | `OWNER FAILED` | Pricing page имела слишком мелкий шрифт и неверные формулировки. Сделать mobile-readable selection, feature list и sticky checkout action по примеру современных subscription screens. |

## 10. Архитектура, безопасность и release

| ID | Статус | Проблема / критерий |
| --- | --- | --- |
| AR-01 | `OPEN` | Два runtime создают путаницу. Сначала стабилизировать deployed vertical flows, затем по одному переносить в PB2 public use-cases; не делать третий rewrite. |
| AR-02 | `BLOCKED` | Production recipient reads/shared Browser остаются disabled до server ACL/trusted-time/adversarial tests. |
| AR-03 | `BLOCKED` | Broad Local Delete/Emergency не включать до data ownership inventory и восстановимого crash-safe процесса. |
| AR-04 | `OPEN` | Исправить PB2 P0 expiry cleanup: bounded tombstones, `photo_name_codes`, no indefinite photo linkage, late-ACK anti-resurrection. |
| AR-05 | `OPEN` | Убрать TTL-critical `Date.now()` из recipient/recovery paths в пользу trusted time. |
| AR-06 | `OPEN` | Разорвать runtime cycles и UI→infrastructure imports; выделить typed application commands/view-state до большого UI replacement. |
| AR-07 | `OPEN` | Уменьшить bundle и исключить Matrix/LiveKit из initial product runtime; они не должны замедлять Camera/navigation. |
| AR-08 | `NOT RUN` | Полный final-branch frontend/backend/PostgreSQL/Garage/Playwright pipeline после handoff commit не выполнялся. |
| AR-09 | `NOT RUN` | Real-device matrix: iPhone installed PWA update, permission deny/retry, offline/reload, storage full, clock rollback, expiry/revoke, two accounts. |
| AR-10 | `OPEN` | Backup/restore/rollback и воспроизводимый clean deploy должны быть задокументированы до release. |

## 11. Как закрывать пункт

Для каждого ID агент добавляет под строкой или в commit/PR handoff:

- commit SHA и затронутый runtime;
- воспроизведение до исправления;
- точное изменение поведения;
- targeted checks с PASS/FAIL/NOT RUN;
- production/mobile evidence без приватных данных;
- что именно подтвердил владелец.

Статус `OWNER FAILED` можно заменить на `ACCEPTED` только после повторной проверки владельца. Успешный Playwright сам по себе даёт максимум `IMPLEMENTED`/`CONFIRMED test`.
