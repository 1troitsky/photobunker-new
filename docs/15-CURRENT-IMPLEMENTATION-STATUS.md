# 15. Текущее состояние реализации

Дата среза: 2026-11-06. Этот документ заменяет разрозненные заявления о завершении этапов. Он не является release acceptance.

## 1. Обозначения

- `CONFIRMED` — проверено на указанном SHA/окружении.
- `IMPLEMENTED` — код существует, но результат не принят.
- `OWNER FAILED` — владелец воспроизвёл дефект на реальном устройстве после реализации.
- `PARTIAL` — неполный вертикальный сценарий.
- `BLOCKED` — намеренно выключено из-за безопасности.
- `NOT RUN` — проверка отсутствует.
- `ACCEPTED` — может поставить только владелец.

## 2. Версии и окружение

| Объект | Факт | Статус |
| --- | --- | --- |
| Рабочая ветка | `main`; handoff baseline `ac6e942` перенесён fast-forward | `CONFIRMED` локально 2026-11-06 |
| Implementation snapshot | `595be251ae092ae40cd2354bc910afa31ecc76e5` | `CONFIRMED` local Q1 implementation |
| Q1 dock source commit | `595ec85` на `main` и `origin/main` | `CONFIRMED` 2026-11-06 |
| Активный runtime | `compat/assignment-release/` | `CONFIRMED` |
| Production URL | `https://photobunker.duckdns.org` | `CONFIRMED` 2026-11-06 |
| Release marker | `browser-layout-20261106-1` | `CONFIRMED` production 2026-11-06 |
| Server HTTP/API health | root, health, ready возвращают 200 | `CONFIRMED` 2026-11-06 |
| Owner mobile acceptance | повторно выявлены критические UX/functional defects | `OWNER FAILED` |

## 3. Подтверждённые ограниченные результаты

1. Integration history и поздние незакоммиченные изменения сохранены в GitHub; secret `.env` не добавлен.
2. Исторический Colima production E2E 2026-11-04 проходил цепочку create/recover account → assignment → encrypted capture/offline retry → gallery/card/editor/browser/team. Это доказательство конкретной сборки и тестового контекста, но не текущей мобильной приёмки.
3. Исторические frontend checks: 61 Vitest files / 314 tests и production build проходили до поздних правок.
4. Исторические backend checks: 68 tests / 1329 assertions проходили на SQLite in-memory; реальные dev-data не удалялись.
5. Remote account origin был исправлен; после этого владелец смог войти и продолжить мобильное тестирование.
6. PWA release mechanism реализован: content-hashed assets, `release.json`, service-worker version, `no-store` для shell и безопасный reload без очистки IndexedDB/OPFS.

### Q1 evidence на implementation commit `595be25`

- `IMPLEMENTED`: mobile shell использует один `--dock-total-height` для workspace,
  dock и перекрывающих панелей; фон dock продолжается до нижнего края safe-area;
  подписи пяти пунктов остаются видимыми на 320 px; низкий landscape viewport
  больше не переключается на floating desktop dock.
- `CONFIRMED test`: `docker compose -f compat/assignment-release/compose.yaml exec -T web npm test`
  — 63 files / 320 tests, exit code 0.
- `CONFIRMED test`: targeted PWA/SW — 2 files / 7 tests, exit code 0.
- `CONFIRMED build`: `PHOTOBUNKER_RELEASE_ID=q1-dock-20261106-1 npm run build`
  в штатном web container, exit code 0; `release.json` содержит тот же marker.
- `CONFIRMED test`: Playwright MCP на локальном runtime — 320×700, 390×844,
  844×390 и 1440×900 без horizontal overflow; mobile dock заканчивается ровно
  на нижней границе viewport, touch targets 59 px. Assignments ↔ Contacts после
  загрузки переключались за 4.4–15.7 ms; это laboratory timing, не RUM.
- `FAIL`: `npm run localization:check` останавливается на существующем
  untranslated `q('Удалить цифру')` в `App.vue`; Q1 этот код не меняет.
- `NOT RUN`: Lighthouse CI — для Q1 нет сохранённого сопоставимого pre-change
  baseline и branch config; synthetic audit не подменяет latency private route.
- `CONFIRMED` production: static bundle опубликован в `/var/www/photobunker`,
  public `release.json` вернул `q1-dock-20261106-1`, public CSS/JS SHA-256
  совпали с локальным bundle; root/SW/release имеют `no-store`, health/ready — 200.
