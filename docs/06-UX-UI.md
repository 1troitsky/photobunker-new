# 06. UI / UX и производительность

**Цель:** законченный installable mobile-first PWA и полноценный desktop, а не набор API-форм и демонстрационные картинки. Конкретный visual design утверждает владелец. Прототип может использовать тестовые данные **только явно помеченные UI fixtures**, не подменяя production функции.

## 1. Основная навигация

Первый релиз: **Фото**, **Камера**, **Задания**, **Photo Browser**, **Профиль/Настройки**. Editor — из просмотра выбранного фото; Photo Card — отдельная кнопка и отдельный маршрут. Security/PIN — из настроек. Никакой вкладки Messenger/Calls, никакой скрытой Matrix-инициализации.

Рабочая область не должна перезапускаться при обычном переключении разделов. Camera permission и видоискатель не должны ждать загрузки заданий/профиля/API; шифрующая фиксация может честно требовать разблокированный ключ — понятная ошибка с действием, не бесконечный spinner.

## 2. Обязательные состояния для каждого экрана

`ready/local-pending/syncing/synced/conflict/failed/locked/denied/offline/expired` там, где применимо. Навигация сразу рисует shell + последнее разрешённое локальное состояние; данные **не выдумываются**. Не показывать «загружено на сервер» без server ACK; «сохранено на устройстве» только после durable encrypted commit.

При storage quota/нет разрешения камеры/доступ отозван/нет ключа: короткая ошибка, причина на языке пользователя, понятное действие; без сброса данных или требования перерегистрации.

## 3. Критические пути

- Capture: открыть видоискатель → снять → encrypted local save → увидеть во внутренней галерее → offline/reload → sync indicator; фото не появляется в системной Photos.
- Assignment: создать → добавить/пригласить участников → выбрать режим 2/3; режим 1 виден, но disabled и пояснён → snapshot policy → снять в задании → проверить права и состояние.
- Photo Editor: открыть → text/draw/shape/fill/crop/etc по scope → сохранить с режимом storage → понять, сохранился ли исходник отдельно → reopen/offline → получить верный результат.
- Photo Card: отдельная кнопка; title/NAME-ID fallback, описание по правам, expires, карты только с opt-in, набор scopes Card/photo/original/download/metadata.
- Photo Browser: дерево «Задания → Фото», Grid/List/Tree, поиск и сортировка; ссылка ничего не открывает без текущего grant; download/ZIP только по разрешённому scope (отдельный roadmap gate).
- PIN: раздельные настройки lock/local delete/emergency, понятные последствия, crash/retry/status не раскрывают секреты.

## 4. Responsive и visual design

Mobile 320px+, tablet, desktop 1440px+; touch targets не менее 44x44 CSS pixels как guideline, safe areas, keyboard/viewport, тёмная/светлая тема, авто/ручной выбор, accessibility keyboard & screenreader, color contrast, reduced motion. RU/EN обязательно; English fallback и отсутствие hardcoded user-facing strings.

Дизайн-система: tokens, типографика, цвета, spacing, form, buttons, lists, cards, dialogs, skeletons, overlays, feedback; повторяемые UI primitives с snapshot/visual regression. Никаких многочисленных разноцветных «админских» экранов как подмены продукта. Макеты пяти основных экранов и целевые UX сценарии владелец утверждает **до интеграции сложных операций**, но визуальное утверждение не отменяет production E2E.

## 5. Performance budgets (предложения — измерить и утвердить на baseline device)

- Shell и локально доступный экран: цель визуального отклика в пределах 150 ms после действия, без сетевого await.
- Навигация между уже загруженными экранами: цель <= 100–200 ms до first meaningful UI (не дожидаться sync).
- Камера: разрешения и hardware startup зависят от ОС; замерять отдельно permission request / first frame / shutter / encrypted saved.
- Image grid: virtualization/pagination; thumbnails with bounded memory + storage budget; никаких full-resolution downloads ради списка.
- Web bundle: route split, no Matrix/RTC/unused SDK; performance regression проверять production build на медленном мобильном устройстве.

Все значения до выбора target устройства — **цели**, не факт и не SLA.

## 6. UX приёмка — до разработки всех функций

**Первая проверка владельца проходит после R2-02**: ChatGPT обеспечивает **production-сборку frontend в HTTPS preview** (не dev server), Codex независимо проверяет её запуск и сценарии, а затем владелец открывает готовую сборку. Владелец лично открывает её на телефоне/desktop, нажимает все основные разделы, проверяет скорость, адаптивность и взаимодействия. Fixture-only содержимое должно иметь явную маркировку — не изображать функционирующее сохранение, авторизацию или синхронизацию.

**Вторая проверка — после R2-06:** на том же типе production-сборки пользователь реально фотографирует, видит снимок в минимальном защищённом локальном просмотре, закрывает/открывает приложение, смотрит offline и проверяет отсутствие фото в системе Photos/DCIM. Это уже **настоящие пользовательские данные и encrypted local commit**, не UI fixtures; S3 ещё может отсутствовать.

Далее проверяются вехи заданий, S3/галереи, редактора, Card, Browser и PIN; полный порядок закреплён в [roadmap](08-ROADMAP.md). Негативное UX-review владельца на вехе блокирует переход к следующей зависимой пользовательской вехе. Не требовать личной проверки каждой мелкой Issue. Финальная mobile acceptance и release-gate остаются отдельными — ранняя проверка UI не доказывает E2EE или production readiness.
