# Этап 5 — безопасное окружение Colima

Дата: 2026-11-04
Рабочий checkout: `/Users/ivan/Documents/WEB/photobunker-new/.codex-review`
Ветка: `codex/integration-2026-11-04`
Статус: приложение доступно локально; окружение пригодно для следующей проверки, но Compose health и воспроизводимость требуют исправления.

## 1. Docker и Colima

Проверка `docker context ls` показала:

- активный context — `colima`;
- endpoint — `unix:///Users/ivan/.colima/default/docker.sock`;
- context `orbstack` на этом компьютере отсутствует;
- CLI OrbStack также отсутствует;
- Docker Desktop context существует, но его daemon не запущен.

Выполнен штатный `colima start`. Команда ответила `already running, ignoring`, то есть профиль не пересоздавался. Последующая проверка вне ограниченного sandbox подтвердила:

```text
Colima: running using QEMU
Architecture: x86_64
Runtime: docker
Mount: 9p
Docker name: colima
Guest OS: Ubuntu 24.04.4 LTS
Kernel: 6.8.0-117-generic
Docker root: /var/lib/docker
Docker client/server: 29.7.2 / 29.5.2
```

Начальный `colima list` из sandbox ошибочно показывал `Broken`, а доступ к socket — `permission denied`. Авторитетная проверка с доступом к локальному daemon подтвердила, что VM и Docker работают. Никакого repair/delete/recreate не выполнялось.

## 2. Какой Compose реально есть в integration branch

Корневого `compose.yaml`/`docker-compose.yml` у native PB2 runtime нет. Единственный Docker-стек находится в:

```text
compat/assignment-release/compose.yaml
```

Это изолированный compatibility runtime старого Laravel/Vue приложения, а не полноценный Compose новой PB2-архитектуры. Он содержит:

- PostgreSQL 17;
- Garage 2.4.1;
- Laravel API;
- queue worker;
- scheduler;
- Vue/Vite web;
- Nginx gateway;
- опциональный Matrix profile.

Native PB2 frontend и `apps/api` этим Compose не поднимаются. Следовательно, текущий Docker-запуск подтверждает compatibility-приложение, но ещё не доказывает воспроизводимый запуск всего native PB2 runtime.

## 3. Почему `./scripts/dev setup` не запускался

Скрипт изучен до запуска. Он содержит:

- `docker compose down` при смене network mode;
- одноразовые контейнеры с `docker compose run --rm`;
- обычный `php artisan migrate --force`;
- настройку Garage;
- полный `docker compose up -d --wait`.

В текущем окружении зависимости, env-файлы, volumes и контейнеры уже существовали. Запуск `setup` нарушил бы установленное владельцем ограничение на удаление контейнеров и мог пересоздать работающий стек. Поэтому он не выполнялся.

Не запускались:

- `migrate:fresh`;
- `db:wipe`;
- сидеры;
- restore БД;
- любые обычные migrations;
- `docker compose down` или `down -v`;
- `docker system prune`;
- удаление контейнеров, images или volumes.

## 4. Конфликты и изоляция

В Colima уже работает чужой Compose-проект `artefacts-laravel`. Он занимает в том числе:

- `8080`;
- `8081`;
- `5173`;
- `5432`.

Этот проект и его контейнеры не останавливались и не изменялись.

У PhotoBunker уже были безопасно назначены другие host ports в ignored local `.env`:

```text
APP_PORT=18081
S3_PORT=13901
COMPOSE_PROJECT_NAME=photobunker-assignment-release
```

PostgreSQL PhotoBunker не опубликован на host. Named volumes отдельные:

- `photobunker-assignment-release_postgres-data`;
- `photobunker-assignment-release_garage-meta`;
- `photobunker-assignment-release_garage-data`.

## 5. Фактическое состояние запуска

На момент проверки уже существовал частично поднятый PhotoBunker stack. Ничего не пересоздавалось. Был запущен только существующий остановленный worker:

```sh
docker start photobunker-assignment-release-worker-1
```

Итоговое состояние:

