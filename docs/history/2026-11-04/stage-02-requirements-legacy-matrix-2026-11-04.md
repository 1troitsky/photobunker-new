# Этап 2 — требования, аудит и legacy-сверка

Дата проверки: 2026-11-04
Новый репозиторий: `1troitsky/photobunker-new`
Проверенный implementation tip: `4491ee16478a0c3c6180f07379b790060a692e37` (`chatbot/pb2-g5-second-device-verification`)
Legacy: `1troitsky/photobunker@0c5062dde25fffbbb81447e42ace7fa6f412f8a1`, локальный `_old` использован только для чтения.
Статус документа: source/requirements audit. Это не runtime acceptance и не разрешение на merge.

## 1. Итог этапа

Текущая реализация — не пустой прототип: в ней есть новый PB2 Identity, encrypted local-first storage, Camera, Gallery, Garage sync, Assignments, Teams/Contacts, Editor, private Card/Browser, App Lock и несколько серьёзных security-механизмов. Однако целевое приложение ещё не собрано полностью.

Из 101 функции актуальной матрицы:

| Результат | Количество | Что означает |
| --- | ---: | --- |
| **G — готово по исходникам** | 34 | Сквозной код функции явно существует; это не означает acceptance финального tip. |
| **P — частично** | 34 | Есть UI, модель или часть сценария, но нет полного контракта, прав, UX или проверки. |
| **M — отсутствует** | 16 | Нативного PB2 сценария нет. |
| **B — safety-blocked** | 6 | Подготовительный код есть, но функция намеренно отключена или не имеет права на опасное действие. |
| **D — требуется решение владельца** | 8 | `visual-ux.md` конфликтует с утверждённым PB2 baseline либо описывает будущий продукт. |
| **X — сознательно исключено** | 3 | Не должно входить в текущий PB2 в указанном виде. |

Ни один из 101 пунктов нельзя считать окончательно `Verified/Accepted` на SHA `4491ee1`:

- точный SHA #42 `7b2e929` имеет успешный CI, PostgreSQL/Garage и two-browser E2EE;
- изменения #44–#53 после него не имеют Actions run;
- owner UX gate по R2-02 был явно провален и позднее не принят владельцем;
- реальных iOS/Android checks и общего production HTTPS acceptance нет.

## 2. Приоритет источников требований

При расхождении источников применён следующий порядок:

1. Прямые решения владельца в актуальной Issue.
2. `docs/11-IDENTITY-AND-KEYS.md`, `docs/12-CLIENT-STORAGE-AND-TRUSTED-TIME.md`, `docs/13-PRODUCT-ACCEPTANCE-BASELINE.md`.
3. Архитектура, storage, domain, security, UX, quality и operations из `docs/02`–`docs/10` и process rule `docs/14`.
4. `visual-ux.md` как дополнительная продуктовая и визуальная спецификация.
5. Legacy как read-only evidence, но не как нормативная архитектура.

Поэтому нельзя молча реализовывать из `visual-ux.md` следующие конфликтующие требования:

| Конфликт | Нормативный PB2 результат |
| --- | --- |
| TTL `Never`, 60 дней, unlimited | Каждый снимок обязан иметь TTL от 24 часов до 45 дней. |
| Отдельная постоянная 80px thumbnail/preview-модель | Одна encrypted WebP thumbnail, максимум 320px; постоянного preview нет. |
| Email/phone/username/password как credential | Единственный Recovery Key, trusted-device signatures; профильные поля не являются credential. |
| Matrix/Signal/Calls внутри текущего приложения | Matrix/RTC исключены из initial PB2 и не должны блокировать Camera/Identity. |
| Тарифы и выбор S3/IPFS как уже утверждённая функция | Это будущие продуктовые решения; billing/entitlement engine отсутствует. |

## 3. Последний legacy-аудит: что нельзя повторять

Полностью прочитаны `_old/docs/AUDIT-20261028.md` и `_old/docs/CHECKLIST.md`. P0-выводы подтверждены реальным legacy-кодом:

