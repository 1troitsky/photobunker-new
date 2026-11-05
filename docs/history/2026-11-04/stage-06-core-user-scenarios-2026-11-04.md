# Этап 6 — основные пользовательские сценарии

Дата: 2026-11-04
Рабочий checkout: `/Users/ivan/Documents/WEB/photobunker-new/.codex-review`
Ветка: `codex/integration-2026-11-04`
Локальный адрес: `http://127.0.0.1:18081`
Статус: основные сценарии собраны в цельную работающую цепочку; этап 6 завершён. Визуальная полировка, permission/error states и оптимизация загрузки переходят в этап 7.

## 1. Принцип работы с legacy

Старый PhotoBunker использовался только как read-only источник полезных сценариев, терминов и ожидаемого поведения. Legacy-баги, ручные блокировки и ухудшающие работу UI-паттерны не переносились.

В частности, удалена обязательная ручная проверка участников перед съёмкой. Состав, роли, ACL, epoch, подписи и ключи проверяются автоматически. Пользователь не должен нажимать «Проверить участников» или «Подтвердить участников». Реальное несовпадение ключа по-прежнему fail-closed блокирует опасную операцию автоматически.

Продуктовое правило зафиксировано так: обычные функции доступны без искусственных подтверждений; продуктовые ограничения определяются тарифом. Отдельные подтверждения необратимого удаления данных сохранены как safety-механизм, а не ограничение функции.

## 2. Исправленные функциональные дефекты

### Аккаунт и origin

- Исправлено сообщение «Адрес приложения не разрешён сервером» при регистрации на `127.0.0.1:18081`.
- `APP_URL` задаёт фактический trusted origin, а `IDENTITY_ORIGINS` добавляет только явные aliases без wildcard.
- Local setup генерирует правильный origin с текущим портом.
- Разрешённый локальный origin доходит до auth API; посторонний origin получает `403`.
- PHPUnit теперь принудительно задаёт собственный test origin и не зависит от локальной `.env` разработчика.

### Камера и локальное сохранение

- Камера аккаунта больше не отключается production-флагом plaintext-прототипа.
- После автоматической подготовки зашифрованного capture plan камера запускается без отдельной пользовательской проверки участников.
- Снимок сначала сохраняется в зашифрованную durable local queue, затем отправляется на сервер.
- Offline capture сохраняется локально; после возврата сети доставка повторяется автоматически.
- Глобальный жёсткий барьер GPS `<= 30 м` удалён. Геолокация применяется только по правилам конкретного задания.
- Demo/plaintext fallback остаётся только у явно включённого локального прототипа и не используется аккаунтом.

### Галерея, редактор и Photo Browser

- Production-галерея теперь загружает encrypted index, даже когда plaintext-прототип выключен.
- Устранена гонка параллельных refresh: более ранний caller ждёт актуальное завершившееся обновление и не открывает временно пустую галерею.
- Устранена гонка редактора: инструменты не меняют baseline до готовности изображения.
- Проверена цепочка gallery → photo view → note → Photo Card → editor version → Photo Browser.

### QA-контракты

- Старые browser QA ожидания ручного подтверждения участников заменены проверкой автоматического signed recipient plan.
- Locale-зависимые тесты явно задают язык и больше не зависят от языка машины.
- App shell tests явно инициализируют защитные журналы emergency/local deletion.
- Messaging onboarding test приведён к актуальному контракту: общий E2EE-клиент не останавливается после подготовки аккаунта.

## 3. Production browser E2E

Финальный Playwright-прогон выполнялся по production build через Colima. Он не печатает Recovery Key и ничего не удаляет.

```json
{"coreFlows":"pass","accountCreate":"pass","accountRecoverySecondDevice":"pass","assignmentCreate":"pass","encryptedCameraCapture":"pass","offlineCaptureRetrySync":"pass","photoNote":"pass","galleryAndPhotoCard":"pass","editorVersionCommit":"pass","photoBrowser":"pass","teamCreate":"pass","desktopOverflow":"pass","runtimeErrors":0}
```

Проверено в одной сквозной цепочке:

- создание key-only аккаунта;
- восстановление того же аккаунта во втором browser context/устройстве;
- создание assignment;
- отсутствие кнопок ручной проверки участников;
- автоматическая подготовка камеры;
- зашифрованный capture и server ACK;
- реальный browser offline, второй capture, durable pending job, возврат online и автоматический ACK обоих кадров;
- галерея и просмотр фото;
- редактирование заметки и её отображение в Photo Card;
- создание новой версии редактором;
- Photo Browser collection;
- создание team;
- desktop viewport 1440 px без горизонтального overflow и со стабильной навигацией.

