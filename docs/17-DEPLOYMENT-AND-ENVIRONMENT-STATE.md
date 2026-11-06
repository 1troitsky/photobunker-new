# 17. Deployment и состояние окружения

Дата среза: 2026-11-06. Этот runbook не разрешает destructive операции.

## 1. GitHub и режим REMOTE

```sh
git clone https://github.com/1troitsky/photobunker-new.git
cd photobunker-new
git switch main
```

Активное приложение:

```sh
cd compat/assignment-release
```

`main` содержит handoff snapshot от `ac6e942` и является рабочей веткой. Не force-push. До первой правки проверить `git status`, текущий SHA и прочитать `README.md`, `AGENTS.md`, `ts_and_ux.md`, `docs/00-*`, `docs/15-*`, `docs/16-*`.

Режим **REMOTE**: выполнить одну задачу (для большой — все её последовательные подзадачи), проверить изменённый сценарий Playwright MCP и другими уместными инструментами, затем commit/push в `main`, deploy изменённого runtime и короткий отчёт владельцу. Полный CI не запускать автоматически; объём проверок выбирать по риску. Только документационные изменения не требуют deploy приложения.

## 2. Production server

- SSH alias: `affordablebytesKVMserver`.
- Host/user: `root@45.13.239.154`.
- Project directory: `/var/www/photobunker`.
- Public URL: `https://photobunker.duckdns.org`.
- Host Nginx config: `/etc/nginx/sites-available/photobunker`.
- Config backup before PWA header update: `/var/www/photobunker/backups/photobunker-nginx-before-pwa-20261105.conf`.

Историческая проверка 2026-11-05:

```text
GET /api/v1/health -> 200 {"status":"ok"}
GET /api/v1/ready  -> 200 {"status":"ready"}
GET /               -> 200
release.json         -> {"buildId":"dock-pwa-20261105-1"}
```

Новая проверка 2026-11-06 для Q1 dock (`main@595ec85`): `release.json` → `q1-dock-20261106-2`; публичные `index.html`, `sw.js`, `release.json`, CSS и JS побайтно совпадают с локальной сборкой; root/SW/release имеют `no-store`, CSS — `immutable`; health и ready возвращают 200. Backup до публикации: `/var/www/photobunker/.local/backups/q1-dock-20261106-2-before/`. Playwright MCP открыл публичный `/welcome`; реальный installed-PWA upgrade остаётся `NOT RUN`.

Важно: server Git HEAD исторически показывал старый `main@31ac368`, хотя исходники и `dist` копировались поверх него. Поэтому **не выполнять** на production `git reset`, `git checkout`, `git pull` или clean. Сначала создать отдельный release directory/checkout и план atomic switch.

Последняя публикация 2026-11-06: Browser `main@56d91ad`, release `browser-native-20261106-1`. Заменены восемь frontend source files и собранный shell; backend/данные не менялись. Backup shell и пяти существовавших source files: `/var/www/photobunker/.local/backups/browser-native-20261106-1-before/`. Assets загружены без удаления старых, checksum dry-run — пустой, exit 0; index → SW → release marker опубликованы последовательно. [Публичная сверка shell, bundles, health/ready и cache headers](evidence/browser-native-20261106/deploy.json) — exit 0. Новый ID получен через production Playwright; приватная приёмка и установленная PWA — `NOT RUN`.

## 3. PWA cache/update

Последняя публикация PIN: `main@d753076`, release `pin-flow-20261106-1`; девять frontend source files и shell, без изменений backend/данных. Backup `/var/www/photobunker/.local/backups/pin-flow-20261106-1-before/`. Assets сохранены, checksum dry-run пустой, exit 0; index → SW → release marker. [Публичные файлы, health/ready и cache headers](evidence/pin-flow-20261106/deploy.json) совпали со сборкой, exit 0; production Playwright подтвердил ID. Installed-PWA upgrade и private hardware acceptance — `NOT RUN`. Emergency destructive gate остаётся false.