1. **Production Camera была фактически отключена.** `apps/web/src/local/photos.ts` включает plaintext prototype через `import.meta.env.DEV || VITE_LOCAL_PROTOTYPE`; Camera смешивает encrypted и prototype paths. Простое включение старого флага в production недопустимо.
2. **Camera зависела от удалённых подсистем.** Старый startup ожидал Identity/Profile/Assignments/Studio/Matrix-связанные initializers, поэтому основной локальный сценарий мог не открыться из-за сети или messaging.
3. **Compose запускал Vite dev server.** Старый `compose.yaml` использует `npm run dev`, содержит Matrix и OrbStack labels; это не production proof и не шаблон для Colima один к одному.
4. **Identity был связан с Matrix и старым photo protocol.** `identity/onboarding.ts`, `messaging-setup.ts`, `setup.ts`, `store.ts` объединяют аккаунт, PB1/PB4 recovery и messaging bootstrap.
5. **Старое local storage содержало plaintext prototype.** `local/photos.ts` хранит `originals` и `thumbnails` отдельно и прямо помечено как unencrypted prototype.
6. **Trusted time был недостаточно строгим.** `crypto/time.ts` использует `Math.max(Date.now(), ...)`; `delivery/clock.ts` хранит anchor в `localStorage` и после reload продолжает зависеть от wall clock.
7. **Галерея имела лишнюю постоянную модель.** Legacy хранит `original/preview/thumbnail`, включая JPEG 480px и restricted 80px, что противоречит PB2 storage baseline.
8. **Права частично вычислялись на клиенте.** `workspace/access.ts` и `collaboration/access.ts` полезны как отрицательные test vectors, но не могут быть источником ACL.
9. **Крупные views/stores были монолитными.** Например, CameraView — 1255 строк, PhotoView — 1023, PhotoEditView — 899, `crypto/photos.ts` — 1706; переносить их целиком нельзя.
10. **Release evidence отсутствовал.** Legacy тестировался преимущественно в dev, без надёжной production/device acceptance.

## 4. Что из legacy действительно пригодно

### REUSE без изменения смысла

- Owner assets: favicon/PWA images и Welcome logo. SHA-1 legacy assets совпадает с текущими файлами PB2:
  - `favicon.ico` — `a95cf27331300d61f05c0334c559e5e88d08e3b2`;
  - `favicon-96x96.png` — `7033e5c1d736a9e45b0ea6c43edb9d67070c8824`;
  - `apple-touch-icon.png` — `cd09d2d81ece8b5559724a1002e7df3d9c61f0d3`;
  - 192/512 PWA images — `1770c6...` / `eb374c...`;
  - Welcome logo — `52710bfe57bd446f09cdfd9e635e9ac06c483c44`.
- S3 private-disk invariants и storage probe: bounded timeouts, PUT/HEAD/GET/DELETE, anonymous denial и cleanup verification.
- NAME-ID format/test vectors и server-serialized lease allocation.
- Object URL revoke-on-change/unmount pattern.

### ADAPT в новые модули

- Camera controller lifecycle, late permission cancellation, `ImageCapture` fallback, feature checks и track cleanup.
- Strict IDB completion/abort/versionchange/durability patterns.
- Lost-ACK, bounded backoff, idempotent retry и expired-never-uploads test scenarios.
- GPS permission lifecycle, freshness/accuracy and generation guards.
- Editor geometry, canvas compositing, normalized coordinates, transient undo/redo.
- Card scope ideas: Card/photo/original/download/metadata независимы; fragment secret удаляется из URL; revoke/TTL проверяются на каждом read.
- Browser projection/cache/download ideas: минимальный encrypted cache, no notes/GPS/original in collection projection, per-item authorization, safe names, re-encode without EXIF, bounded ZIP.
- App Lock/PIN attempt counters, cross-tab atomicity, cooldown and rollback detection — только после независимой security-проверки.

### REJECT

- PB1/PB4 formats, account fingerprint lookup и old Matrix recovery package.
- Matrix, Chatify, RTC/LiveKit, message bootstrap and presence as Camera/Identity dependencies.
- Plaintext prototype DB and `VITE_LOCAL_PROTOTYPE` production path.
- Whole legacy `App.vue`, router, startup watchers, giant stores/views and full `compose.yaml`.
- Old `original/preview/thumbnail` persistence and 80/480px JPEG thumbnail behavior.
- Client-side grants as security authority.
- Permanent editor version history until an explicit product decision.
- Any email/password/reset identity flow.

## 5. Проверка Issue-scoped Legacy evidence

### Issues с evidence

Evidence присутствует только в Issues #3–#12. Проверены все перечисленные пути в `_old`:

