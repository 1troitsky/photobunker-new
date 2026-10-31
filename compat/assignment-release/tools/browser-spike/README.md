# PhotoBunker I02 browser lab

Изолированный developer tool для проверки browser APIs до продуктовых crypto/capture/outbox. Не импортируется `apps/web`, не имеет API/env/ключей приложения, не реализует ADR 0002 wire format. Automatic probes не запрашивают камеру/GPS. Browser report содержит только capabilities, безопасные codes и технические размеры/время.

На host нужен уже используемый Node.js 22. Установки этого отдельного package выполняются на host; не используйте Linux `apps/web/node_modules` для Mac.

```sh
cd tools/browser-spike
npm ci --ignore-scripts --no-fund
npm run dev
```

Открыть http://localhost:5180. `Запустить пробы` проверяет libsodium worker/CSP, синтетический 4 MiB IDB Blob/job commit/abort, P-256 CryptoKey persistence и generated canvas. `Проверить после reload` выполняет readback/hash/signature verification, а не новую запись. `Очистить данные стенда` удаляет только `photobunker-i02-synthetic-lab` database этого origin. В product outbox стенд не обращается.

Production build с проверяемой CSP:

```sh
npm run check
npm run preview
```

Dev/preview используют один port 5180 и запускаются по отдельности. `blocked.html` — negative WASM/CSP entry, обычные пробы там должны завершаться отказом. Сервис-воркера нет: этот lab не обещает offline reload или background upload.

Для воспроизводимых desktop tests:

```sh
export PLAYWRIGHT_BROWSERS_PATH=/private/tmp/photobunker-playwright-browsers
npx playwright install chromium firefox webkit
npm test
```

На Linux установка browser system dependencies: `npx playwright install --with-deps chromium firefox webkit`. Браузеры/пакеты требуют первоначального скачивания; подготовленные tests не требуют внешних runtime services. `npm test` сам собирает/запускает preview и останавливает свой server. Свободный port 5180 обязателен. Видео/traces/screenshots отключены; временные browser profiles удаляются после теста. Бинарники в `/private/tmp` могут быть удалены системой и потребовать повторного install; другой каталог можно задать env переменной.

Fake camera test запускается только в Chromium. Для физических тестов используйте неперсональную test card, явно включите камеру, измерьте still/Canvas в обеих ориентациях, затем выключите. Снимки не сохраняются/не отправляются; browser/OS temporary memory вне контроля стенда. Телефону нужны собственные LAN/DNS и trusted HTTPS; `localhost` указывает на телефон. Не обходите certificate warning и не включайте insecure-origin camera flags для доказательства поддержки.

Полная матрица, команды и pending checks: [browser compatibility runbook](../../docs/operations/browser-compatibility.md).

## Проверки приложения

### Интерактивная проверка экранов

`interactive-qa.mjs` позволяет агенту самостоятельно нажимать кнопки, заполнять поля, ждать состояния UI и сохранять снимки экрана живого `localhost:8080`. Он создаёт только синтетические аккаунты, держит их ключи в памяти процесса, показывает безопасные состояния/ошибки HTTP и очищает тестовые аккаунты при команде `exit`. Chrome получает синтетические камеру и микрофон; это проверка браузерного сценария, а не физического телефона. Запуск из корня проекта после `./scripts/dev up` и `./scripts/dev matrix`:

```sh
APP_CHROME_CHANNEL=chrome node tools/browser-spike/interactive-qa.mjs
```

Команды передаются по одной JSON-строке. Например: `{"op":"fixture","user":"alice"}`, `{"op":"goto","user":"alice","path":"/messages"}`, `{"op":"click","user":"alice","name":"Новый чат"}`, `{"op":"fill","user":"alice","label":"ID или @username","value":"pb_…"}`, `{"op":"inspect","user":"alice"}`, `{"op":"screenshot","user":"alice","name":"inbox"}`, `{"op":"exit"}`. Для переходов `click` принимает `waitPath`, а `wait` — `selector` либо `role`/`name`, а также `attribute`/`value` или `text`. Снимки находятся только в `/private/tmp/photobunker-qa-*`; их можно визуально проверить локальным просмотрщиком. При ошибке сохраняется снимок текущего экрана. Не используйте этот инструмент с личным аккаунтом владельца.

При работающем `./scripts/dev up`, из корня репозитория:

```sh
PLAYWRIGHT_BROWSERS_PATH=/private/tmp/photobunker-playwright-browsers node tools/browser-spike/check-ui-workspace.mjs
```

