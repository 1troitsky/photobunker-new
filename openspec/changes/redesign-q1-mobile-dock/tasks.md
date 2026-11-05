# Tasks

## 1. Dock и локальная проверка

- [x] 1.1 Зафиксировать Q1 baseline: route, viewport, время, screenshot и конкретный дефект; проверить наличие артефакта `q1-before-20261106-320x700.png`.
- [x] 1.2 Убрать постоянный акцент Camera и унифицировать active/idle/pressed/focus состояния пяти пунктов; проверить через Playwright MCP, что активен ровно один пункт на Assignments, Camera и Contacts.
- [x] 1.3 Проверить геометрию и читаемость dock на 320×700, 375×812, 390×844, landscape и desktop, включая light/dark, клавиатуру и reduced motion; сохранить screenshots и записать результаты в `docs/15-*` и `docs/16-*`.

## 2. Сборка и выпуск

- [x] 2.1 Выполнить затронутые deterministic-тесты и production build; записать точные команды, exit codes и новый build ID. Запустить сопоставимый Lighthouse CI, если доступен релевантный baseline, иначе записать `NOT RUN`.
- [ ] 2.2 После проверок сделать commit/push в `main`, безопасно опубликовать новый static bundle с уникальным `PHOTOBUNKER_RELEASE_ID` и проверить публичный marker, assets, headers и API health; записать release ID и сценарий проверки владельцем в status docs/отчёт.

## Workflow follow-up

- Владелец повторно проверяет установленную PWA на реальном телефоне; только он может изменить `OWNER FAILED` на `ACCEPTED`.