- 131 ссылочное упоминание;
- 113 уникальных явно записанных путей плюс sibling paths, сокращённые в тексте (`AccountSecurityView.vue`, `onboarding.ts`, `messaging-setup.ts`, `setup.ts`), и legacy `compose.yaml`;
- все пути существуют на legacy SHA `0c5062d`;
- бинарные assets проверены по размеру, формату и SHA-1;
- крупные исходники проверены по заявленным state machines, security boundaries, storage behavior и отрицательным patterns.

| Issue | Evidence | Фактический вывод |
| --- | --- | --- |
| #3 UI Foundation | Есть | Assets пригодны; shell patterns — reference; old App/router/runtime rejected. |
| #4 Identity | Есть | P-256/challenge/CAS ideas пригодны; PB1/PB4/Matrix coupling rejected. |
| #5 Local storage/time | Есть | IDB/crypto framing ideas пригодны; old trusted-time algorithms rejected. |
| #6 S3 sync/TTL | Есть | Retry/readback/cleanup patterns пригодны; monolithic controller/schema rejected. |
| #7 Camera | Есть | Lifecycle/fallback/tests пригодны; plaintext demo and legacy thumbnail rejected. |
| #8 Gallery/NAME-ID/GPS | Есть | NAME-ID/GPS/object URL logic пригодны; old three-image model rejected. |
| #9 Assignments | Есть | CRUD/CAS/dirty-state UI пригодны; old Workspace plaintext/global state rejected. |
| #10 Teams | Есть | Invitations/roles UX and negative ACL tests пригодны; membership не даёт Photo access. |
| #11 Assignment capture | Есть | Review states and server checks useful; client access calculations rejected. |
| #12 Editor | Есть | Render/geometry/pointer behavior useful; permanent history and Workspace grants rejected. |

### Issues без evidence

В Issues #13–#26 раздел `Legacy evidence` отсутствует. Комментариев с таким evidence тоже нет. Это нарушение обязательного процесса из `AGENTS.md`. В рамках этапа 2 выполнен read-only narrow check, но GitHub Issues не изменялись.

| Issue | Narrow legacy check | Результат для PB2 |
| --- | --- | --- |
| #13 Notes | `Photo.note` встроен в Photo/manifest; отдельного `PhotoNote`/`AssignmentNote` нет | Не переносить встроенное поле как новую сущность; спроектировать Notes заново. |
| #14 Card | `PhotoCardView.vue`, `private-photo-card.ts`, `photo-card.test.ts` | Адаптировать projection/scopes/TTL; не переносить Workspace types. |
| #15 Shares | `SharedCardView.vue`, `crypto/card-shares.ts`, outbox, API controller, tests | Использовать scope/revoke/fragment/privacy test vectors, переписать под PB2. |
| #16 Browser collection | `PhotoBrowserView.vue`, `photo-browser/model.ts`, encrypted cache | Полезен минимальный projection; authorization остаётся серверным. |
| #17 Browser UX | legacy Browser/Gallery views | Использовать layout/search/tree ideas, не старые stores. |
| #18 Downloads | `photo-browser/download.ts`, `zip.ts` | Хорошие bounded ZIP, re-encode/no-EXIF and cleanup patterns. |
| #19 App Lock | `app/lock.ts`, `pin-store.ts`, AccountSecurity UI/tests | Адаптировать attempt/cooldown/cross-tab; PIN не является disk encryption. |
| #20 Local Delete | `local-delete-*` modules | Только test/state-machine reference; old flow связан с PB1/Matrix и broad stores. |
| #21 Emergency | `emergency-*` modules | Signed intent/journal ideas полезны; старую wipe authority не переносить. |
| #22 UX polish | Welcome/Settings/preferences/theme/assets | Visual reference; owner gate всё равно обязателен. |
| #23 Geo | `profiles/location.ts`, `PrivateLocationMap.vue` | Adapt permission lifecycle/private local map; no silent third-party disclosure. |
| #24 Security/chaos | legacy audit, retention/storage/photo/ACL tests and browser spikes | Использовать как fault matrix, не как proof PB2. |
| #25 Deploy | `compose.yaml` и operations docs | Dev-only, Matrix/OrbStack-coupled; не использовать как production/Colima template. |
| #26 Recommendations/avatars | stable initials/colors exist mainly in Messenger; Team placeholders/icons exist | Messenger code rejected; safe local placeholder algorithm можно выделить независимо. |