Текущий сценарий U02–U03 выполняется в Chromium и WebKit: создание пресетов/заданий/команд, проверка полей, съёмка DEMO, категории, метаданные, редактор с неизменным оригиналом, экспорт файла, перезапуск, удаление, конфликты и отказ IDB. API перехватывается как недоступный; сценарий требует ноль API-запросов. `UI_BROWSERS=chromium` или `webkit` ограничивает запуск. Синтетические скриншоты сохраняются в OS temp directory, отдельные browser profiles удаляются. Этот сценарий включён в основной CI. [Границы и ручная проверка](../../docs/product/ui-through-u03.md).

Предыдущие `check-local-app.mjs`, `check-server-library.mjs`, `check-profiles.mjs`, `check-delivery.mjs`, `check-collaboration.mjs`, `check-identity-ux.mjs` сохранены как сценарии прежних этапов. Их селекторы/маршруты требуют адаптации к новому UI; они не являются текущей регрессией и больше не запускаются основным UI step. Unit-тесты существующих адаптеров доставки и API, а также Laravel feature tests остаются в `./scripts/dev check`.

Физические iPhone/Android, установленная PWA и системное меню передачи файлов проверяются отдельно. Browser automation проверяет файловый fallback передачи; успешный вызов системного share не трактуется как подтверждение доставки получателю.

## U04/B01 local application QA

With the app running and `./scripts/dev matrix` prepared, run `node tools/browser-spike/check-account.mjs` for Chromium/WebKit real Identity and Matrix, or `node tools/browser-spike/check-camera.mjs` for Chromium synthetic hardware through the actual capture pipeline. Set `PLAYWRIGHT_BROWSERS_PATH` to your installed browsers. Account QA creates synthetic identities, keeps credentials in memory, temporarily stops only local Matrix for outage/cold-copy restore, restores it in finally, and removes precisely known QA accounts/restore clones. Use a disposable local stand without active communication; it accepts loopback origins only. It does not validate physical phones. B02 messaging/history is covered separately by `check-messages.mjs`. [Runbook](../../docs/operations/identity-matrix-local.md).


For profile save feedback and actual persistence, run `node tools/browser-spike/check-profile-save.mjs`. For Rust E2EE direct/group messages, SAS, backup/history recovery, device epochs, policy and cancellation, run `node tools/browser-spike/check-messages.mjs`. Both use real local APIs in Chromium/WebKit and precisely clean their synthetic accounts. `MESSAGE_BROWSERS=chromium` or `webkit` selects one messaging engine; `PLAYWRIGHT_BROWSERS_PATH` is required when browsers are installed outside the default cache. No secrets or message bodies belong in reports/screenshots. [B02 workflow and limitations](../../docs/operations/matrix-messaging.md).

## B03 account workspace QA

Run `node tools/browser-spike/check-workspace.mjs` against the running local app and Matrix. `WORKSPACE_BROWSERS=chromium` or `webkit` selects one engine. The scenario creates only synthetic accounts and a precisely fingerprinted old library, exercises real UI invitations/roles/capture, restricted thumbnails, encrypted assignment discussion and ID references, immediate revoke, source-preserving S3/device photo import, partial-failure retry, TTL, permission downgrade and cross-tab account isolation. It does not stop Matrix or require external services. Cleanup deletes only its exact account/library fixtures, including their known object keys. No private payloads/credentials/screenshots are reported. [B03 runbook](../../docs/operations/account-workspace.md).

Messaging QA also monitors `window.error` and `unhandledrejection`. WebKit native cancelled-photo-poll diagnostics during full-document recovery are counted separately; other browser/runtime errors remain failures. See the [B03 regression note](../../docs/operations/matrix-messaging.md).


## B04 application QA

Run `check-photo-crypto.mjs`, `check-photo-workspace.mjs`, `check-photo-recovery.mjs`, `check-photo-offline.mjs` from the repository root with the same PLAYWRIGHT_BROWSERS_PATH as above. Local app, managed Matrix and S3 must be running. `PHOTO_BROWSERS=chromium` or `webkit` selects one engine; default both. These replace the historical plaintext B03 `check-workspace.mjs` for current account photo behavior. They cover real crypto worker/ACK cleanup, signed shared plans/upload-only/80px scope/review/revoke/rewrap and Matrix ID-only references, explicit migration with local editor versions/readback/cleanup, PIN hard lock/PB4 rotation/device linking, and cold API outage capture/restart/delivery. Only synthetic accounts/fixtures, strict fingerprint-bound cleanup, no secret artifacts. Full offline PWA caching/physical phones/external audit remain release gates. [Runbook](../../docs/operations/photo-protection.md).


## Persistent app access and messenger actions

`check-first-message.mjs`: первое E2EE сообщение отправляется до открытия Messages получателем, затем проверяются присоединение и расшифровка. Новая регистрация автоматически готовит сообщения под тем же ключом аккаунта. Диагностика содержит только enum states и event types, без контента/credentials.

