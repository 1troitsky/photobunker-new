# 00. Start here — handoff владельца и агента

Дата среза: 2026-11-06. Эта страница — первая точка входа после `README.md`, `AGENTS.md` и `ts_and_ux.md`.

## 1. Какая ветка является рабочей

- Рабочая ветка: `main`; handoff-ветка сохранена как точка передачи.
- База handoff: `53f7d696d385fd81d3611089873db425c9175e8d` (`wip(handoff): preserve deployed integration state`).
- Поздние изменения перенесены в `main` через fast-forward от `handoff/owner-agent-2026-11-06` на `ac6e942`.
- Предыдущая сохранённая ветка: `codex/integration-2026-11-04`; она остаётся резервным evidence.

## 2. Почему репозиторий выглядит как два приложения

В ветке существуют два дерева:

| Путь | Реальный смысл |
| --- | --- |
| `compat/assignment-release/` | Текущий развёрнутый Vue/Laravel runtime. Именно здесь находятся поздние UI/PIN/Browser/PWA изменения и серверный build. |
| `apps/web`, `apps/api` | PB2-модульное архитектурное дерево из прежнего implementation stack. Оно содержит полезные security/storage контракты, но не является текущим runtime сервера. |

Это архитектурный долг, а не разрешение бессрочно поддерживать два продукта. Нельзя исправить экран в одном дереве и считать, что изменился другой. Каждый commit обязан явно назвать затронутый runtime.

## 3. Что считать источником истины

1. Последнее решение владельца.
2. `ts_and_ux.md` — Technical Specification + quick tasks.
3. `docs/15-CURRENT-IMPLEMENTATION-STATUS.md`.
4. `docs/16-OPEN-PROBLEMS-AND-QUICK-TASKS.md`.
5. Технические invariants `docs/02-*`–`docs/13-*`.
6. `docs/history/` и `docs/recovery/` — evidence, не актуальный status.

Отчёт этапа 6 зафиксировал успешный автоматический E2E, но последующая проверка владельца на реальном iPhone выявила регрессии навигации, дока, PIN, Camera, Browser, photo view и форм. Поэтому слова «этап завершён» в историческом отчёте не равны `ACCEPTED`.

## 4. Текущая техническая точка

- Production URL: `https://photobunker.duckdns.org`.
- Remote directory: `/var/www/photobunker`.
- Последний подтверждённый release marker: `public-card-access-20261107-1` (см. `docs/15-*`).
- `/`, `/api/v1/health`, `/api/v1/ready` отвечали `200` после последнего deploy.
- `release.json`, `sw.js` и navigation HTML настроены как `no-store`; assets — content-hashed immutable.
- PWA update code существует, но новый док после этого deploy владелец ещё не подтвердил.
- Git HEAD на сервере исторически не совпадал с фактически скопированными исходниками. Не выполнять на сервере `git reset`, `checkout` или `pull`, пока не создан отдельный план безопасного развёртывания.

## 5. С чего продолжать

Работать строго по одному acceptance slice:

1. Зафиксировать текущий production mobile baseline скриншотами и timings.
2. Довести shell/dock/PWA update до подтверждения владельцем.
3. Исправить быстрый единый PIN input.
4. Полностью заменить Browser на классическую единую файловую модель.
5. Исправить Camera/capture/post-capture navigation и assignment scope.
6. Восстановить открытие Photo → Photo Card → Editor.

Полная очередь и критерии находятся в `docs/16-*`. Не начинать следующий slice, пока текущий не задокументирован и не передан владельцу на проверку.

## 6. Что нельзя делать в первом проходе

- Не объявлять приложение готовым по тестам.
- Не переписывать сразу весь UI и всю архитектуру.
- Не переносить массово `_old`.
- Не включать опасное удаление или recipient reads, если safety/ACL proof отсутствует.
- Не очищать PWA storage ради обновления интерфейса.
- Не тратить часы на широкую регрессию до появления видимого исправления выбранного дефекта.