- PostgreSQL — `healthy`;
- Garage — `healthy`;
- scheduler — `Up`;
- worker — `Up` после точечного старта;
- ручной replacement API `photobunker-colima-api` — `Up`;
- ручной replacement Web `photobunker-colima-web` — `Up`;
- gateway — `Up`, но Docker health status `unhealthy`;
- старые Compose API/Web containers остаются `Exited (143)` и не запускались, чтобы не создавать дубли network aliases.

Ручные API/Web replacements используют тот же checkout и network aliases `api`/`web`. Их наличие означает, что текущее окружение является рабочим, но не каноническим чистым Compose-запуском.

## 6. Healthcheck и HTTP

Проверки:

```text
GET http://127.0.0.1:18081/              -> 200 text/html
HTML                                     -> PhotoBunker, <title>PhotoBunker</title>, id="app"
GET http://127.0.0.1:18081/api/v1/ready -> 200 application/json, {"status":"ready"}
GET http://127.0.0.1:13901/             -> 403 application/xml (ожидаемый private S3 response)
```

API readiness на старом компьютере отвечал примерно за 14 секунд. Внутренний запрос gateway к главной странице занимал примерно 6.85 секунды. В Compose для gateway задан `timeout: 3s`, поэтому healthcheck стабильно получает `Health check exceeded timeout`, хотя внешняя главная страница возвращает 200.

Это не следует маскировать как PASS:

- HTTP smoke — **PASS**;
- PostgreSQL/Garage health — **PASS**;
- worker/scheduler process state — **PASS на момент проверки**;
- gateway Docker healthcheck — **FAIL: timeout 3s**;
- чистый канонический `docker compose up --wait` — **NOT RUN**, так как он мог пересоздать контейнеры;
- native PB2 full-stack Compose — **ABSENT**.

## 7. Безопасные команды для текущего Colima-окружения

### Запуск существующего проекта без пересоздания

```sh
docker context use colima
colima start
cd /Users/ivan/Documents/WEB/photobunker-new/.codex-review/compat/assignment-release
docker compose start postgres garage
docker start photobunker-colima-api photobunker-colima-web
docker compose start worker scheduler gateway
docker compose ps --all
curl --max-time 30 http://127.0.0.1:18081/
curl --max-time 60 http://127.0.0.1:18081/api/v1/ready
```

Эти команды запускают только уже существующие containers. Они не подходят как bootstrap чистого клона, пока безопасный setup и root native Compose не подготовлены.

### Остановка PhotoBunker без удаления данных

```sh
cd /Users/ivan/Documents/WEB/photobunker-new/.codex-review/compat/assignment-release
docker compose stop gateway worker scheduler garage postgres
docker stop photobunker-colima-web photobunker-colima-api
```

Не использовать для этой задачи `./scripts/dev down`, `docker compose down`, `down -v` или `prune`.

### Возврат к OrbStack на компьютере, где context существует

```sh
docker context use orbstack
```

На текущем старом компьютере context `orbstack` отсутствует, поэтому здесь эта команда ожидаемо завершится ошибкой и не нужна.

## 8. Что нужно исправить позже

1. Добавить канонический Colima Compose для native PB2 frontend/API либо явно документировать двух-runtime схему.
2. Убрать зависимость запуска от ручных replacement containers.
3. Сделать healthchecks реалистичными для старого двухъядерного профиля, не ослабляя production readiness.
4. Разделить safe `start` и destructive/recreate bootstrap; setup не должен неявно вызывать `down` при обычном запуске.
5. После отдельного разрешения выполнить обычные schema migrations только на изолированной dev DB и проверить полный API/queue flow. Destructive migrations и seed/restore остаются запрещены без подтверждения владельца.

## 9. Контроль целостности

- Application code не изменялся.
- Integration branch осталась clean.
- `_old` остался clean и не изменялся.
- `main`, remote refs и GitHub не изменялись.
- Не удалено ни одного container, image, volume или файла данных.
- Чужой `artefacts-laravel` stack не изменялся.
