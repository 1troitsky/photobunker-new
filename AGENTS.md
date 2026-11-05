# PhotoBunker New — правила владельца и агента

**Актуальное решение владельца от 2026-11-06:** в проекте работают только владелец и один агент. Старый трёхсторонний процесс ChatGPT/Codex, stacked PR и ожидание отдельного интегратора отменён. `COLLABORATION.md` и `CHATBOT-AGENTS.md` больше не существуют.

## 1. Обязательное чтение до любых изменений

1. `README.md`.
2. `ts_and_ux.md` целиком. Это одновременно основная Technical Specification и список quick tasks.
3. `docs/00-START-HERE.md`.
4. `docs/15-CURRENT-IMPLEMENTATION-STATUS.md`.
5. `docs/16-OPEN-PROBLEMS-AND-QUICK-TASKS.md`.
6. `docs/17-DEPLOYMENT-AND-ENVIRONMENT-STATE.md`.
7. Релевантные технические контракты: `docs/02-ARCHITECTURE.md`, `03-PHOTO-STORAGE.md`, `04-DOMAIN-AND-CONTRACTS.md`, `05-SECURITY.md`, `06-UX-UI.md`, `07-QUALITY-AND-RELEASE.md`, `09-OPERATIONS.md`, `11-IDENTITY-AND-KEYS.md`, `12-CLIENT-STORAGE-AND-TRUSTED-TIME.md`, `13-PRODUCT-ACCEPTANCE-BASELINE.md`.

Старые отчёты в `docs/history/` — evidence, а не текущая инструкция. При расхождении действует последнее прямое решение владельца, затем `ts_and_ux.md`, затем актуальные status/problem документы.

## 2. Где находится рабочее приложение

- Текущая handoff-ветка: `handoff/owner-agent-2026-11-06`.
- Последний сохранённый implementation commit: `53f7d696d385fd81d3611089873db425c9175e8d`.
- Текущий развёрнутый runtime: `compat/assignment-release/`.
- Корневые `apps/web` и `apps/api` — отдельное незавершённое PB2-дерево. Не смешивать два runtime в одном изменении.
- Сервер: `https://photobunker.duckdns.org`, каталог `/var/www/photobunker`.

## 3. Статусы и честность

Использовать только эти статусы:

- `CONFIRMED` — факт проверен на текущем SHA/окружении.
- `IMPLEMENTED` — код существует, но пользовательский результат не подтверждён.
- `OWNER FAILED` — владелец проверил на реальном устройстве и сообщил дефект; тесты не могут повысить этот статус.
- `PARTIAL` — работает только часть сценария.
- `NOT RUN` — проверка не выполнялась.
- `BLOCKED` — опасная операция намеренно выключена до доказательства безопасности.
- `ACCEPTED` — только владелец подтвердил результат.

Нельзя писать «готово», если есть только код, unit test, Playwright или HTTP 200. Для UI важна реальная мобильная приёмка. Для безопасности нужны отдельные технические доказательства.

## 4. Как работать

1. Выбрать **один** пункт из quick-task очереди `docs/16-*`/`ts_and_ux.md`.
2. До кода воспроизвести дефект и зафиксировать текущий экран/маршрут/время/ошибку без приватных данных.
3. Сделать минимальный вертикальный fix. Не начинать параллельный редизайн пяти подсистем.
4. Сначала проверить затронутый сценарий; широкую регрессию запускать после работающего результата, а не вместо реализации.
5. Для mobile UI сделать production screenshot/видео на viewport, близком к реальному телефону, и проверить реальное устройство, когда оно доступно.
6. Обновить `docs/15-*` и `docs/16-*`: SHA, что изменено, PASS/FAIL/NOT RUN, что должен проверить владелец.
7. Коммитить и push после каждого законченного шага. Не force-push и не менять `main` без прямой команды владельца.

Отмена формы (`×`, Back, Cancel) не должна сохранять или создавать объект. Настройки, для которых владелец потребовал мгновенное сохранение, не должны показывать ложный dirty-state/unsaved dialog.

## 5. Технические инварианты

- Anonymous key-only identity; email/phone — только необязательные скрываемые поля профиля, не credentials.
- Local-first: shell и локальные данные не ждут HTTP; capture сначала шифруется и durable сохраняется, синхронизация позже.
- Фото, GPS, EXIF, PIN, ключи и токены не попадают в logs, URLs, analytics или plaintext persistent cache.
- Фото не экспортируется в системные Photos/DCIM автоматически.
- UI не должен напрямую владеть raw DB/HTTP/crypto/S3 бизнес-логикой; целевые границы — domain/application/infrastructure/ui.
- Photo, Photo Card, Assignment, Team, Note и Browser collection — разные сущности и scopes.
- TTL определяется выбором пользователя и пределами тарифа; зафиксированный при capture effective TTL нельзя незаметно продлевать.
- App PIN и emergency PIN — разные секреты, но вводятся через один визуально неразличимый экран согласно `ts_and_ux.md` и `docs/16-*`.
- `_old/**` и `1troitsky/photobunker` — только read-only evidence. Не редактировать, не форматировать, не stage/commit.

## 6. Запреты на окружение и данные

Без прямого подтверждения владельца запрещены:

- `docker system prune`, `docker compose down -v`;
- удаление containers/images/volumes и данных OrbStack/Colima;
- `migrate:fresh`, `db:wipe`, сидеры, restore БД;
- очистка PWA site data, IndexedDB, OPFS или пользовательского cache, если это может удалить фото/ключи;
- широкие destructive Local Delete/Emergency операции без preflight, recovery proof и owner approval.

Если порт занят, менять порт проекта или аккуратно останавливать только точно идентифицированный конфликтующий контейнер после согласования. Никогда не уничтожать чужой стек.

## 7. STOP

Остановить затронутый сценарий и зафиксировать проблему при любом из условий: plaintext photo/metadata на диске; потеря unsynced ciphertext; late ACK воскрешает удалённое; ACL/TTL обходится; expiry оставляет доступные файлы/metadata; ключ/PIN/GPS утекает; production camera ломается; destructive PIN может удалить данные без доказанного восстановления.

## 8. Документация в корне

В корне репозитория остаются только три Markdown-файла:

- `README.md`;
- `AGENTS.md`;
- `ts_and_ux.md`.

Все отчёты, матрицы, runbooks и история находятся в `docs/`.