`check-person-profile.mjs`: полный профиль из поиска/контактов/заголовка, privacy после принятия/удаления, share и вход по ссылке, block/unblock, видимый сбой/повтор открытия DM, ответ из standalone profile в ту же комнату, E2EE сообщения, сохранение черновика и действие звонка. Скриншоты только с синтетическими данными: `/private/tmp/photobunker-person-profile-<engine>.png`.

`check-app-access.mjs` and `check-messenger-actions.mjs` (APP_BROWSERS=chromium/webkit) cover mandatory authentication, no timed session expiry, cookie-loss PoP, automatic photo reopen, optional whole-app PIN after reload/background/logout, unique @username direct invites, pins, select-all/local delete, full-history search, synced archive, both-party redaction/empty-dialog hiding and account contact sync. `check-ui-workspace.mjs` is historical guest U03 coverage and is no longer a product/CI entry point. Camera tests now use an authenticated encrypted Vault; B04 scripts use automatic trusted-device reopening. General model/camera/cache tests remain in the client suite.

WebKit's native aborted-load diagnostics can occur for API/module requests at a pagehide/visibility privacy transition. The monitor requires same-origin known API/module paths and observed AbortSignal/request cancellation or a tightly correlated privacy transition; window.error/unhandledrejection stay strict, as do unrelated native errors. No body/token/key is recorded. [Current behavior](../../docs/operations/messenger-actions.md).

B06 calls: prepare `./scripts/dev rtc` after Matrix and run `node tools/browser-spike/check-calls.mjs` (Chromium synthetic hardware). Covers real encrypted remote video/audio, reconnect, group calls, a no-key ciphertext observer, narrow layout, capture release, declined/denied/outage/PIN and active device revocation. `CALL_BROWSERS=webkit` is a diagnostic compatibility run with generated canvas/oscillator media; a result is not physical Safari/iPhone certification. Optional `CALL_DIAGNOSTICS=1` reports fixed codes/states only. Never print WebSocket URLs, JWTs, OpenID proofs or raw RTP/media. [Runbook](../../docs/operations/matrixrtc-calls.md).


`check-onboarding-messages.mjs` проверяет регистрацию с PB4, первый зашифрованный DM через встроенный поиск контактов **без** предварительного backup, повторное открытие, 320–1440 px, общий файл восстановления PB1/PB4 и запрет отправки до подтверждения второго устройства. `APP_BROWSERS` выбирает Chromium/WebKit.


`check-single-key.mjs` — актуальный пользовательский сценарий одного ключа: автоматические фото/Matrix, удаление входящего сообщения у обоих, очистка UI/локальных credentials после выхода, восстановление фото и истории тем же ключом на том же и другом устройстве. `APP_BROWSERS` выбирает Chromium/WebKit. `check-photo-crypto.mjs` и `check-photo-recovery.mjs` проверяют прежний внутренний формат через protocol drills; отдельные PB4 формы больше не являются пользовательским UI. [Операции](../../docs/operations/single-account-key.md).

`check-data-storage.mjs` проверяет Chromium/WebKit: автоматическую камеру после отсутствующего context/reload, policy 30–360, отмену logout/delete, удаление локального scope, targeted server cleanup и инвалидность прежнего Matrix token после настройки настоящего SDK backup. Только synthetic QA accounts; физические iPhone/Android этим не заменяются.

`check-messenger-ui.mjs`: synthetic public sample profiles, новый список/превью, плюс/@username, touch hold actions, ответ/закрепление, scoped search, удаление incoming у обоих, черновики и 320–1440 layouts. Снимки в `/private/tmp/photobunker-messenger-<engine>-{chat,list,desktop,desktop-light}.png`; настоящие личные данные и recovery material на них не снимаются.

`check-voice.mjs` exercises real MediaRecorder with a generated synthetic microphone stream, preview and capture release, ciphertext-only upload, automatic first receipt without acceptance, decryption/playback, playback speed and an encrypted text reply in Chromium/WebKit. Playwright's Linux WebKit build currently has no MediaRecorder: that path first asserts the product's explicit unsupported state, then installs a QA-only valid WAV recorder so the remaining WebKit encryption, delivery, playback and deletion pipeline still runs. No physical microphone is used. `check-first-message.mjs` tests a receiver who has never opened Messages, including SDK signature arrival and strict-policy retry. These are in `check:app`.

`check-legacy-chat.mjs` creates a synthetic encrypted room with the previous joined-history/invitation format through the authenticated Matrix API. It verifies automatic legacy joining, normalization of future history visibility, and readable text/replies without accepting a request. Voice QA additionally covers slide cancellation, explicit permission refusal, pause/resume, failed upload with a retained preview and retry, and deletion of an incoming voice message for everyone. WebKit synthetic sources pin the MediaDevices wrapper on navigator so garbage collection cannot discard the test override.
