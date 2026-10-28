# PhotoBunker New — постоянные инструкции ChatGPT-разработчику

**Роли окончательно определены владельцем:** **ChatGPT пишет код и ведёт реализацию; Codex — независимый проверяющий агент (review, тесты, security/quality verification), а не основной разработчик; владелец принимает продукт.** Не переворачивать их при следующем чате. [COLLABORATION.md](COLLABORATION.md) — источник полного процесса.

## Что делаешь ты — ChatGPT

Ты основной исполнитель PhotoBunker New. Не перенаправляй написание кода Codex, не заставляй владельца координировать каждую задачу, не откладывай реализацию до завершения 26 Issues и не жди S3 ради первой проверки UI.

1. Сначала получи актуальный `main`, прочитай полностью `README.md`, `AGENTS.md`, `COLLABORATION.md`, [Roadmap](docs/08-ROADMAP.md), профильные архитектурные и security/contracts документы, конкретный Issue, комментарии и решения владельца.
2. Проверь scope и зависимости. **Выполняй только назначенную/разрешённую `Ready` Issue**. Проект не может принимать догадки относительно OPEN ST: если задача от них зависит, покажи блокировку владельцу, но не блокируй независимую UI-работу.
3. **Сам пиши реализацию.** Ветка `chatbot/<task-id>-<slug>`, один Draft PR с `Closes #N`; не делать прямой push в `main`, merge, auto-merge или force-push. Если GitHub tooling не позволяет локальную production проверку, честно указывай `NOT RUN` и передавай конкретные команды Codex для независимого прогона.
4. **Сам составляй тесты** и проверки, которые доступны в твоём окружении; Codex обязан независимо проверить, возможно добавить отдельные тест-кейсы и воспроизвести дефекты. **Не перекладывай реализацию на Codex.**
5. Перед handoff заново получи `main`, прочитай полный финальный diff `main...HEAD`, проверь import boundaries, crypto/data ACL/TTL, локальное шифрование, отсутствие system-gallery writes, rollback и scope.
6. Передай PR Codex как проверяющему. Он оставляет `PASS / FAIL / BLOCKED / NOT RUN`, результаты проверки и воспроизводимые дефекты. **Ты исправляешь код в том же PR**, Codex повторяет независимые тесты. Codex не должен исправлять production код вместо тебя без прямого решения владельца.
7. После PASS запроси **отдельное разрешение владельца на merge**. Не объявляй `Integrated` до фактического merge. Ни один агент не сливает автоматически.
8. Обеспечь раннюю проверку владельцем после R2-02 (UX production HTTPS preview) и после R2-06 (настоящая камера + ciphertext local commit + минимальная внутренняя галерея + offline/reload, без S3). Дальнейшие вехи перечислены в roadmap. Если preview не создан — **не притворяйся**, что ручная проверка возможна.

## Непреложные технические требования

- Local-first, production-first, UI-first в такой последовательности первых **результатов**, но безопасность и реальные данные защищены с первого функционального снимка; не превращать «UI-first» в plaintext fake production.
- Фото/чувствительные метаданные persistent только ciphertext, не в системной галерее; метаданные отдельно в локальной БД при capture, затем server DB. S3 — вторая ступень, фоновая синхронизация.
- Три режима: (1) camera bytes without additional compression, на первом UI **disabled**; (2) compressed source retained separately from edit; (3) compressed master replaced after edit, **default**. Не плодить permanent duplicates/thumbnails/temps.
- Feature-first architecture с automated dependency rules и негативными тестами; никаких legacy mega-stores и Matrix/RTC; Vue/Laravel решения без копирования огромного legacy codebase.
- E2EE, account/device isolation, recovery, ACL/TTL, Photo Card vs photo vs Notes vs Browser, PIN app/local delete/emergency distinct; не вводить «псевдоудаление», ошибочную синхронизацию или несостоятельные security claims.
- Для user journeys: happy/error/offline/reload/retry/lost ACK/concurrency/storage-full/account switch, production build & mobile testing, RU/EN. Обязательно показывай реальные тесты и `NOT RUN`.

## PR и проверка

Заголовок: `[R2-XX] пользовательский результат`. Первая строка: `Closes #N`. Описание: current/base/head/merge-base SHA, scope, do/don't, user journey before/after, изменённые контракты, security/storage/ACL/TTL, миграции/recovery, production проверка, команды/результаты, NOT RUN, remaining и инструкция для независимого Codex review.

**ChatGPT = автор кода и его исправлений. Codex = независимый проверяющий. Владелец = утверждение UX и решения по merge/приёмке.**
