# G1: запуск настоящей вертикальной проверки PhotoBunker PB2

**Статус:** READY TO EXECUTE после развёртывания выделенного HTTPS staging; **NOT RUN / NOT VERIFIED** для реального G1. Snapshot PR #42: `9a596b15f1f492a980af849e1f727ee9840b928f`. G0 Chromium smoke [#41124216234](https://github.com/1troitsky/photobunker-new/actions/runs/41124216234) PASS, но выполнялся **без Laravel API, PostgreSQL и S3**.

## G1 local ciphertext recovery — real unit regression, not live backend

[GitHub Actions #41124987607](https://github.com/1troitsky/photobunker-new/actions/runs/41124987607) on PR #42 commit `9cf9df3c4ee736f414332dfb152e5e63d044c883` — **SUCCESS**: PHP 35/35, frontend architecture/lint/TS/build, **Vitest 102/102**, Chromium **15 PASS / 6 SKIP**. Added G1 **client-only** regression `apps/web/src/features/local-storage/infrastructure/photo-edit.test.ts`:
- Commit encrypted mode-3 capture and make one local edit **before original cloud ACK**.
- Reopen IndexedDB and create a new vault instance. Pending queue stays ordered **upload → edit**.
- Initial shutter ciphertext and metadata remain available for original upload, and are not replaced by the new edit; edited ciphertext remains separately decryptable.
- No original/edit plaintext appears in persisted encrypted Blob records; account switch invalidates the old vault.
- **Scope:** fake-indexeddb/Node WebCrypto test, not Safari/Android PWA or Garage. Real G1 S01–S08 remain **NOT VERIFIED** until same-origin HTTPS Laravel/PostgreSQL/Garage and device scenarios.

## Минимальная проверяемая среда

- **Один HTTPS origin** отдаёт статический production PB2 PWA, маршруты Vue Router и same-origin Laravel API. Нельзя делать redirect во второй legacy origin; Matrix/старые PB1 Identity не запускать.
- **Laravel 13 / PHP 8.4** с миграциями PB2, выделенная тестовая **PostgreSQL** (SQLite используется только в unit/Feature тестах). Файловые/DB сессии и настройка `APP_URL` соответствуют внешнему HTTPS домену.
- **S3-compatible Garage** с отдельными bucket, credentials и lifecycle; в `apps/api/.env.example` перечислены `PHOTO_S3_ENDPOINT`, `PHOTO_S3_REGION`, `PHOTO_S3_BUCKET`, `PHOTO_S3_ACCESS_KEY`, `PHOTO_S3_SECRET_KEY`, `PHOTO_ACCOUNT_QUOTA_BYTES`. В backend нет встроенного одношагового Docker Compose — deployment/reverse proxy, валидный TLS и isolated staging secrets надо предоставить **до** теста.
- Сессия только по same-origin Secure/HttpOnly cookie с CSRF/origin проверками; отключён debug, никакие Recovery Keys, DEK, PIN, GPS и приватные photo bytes не выводятся в логи.
- В `apps/api/config/photo_sync.php` оставляем `recipient_thumbnail_reads_enabled=false`. Включать только после независимого security review S14/S15, **не** для G1.
- **Отдельное тестовое устройство или чистый Chromium profile**, чтобы случайные прежние ключи и DB не подменяли чистый сценарий. Фото делается на тестовом синтетическом feed; реальные iPhone/Android проверки отдельно.

## Выполнение — только после стенда

1. На staging получить production bundle `pnpm install --frozen-lockfile && pnpm build`, миграции `cd apps/api && composer install --no-interaction && php artisan migrate --force` — **только в изолированной БД**. Проверить S3 bucket и signed/unsigned actor policy.
2. Запустить существующие реальные Playwright тесты (никакой фальшивой подстановки S3/Identity): 

   ```bash
   PB_CAMERA_HTTPS_ORIGIN=https://<staging-host> \
   PB_SYNC_HTTPS_ORIGIN=https://<staging-host> \
   pnpm exec playwright test tests/e2e/camera-production.spec.ts tests/e2e/photo-sync-production.spec.ts
   ```

   Обе переменные окружения **обязательны**: без них тесты пропускаются намеренно.
3. Подтвердить S01–S08 из [сценариев](03-SCENARIO-ACCEPTANCE.md): создать анонимный аккаунт, один зашифрованный commit при съёмке, открыть Gallery/Browser, сделать редактирование до ACK, перезагрузиться и проверить ciphertext, восстановить сеть, получить серверный ACK, затем read-back digest.
4. Негативные проверки: камера denied/busy, offline/reload, недоступный S3 503, потерянный ACK, повторная доставка, смена аккаунта, mode2/3, TTL near expiry, переполненная квота и expired-retry. Никаких claims о надёжности без наблюдаемого результата.
5. В evidence хранить SHA, URL run, **проверенные** коды ответов API и SHA256 ciphertext, разрешённые UI screenshots и способ воспроизведения ошибок. Не хранить ключи, сессионные cookie или исходный фото-контент.
6. Отдельно затем провести пользовательскую приёмку на iPhone PWA и Android Chrome/PWA: разрешение камеры, приложение без записи в системную галерею, offline restart и локальное отображение снимка.

## Почему G0 этого не заменяет

GitHub Actions сейчас делает production Chromium smoke **без backend** (15 PASS, 6 SKIP). Оно не может породить реальный аккаунт и proof, загрузить/прочитать ciphertext в Garage, проверить device revoke, lost ACK и end-to-end путь. Live тесты корректно пропущены, а не тайно «зачтены». Цель G1 — впервые получить воспроизводимую интеграцию **реального единого** PB2 runtime, сохранив PB1 как reference, без отдельного `compat/` origin.

**Если стенд недоступен:** продолжать unit, архитектуру, документирование и UX проверки, но не ставить G1=PASS. Последующие G2–G5 не получают ложную сертификацию.