- `NOT RUN`: installed-PWA cross-release и реальный iPhone/Android safe-area.
  Статус остаётся ниже `ACCEPTED` до проверки владельца.

Ни один пункт выше не означает, что текущий интерфейс принят или что полный final-branch pipeline пройден.

### Q1 dock candidate 2026-11-06 (текущая правка, до owner acceptance)

Последняя проверка владельца release `-2`: `OWNER FAILED`, кнопки остались выше нижнего края. В `main@96c7fce` убран резерв `--dock-safe-bottom`; при сравнении с inset 34 px кнопки в локальном runtime опустились на 29 px, осталось 5 px padding. По прямой команде владельца опубликован `q1-dock-20261106-3` из main, без PR #54/#55. Публичные HTML/SW/release/CSS/JS совпали с build (`cmp -s`, exit 0), API health/ready — 200. Playwright MCP на production подтвердил новый marker и `--dock-safe-bottom: 0px`. Backup: `/var/www/photobunker/.local/backups/q1-dock-20261106-3-before/`. `READY FOR OWNER REVIEW`: закрыть/открыть установленную PWA и проверить низ дока на Assignments. Реальный телефон ещё не проверен агентом.

- `IMPLEMENTED`: убрана постоянная заливка Camera, все пять пунктов используют один outline icon style; активный раздел показывает тонкий верхний индикатор и `aria-current="page"` без отдельной карточки. На phone dock остаётся у нижней границы, подписи имеют 12 px и не обрезаются на 320/375/390 px.
- `CONFIRMED` baseline: 2026-11-06 03:25:39 Asia/Tbilisi, `/assignments`, 320×700. До правки Camera была залита акцентом вне своего маршрута, активный пункт имел pill, подписи были 10 px. Снимки [до](evidence/q1-dock-20261106/before-assignments-320x700.png), [после](evidence/q1-dock-20261106/after-assignments-320x700.png) и [светлая тема](evidence/q1-dock-20261106/after-camera-light-390x844.png).
- `CONFIRMED test`: Playwright MCP на локальном Vue runtime с временным in-memory fixture (без создания аккаунта): 320×700, 375×812, 390×844, 844×390 и 1440×900; на phone нижняя граница dock совпадает с viewport, все targets ≥59 px по высоте, нет horizontal overflow/обрезанных labels; Assignments → Contacts → Camera сохраняет геометрию и единственный active state. Light/dark и клавиатурный focus проверены.
- `CONFIRMED test`: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8081 PLAYWRIGHT_COMPAT_URL=http://127.0.0.1:8081 ./node_modules/.bin/playwright test tests/e2e/compat-dock.spec.mjs --project=chromium` — 1 test PASS, exit 0; включая `prefers-reduced-motion: reduce`.
- `CONFIRMED test`: `docker compose -f compat/assignment-release/compose.yaml exec -T web npm test -- tests/app.test.ts tests/pwa-update.test.ts tests/service-worker.test.ts` — 3 files / 13 tests PASS, exit 0.
- `CONFIRMED build`: `docker compose -f compat/assignment-release/compose.yaml exec -T -e PHOTOBUNKER_RELEASE_ID=q1-dock-20261106-2 web npm run build` — exit 0; local `dist/release.json` содержит новый marker.
- `CONFIRMED production`: static bundle из `595ec85` опубликован в `/var/www/photobunker/apps/web/dist`; прежние файлы shell и два исходника сохранены в `/var/www/photobunker/.local/backups/q1-dock-20261106-2-before/`. Новые immutable assets загружены до `index.html`, `sw.js` и последним `release.json`; `rsync -rcn --itemize-changes` для assets — пустой diff, exit 0. Публичные `index.html`, `sw.js`, `release.json`, CSS и JS побайтно совпали с локальным build (`cmp -s`, exit 0); marker — `q1-dock-20261106-2`. Root/SW/release — HTTP 200 и `no-store`, CSS — HTTP 200 и `immutable`; `/api/v1/health` — `ok`, `/api/v1/ready` — `ready`. Playwright MCP открыл публичный `/welcome` и получил тот же marker; ответ 401 от `/api/v1/identity/me` ожидаем для гостя.
- `CONFIRMED` размер CSS в сопоставимом формате: публичный `index-TYbynOX6.css` прежнего release и новый `index-CU41a-Pv.css`, `gzip -n -c | wc -c` — 29 940 → 29 987 bytes (+47). Это размер transfer artifact, не Lighthouse latency или RUM.
- `NOT RUN`: Lighthouse CI — нет установленного `lhci`/конфигурации и сопоставимого baseline для приватного маршрута; CSS-only изменение не доказывает улучшение latency. Реальный iPhone/Android и installed-PWA upgrade также `NOT RUN`.
- Локальный API `/api/v1/ready` отвечает 500 (`require_once(/index.php)`), поэтому fixture подтверждает только визуальное поведение dock; server auth/data flows им не проверены. Статус owner mobile acceptance остаётся `OWNER FAILED`.
- `NOT RUN` owner acceptance: на реальном телефоне закрыть и снова открыть установленную PWA, убедиться, что release обновился без удаления локальных данных; открыть Assignments → Contacts → Camera и проверить dock у нижней safe-area, читаемые подписи, ровно один активный пункт и отсутствие скачка. До ответа владельца Q1 не считать `ACCEPTED`.