До кода по #13–#26 evidence должен быть добавлен именно в соответствующие Issues.

## 6. Актуальная 101-функциональная матрица

Легенда: **G** — готово по исходникам; **P** — частично; **M** — отсутствует; **B** — safety-blocked; **D** — решение владельца; **X** — исключено. `G` не означает final-tip PASS.

### Shell — 7

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| SH01 | Dock основных разделов | P | Работает Assignments/Browser/Camera/Photos/Profile; Contacts/Teams доступны маршрутами, но owner navigation decision не закрыт. |
| SH02 | Header и круглые действия | P | Компоненты есть, но owner visual acceptance провален. |
| SH03 | Context actions/submenus | P | Actions есть на отдельных экранах; единая система контекстного меню неполна. |
| SH04 | One-origin PWA, nonblocking shell | G | Router открывает shell без HTTP; production smoke прошёл на #42, финальный tip не запускался. |
| SH05 | Выбор стартового раздела | G | #44 хранит allowlisted device preference и открывает Camera/Assignments/Browser/Photos. |
| SH06 | Auto/Light/Dark | P | Light/Dark есть, system Auto нет. |
| SH07 | Языки | G | Нормативные RU/EN есть; UA/PL/TR/KA из visual spec требуют отдельного решения. |

### Welcome — 3

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| WE01 | Anonymous Create/Restore | G | Native PB2 key-only flow существует; PB1 keys намеренно несовместимы. |
| WE02 | Product carousel | P | Ручная презентация есть; autoplay/reduced-motion owner UX не принят. |
| WE03 | Local session restore | P | Local bootstrap есть, но cold/offline real-device final-tip acceptance отсутствует. |

### Assignments — 22

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| AS01 | CRUD/search/detail/duplicate/delete | G | Encrypted local repository, outbox, API/CAS и UI присутствуют. |
| AS02 | Active/Archive/All | G | Отдельный encrypted archive action и три фильтра есть; выбранный фильтр не сохраняется. |
| AS03 | Sort create/edit/latest photo | G | Все три сортировки добавлены; latest-photo локальный/on-demand. |
| AS04 | Name/status/description/dates | G | Пять статусов и private start/finish fields существуют. |
| AS05 | Target count/progress | G | 1–9999, local count и отдельный server-confirmed receipt count. |
| AS06 | Start → Camera, frozen policy | P | Mode/TTL/GPS/dates/description/tags/NAME-ID frozen; edit/delete/browse permissions не server-authoritative. |
| AS07 | Assignment photos in permitted Browser | P | Owner-local assignment folder есть; shared server-backed Browser collection отсутствует. |
| AS08 | Role-enforced status change | P | State machine/CAS есть; полный Team role binding не завершён. |
| AS09 | Start now/finish date | G | Private dates валидируются и отображаются. |
| AS10 | Separate camera instructions | G | Отдельное encrypted поле и показ в Camera есть. |
| AS11 | Shared Camera preset | P | Есть preset label и copy-from-assignment template; отдельного versioned preset repository нет. |
| AS12 | Team/contacts/participants | P | Teams/grants существуют отдельно; нет единой assignment participant form со всеми источниками. |
| AS13 | Owner/Curator/Contributor/Viewer | P | Roles/grants есть, но effective photo permissions ещё не полны. |
| AS14 | Assignment-scoped NAME-ID | G | Отдельные prefix ranges/leases и explicit disable реализованы. |
| AS15 | Required tags/whitelist | G | Frozen capture validation и encrypted photo annotation есть; recipient/server policy остаётся ограниченной. |
| AS16 | Required description/min length | G | Capture validation и encrypted metadata есть. |
| AS17 | Edit/keep-original policy | P | Поля есть, но сервер предупреждает, что participant restrictions ещё не активны. |
| AS18 | Assignment delete permission | P | Поле есть, но server enforcement отсутствует; Local Delete — отдельный механизм. |
| AS19 | Participant browse/thumbnail | B | E2EE thumbnail flow протестирован только в isolated test env; production flag выключен. 80px legacy default отклонён. |
| AS20 | Sharing policy | P | Signed grant/revoke есть; полная role policy и production enablement отсутствуют. |
| AS21 | Archive/delete/duplicate lifecycle | G | Все три действия разделены, archive подписан отдельно. |
| AS22 | Progress from receipts | G | Owner-only server endpoint считает только active finalized unexpired records. |

