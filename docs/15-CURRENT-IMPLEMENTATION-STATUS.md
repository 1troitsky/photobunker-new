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
| Handoff branch | `handoff/owner-agent-2026-11-06` | `CONFIRMED` |
| Implementation snapshot | `595be251ae092ae40cd2354bc910afa31ecc76e5` | `CONFIRMED` local Q1 implementation |
| Активный runtime | `compat/assignment-release/` | `CONFIRMED` |
| Production URL | `https://photobunker.duckdns.org` | `CONFIRMED` 2026-11-05 |
| Release marker | `q1-dock-20261106-1` | `CONFIRMED` production 2026-11-06 |
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

## 4. Код существует, но приёмка не пройдена

| Область | Что добавлено в код | Фактический статус |
| --- | --- | --- |
| Shell/Dock | fixed shell CSS, dock marker, PWA updater | `IMPLEMENTED`, новый результат не подтверждён владельцем |
| PIN | `PasscodeInput.vue`, обновлённые lock/emergency rules | `OWNER FAILED`: быстрый ввод теряет цифры, UX не принят |
| Browser | крупная правка `PhotoBrowserIndexView.vue`, folders/actions/cache | `OWNER FAILED`: модель и UI отклонены |
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
