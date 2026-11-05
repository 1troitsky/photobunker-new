# 17. Deployment и состояние окружения

Дата среза: 2026-11-06. Этот runbook не разрешает destructive операции.

## 1. GitHub handoff

```sh
git clone https://github.com/1troitsky/photobunker-new.git
cd photobunker-new
git switch handoff/owner-agent-2026-11-06
```

Активное приложение:

```sh
cd compat/assignment-release
```

Не начинать работу с `main`: он не содержит поздний implementation snapshot. Не force-push. До первой правки проверить `git status`, текущий SHA и прочитать `README.md`, `AGENTS.md`, `ts_and_ux.md`, `docs/00-*`, `docs/15-*`, `docs/16-*`.

## 2. Production server

- SSH alias: `affordablebytesKVMserver`.
- Host/user: `root@45.13.239.154`.
- Project directory: `/var/www/photobunker`.
- Public URL: `https://photobunker.duckdns.org`.
- Host Nginx config: `/etc/nginx/sites-available/photobunker`.
- Config backup before PWA header update: `/var/www/photobunker/backups/photobunker-nginx-before-pwa-20261105.conf`.

Последняя проверка 2026-11-05:

```text
GET /api/v1/health -> 200 {"status":"ok"}
GET /api/v1/ready  -> 200 {"status":"ready"}
GET /               -> 200
release.json         -> {"buildId":"dock-pwa-20261105-1"}
```

Важно: server Git HEAD исторически показывал старый `main@31ac368`, хотя исходники и `dist` копировались поверх него. Поэтому **не выполнять** на production `git reset`, `git checkout`, `git pull` или clean. Сначала создать отдельный release directory/checkout и план atomic switch.

## 3. PWA cache/update

Текущая схема:

- `index.html`, navigation routes, `sw.js`, `release.json`, manifest: `no-store, no-cache, must-revalidate`;
- `/assets/<content-hash>`: `public, max-age=31536000, immutable`;
- build генерирует `release.json` и embedded build ID;
- клиент проверяет release при старте, `pageshow`, online, возврате visibility и периодически;
- новый worker получает `SKIP_WAITING`, старые shell caches удаляются по revision;
- reload защищён от цикла через короткий session guard;
- IndexedDB, OPFS, keys и пользовательские фото не очищаются.

Первая установленная версия до появления updater может потребовать один полный close/reopen PWA. Никогда не предлагать удалить PWA/site data как обычный способ обновления: это может уничтожить локальные данные.

Для каждого нового deploy задавать новый `PHOTOBUNKER_RELEASE_ID`, проверять публичный `release.json`, asset hashes и headers.

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

1. Зафиксировать branch/SHA и `git status`.
2. Выполнить production frontend build активного runtime.
3. Запустить targeted tests выбранного quick task.
4. Не запускать migration автоматически; показать pending migrations владельцу и запросить подтверждение, если они затрагивают существующую БД.
5. Синхронизировать immutable assets до `index.html`; `release.json` и `sw.js` публиковать в согласованном порядке.
6. Проверить headers/health/ready.
7. Выполнить targeted mobile production check.
8. Обновить `docs/15-*`/`docs/16-*` фактическим результатом.

## 7. Что ещё отсутствует в deployment

- отдельный чистый release checkout и atomic symlink/release switch;
- подтверждённый rollback production DB/assets;
- автоматизированный backup/restore proof;
- воспроизводимый clean-clone Compose текущего deployed runtime;
- production monitoring без утечки private data;
- final device/PWA upgrade acceptance.