## 4. Код существует, но приёмка не пройдена

Последнее решение владельца: фотографии стали открываться, но расположение controls, большой служебный блок, Tree внутри папки и перекрывающая панель PhotoView — `OWNER FAILED`. По его команде проведён [повторный аудит с причинами и снимками](BROWSER-AUDIT-2026-11-06.md#повторный-аудит-по-замечаниям-владельца). `d5acff3` опубликован как `browser-layout-20261106-1`: четыре header actions, View/Sort в settings, краткий путь, текущий узел Tree, обычная прокручиваемая панель фото, сохранение folder+assignment при перелистывании, защита от всплывающих стрелок и Retry вместо пустого stage. `READY FOR OWNER REVIEW`, не `ACCEPTED`. Production build — exit 0; [публичная сверка](evidence/browser-layout-20261106/deploy.json) — exit 0, health/ready 200, новый marker получен production Playwright. Приватный production Browser в гостевом контексте не проверялся; hardware/PWA upgrade и реальные bytes/edit/share этой итерации — `NOT RUN`. Проверка владельца: шапка Browser → Settings → Tree → вложенная папка → фото → прокрутить до действий и убедиться, что панель не перекрывает изображение/данные. Backup: `/var/www/photobunker/.local/backups/browser-layout-20261106-1-before/`.

Владелец отклонил PR #55: `OWNER FAILED`. PR и follow-up отменены `da33e7c`, восстановлен web source до #55 (`f81c2da`) с PIN #54. Откат опубликован как `browser-rollback-20261106-1`; публичные HTML/SW/release/JS/CSS совпали с build, exit 0. [Аудит восстановленного Browser](BROWSER-AUDIT-2026-11-06.md) содержит source links, реальные screenshots синтетического сценария и измерения.

После согласования аудита владелец поручил исправление. Новый native Browser (`56d91ad`, `main`/`origin/main`) опубликован как `browser-native-20261106-1`: четыре раздела, единая scoped-модель, реальные раскрытия Tree, history, действия по capability, локальные папки независимо от HTTP и видимый mobile expiry. Статус — `READY FOR OWNER REVIEW`, не `ACCEPTED`; прежние жалобы владельца не закрыты автоматически. [Результаты и screenshots](BROWSER-AUDIT-2026-11-06.md#решение-владельца-и-реализация), [публичная сверка](evidence/browser-native-20261106/deploy.json). Production build и целевые organizer/scope tests — exit 0; public shell/Browser/photo/card bundles совпадают с build, health/ready — 200, no-store/immutable подтверждены. Гостевой Playwright открыл production и получил ожидаемый вход без identity (401); приватный Browser на production не подменялся fixture. Backup: `/var/www/photobunker/.local/backups/browser-native-20261106-1-before/`. Реальные фото/original/edit/share, destructive delete, iOS/Android/PWA upgrade — `NOT RUN`. Проверка владельца: Browser → своё задание → папка → Back; Tree; expiry; меню фото; личное фото Archive → Restore. Архив только локальный и не меняет TTL.

PR #54 интегрирован в main (`b701503`) и опубликован по прямой команде владельца с защитой аварийного удаления (`7eee94e`), release `pr54-pin-20261106-1`. Публичные HTML/SW/release/CSS/JS побайтно совпали с build, health/ready — 200. Обычный PIN 4–6 цифр, последовательный ввод без таймеров и второй keypad доступны на `/profile/security`; существующие legacy PIN сохранены. Аварийная настройка, trigger, replay и отправка cloud command явно заблокированы до доказательства сохранения backup. `READY FOR OWNER REVIEW` для обычного PIN; emergency — `BLOCKED`. Backup deploy: `/var/www/photobunker/.local/backups/pr54-pin-20261106-1-before/`. Владелец также отклонил dock release `-3`; Q1 остаётся `OWNER FAILED`.

| Область | Что добавлено в код | Фактический статус |
| --- | --- | --- |
| Shell/Dock | fixed shell CSS, dock marker, PWA updater | `IMPLEMENTED`, новый результат не подтверждён владельцем |
| PIN | `PasscodeInput.vue`, обновлённые lock/emergency rules | `OWNER FAILED`: быстрый ввод теряет цифры, UX не принят |
| Browser / PhotoView layout | compact controls и Tree context `d5acff3`, release `browser-layout-20261106-1` | `READY FOR OWNER REVIEW`; замечания к прежнему UI — `OWNER FAILED`, новая версия не принята |
| Photo read/cache | encrypted `photo-cache.ts`, view/card/editor правки | `OWNER FAILED`: фото не открывались |
| Camera/GPS | permission/location/context и camera UI правки | `OWNER FAILED`: размер/permissions/GPS/navigation остаются неверными |
| Status | status store/view/route | `OWNER FAILED`: нет понятного realtime monitoring |
| Payments | tariff catalog/providers/UI shell | `PARTIAL`: реального Web3 checkout/entitlements нет |
| People | объединяющий People screen и Team/Contacts правки | `PARTIAL`: поиск/создание/cancel/membership требуют исправления |
| Identity display | 8-digit user number migration/display code | `IMPLEMENTED`: migration/deployed-data acceptance не доказаны |
| Profile/avatar | edit/profile/image правки | `PARTIAL`: owner acceptance отсутствует |
| Assignment forms | dates/team/preset/rules UI правки | `PARTIAL`: несколько сценариев владелец воспроизвёл как сломанные |

## 5. Архитектурное состояние

### Текущий deployed compatibility runtime

Он обеспечивает видимый продукт и является единственным практическим продолжением текущего server state, но наследует монолитные Vue/Laravel модули и не соответствует полностью целевым границам domain/application/infrastructure/ui.

### Корневой PB2 runtime

В нём присутствуют Identity, encrypted local storage, Camera, Gallery/S3, Assignments, Teams, editor и security groundwork. Аудит 2026-11-04 выявил:

- пять runtime dependency cycles;
- UI → infrastructure imports и workflows внутри Vue;
- широкие barrels, экспортирующие DB/HTTP/crypto adapters;
- крупные `LocalPhotoVault` и identity services;
- Laravel controllers с business logic;
- P0 бессрочные photo-related tombstone/name rows;
- TTL-critical recipient/recovery paths на `Date.now()`;
- assignment permission toggles без полной server enforcement;
- production recipient reads disabled;
- Local Delete/Emergency safety-blocked.

Нельзя выдавать это дерево за готовую замену deployed runtime. Миграция должна идти вертикальными сценариями с сохранением данных и owner acceptance.

## 6. Что точно не завершено

- Профессиональный Browser с классической файловой моделью.
- Стабильная мгновенная mobile navigation/local-first shell.
- Принятый dock/safe-area/PWA update UX.
- Надёжное открытие Photo/Card/Editor на production mobile.
- Assignment-isolated photo browsing и capture для любого assignment.
- Полные Camera presets и assignment-level image logo.
- Единый быстрый normal/emergency PIN UX и lock timing settings.
- Полный realtime Status/diagnostics.
- Contacts search и Team workflow через contacts.
- Web3 payment provider integration, entitlements, backups и квоты.
- Полная карта тарифов/скидок и утверждённое TTL enforcement.
- Real-device security/offline/storage-full/permission-denied matrix.
- Backup/restore/rollback/release acceptance.

Детальные критерии находятся в `docs/16-OPEN-PROBLEMS-AND-QUICK-TASKS.md`.
