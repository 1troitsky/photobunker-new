# PhotoBunker New — общие правила разработки и независимой проверки

**Проект:** `1troitsky/photobunker-new`. Этот документ применяется ко всему репозиторию. **Роли: ChatGPT — главный разработчик и координатор; Codex — независимый проверяющий (review/tests), а не разработчик; владелец — продуктовые решения, merge authorization и ручная приёмка.** См. `COLLABORATION.md`. **Никто не вправе молча заменить продуктовые решения своими.**

## 0. Начало любой работы

1. Заново прочитать актуальный `main` и в порядке: `README.md`, этот `AGENTS.md`, `CHATBOT-AGENTS.md`, `COLLABORATION.md`, `docs/08-ROADMAP.md`, `docs/02-ARCHITECTURE.md`, `docs/03-PHOTO-STORAGE.md`, `docs/04-DOMAIN-AND-CONTRACTS.md`, `docs/05-SECURITY.md`, `docs/06-UX-UI.md`, `docs/07-QUALITY-AND-RELEASE.md`, `docs/09-OPERATIONS.md`, `docs/10-CHECKLIST-MAP.md`, а также **полный** текст назначенного Issue и замечания ревью.
2. Внешние ссылки обязательны как исходные сведения, но **не перекрывают согласованные новые решения**: [аудит 28.10.2026](https://github.com/1troitsky/photobunker/blob/main/docs/AUDIT-20261028.md) и [текущий checklist](https://github.com/1troitsky/photobunker/blob/main/docs/CHECKLIST.md).
3. Уточнить текущий SHA `main`, состояние Project, зависимости и все OPEN decisions затронутой области. Не работать из сохранённой в памяти копии.
4. Пока документация не утверждена владельцем и Issue не переведён в `Ready`, **не писать код**.

## 1. Иерархия решений

Явное новое решение владельца > зафиксированные DECIDED в `docs/03-PHOTO-STORAGE.md` и других контрактах > AGENTS/CHATBOT-AGENTS/COLLABORATION > Issue и roadmap > прежние документы/код. Если противоречие затрагивает секреты, хранение, уничтожение или права, **остановиться, показать конфликт владельцу**, не выбирать компромисс самостоятельно. Разрешено уточнять только область текущей задачи.

**В первой версии НЕТ:** мессенджера, Matrix/Tuwunel, чатов, звонков/RTC. Не импортировать их и не создавать «на будущее» зависимости. Функции Notes/Teams и иные необязательные из checklist включать только в перечисленный roadmap scope.

## 2. Архитектурные запреты

- PhotoBunker New — новый продукт, не монолитное копирование старого `apps/web`. Legacy изучать и использовать **проверенные** спецификации/fixtures/сценарии. Не копировать старые mega-stores и crypto без review.
- Структура feature modules: отдельные domain/application/infrastructure/ui и публичные API. UI не импортирует HTTP, IndexedDB/OPFS, crypto SDK, Storage SDK. Domain не зависит от UI/платформы. Нет циклических cross-feature imports. Правила *enforced* CI и негативными тестами.
- Никакого гигантского состояния приложения или бизнес-логики в компонентах. У каждого файла одна ограниченная ответственность; тяжёлый код разделяется по задачам, а не механическим переносом строк.
- Только один источник истины для `Photo` и связанных assets/metadata. Assignment задаёт snapshot capture policy; Editor выпускает операцию, а storage owner применяет её. Browser/Card используют только разрешённые проекции.
- Local-first: открыть shell без сети; захват -> шифрование -> надёжный локальный commit -> видимое состояние -> фоновая идемпотентная синхронизация с S3; never await HTTP for navigation. Обработка offline/reload/crash/storage full/retry/lost ACK/stale responses/account switch обязательна.
- Три режима фото: (1) raw camera bytes без повторного сжатия, **UI disabled**; (2) compressed source retained + separate current edit; (3) compressed current master replaced after edit, **default**. При отсутствии задания default 3. Не сохранять постоянные копии без owner/TTL/purpose. Ключевые решения — в `docs/03-PHOTO-STORAGE.md`.
- Снимки **не попадают в системную галерею**, persistent local photo bytes / sensitive metadata **только зашифрованы**; фото metadata — отдельные записи локальной БД, позднее server DB. Plaintext допускается только как краткоживущая память. Никаких plaintext IndexedDB, localStorage, OPFS, disk temp, analytics, URL, logs.
- Не выдавать доступ по ссылке на Card/Browser без проверки независимого ACL/TTL. Отзыв/удаление fail-closed, поздние ACK не воскрешают данные. Шифрование/подписи/ключи нельзя самовольно упрощать.
- PIN интерфейса ≠ PIN локального удаления ≠ экстренный PIN ≠ криптоключ. Безопасность подтверждается отдельной threat model.
- Production-ready — реальная production-сборка и end-to-end, не успешный dev-сервер или unit tests. Не создавать unsafe prototype mode.
- **Запрещено:** destructive migration старых данных, `rm` пользовательских volumes, изменение legacy repo, секреты/приватные fixtures в Git, `force push`, отключение CI и self-merge без явного полномочия владельца.

## 2.1. Последовательность и ранние ручные проверки

Новый клиент **не** создаётся копированием всего `photobunker`. Reuse = audit -> scope -> contract test -> перенос/adaptation конкретного элемента, а не копирование деревьев `apps/web` или backend migrations. Причину каждого использования legacy кода фиксировать в PR.

Вехи owner acceptance обязательны **до окончания всего проекта**: после R2-02 — собранный production frontend с пятью UI-экранами доступен на отдельном HTTPS preview; после R2-06 — реальная камера, зашифрованный local commit, минимальный просмотр, offline/reload **без S3**; после R2-05/R2-07 — S3 и полная галерея; далее задачи и совместная работа, редактор и Card, Browser/PIN. См. [Roadmap §1.1](docs/08-ROADMAP.md). Владелец не обязан тестировать каждый маленький PR. Нельзя имитировать существование preview URL или выдавать UI fixture за рабочую съёмку.

R2-01 обеспечивает staging/preview для **ранних** проверок. R2-24 — финальный релиз, не первая демонстрация владельцу. **ChatGPT создаёт весь прикладной код и исправляет замечания Codex; Codex независимо проверяет/тестирует, не пишет продуктовые функции.**

## 3. Как выполняются задачи

Источник сроков/приоритета — GitHub Project; долгосрочный scope — `docs/08-ROADMAP.md`; acceptance каждой операции — Issue. **Все Issues roadmap можно создать заранее**, но одновременно `In Progress` у ChatGPT не более одного. ChatGPT сопровождает backlog и implementation; Codex проверяет готовые PR и не ведёт разработку. Не создавать отдельную мини-дорожную карту на каждый чат.

Для разработки: только `Ready` Issue с принятыми зависимостями и решениями, отдельная ветка `chatbot/<task-id>-<slug>`, один Draft PR в `main` с `Closes #N`. **ChatGPT пишет реализацию, проверяет доступные тесты и вносит исправления Codex в тот же PR.** Локальный **Codex только независимо проверяет**, запускает production build/contract/security/E2E tests и даёт доказанные PASS/FAIL/NOT RUN; не обязан и не должен писать функциональный код. **Merge только после отдельного разрешения владельца; никакой агент автоматически не сливает PR и не меняет `main`.** Владелец выполняет реальную пользовательскую приёмку.

Перед handoff перечитать **полный итоговый diff `main...HEAD`**, текущий `main`, затронутые контракты. Показать выполненные тесты и NOT RUN, риски, миграции и security implications. Не выдавать теги `DONE` или `production-ready` без подтверждений.

## 4. Обязательная техническая приёмка

Для любого пользовательского пути: happy/error, local save, offline/reconnect, reload/crash, concurrent/conflict/retry, account/device isolation, ACL/TTL/revoke, mobile + desktop RU/EN, production build and E2E. Для destructive PIN/delete — отдельная матрица атак и отказов. Скорость измерять на реальном устройстве, а не оценивать по субъективному ощущению агента.

Если не удалось проверить на устройстве/на production, писать `NOT RUN`, не подменять проверку самооценкой. Вся техническая работа остаётся `Integrated` до пользовательского `Accepted`.