### Camera — 14

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| CA01 | Real camera/front/back/assignment | G | Native controller и assignment selector есть; real-phone acceptance нет. |
| CA02 | Preset CRUD/archive | M | Отдельного PB2 preset repository/UI нет. |
| CA03 | Preset name/description | M | `capturePreset` — строковый hint, не сущность. |
| CA04 | Resolution profiles/custom | P | Fixed compression v1 и safe bounds есть; пользовательских profiles нет. |
| CA05 | Ratio presets/custom | M | Нет capture ratio policy. |
| CA06 | Metadata toggles | P | GPS/time metadata есть; per-preset toggles отсутствуют. |
| CA07 | Required GPS accuracy/time | P | Required GPS/date window есть; полный configurable accuracy/freshness contract отсутствует. |
| CA08 | Never/hour/60d/custom TTL | D | Текущий PB2 правильно ограничивает 1–45 days; visual spec конфликтует с baseline. |
| CA09 | Mode 1 raw bytes | X | Намеренно disabled до доказуемой поддержки camera bytes. |
| CA10 | Mode 2 original+edit, mode 3 replace | G | Crash-safe edit paths и reopen tests есть на #42; финальный E2E не выполнялся. |
| CA11 | Encrypt first/offline/S3 later | G | Local ciphertext/outbox/Garage pipeline существует и прошёл #42 integration. |
| CA12 | NAME-ID/offline allocation | G | Personal и assignment scopes разделены. |
| CA13 | Persistent default preset | M | Startup section существует, camera preset — нет. |
| CA14 | No system gallery write | P | Код использует in-app encrypted storage, но OS-level phone check не выполнен. |

### Browser / Gallery / Card — 21

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| BR01 | All/My/Assignments/Archive filters | P | All/personal/assignment folders есть; archive/shared All отсутствуют. |
| BR02 | Search title/NAME-ID/tags | P | Title/NAME-ID есть; tags в Browser index отсутствуют. |
| BR03 | Tree/List/Grid | G | #46 добавляет все три owner-local views. |
| BR04 | Folder tiles/covers/dates | M | Есть sidebar/tree counts, но нет 4-cover folder tiles. |
| BR05 | Own + assigned scoped photos | B | Owner Browser local-only; recipient path ограничен thumbnail и production-disabled. |
| BR06 | Open permitted full photo | P | Owner viewer работает; recipient full-photo permission не реализован. |
| BR07 | Capture/edit/delete dates/title/tags | P | Capture/expiry/title частично; edit/delete dates/tags неполны. |
| BR08 | Tag taxonomy CRUD/apply | M | Assignment allowed tags не заменяют tag-management feature. |
| BR09 | Edit title/description/GPS | P | Title/GPS есть частично; цельный metadata editor отсутствует. |
| BR10 | Pixel editor/undo/compare | G | Native editor и transient undo/redo есть; final-tip acceptance отсутствует. |
| BR11 | Immutable original view | M | Asset может существовать для mode 2, отдельного authorized original viewer нет. |
| BR12 | Delete + full object cleanup | P | Tombstones/GC есть; цельный user deletion/revoke flow не подтверждён. |
| BR13 | Public encrypted Card link | M | Только private in-account Card. |
| BR14 | Protected multi-assignment collection | M | Native owner-local folders не являются shared collection. |
| BR15 | Share/revoke Browser collection | P | Owner single/ZIP export есть; shared collection/revoke отсутствуют. |
| BR16 | Safe single/ZIP download | G | #45–#46: bounded owner JPEG re-encode, sanitized names, ZIP and URL cleanup. |
| BR17 | Private Card quick link | G | Отдельный route/view существует. |
| BR18 | Rich Card fields/map/TTL | P | Image/title/coords/expiry есть; полноценные description/author/assignment/tags/map scopes нет. |
| BR19 | Original ID/full metadata/provenance | P | Ограниченная projection есть; provenance links/full metadata нет. |
| BR20 | External card independent scopes | M | Legacy имел хороший reference; PB2 native public share отсутствует. |
| BR21 | Saved folder/view/layout defaults | M | Текущий выбор transient; startup preference — другая функция. |