Первый финальный E2E во время одновременных production builds и нескольких PHPUnit-процессов превысил таймаут первого ACK. Логи показывали API requests до 29 секунд. После завершения фоновой нагрузки PostgreSQL не имел зависших запросов, и тот же E2E прошёл полностью. Это не функциональный дефект retry, но важное evidence для оптимизации этапа 7 на старом компьютере.

## 4. Автоматические проверки

### Frontend

- Полный Vitest: **61 test file, 314 tests — PASS**.
- Production build: `vue-tsc --noEmit && vite build` — **PASS**.
- Vite преобразовал 625 modules.
- RU/EN catalog audit — **PASS**: 203 source modules, 95 literal `q()` calls, 1168 translation pairs.

### Backend в Colima

Тесты запущены внутри существующего API-контейнера. `phpunit.xml` принудительно использует `APP_ENV=testing`, SQLite `:memory:`, array cache/session и sync queue. Рабочая PostgreSQL не использовалась.

- Identity: **28 tests, 631 assertions — PASS**.
- Encrypted Photos + Workspace + Prototype Retention: **40 tests, 698 assertions — PASS**.
- Итого: **68 tests, 1329 assertions — PASS**.

Этим изолированно проверены trusted/recovery device, revoke, ACL, origin guard, replay protection, encrypted upload, cancel/delete tombstones, offline TTL, expiry, cleanup retry, assignments, photo access scopes, Photo Browser и защита от resurrection.

Live-delete реальной dev-фотографии и ожидание реального TTL по настенным часам не выполнялись: это было бы удалением данных. Эти сценарии проверены изолированными тестами на временной SQLite/fixture storage без воздействия на локальный стек.

## 5. Текущее состояние Colima

```text
Docker context: colima
Colima: running, QEMU, x86_64, Docker
Docker server: 29.5.2, Ubuntu 24.04.4 LTS
PostgreSQL: healthy
Garage: healthy
Gateway: healthy
Worker: running
Scheduler: running
API fast replacement: running
Production web preview: running
GET /: 200, 0.086 s
GET /ready: 200, 0.143 s
```

Compose API/Web containers, заменённые более быстрыми runtime-контейнерами, остаются остановленными и сохранёнными. Ничего не удалялось. Чужой стек `artefacts-laravel` не изменялся.

OrbStack context и CLI на этом старом компьютере отсутствуют. Это ожидаемо: здесь используется Colima.

## 6. Безопасные команды

### Запуск существующего PhotoBunker через Colima

```sh
docker context use colima
colima start
cd /Users/ivan/Documents/WEB/photobunker-new/.codex-review/compat/assignment-release
docker compose start postgres garage worker scheduler
docker start photobunker-colima-api-fast photobunker-colima-web-preview
docker compose start gateway
docker compose ps --all
curl --max-time 30 http://127.0.0.1:18081/
curl --max-time 30 http://127.0.0.1:18081/ready
```

Эти команды запускают только уже созданные containers и не удаляют данные.

### Остановка без удаления данных

```sh
cd /Users/ivan/Documents/WEB/photobunker-new/.codex-review/compat/assignment-release
docker compose stop gateway worker scheduler garage postgres
docker stop photobunker-colima-web-preview photobunker-colima-api-fast
```

Не использовать `docker compose down -v`, `docker system prune`, удаление containers/images/volumes или очистку БД.

### Возврат к OrbStack на компьютере, где он установлен

```sh
docker context use orbstack
```

На текущем компьютере такого context нет, поэтому эта команда нужна только при возврате на современный Mac с OrbStack.

## 7. Что осталось на этап 7

1. Уменьшить initial bundle: основной chunk около 1.38 MB, Matrix WASM около 7.8 MB, LiveKit chunk около 587 kB.
2. Оптимизировать конкурентную загрузку/опросы API для старого двухъядерного компьютера.
3. Проверить и визуально исправить док, layout shifts, галереи и все loading/empty/error states.
4. Отдельно пройти camera permission denied/no camera/camera busy, storage full и restart UX на реальных устройствах.
5. Сравнить ключевые экраны с полезной частью legacy, не перенося его дефекты и блокирующие защиты.

## 8. Контроль безопасности работ

- Не запускались `migrate:fresh`, `db:wipe`, сидеры, restore или обычные migrations.
- Не выполнялись `docker compose down`, `down -v`, `docker system prune` или удаления containers/images/volumes.
- Не удалялись dev-аккаунты и синтетические E2E-данные; они оставлены из-за запрета на удаления без подтверждения.
- `_old` не изменялся.
- `main`, remote refs и GitHub не изменялись.
- Все изменения находятся только в локальной integration-ветке и в этом отчёте.