Последняя публикация поверх native Browser: `main@d5acff3`, release `browser-layout-20261106-1`; четыре frontend source files и shell. Backup: `/var/www/photobunker/.local/backups/browser-layout-20261106-1-before/`. Старые assets сохранены, checksum dry-run — пустой, exit 0; index/SW/release опубликованы в этом порядке. [Публичная побайтная сверка и headers](evidence/browser-layout-20261106/deploy.json) — exit 0; health/ready 200. Production Playwright получил новый marker и ожидаемый guest sign-in. База, crypto, PIN и emergency gate не менялись.

Текущая схема:

- `index.html`, navigation routes, `sw.js`, `release.json`, manifest: `no-store, no-cache, must-revalidate`;
- `/assets/<content-hash>`: `public, max-age=31536000, immutable`;
- build генерирует `release.json` и embedded build ID;
- клиент проверяет release при старте, `pageshow`, online, возврате visibility и периодически;
- новый worker получает `SKIP_WAITING`, старые shell caches удаляются по revision;
- reload защищён от цикла через короткий session guard;
- IndexedDB, OPFS, keys и пользовательские фото не очищаются.

Первая установленная версия до появления updater может потребовать один полный close/reopen PWA. Никогда не предлагать удалить PWA/site data как обычный способ обновления: это может уничтожить локальные данные.

Для каждого нового deploy задавать **новый, ранее не использованный** `PHOTOBUNKER_RELEASE_ID` при production build, публиковать соответствующие `index.html`, `sw.js`, `release.json` и проверять публичный `release.json`, asset hashes и headers. Не переиспользовать ID после исправленного повторного upload: иначе установленная PWA может остаться на старом shell.

## 4. Безопасная production-проверка

Только read-only checks:

```sh
curl -fsS https://photobunker.duckdns.org/api/v1/health
curl -fsS https://photobunker.duckdns.org/api/v1/ready
curl -fsS https://photobunker.duckdns.org/release.json
curl -sSI https://photobunker.duckdns.org/sw.js
curl -sSI https://photobunker.duckdns.org/
ssh affordablebytesKVMserver 'nginx -t'
```

Перед применением Nginx config: backup конкретного файла → `nginx -t` → `systemctl reload nginx`. Reload, не destructive restart.

## 5. Локальные окружения

Исторически старый Mac использовал Colima и изолированные порты `18081`/`13901`; OrbStack там отсутствовал. Новый компьютер может иметь другое окружение — сначала выполнить read-only:

```sh
docker context ls
docker context show
docker compose ps --all
```

Не предполагать, что Colima или OrbStack уже настроены. Не переключать/останавливать чужой stack без идентификации. На компьютере с OrbStack возврат выполняется `docker context use orbstack`; на компьютере с Colima — `docker context use colima`.

Запрещены без разрешения владельца:

- `docker system prune`;
- `docker compose down -v`;
- удаление containers/images/volumes;
- `migrate:fresh`, `db:wipe`, seed, DB restore;
- очистка production/dev user data.

Исторический Colima runbook и результаты находятся в `docs/history/2026-11-04/stage-05-*` и `stage-06-*`; они не являются гарантией clean-clone bootstrap.

## 6. Перед следующим deploy

1. Зафиксировать branch/SHA и `git status`; проверить точный состав файлов для upload и состояние сервера.
2. Запустить targeted tests выбранной задачи и применимые UI/performance проверки.
3. Выполнить production frontend build активного runtime с новым `PHOTOBUNKER_RELEASE_ID`.
4. Не запускать migration автоматически; показать pending migrations владельцу и запросить подтверждение, если они затрагивают существующую БД.
5. Синхронизировать immutable assets до `index.html`; `release.json` и `sw.js` публиковать в согласованном порядке.
6. Проверить публичный release ID, asset hashes, headers/health/ready.
7. Выполнить targeted mobile production check.
8. Обновить `docs/15-*`/`docs/16-*` фактическим результатом.

## 7. Что ещё отсутствует в deployment

- отдельный чистый release checkout и atomic symlink/release switch;
- подтверждённый rollback production DB/assets;
- автоматизированный backup/restore proof;
- воспроизводимый clean-clone Compose текущего deployed runtime;
- production monitoring без утечки private data;
- final device/PWA upgrade acceptance.