### Account / Settings / Safety — 22

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| PR01 | Anonymous account/key recovery | G | PB2 Recovery Key/Identity v2 существует. |
| PR02 | Public InAppID | P | Opaque account ID виден; отдельной безопасной public profile card нет. |
| PR03 | @slug/name/about | M | Editable public profile отсутствует. |
| PR04 | Optional email/phone/privacy | D | Не могут быть credentials; optional profile fields требуют product/privacy решения. |
| PR05 | Auto/Dark/Light | P | Light/Dark есть, Auto нет. |
| PR06 | Languages | G | RU/EN нормативно готовы по коду; дополнительные языки не утверждены. |
| PR07 | Open on launch | G | #44 реализует device-only safe preference. |
| PR08 | Profile field visibility | M | Нет profile visibility UI/server contract. |
| PR09 | App Lock PIN | G | #48 добавляет scoped verifier, gate, cooldown, cross-tab/background lock; final security tests NOT RUN. |
| PR10 | Local-delete PIN/full wipe | B | Отдельный PIN и signed revoke есть, но photo/key/device wipe намеренно не разрешён. |
| PR11 | Emergency PIN/destruction | B | Distinct PIN + signed revoke intent есть; emergency destruction UI/authority выключены. |
| PR12 | Keep cloud data setting | D | Требуется owner threat-model decision; текущий код не уничтожает cloud data. |
| PR13 | Trusted devices/pair/revoke | G | Native flow есть; #53 добавляет second-device attestation, но final tip не проверен. |
| PR14 | Local quota/persist diagnostics | G | Capabilities/usage diagnostics существуют. |
| PR15 | Cloud/pending/cache counts | P | Технический risk inventory есть; полноценный user storage dashboard неполон. |
| PR16 | Backups/recoverable cloud data | P | Second-device decrypt attestation есть; это явно не backup guarantee. |
| PR17 | Clear cache safely | M | Нет user cache purge с доказанным сохранением sole unsynced copy. |
| PR18 | Delete current device photos/queues | B | Post-ACK удаляются только три PIN verifier и exact-device trusted clock; ciphertext retained. |
| PR19 | Delete cloud photos/account | M | Полного lifecycle UI/verified cleanup нет. |
| PR20 | Matrix/Signal + S3/IPFS choice | X | Messenger исключён; provider selection — отдельное будущее решение. |
| PR21 | Support/report/about | M | Dedicated screens отсутствуют. |
| PR22 | Teams/Contacts/block | G | Native encrypted modules и two-browser contact/grant path есть на #42. |

### Billing — 5

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| BI01 | Free tariff | D | Billing/entitlements отсутствуют; 14d может быть policy only после решения. |
| BI02 | Go tariff/backups | D | Нет payment/entitlement/backup engine. |
| BI03 | Pro 60d | D | 60 дней противоречат maximum 45 days. |
| BI04 | Unlimited TTL | D | Unlimited TTL противоречит mandatory expiry. |
| BI05 | Provider/messenger tiers | D | Нет утверждённого plugin/provider/billing scope. |

### Crosscutting — 7

| ID | Функция | Итог | Факт на #53 |
| --- | --- | :---: | --- |
| X01 | Matrix/RTC/calls | X | Правильно исключены из PB2 runtime. |
| X02 | Two-account encrypted thumbnail | B | Полный isolated two-browser E2EE прошёл на #42, но production read flag выключен. |
| X03 | Offline/reload/device recovery | P | Сильные local-first paths есть; real-device eviction/crash/final-tip proof отсутствует. |
| X04 | TTL/remote GC | G | #42 live PG/Garage tests покрывают expiry/late upload/cleanup; #53 cascade changes не запускались. |
| X05 | Production HTTPS PWA/CI/device | P | #42 CI зелёный; final tip, staging и реальные устройства не проверены. |
| X06 | No legacy redirect/Matrix bootstrap | G | Native router/runtime не импортирует compat/Matrix; `compat/` всё ещё лежит в diff. |
| X07 | Traceable recovery inventory | G | #43 дал 101 rows; этот отчёт обновляет матрицу до #53. |

## 7. Функции вне исходной 101-матрицы

| Roadmap Issue | Фактический статус |
| --- | --- |
| R2-12 Notes | **Отсутствует.** Поиск не нашёл native `PhotoNote`/`AssignmentNote` domain/API/storage/UI. |
| R2-13 Photo Card | **Частично.** Private owner Card есть; независимые server scopes/public route/cleanup отсутствуют. |
| R2-14 Shares/export | **Частично.** Recipient thumbnail и owner export есть; public scoped Card/export нет. |
| R2-15 Authorized Browser collection | **Отсутствует.** Current Browser прямо документирован как device-local owner view. |
| R2-16 Browser UX | **Частично/готово по малому scope.** Grid/List/Tree/search/selection есть; virtualization/shared ACL нет. |
| R2-17 Downloads | **Готово по owner-local source.** Recipient/scoped collection downloads отсутствуют. |
| R2-18 App Lock | **Готово по source, NOT RUN** после #42. |
| R2-19 Local Delete | **Safety-blocked.** Никакого broad wipe; `permitted:false`. |
| R2-20 Emergency | **Safety-blocked.** Signed revoke не равен emergency destruction. |
| R2-21 UX polish | **Не принято.** Есть RU/EN/profile/safety additions, но owner gate не закрыт. |
| R2-22 Geo Browser/map | **Отсутствует.** Capture GPS не равен distance filters/private map. |
| R2-23 Security/chaos | **Частично.** Сильный #42 CI; final stack и полный matrix не проверены. |
| R2-24 Deploy/backup/rollback | **Отсутствует.** Нет staging/device/rollback/restore acceptance. |
| R2-25 Recommendations/avatars | **Частично.** Team avatar/placeholder есть; recommendations/user avatar polish нет. |

## 8. Реализовано неправильно или опасно интегрировать как есть

1. **`compat/assignment-release` — массовый legacy snapshot.** 473 файла и +67k строк противоречат принципу «без массового переноса legacy». Он не подключён к runtime, но не должен автоматически попасть в целевой merge.
2. **GitHub process разошёлся с Roadmap.** #44–#53 реализуют части #16–#21 отдельными gap PR без Issue-scoped evidence и без `Closes #N`.
3. **Документация #43 не входит в implementation spine.** Без отдельного переноса матрица/decisions будут потеряны.
4. **Production recipient sharing выключен.** В `apps/api/config/photo_sync.php` reads разрешаются только `local/testing/staging` и при явном preview flag. Включать production flag до независимой проверки нельзя.
5. **Assignment permission toggles пока декларативны.** UI честно предупреждает, что participant edit/delete/browse restrictions не активны до server authorization.
6. **App Lock — UI/session lock, не at-rest encryption.** Нельзя продавать его как защиту данных от модифицированного JS/browser profile attacker.
7. **Second-device attestation — не deletion permission.** Она подтверждает текущий decrypt path, но не гарантирует будущую сохранность ключа и не разрешает стирать локальную единственную копию.
8. **Owner UX failure остаётся действующим evidence.** Наличие новых экранов не заменяет повторную визуальную приёмку.

## 9. P0-блокеры перед интеграцией

1. Не интегрировать `compat/` без отдельного решения и удаления его из целевого diff либо доказанной изоляции с обоснованием.
2. Запустить полный pipeline на финальном tip #53; сейчас PASS есть только у предка #42.
3. Исправить/доказать production recipient ACL либо оставить функцию disabled и не заявлять shared Browser готовым.
4. Не включать Local Delete/Emergency destructive UI: широкое удаление и ownership proof отсутствуют.
5. Спроектировать отсутствующие Notes, public Card/share и authorized multi-assignment Browser как native PB2 modules.
6. Закрыть owner decisions по навигации, profile fields, extra languages, TTL/billing/provider scope.
7. Повторить owner UI acceptance на production build после UX-исправлений.
8. Выполнить real-device Camera/no-Photos/DCIM/offline/reload checks.

## 10. Вывод этапа 2

Работу ChatGPT можно использовать как основу, но нельзя принимать как готовое приложение. Наиболее зрелая часть — security/storage/camera/sync foundation и owner-local workflows. Наиболее крупные пробелы — Notes, preset system, public/scoped Card, shared Browser, полноценное удаление, deployment/release и owner-approved UX.

Legacy полезен как библиотека конкретных алгоритмов и test vectors, особенно для Camera, NAME-ID, GPS, Card scopes, Browser export и PIN state machines. Его runtime, Matrix coupling, plaintext prototype, старое хранение изображений и монолитный UI переносить нельзя.

Этап 2 завершён без изменения нового кода, Git history, GitHub Issues, `_old`, Docker, Colima, OrbStack, контейнеров, images, volumes или данных.